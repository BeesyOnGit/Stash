//! Downloads into a file with progress events: songs while they stream, covers,
//! the karaoke model, app updates' checksums. Written to `<dest>.part` and
//! renamed when complete, so a half file never looks like a song.
//!
//! Sources that throttle one big request (YouTube) are fetched in ranged chunks
//! appended into the same file: full speed, and exactly the original stream.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;

const CHUNK_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Default)]
pub struct Downloads {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Clone, Serialize)]
struct Progress<'a> {
    id: &'a str,
    received: u64,
    total: u64,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 stash")
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(Duration::from_secs(60))
            .build()
            .expect("http client")
    })
}

struct Job<'a> {
    app: &'a AppHandle,
    id: &'a str,
    cancel: Arc<AtomicBool>,
    last_emit: Instant,
}

impl Job<'_> {
    fn progress(&mut self, received: u64, total: u64, force: bool) {
        if force || self.last_emit.elapsed() >= Duration::from_millis(250) {
            self.last_emit = Instant::now();
            let _ = self.app.emit(
                "download-progress",
                Progress { id: self.id, received, total },
            );
        }
    }
}

/// One GET into `file` (appending). Returns the status and the bytes written.
async fn fetch_into(
    job: &mut Job<'_>,
    file: &mut tokio::fs::File,
    url: &str,
    headers: &HashMap<String, String>,
    range: Option<(u64, u64)>,
    base: u64,
    total: u64,
) -> Result<(u16, u64), String> {
    let mut req = client().get(url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some((from, to)) = range {
        req = req.header("Range", format!("bytes={from}-{to}"));
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    if status >= 400 {
        return Ok((status, 0));
    }
    let known = if total > 0 {
        total
    } else {
        res.content_length().unwrap_or(0)
    };
    let mut stream = res.bytes_stream();
    let mut got = 0u64;
    while let Some(chunk) = stream.next().await {
        if job.cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        let bytes = chunk.map_err(|e| e.to_string())?;
        file.write_all(&bytes).await.map_err(|e| e.to_string())?;
        got += bytes.len() as u64;
        job.progress(base + got, known, false);
    }
    Ok((status, got))
}

/// Downloads `url` to `dest`. With `chunked` and a known `total`, in ranged
/// pieces. Resolves with the file's size; rejects on HTTP errors or cancel.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn download_start(
    app: AppHandle,
    state: State<'_, Downloads>,
    id: String,
    url: String,
    dest: String,
    headers: Option<HashMap<String, String>>,
    chunked: Option<bool>,
    total: Option<u64>,
) -> Result<u64, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .cancels
        .lock()
        .unwrap()
        .insert(id.clone(), cancel.clone());
    let part = format!("{dest}.part");
    let result = run(&app, &id, &url, &dest, &part, headers.unwrap_or_default(), chunked.unwrap_or(false), total.unwrap_or(0), cancel).await;
    state.cancels.lock().unwrap().remove(&id);
    if result.is_err() {
        let _ = tokio::fs::remove_file(&part).await;
    }
    result
}

#[allow(clippy::too_many_arguments)]
async fn run(
    app: &AppHandle,
    id: &str,
    url: &str,
    dest: &str,
    part: &str,
    headers: HashMap<String, String>,
    chunked: bool,
    total: u64,
    cancel: Arc<AtomicBool>,
) -> Result<u64, String> {
    if let Some(dir) = Path::new(dest).parent() {
        tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    }
    let mut file = tokio::fs::File::create(part).await.map_err(|e| e.to_string())?;
    let mut job = Job { app, id, cancel, last_emit: Instant::now() };
    let mut written = 0u64;
    if chunked && total > 0 {
        let mut start = 0u64;
        while start < total {
            let end = (start + CHUNK_BYTES - 1).min(total - 1);
            let (status, got) =
                fetch_into(&mut job, &mut file, url, &headers, Some((start, end)), start, total).await?;
            if status == 200 {
                // The server ignored the range and sent everything.
                written = got;
                break;
            }
            if status != 206 {
                return Err(format!("Download failed (HTTP {status})"));
            }
            written += got;
            if got == 0 {
                break;
            }
            start += got;
        }
    } else {
        let (status, got) = fetch_into(&mut job, &mut file, url, &headers, None, 0, total).await?;
        if status >= 400 {
            return Err(format!("Download failed (HTTP {status})"));
        }
        written = got;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    if written == 0 {
        return Err("Nothing was downloaded".into());
    }
    let _ = tokio::fs::remove_file(dest).await;
    tokio::fs::rename(part, dest).await.map_err(|e| e.to_string())?;
    job.progress(written, written, true);
    Ok(written)
}

#[tauri::command]
pub fn download_cancel(state: State<'_, Downloads>, id: String) {
    if let Some(flag) = state.cancels.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}
