//! Removes the vocals from a song with an MDX-Net model, the way UVR (Ultimate
//! Vocal Remover) does it, but as a stream: the song is read a model chunk at a
//! time (~3 s), overlapping chunks are cross-faded with a Hann window, and every
//! stretch that no later chunk touches is handed out at once, so it can be
//! played while the rest is still being worked on.
//!
//! Mirrors UVR's demix(): `trim` zeros in front, chunks every 75% of a chunk,
//! the song padded at the end to a whole number of generated blocks.
//! (Port of the phone app's VocalRemover.kt.)

use std::f64::consts::PI;

use super::stft::MdxStft;
use crate::audio::PcmSource;

/// numpy.hanning: symmetric, zero at both ends.
fn hanning(n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| if n == 1 { 1.0 } else { (0.5 - 0.5 * (2.0 * PI * i as f64 / (n - 1) as f64).cos()) as f32 })
        .collect()
}

/// Reads `source` to the end, calling `sink` with the instrumental in order (from
/// the song's first sample). `model` turns a spectrogram into the instrumental's;
/// `cancelled` is checked between chunks. Returns the frames written.
pub fn run(
    stft: &mut MdxStft,
    n_fft: usize,
    source: &mut dyn PcmSource,
    model: &mut dyn FnMut(&[f32], &mut [f32]) -> Result<(), String>,
    sink: &mut dyn FnMut(&[f32], &[f32], usize, usize) -> Result<(), String>,
    cancelled: &dyn Fn() -> bool,
) -> Result<u64, String> {
    let overlap = 0.25;
    let trim = n_fft / 2;
    let chunk = stft.chunk;
    let gen = (chunk - 2 * trim) as i64;
    let step = ((1.0 - overlap) * chunk as f64) as usize;

    let mut mix_l = vec![0f32; chunk];
    let mut mix_r = vec![0f32; chunk];
    let mut acc_l = vec![0f32; chunk];
    let mut acc_r = vec![0f32; chunk];
    let mut weight = vec![0f32; chunk];
    let mut out_l = vec![0f32; chunk];
    let mut out_r = vec![0f32; chunk];
    let mut spec = vec![0f32; stft.size];
    let mut pred = vec![0f32; stft.size];
    let full_window = hanning(chunk);

    let mut song_frames: i64 = -1; // known at the end of the input
    let mut read: i64 = 0;
    let mut written: u64 = 0;
    let mut pos: i64 = 0; // padded position of the current chunk
    // The padded song starts with `trim` zeros.
    let mut filled = trim;

    loop {
        if cancelled() {
            return Err("cancelled".into());
        }
        // Fill the chunk: song frames, then zeros once it's over.
        while filled < chunk {
            let n = if song_frames < 0 {
                source.read(&mut mix_l, &mut mix_r, filled, chunk - filled)
            } else {
                0
            };
            if n == 0 {
                if song_frames < 0 {
                    song_frames = read;
                }
                mix_l[filled..].fill(0.0);
                mix_r[filled..].fill(0.0);
                filled = chunk;
            } else {
                filled += n;
                read += n as i64;
            }
        }
        let padded = if song_frames >= 0 {
            trim as i64 + song_frames + (gen + trim as i64 - song_frames % gen)
        } else {
            i64::MAX
        };
        let actual = (chunk as i64).min(padded - pos) as usize;
        let short;
        let window: &[f32] = if actual == chunk {
            &full_window
        } else {
            short = hanning(actual);
            &short
        };

        stft.forward(&mix_l, &mix_r, &mut spec);
        model(&spec, &mut pred)?;
        stft.inverse(&pred, &mut out_l, &mut out_r);
        for i in 0..actual {
            let w = window[i];
            acc_l[i] += out_l[i] * w;
            acc_r[i] += out_r[i] * w;
            weight[i] += w;
        }

        let last = pos + step as i64 >= padded;
        let done = if last { actual } else { step };
        // Finished stretch [pos, pos + done) → song frames [pos - trim, …).
        let mut from = 0usize;
        let mut to = done as i64;
        if pos < trim as i64 {
            from = (trim as i64 - pos) as usize;
        }
        if song_frames >= 0 {
            to = to.min(trim as i64 + song_frames - pos);
        }
        if to > from as i64 {
            let to = to as usize;
            for i in from..to {
                let w = weight[i];
                out_l[i] = if w > 1e-8 { acc_l[i] / w } else { 0.0 };
                out_r[i] = if w > 1e-8 { acc_r[i] / w } else { 0.0 };
            }
            sink(&out_l, &out_r, from, to - from)?;
            written += (to - from) as u64;
        }
        if last {
            return Ok(written);
        }

        // Slide everything by one step.
        let keep = chunk - step;
        mix_l.copy_within(step.., 0);
        mix_r.copy_within(step.., 0);
        acc_l.copy_within(step.., 0);
        acc_r.copy_within(step.., 0);
        weight.copy_within(step.., 0);
        acc_l[keep..].fill(0.0);
        acc_r[keep..].fill(0.0);
        weight[keep..].fill(0.0);
        filled = keep;
        pos += step as i64;
    }
}
