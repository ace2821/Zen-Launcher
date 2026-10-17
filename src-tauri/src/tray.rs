//! System tray + close-to-tray behaviour (contract §"Tray and window behavior").
//!
//! - Tray icon always present, menu: **Show Zen Launcher** / **Quit**.
//! - Quit exits the process (`app.exit(0)`).
//! - Window close hides to tray when `settings.closeToTray`, otherwise quits.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WindowEvent};

use crate::state::AppState;

pub const TRAY_ID: &str = "zen-launcher-tray";
pub const MENU_SHOW: &str = "show";
pub const MENU_QUIT: &str = "quit";

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Build the tray icon + menu. Uses the app's default window icon.
pub fn init(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let show = MenuItem::with_id(handle, MENU_SHOW, "Show Zen Launcher", true, None::<&str>)?;
    let quit = MenuItem::with_id(handle, MENU_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(handle, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Zen Launcher")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_SHOW => show_main_window(app),
            MENU_QUIT => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// Close button hides to tray (when enabled) instead of quitting.
pub fn install_close_handler(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            let close_to_tray = handle
                .try_state::<AppState>()
                .and_then(|state| state.lock_settings().ok().map(|s| s.close_to_tray))
                .unwrap_or(true);
            if close_to_tray {
                api.prevent_close();
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            } else {
                handle.exit(0);
            }
        }
    });
}

/// Hide the main window right after a launch (when `settings.hideOnLaunch`).
pub fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}
