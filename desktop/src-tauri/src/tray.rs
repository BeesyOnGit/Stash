//! The tray icon: closing the window keeps stash playing, so this is where it's
//! reopened, paused, skipped or quit. Menu clicks go to the player in the main
//! window as `tray` events ("toggle", "next", "previous").

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

pub struct TrayItems {
    toggle: MenuItem<Wry>,
    labels: Mutex<(String, String)>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open stash", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Play", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "Previous", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit stash", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &toggle,
            &previous,
            &next,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(TrayItems {
        toggle: toggle.clone(),
        labels: Mutex::new(("Play".into(), "Pause".into())),
    });

    let mut builder = TrayIconBuilder::with_id("stash")
        .tooltip("stash")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => crate::show_main(app),
            "quit" => {
                // The player saves what it was doing, then the app ends (or ends anyway).
                let _ = app.emit("tray", "quit");
                let handle = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(700));
                    handle.exit(0);
                });
            }
            other => {
                let _ = app.emit("tray", other.to_string());
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Keeps the menu's Play/Pause item (and its words, in the app's language) up to date.
#[tauri::command]
pub fn tray_set_playing(
    app: AppHandle,
    playing: bool,
    title: Option<String>,
    play_label: Option<String>,
    pause_label: Option<String>,
) {
    let Some(items) = app.try_state::<TrayItems>() else { return };
    let mut labels = items.labels.lock().unwrap();
    if let Some(p) = play_label {
        labels.0 = p;
    }
    if let Some(p) = pause_label {
        labels.1 = p;
    }
    let _ = items
        .toggle
        .set_text(if playing { labels.1.clone() } else { labels.0.clone() });
    if let Some(tray) = app.tray_by_id("stash") {
        let tip = match title {
            Some(t) if !t.is_empty() => format!("stash · {t}"),
            _ => "stash".to_string(),
        };
        let _ = tray.set_tooltip(Some(tip));
    }
}
