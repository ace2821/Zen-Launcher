//! Storage locations. Contract:
//! - config: `~/.config/zen-launcher/config.toml`
//! - data:   `~/.local/share/zen-launcher/` (`library.db`, `logs/`)

use std::path::PathBuf;

use crate::error::{AppError, AppResult};

pub const APP_DIR: &str = "zen-launcher";
pub const CONFIG_FILE: &str = "config.toml";
pub const DB_FILE: &str = "library.db";
pub const LOGS_DIR: &str = "logs";
pub const COVERS_DIR: &str = "covers";
pub const GAMES_DIR: &str = "games";

/// Per-game state (`<dataDir>/games/<gameId>/`), created on demand. Holds the
/// loader install record used by the update checker.
pub fn game_state_dir(game_id: i64) -> AppResult<PathBuf> {
    let dir = data_dir()?.join(GAMES_DIR).join(game_id.to_string());
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn config_dir() -> AppResult<PathBuf> {
    dirs::config_dir()
        .map(|dir| dir.join(APP_DIR))
        .ok_or_else(|| AppError::io("could not resolve the user config directory"))
}

pub fn config_file() -> AppResult<PathBuf> {
    Ok(config_dir()?.join(CONFIG_FILE))
}

pub fn data_dir() -> AppResult<PathBuf> {
    dirs::data_dir()
        .map(|dir| dir.join(APP_DIR))
        .ok_or_else(|| AppError::io("could not resolve the user data directory"))
}

pub fn db_path() -> AppResult<PathBuf> {
    Ok(data_dir()?.join(DB_FILE))
}

pub fn logs_dir() -> AppResult<PathBuf> {
    Ok(data_dir()?.join(LOGS_DIR))
}

pub fn covers_dir() -> AppResult<PathBuf> {
    Ok(data_dir()?.join(COVERS_DIR))
}

/// Create the config and data directories (including `logs/` and `covers/`)
/// if missing.
pub fn ensure_dirs() -> AppResult<()> {
    std::fs::create_dir_all(config_dir()?)?;
    std::fs::create_dir_all(data_dir()?)?;
    std::fs::create_dir_all(logs_dir()?)?;
    std::fs::create_dir_all(covers_dir()?)?;
    Ok(())
}
