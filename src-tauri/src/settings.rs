//! Settings persisted as human-editable TOML at
//! `~/.config/zen-launcher/config.toml`.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::{Language, Settings, SettingsPatch};
use crate::paths;

/// On-disk representation. Every field has a default so a hand-edited or
/// partial file still loads.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SettingsFile {
    language: Language,
    close_to_tray: bool,
    hide_on_launch: bool,
}

impl Default for SettingsFile {
    fn default() -> Self {
        let settings = Settings::default();
        Self::from(settings)
    }
}

impl From<Settings> for SettingsFile {
    fn from(settings: Settings) -> Self {
        Self {
            language: settings.language,
            close_to_tray: settings.close_to_tray,
            hide_on_launch: settings.hide_on_launch,
        }
    }
}

impl From<SettingsFile> for Settings {
    fn from(file: SettingsFile) -> Self {
        Self {
            language: file.language,
            close_to_tray: file.close_to_tray,
            hide_on_launch: file.hide_on_launch,
        }
    }
}

/// Load settings from `path`. A missing file yields defaults; an unreadable
/// or malformed file yields defaults rather than failing app startup.
pub fn load_from(path: &Path) -> Settings {
    match std::fs::read_to_string(path) {
        Ok(contents) => match toml::from_str::<SettingsFile>(&contents) {
            Ok(file) => file.into(),
            Err(err) => {
                tracing::warn!("ignoring malformed settings at {}: {err}", path.display());
                Settings::default()
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Settings::default(),
        Err(err) => {
            tracing::warn!("could not read settings at {}: {err}", path.display());
            Settings::default()
        }
    }
}

/// Write settings to `path`, creating parent directories as needed.
pub fn save_to(path: &Path, settings: &Settings) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = SettingsFile::from(settings.clone());
    let contents = toml::to_string_pretty(&file)
        .map_err(|err| AppError::io(format!("could not serialize settings: {err}")))?;
    std::fs::write(path, contents)?;
    Ok(())
}

pub fn load() -> Settings {
    match paths::config_file() {
        Ok(path) => load_from(&path),
        Err(err) => {
            tracing::warn!("{err}");
            Settings::default()
        }
    }
}

pub fn save(settings: &Settings) -> AppResult<()> {
    let path = paths::config_file()?;
    save_to(&path, settings)
}

/// Apply a partial patch on top of the current settings.
pub fn apply_patch(settings: &mut Settings, patch: SettingsPatch) {
    if let Some(language) = patch.language {
        settings.language = language;
    }
    if let Some(close_to_tray) = patch.close_to_tray {
        settings.close_to_tray = close_to_tray;
    }
    if let Some(hide_on_launch) = patch.hide_on_launch {
        settings.hide_on_launch = hide_on_launch;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn roundtrip_preserves_values() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let settings = Settings {
            language: Language::Pl,
            close_to_tray: false,
            hide_on_launch: false,
        };
        save_to(&path, &settings).unwrap();
        assert_eq!(load_from(&path), settings);
    }

    #[test]
    fn missing_file_yields_defaults() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("does-not-exist.toml");
        assert_eq!(load_from(&path), Settings::default());
    }

    #[test]
    fn partial_file_fills_defaults() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "language = \"pl\"\n").unwrap();
        let settings = load_from(&path);
        assert_eq!(settings.language, Language::Pl);
        assert!(settings.close_to_tray);
        assert!(settings.hide_on_launch);
    }
}
