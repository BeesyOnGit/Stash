//! The file system, for the app's own folders (Music/stash, Music/Karaoke,
//! app data) and scanning the computer's music. Missing files are not errors:
//! checks answer false/empty and removals of what's gone succeed.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    /// Milliseconds since the epoch.
    modified: f64,
}

#[derive(Serialize)]
pub struct Stat {
    size: u64,
    modified: f64,
    is_dir: bool,
}

fn modified_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

#[tauri::command]
pub fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn fs_remove(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let res = if p.is_dir() {
        std::fs::remove_dir_all(p)
    } else {
        std::fs::remove_file(p)
    };
    match res {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn fs_mkdir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_list(path: String) -> Vec<Entry> {
    let Ok(dir) = std::fs::read_dir(&path) else { return vec![] };
    dir.flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            Some(Entry {
                name: e.file_name().to_string_lossy().to_string(),
                path: path_string(&e.path()),
                is_dir: meta.is_dir(),
                size: meta.len(),
                modified: modified_ms(&meta),
            })
        })
        .collect()
}

#[tauri::command]
pub fn fs_stat(path: String) -> Option<Stat> {
    let meta = std::fs::metadata(&path).ok()?;
    Some(Stat {
        size: meta.len(),
        modified: modified_ms(&meta),
        is_dir: meta.is_dir(),
    })
}

/// Moves a file; across drives it's copied, checked and the original deleted.
#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    if let Some(dir) = Path::new(&to).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if std::fs::rename(&from, &to).is_ok() {
        return Ok(());
    }
    let size = std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
    let from_size = std::fs::metadata(&from).map(|m| m.len()).unwrap_or(0);
    if size != from_size {
        let _ = std::fs::remove_file(&to);
        return Err("Copy incomplete".into());
    }
    std::fs::remove_file(&from).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_copy(from: String, to: String) -> Result<(), String> {
    if let Some(dir) = Path::new(&to).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&from, &to).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_read_text(path: String) -> Option<String> {
    let bytes = std::fs::read(&path).ok()?;
    Some(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
pub fn fs_write_text(path: String, text: String) -> Result<(), String> {
    if let Some(dir) = Path::new(&path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

/// Binary data straight from the web view (a raw request body); the path is in
/// the `x-path` header, URI-encoded.
#[tauri::command]
pub fn fs_write_bytes(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("Expected raw bytes".into());
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or("Missing x-path")?;
    if let Some(dir) = Path::new(&path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
pub async fn fs_sha256(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
        Ok(hex::encode(hasher.finalize()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct Found {
    path: String,
    size: u64,
}

const AUDIO_EXT: &[&str] = &["mp3", "m4a", "aac", "flac", "ogg", "opus", "wav", "wma", "alac", "aiff", "aif"];

fn walk(dir: &Path, depth: u32, max_depth: u32, out: &mut Vec<Found>) {
    if depth > max_depth {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        let path: PathBuf = e.path();
        if meta.is_dir() {
            walk(&path, depth + 1, max_depth, out);
        } else if meta.len() > 50_000 {
            let ext = path
                .extension()
                .map(|x| x.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if AUDIO_EXT.contains(&ext.as_str()) {
                out.push(Found { path: path_string(&path), size: meta.len() });
            }
        }
    }
}

/// Every audio file (over 50 kB) under the folders, a few levels deep.
#[tauri::command]
pub async fn scan_audio(roots: Vec<String>, max_depth: Option<u32>) -> Vec<Found> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = vec![];
        for r in roots {
            walk(Path::new(&r), 0, max_depth.unwrap_or(6), &mut out);
        }
        out
    })
    .await
    .unwrap_or_default()
}
