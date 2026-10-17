//! Shared application state managed by Tauri.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::models::Settings;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub settings: Mutex<Settings>,
    pub config_path: PathBuf,
}

impl AppState {
    pub fn new(conn: Connection, settings: Settings, config_path: PathBuf) -> Self {
        Self {
            db: Mutex::new(conn),
            settings: Mutex::new(settings),
            config_path,
        }
    }

    /// Lock the database. Callers must release this before long operations
    /// (scan, spawn, wait).
    pub fn lock_db(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.db
            .lock()
            .map_err(|_| AppError::db("database lock poisoned"))
    }

    pub fn lock_settings(&self) -> AppResult<MutexGuard<'_, Settings>> {
        self.settings
            .lock()
            .map_err(|_| AppError::db("settings lock poisoned"))
    }
}
