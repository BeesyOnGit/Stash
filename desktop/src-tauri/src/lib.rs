//! stash for desktop, native side. The app itself (player, library, sources,
//! screens) is TypeScript in ../src; this is what a web view can't do alone:
//!
//! - `download`: saving songs, covers and the karaoke model, with progress
//! - `files`: the file system (library folders, scans, recordings)
//! - `audio`: decoding any song to 44.1 kHz stereo (karaoke)
//! - `karaoke`: the vocal remover (UVR-MDX-NET on ONNX Runtime) and mixing takes
//! - `tray`: the tray icon, since closing the window keeps the music playing

mod audio;
mod download;
mod files;
mod karaoke;
mod tray;

use tauri::{Emitter, Manager, WindowEvent};

/// Brings the main window back (tray icon, a second launch, the mini player).
pub fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("main-shown", ());
    }
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // One stash at a time: opening it again brings the running one forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(download::Downloads::default())
        .manage(karaoke::Karaoke::default())
        .setup(|app| {
            tray::create(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // ✕ closes to the tray: the music keeps playing (Quit is in the tray menu).
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.emit("main-hidden", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            show_main_window,
            quit_app,
            download::download_start,
            download::download_cancel,
            files::fs_exists,
            files::fs_remove,
            files::fs_mkdir,
            files::fs_list,
            files::fs_stat,
            files::fs_rename,
            files::fs_copy,
            files::fs_read_text,
            files::fs_write_text,
            files::fs_write_bytes,
            files::fs_sha256,
            files::scan_audio,
            audio::audio_duration,
            karaoke::karaoke_prepare_model,
            karaoke::karaoke_separate,
            karaoke::karaoke_cancel,
            karaoke::karaoke_cancel_running,
            karaoke::karaoke_release,
            karaoke::karaoke_mix,
            tray::tray_set_playing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running stash");
}
