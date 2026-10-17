//! Zen Launcher — Rust core.
//!
//! Local-first game library manager for Linux. The IPC surface is frozen in
//! `docs/INTERFACES.md`; every module here implements a slice of it.

pub mod commands;
pub mod db;
pub mod error;
pub mod launch;
pub mod models;
pub mod paths;
pub mod scanner;
pub mod settings;
pub mod state;
pub mod time;
pub mod tray;

use std::path::Path;
use std::sync::OnceLock;

use tauri::Manager;

use crate::error::AppResult;
use crate::state::AppState;

/// Keeps the non-blocking log writer alive for the whole process.
static LOG_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();

fn init_logging(dir: Option<&Path>) {
    use tracing_subscriber::EnvFilter;

    let filter = || EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    if let Some(dir) = dir
        && std::fs::create_dir_all(dir).is_ok()
    {
        let appender = tracing_appender::rolling::daily(dir, "zen-launcher.log");
        let (writer, guard) = tracing_appender::non_blocking(appender);
        let _ = LOG_GUARD.set(guard);
        if tracing_subscriber::fmt()
            .with_env_filter(filter())
            .with_writer(writer)
            .with_ansi(false)
            .try_init()
            .is_ok()
        {
            return;
        }
    }

    // Fallback: stderr only (no log directory available, or a subscriber is
    // already installed, e.g. during tests).
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter())
        .try_init();
}

fn setup_app(app: &mut tauri::App) -> AppResult<()> {
    paths::ensure_dirs()?;

    let db_path = paths::db_path()?;
    let conn = db::open(&db_path)?;
    tracing::info!("database ready at {}", db_path.display());

    let config_path = paths::config_file()?;
    let settings = settings::load_from(&config_path);
    app.manage(AppState::new(conn, settings, config_path));

    tray::init(app)?;
    tray::install_close_handler(app.handle());

    tracing::info!("Zen Launcher ready");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging(paths::logs_dir().ok().as_deref());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            setup_app(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_sources,
            commands::add_source,
            commands::remove_source,
            commands::scan_source,
            commands::list_candidates,
            commands::approve_candidate,
            commands::reject_candidate,
            commands::list_games,
            commands::get_game,
            commands::update_game,
            commands::remove_game,
            commands::launch_game,
            commands::list_sessions,
            commands::get_settings,
            commands::update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
