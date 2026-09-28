//! Decodes an audio file as 44.1 kHz stereo float, pulled as it's needed
//! (nothing is decoded ahead into memory). Mono is doubled to both sides; for
//! more than two channels the front pair is kept. Same as the phone app's
//! karaoke/AudioReader.kt, with Symphonia instead of the phone's codecs.

use std::fs::File;
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub const SAMPLE_RATE: u32 = 44_100;

/// Stereo float audio, read a block at a time.
pub trait PcmSource {
    /// Fills up to `count` frames from `offset`; fewer only at the end (0 = finished).
    fn read(&mut self, left: &mut [f32], right: &mut [f32], offset: usize, count: usize) -> usize;
}

pub struct AudioReader {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    resampler: Option<Resampler>,
    /// Converted frames waiting to be read.
    fifo_l: Vec<f32>,
    fifo_r: Vec<f32>,
    fifo_start: usize,
    done: bool,
    /// Length from the file's header, in seconds (0 if unknown).
    pub duration: f64,
    sample_buf: Option<SampleBuffer<f32>>,
}

fn open_format(path: &str) -> Result<(Box<dyn FormatReader>, u32, symphonia::core::codecs::CodecParameters), String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions { enable_gapless: true, ..Default::default() }, &MetadataOptions::default())
        .map_err(|e| format!("Can't read this file ({e})"))?;
    let format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("No audio track")?;
    let id = track.id;
    let params = track.codec_params.clone();
    Ok((format, id, params))
}

fn duration_of(params: &symphonia::core::codecs::CodecParameters) -> f64 {
    match (params.n_frames, params.sample_rate) {
        (Some(n), Some(r)) if r > 0 => n as f64 / r as f64,
        _ => match (params.n_frames, params.time_base) {
            (Some(n), Some(tb)) => {
                let t = tb.calc_time(n);
                t.seconds as f64 + t.frac
            }
            _ => 0.0,
        },
    }
}

impl AudioReader {
    pub fn open(path: &str) -> Result<Self, String> {
        let (format, track_id, params) = open_format(path)?;
        let decoder = symphonia::default::get_codecs()
            .make(&params, &DecoderOptions::default())
            .map_err(|e| format!("Unsupported audio ({e})"))?;
        let rate = params.sample_rate.unwrap_or(SAMPLE_RATE);
        Ok(Self {
            format,
            decoder,
            track_id,
            resampler: if rate != SAMPLE_RATE { Some(Resampler::new(rate, SAMPLE_RATE)) } else { None },
            fifo_l: Vec::with_capacity(1 << 16),
            fifo_r: Vec::with_capacity(1 << 16),
            fifo_start: 0,
            done: false,
            duration: duration_of(&params),
            sample_buf: None,
        })
    }

    /// Decodes the next packet into the FIFO. False when the file is over.
    fn decode_more(&mut self) -> bool {
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(_) => {
                    // End of file (or a broken tail): flush the resampler and stop.
                    if let Some(rs) = self.resampler.as_mut() {
                        let (l, r) = (&mut self.fifo_l, &mut self.fifo_r);
                        rs.flush(|a, b| {
                            l.extend_from_slice(a);
                            r.extend_from_slice(b);
                        });
                    }
                    return false;
                }
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            let decoded = match self.decoder.decode(&packet) {
                Ok(d) => d,
                Err(SymError::DecodeError(_)) => continue,
                Err(_) => return false,
            };
            let spec = *decoded.spec();
            let frames = decoded.frames();
            if frames == 0 {
                continue;
            }
            let channels = spec.channels.count().max(1);
            let need = decoded.capacity() as u64;
            if self.sample_buf.as_ref().map_or(true, |b| b.capacity() < need as usize * channels) {
                self.sample_buf = Some(SampleBuffer::<f32>::new(need, spec));
            }
            let sb = self.sample_buf.as_mut().unwrap();
            sb.copy_interleaved_ref(decoded);
            let data = sb.samples();
            let mut left = Vec::with_capacity(frames);
            let mut right = Vec::with_capacity(frames);
            for f in 0..frames {
                let l = data[f * channels];
                let r = if channels > 1 { data[f * channels + 1] } else { l };
                left.push(l);
                right.push(r);
            }
            match self.resampler.as_mut() {
                Some(rs) => {
                    let (fl, fr) = (&mut self.fifo_l, &mut self.fifo_r);
                    rs.push(&left, &right, |a, b| {
                        fl.extend_from_slice(a);
                        fr.extend_from_slice(b);
                    });
                }
                None => {
                    self.fifo_l.extend_from_slice(&left);
                    self.fifo_r.extend_from_slice(&right);
                }
            }
            return true;
        }
    }
}

impl PcmSource for AudioReader {
    fn read(&mut self, left: &mut [f32], right: &mut [f32], offset: usize, count: usize) -> usize {
        while self.fifo_l.len() - self.fifo_start < count && !self.done {
            if !self.decode_more() {
                self.done = true;
            }
        }
        let available = self.fifo_l.len() - self.fifo_start;
        let n = available.min(count);
        let s = self.fifo_start;
        left[offset..offset + n].copy_from_slice(&self.fifo_l[s..s + n]);
        right[offset..offset + n].copy_from_slice(&self.fifo_r[s..s + n]);
        self.fifo_start += n;
        // Drop what's been read once it's a good part of the buffer.
        if self.fifo_start > (1 << 16) {
            self.fifo_l.drain(..self.fifo_start);
            self.fifo_r.drain(..self.fifo_start);
            self.fifo_start = 0;
        }
        n
    }
}

/// Length in seconds from the file's header, or by decoding it when the header doesn't say.
#[tauri::command]
pub async fn audio_duration(path: String) -> Option<f64> {
    tauri::async_runtime::spawn_blocking(move || {
        let (mut format, track_id, params) = open_format(&path).ok()?;
        let d = duration_of(&params);
        if d > 0.0 {
            return Some(d);
        }
        // No length in the header (some WAV/MP3): count the packets' durations.
        let tb = params.time_base?;
        let mut ts = 0u64;
        while let Ok(p) = format.next_packet() {
            if p.track_id() == track_id {
                ts = ts.max(p.ts() + p.dur());
            }
        }
        let t = tb.calc_time(ts);
        Some(t.seconds as f64 + t.frac)
    })
    .await
    .ok()
    .flatten()
}

// ---- resampling ----

/// Streaming stereo sample-rate converter: a Blackman-windowed sinc (32 taps)
/// read from a table of 512 phases, with its cut-off lowered below the new
/// Nyquist when converting down (48 → 44.1 kHz). Output positions are counted
/// exactly (k·from/to in integers), so long songs don't drift.
pub struct Resampler {
    from: u64,
    to: u64,
    table: Vec<[f32; 32]>,
    in_l: Vec<f32>,
    in_r: Vec<f32>,
    /// Global input index of in_l[HALF] (the leading zeros come first).
    dropped: u64,
    total_in: u64,
    produced: u64,
}

const HALF: usize = 16;
const PHASES: usize = 512;

impl Resampler {
    pub fn new(from: u32, to: u32) -> Self {
        let cutoff = (to as f64 / from as f64).min(1.0) * 0.97;
        let sinc = |x: f64| if x.abs() < 1e-9 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) };
        let blackman = |x: f64| {
            if x.abs() >= HALF as f64 {
                return 0.0;
            }
            let t = (x + HALF as f64) / (2.0 * HALF as f64);
            0.42 - 0.5 * (2.0 * std::f64::consts::PI * t).cos() + 0.08 * (4.0 * std::f64::consts::PI * t).cos()
        };
        let table = (0..=PHASES)
            .map(|ph| {
                let frac = ph as f64 / PHASES as f64;
                let mut taps = [0f64; 32];
                let mut sum = 0.0;
                for (j, tap) in taps.iter_mut().enumerate() {
                    let x = frac + HALF as f64 - 1.0 - j as f64;
                    let v = cutoff * sinc(cutoff * x) * blackman(x);
                    *tap = v;
                    sum += v;
                }
                let mut out = [0f32; 32];
                for j in 0..32 {
                    out[j] = (taps[j] / sum) as f32;
                }
                out
            })
            .collect();
        Self {
            from: from as u64,
            to: to as u64,
            table,
            in_l: vec![0.0; HALF],
            in_r: vec![0.0; HALF],
            dropped: 0,
            total_in: 0,
            produced: 0,
        }
    }

    pub fn push(&mut self, left: &[f32], right: &[f32], out: impl FnMut(&[f32], &[f32])) {
        self.in_l.extend_from_slice(left);
        self.in_r.extend_from_slice(right);
        self.total_in += left.len() as u64;
        self.drain(false, out);
    }

    /// Call once at the end: the last frames, whose right taps fall past the input.
    pub fn flush(&mut self, out: impl FnMut(&[f32], &[f32])) {
        self.in_l.extend(std::iter::repeat(0.0).take(HALF + 1));
        self.in_r.extend(std::iter::repeat(0.0).take(HALF + 1));
        self.drain(true, out);
    }

    fn drain(&mut self, last: bool, mut out: impl FnMut(&[f32], &[f32])) {
        let total_out = (self.total_in * self.to + self.from - 1) / self.from;
        let mut ol = Vec::with_capacity(4096);
        let mut or = Vec::with_capacity(4096);
        loop {
            if last && self.produced >= total_out {
                break;
            }
            let num = self.produced * self.from;
            let idx = num / self.to;
            if !last && idx + HALF as u64 >= self.total_in {
                break;
            }
            let frac = (num % self.to) as f64 / self.to as f64;
            let taps = &self.table[(frac * PHASES as f64 + 0.5) as usize];
            // Array position of input idx - HALF + 1 (leading zeros offset by HALF).
            let base = (idx + 1 - self.dropped) as usize;
            let mut l = 0f32;
            let mut r = 0f32;
            for j in 0..2 * HALF {
                let w = taps[j];
                l += self.in_l[base + j] * w;
                r += self.in_r[base + j] * w;
            }
            ol.push(l);
            or.push(r);
            self.produced += 1;
            if ol.len() == 4096 {
                out(&ol, &or);
                ol.clear();
                or.clear();
            }
        }
        if !ol.is_empty() {
            out(&ol, &or);
        }
        // Forget inputs no future output reaches.
        let next_idx = self.produced * self.from / self.to;
        let keep_from = (next_idx + 1).saturating_sub(self.dropped) as usize;
        if keep_from >= 16384 && keep_from < self.in_l.len() {
            self.in_l.drain(..keep_from);
            self.in_r.drain(..keep_from);
            self.dropped += keep_from as u64;
        }
    }
}
