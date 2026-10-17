//! Error type shared by every command. Mirrors the `AppError` contract:
//! `{ code, message }` with a fixed set of codes.

use serde::Serialize;

pub const NOT_FOUND: &str = "NOT_FOUND";
pub const IO: &str = "IO";
pub const DB: &str = "DB";
pub const VALIDATION: &str = "VALIDATION";
pub const LAUNCH_FAILED: &str = "LAUNCH_FAILED";
pub const UNSUPPORTED: &str = "UNSUPPORTED";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{code}: {message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(NOT_FOUND, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(IO, message)
    }

    pub fn db(message: impl Into<String>) -> Self {
        Self::new(DB, message)
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(VALIDATION, message)
    }

    pub fn launch_failed(message: impl Into<String>) -> Self {
        Self::new(LAUNCH_FAILED, message)
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new(UNSUPPORTED, message)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        Self::db(err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::io(err.to_string())
    }
}

impl From<walkdir::Error> for AppError {
    fn from(err: walkdir::Error) -> Self {
        Self::io(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::validation(err.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        Self::io(err.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
