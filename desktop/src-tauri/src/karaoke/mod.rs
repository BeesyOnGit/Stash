//! Karaoke, native side (TypeScript: src/core/services/karaoke.ts).
//!
//! - `karaoke_separate`: the instrumental of a song, made by the vocal-removal
//!   model (UVR-MDX-NET Inst HQ 4, downloaded on first use) and streamed to the
//!   web view as short WAV pieces while the full WAV is written.
//! - `karaoke_mix`: the instrumental (or the song) and a recorded voice → one WAV.
//!
//! A port of the phone app's karaoke/KaraokeModule.kt.

#![cfg_attr(not(feature = "karaoke"), allow(dead_code, unused_imports, unused_variables))]

mod remover;
mod stft;

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[cfg(feature = "karaoke")]
use ort::session::builder::GraphOptimizationLevel;
#[cfg(feature = "karaoke")]
use ort::session::{RunOptions, Session};
#[cfg(feature = "karaoke")]
use ort::value::{Tensor, ValueType};

/// Builds without the voice remover: jobs fail with this message, mixing still works.
#[cfg(not(feature = "karaoke"))]
type Session = ();
#[cfg(not(feature = "karaoke"))]
struct RunOptions;
#[cfg(not(feature = "karaoke"))]
impl RunOptions {
    fn terminate(&self) -> Result<(), String> {
        Ok(())
    }
}
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::audio::{AudioReader, PcmSource, SAMPLE_RATE};
use stft::MdxStft;

/// UVR-MDX-NET Inst HQ 4's settings (UVR's model_data: n_fft 5120, hop 1024).
const N_FFT: usize = 5120;
const HOP: usize = 1024;
const RATE: f64 = SAMPLE_RATE as f64;
const KNEE: f32 = 0.9;

#[derive(Default)]
pub struct Karaoke {
    /// The loaded model, kept between songs while karaoke is open. Its lock is
    /// also the queue: one song is made at a time.
    session: Arc<Mutex<Option<(String, Session)>>>,
    cancelled: Arc<Mutex<Option<String>>>,
    running: Arc<Mutex<Option<(String, Arc<RunOptions>)>>>,
    mixing: Arc<Mutex<()>>,
}

#[derive(Clone, Serialize)]
struct PieceEvent {
    job: String,
    path: String,
    index: usize,
    start: f64,
    duration: f64,
    done: f64,
    total: f64,
    elapsed: f64,
}

/// The model is fully convolutional in time but declares 256 frames per input;
/// at 128 it needs half the memory for the same result. Rewrites the two
/// declared shapes (input and output, at the very end of the file) in place:
/// 256 and 128 are both two-byte varints, so nothing else moves.
#[tauri::command]
pub fn karaoke_prepare_model(path: String) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let tail = len.min(4096) as usize;
    let mut bytes = vec![0u8; tail];
    file.seek(SeekFrom::Start(len - tail as u64)).map_err(|e| e.to_string())?;
    file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    // dims …, 4, 2560, 256: 0A 02 08 04 | 0A 03 08 80 14 | 0A 03 08 80 02
    let pattern: [u8; 14] = [0x0A, 0x02, 0x08, 0x04, 0x0A, 0x03, 0x08, 0x80, 0x14, 0x0A, 0x03, 0x08, 0x80, 0x02];
    let mut i = 0;
    while i + pattern.len() <= tail {
        if bytes[i..i + pattern.len()] == pattern {
            file.seek(SeekFrom::Start(len - tail as u64 + (i + pattern.len() - 1) as u64))
                .map_err(|e| e.to_string())?;
            file.write_all(&[0x01]).map_err(|e| e.to_string())?; // 256 → 128
            i += pattern.len();
        } else {
            i += 1;
        }
    }
    Ok(())
}

#[cfg(feature = "karaoke")]
fn load_session(path: &str) -> Result<Session, String> {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    Session::builder()
        .map_err(|e| e.to_string())?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| e.to_string())?
        .with_intra_threads(threads)
        .map_err(|e| e.to_string())?
        .with_memory_pattern(false)
        .map_err(|e| e.to_string())?
        .commit_from_file(path)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "karaoke")]
fn model_dims(session: &Session) -> Result<(usize, usize), String> {
    let input = session.inputs().first().ok_or("The model has no input")?;
    match input.dtype() {
        ValueType::Tensor { shape, .. } if shape.len() == 4 => Ok((shape[2] as usize, shape[3] as usize)),
        other => Err(format!("Unexpected model input {other}")),
    }
}

struct WavOut {
    writer: hound::WavWriter<std::io::BufWriter<std::fs::File>>,
}

impl WavOut {
    fn create(path: &str) -> Result<Self, String> {
        if let Some(dir) = Path::new(path).parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        Ok(Self { writer: hound::WavWriter::create(path, spec).map_err(|e| e.to_string())? })
    }
    fn write(&mut self, l: &[f32], r: &[f32], offset: usize, count: usize) -> Result<(), String> {
        let q = |x: f32| (x.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        for i in offset..offset + count {
            self.writer.write_sample(q(l[i])).map_err(|e| e.to_string())?;
            self.writer.write_sample(q(r[i])).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    fn finish(self) -> Result<(), String> {
        self.writer.finalize().map_err(|e| e.to_string())
    }
}

/// Makes `output` (WAV) from `input`, one chunk at a time; each finished piece
/// is also written to `piece_dir` and announced as a `karaoke-piece` event.
/// Resolves with the length in seconds. One job at a time: a new one waits.
#[cfg(not(feature = "karaoke"))]
#[tauri::command]
#[allow(unused_variables)]
pub async fn karaoke_separate(
    app: AppHandle,
    state: State<'_, Karaoke>,
    job: String,
    input: String,
    output: String,
    piece_dir: String,
    model_path: String,
) -> Result<f64, String> {
    Err("This build of stash has no voice remover (built without the karaoke feature)".into())
}

#[cfg(feature = "karaoke")]
#[tauri::command]
pub async fn karaoke_separate(
    app: AppHandle,
    state: State<'_, Karaoke>,
    job: String,
    input: String,
    output: String,
    piece_dir: String,
    model_path: String,
) -> Result<f64, String> {
    let session = state.session.clone();
    let cancelled = state.cancelled.clone();
    let running = state.running.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = session.lock().unwrap();
        let is_cancelled = || cancelled.lock().unwrap().as_deref() == Some(job.as_str());
        if is_cancelled() {
            *cancelled.lock().unwrap() = None;
            return Err("cancelled".to_string());
        }
        let options = Arc::new(RunOptions::new().map_err(|e| e.to_string())?);
        *running.lock().unwrap() = Some((job.clone(), options.clone()));
        let part = format!("{output}.part");
        let result = (|| -> Result<f64, String> {
            if guard.as_ref().map(|(p, _)| p != &model_path).unwrap_or(true) {
                *guard = None;
                karaoke_prepare_model(model_path.clone())?;
                *guard = Some((model_path.clone(), load_session(&model_path)?));
            }
            let (_, sess) = guard.as_mut().unwrap();
            let (dim_f, dim_t) = model_dims(sess)?;
            let mut stft = MdxStft::new(N_FFT, HOP, dim_f, dim_t);
            let mut reader = AudioReader::open(&input)?;
            let total = reader.duration;
            let _ = std::fs::remove_dir_all(&piece_dir);
            std::fs::create_dir_all(&piece_dir).map_err(|e| e.to_string())?;
            let mut out = WavOut::create(&part)?;
            let mut frames = 0u64;
            let mut piece = 0usize;
            let started = Instant::now();
            let shape = [1usize, 4, dim_f, dim_t];
            let mut model = |spec: &[f32], pred: &mut [f32]| -> Result<(), String> {
                let tensor = Tensor::from_array((shape, spec.to_vec())).map_err(|e| e.to_string())?;
                let outputs = sess
                    .run_with_options(ort::inputs![tensor], &*options)
                    .map_err(|e| e.to_string())?;
                let (_, data) = outputs[0].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
                if data.len() != pred.len() {
                    return Err(format!("Model output has {} values, expected {}", data.len(), pred.len()));
                }
                pred.copy_from_slice(data);
                Ok(())
            };
            let mut sink = |l: &[f32], r: &[f32], off: usize, n: usize| -> Result<(), String> {
                out.write(l, r, off, n)?;
                let path = Path::new(&piece_dir).join(format!("piece_{piece:04}.wav"));
                let path = path.to_string_lossy().to_string();
                let mut p = WavOut::create(&path)?;
                p.write(l, r, off, n)?;
                p.finish()?;
                let start = frames;
                frames += n as u64;
                let _ = app.emit(
                    "karaoke-piece",
                    PieceEvent {
                        job: job.clone(),
                        path,
                        index: piece,
                        start: start as f64 / RATE,
                        duration: n as f64 / RATE,
                        done: frames as f64 / RATE,
                        total,
                        elapsed: started.elapsed().as_secs_f64(),
                    },
                );
                piece += 1;
                Ok(())
            };
            let written = remover::run(&mut stft, N_FFT, &mut reader, &mut model, &mut sink, &is_cancelled)?;
            out.finish()?;
            let _ = std::fs::remove_file(&output);
            std::fs::rename(&part, &output).map_err(|e| e.to_string())?;
            Ok(written as f64 / RATE)
        })();
        *running.lock().unwrap() = None;
        let was_cancelled = is_cancelled();
        if was_cancelled {
            *cancelled.lock().unwrap() = None;
        }
        if result.is_err() {
            let _ = std::fs::remove_file(&part);
            if was_cancelled {
                return Err("cancelled".to_string());
            }
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops a job (queued or running), as soon as the model's current step allows.
#[tauri::command]
pub fn karaoke_cancel(state: State<'_, Karaoke>, job: String) {
    *state.cancelled.lock().unwrap() = Some(job.clone());
    if let Some((j, opts)) = state.running.lock().unwrap().as_ref() {
        if *j == job {
            let _ = opts.terminate();
        }
    }
}

/// Stops whatever job is running (one started before the web view reloaded).
#[tauri::command]
pub fn karaoke_cancel_running(state: State<'_, Karaoke>) {
    let running = state.running.lock().unwrap().as_ref().map(|(j, _)| j.clone());
    if let Some(job) = running {
        karaoke_cancel(state, job);
    }
}

/// Frees the model (its weights and working memory) once karaoke is closed.
#[tauri::command]
pub async fn karaoke_release(state: State<'_, Karaoke>) -> Result<(), String> {
    let session = state.session.clone();
    tauri::async_runtime::spawn_blocking(move || {
        *session.lock().unwrap() = None;
    })
    .await
    .map_err(|e| e.to_string())
}

/// Soft ceiling instead of hard clipping when voice and music add up past full scale.
fn limit(x: f32) -> f32 {
    let a = x.abs();
    if a <= KNEE {
        return x;
    }
    let y = KNEE + (1.0 - KNEE) * ((a - KNEE) / (1.0 - KNEE)).tanh();
    if x < 0.0 {
        -y
    } else {
        y
    }
}

/// The music with the voice on top → `output` (WAV). The first `offset_ms` of
/// the recording are skipped (negative: the voice is delayed), which lines it
/// up with the music. Ends with the recording. Resolves with the length in seconds.
#[tauri::command]
pub async fn karaoke_mix(
    state: State<'_, Karaoke>,
    instrumental: String,
    voice: String,
    output: String,
    offset_ms: f64,
    voice_gain: f64,
    music_gain: f64,
) -> Result<f64, String> {
    let lock = state.mixing.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().unwrap();
        let result = (|| -> Result<f64, String> {
            let mut music = AudioReader::open(&instrumental)?;
            let mut mic = AudioReader::open(&voice)?;
            let mut out = WavOut::create(&output)?;
            const BLOCK: usize = 8192;
            let (mut ml, mut mr) = (vec![0f32; BLOCK], vec![0f32; BLOCK]);
            let (mut vl, mut vr) = (vec![0f32; BLOCK], vec![0f32; BLOCK]);
            let offset = (offset_ms / 1000.0 * RATE) as i64;
            // Skip the start of the recording, or delay it with silence.
            let mut skip = offset;
            while skip > 0 {
                let n = mic.read(&mut vl, &mut vr, 0, (skip as usize).min(BLOCK));
                if n == 0 {
                    break;
                }
                skip -= n as i64;
            }
            let mut silence: i64 = if offset < 0 { -offset } else { 0 };
            let mut voice_over = false;
            let mut total = 0u64;
            let (vg, mg) = (voice_gain as f32, music_gain as f32);
            loop {
                let n = music.read(&mut ml, &mut mr, 0, BLOCK);
                if n == 0 {
                    break;
                }
                let mut v = 0usize;
                if silence > 0 {
                    v = (n as i64).min(silence) as usize;
                    vl[..v].fill(0.0);
                    vr[..v].fill(0.0);
                    silence -= v as i64;
                }
                if v < n && !voice_over {
                    let got = mic.read(&mut vl, &mut vr, v, n - v);
                    if got < n - v {
                        voice_over = true;
                    }
                    vl[v + got..n].fill(0.0);
                    vr[v + got..n].fill(0.0);
                    v += got;
                } else if v < n {
                    vl[v..n].fill(0.0);
                    vr[v..n].fill(0.0);
                }
                for i in 0..n {
                    ml[i] = limit(ml[i] * mg + vl[i] * vg);
                    mr[i] = limit(mr[i] * mg + vr[i] * vg);
                }
                // The recording is over (and the silence before it): stop here.
                let keep = if voice_over && silence == 0 { v } else { n };
                out.write(&ml, &mr, 0, keep)?;
                total += keep as u64;
                if keep < n {
                    break;
                }
            }
            out.finish()?;
            Ok(total as f64 / RATE)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&output);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
