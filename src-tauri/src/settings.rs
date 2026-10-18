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
    font: String,
    accent: String,
    onboarding_completed: bool,
    auto_covers: bool,
    mods_lenient: bool,
    mods_max_mb: i64,
    use_game_mode: bool,
    use_mango_hud: bool,
    big_picture_layout: String,
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
            font: settings.font,
            accent: settings.accent,
            onboarding_completed: settings.onboarding_completed,
            auto_covers: settings.auto_covers,
            mods_lenient: settings.mods_lenient,
            mods_max_mb: settings.mods_max_mb,
            use_game_mode: settings.use_game_mode,
            use_mango_hud: settings.use_mango_hud,
            big_picture_layout: settings.big_picture_layout,
        }
    }
}

impl From<SettingsFile> for Settings {
    fn from(file: SettingsFile) -> Self {
        Self {
            language: file.language,
            close_to_tray: file.close_to_tray,
            hide_on_launch: file.hide_on_launch,
            font: file.font,
            accent: file.accent,
            onboarding_completed: file.onboarding_completed,
            auto_covers: file.auto_covers,
            mods_lenient: file.mods_lenient,
            mods_max_mb: file.mods_max_mb,
            use_game_mode: file.use_game_mode,
            use_mango_hud: file.use_mango_hud,
            big_picture_layout: file.big_picture_layout,
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

/// Apply a partial patch on top of the current settings. `font`/`accent`
/// values are expected to be pre-normalized (see `Settings::normalize_id`).
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
    if let Some(font) = patch.font {
        settings.font = font;
    }
    if let Some(accent) = patch.accent {
        settings.accent = accent;
    }
    if let Some(onboarding_completed) = patch.onboarding_completed {
        settings.onboarding_completed = onboarding_completed;
    }
    if let Some(auto_covers) = patch.auto_covers {
        settings.auto_covers = auto_covers;
    }
    if let Some(mods_lenient) = patch.mods_lenient {
        settings.mods_lenient = mods_lenient;
    }
    if let Some(mods_max_mb) = patch.mods_max_mb {
        settings.mods_max_mb = mods_max_mb;
    }
    if let Some(use_game_mode) = patch.use_game_mode {
        settings.use_game_mode = use_game_mode;
    }
    if let Some(use_mango_hud) = patch.use_mango_hud {
        settings.use_mango_hud = use_mango_hud;
    }
    if let Some(big_picture_layout) = patch.big_picture_layout {
        settings.big_picture_layout = big_picture_layout;
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
            font: "instrument-sans".to_string(),
            accent: "ember".to_string(),
            onboarding_completed: true,
            auto_covers: false,
            mods_lenient: false,
            mods_max_mb: 2048,
            use_game_mode: false,
            use_mango_hud: true,
            big_picture_layout: "playstation".to_string(),
        };
        save_to(&path, &settings).unwrap();
        assert_eq!(load_from(&path), settings);

        // A config file predating the new fields loads them as defaults.
        std::fs::write(
            dir.path().join("old.toml"),
            "language = \"pl\"\ncloseToTray = false\n",
        )
        .unwrap();
        let loaded = load_from(&dir.path().join("old.toml"));
        assert_eq!(loaded.language, Language::Pl);
        assert!(loaded.auto_covers);
        assert!(loaded.mods_lenient);
        assert_eq!(loaded.mods_max_mb, crate::models::DEFAULT_MODS_MAX_MB);
        assert!(loaded.use_game_mode);
        assert!(!loaded.use_mango_hud);
        assert_eq!(loaded.big_picture_layout, "auto");
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
        assert_eq!(settings.font, "maple-mono");
        assert_eq!(settings.accent, "jade");
        assert!(!settings.onboarding_completed);
    }

    #[test]
    fn hand_edited_appearance_keys_load() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(
            &path,
            "font = \"instrument-sans\"\naccent = \"plum\"\nonboardingCompleted = true\n",
        )
        .unwrap();
        let settings = load_from(&path);
        assert_eq!(settings.font, "instrument-sans");
        assert_eq!(settings.accent, "plum");
        assert!(settings.onboarding_completed);
    }
}
