//! Domain types mirroring `docs/INTERFACES.md` 1:1. Every IPC struct uses
//! `rename_all = "camelCase"`; optional values serialize as `null`.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameType {
    Native,
    Windows,
    Retro,
    Mod,
}

impl GameType {
    pub fn as_str(self) -> &'static str {
        match self {
            GameType::Native => "native",
            GameType::Windows => "windows",
            GameType::Retro => "retro",
            GameType::Mod => "mod",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "native" => Ok(GameType::Native),
            "windows" => Ok(GameType::Windows),
            "retro" => Ok(GameType::Retro),
            "mod" => Ok(GameType::Mod),
            other => Err(AppError::validation(format!("unknown game type: {other}"))),
        }
    }
}

impl std::fmt::Display for GameType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineKind {
    Unity,
    Godot,
    Unreal,
    Gamemaker,
    Renpy,
    Unknown,
}

impl EngineKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EngineKind::Unity => "unity",
            EngineKind::Godot => "godot",
            EngineKind::Unreal => "unreal",
            EngineKind::Gamemaker => "gamemaker",
            EngineKind::Renpy => "renpy",
            EngineKind::Unknown => "unknown",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "unity" => Ok(EngineKind::Unity),
            "godot" => Ok(EngineKind::Godot),
            "unreal" => Ok(EngineKind::Unreal),
            "gamemaker" => Ok(EngineKind::Gamemaker),
            "renpy" => Ok(EngineKind::Renpy),
            "unknown" => Ok(EngineKind::Unknown),
            other => Err(AppError::validation(format!(
                "unknown engine kind: {other}"
            ))),
        }
    }
}

impl std::fmt::Display for EngineKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CandidateStatus {
    Pending,
    Approved,
    Rejected,
}

impl CandidateStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            CandidateStatus::Pending => "pending",
            CandidateStatus::Approved => "approved",
            CandidateStatus::Rejected => "rejected",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "pending" => Ok(CandidateStatus::Pending),
            "approved" => Ok(CandidateStatus::Approved),
            "rejected" => Ok(CandidateStatus::Rejected),
            other => Err(AppError::validation(format!(
                "unknown candidate status: {other}"
            ))),
        }
    }
}

impl std::fmt::Display for CandidateStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Computed on read from the existence of the executable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameStatus {
    Ready,
    Missing,
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: i64,
    pub path: String,
    pub auto_scan: bool,
    pub created_at: String,
    pub last_scan_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: i64,
    /// Detaches to `None` when its scan root is removed.
    pub source_id: Option<i64>,
    pub path: String,
    pub executable: Option<String>,
    pub engine: EngineKind,
    pub suggested_title: String,
    pub confidence: f64,
    pub evidence: Vec<String>,
    pub status: CandidateStatus,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: i64,
    pub title: String,
    pub sort_title: Option<String>,
    #[serde(rename = "type")]
    pub game_type: GameType,
    pub install_path: String,
    pub executable: String,
    pub args: Vec<String>,
    pub env: std::collections::BTreeMap<String, String>,
    pub work_dir: Option<String>,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub hidden: bool,
    pub notes: Option<String>,
    pub cover_path: Option<String>,
    pub status: GameStatus,
    pub created_at: String,
    pub updated_at: String,
    pub last_played_at: Option<String>,
    pub total_seconds: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: i64,
    pub game_id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_seconds: Option<i64>,
    pub exit_code: Option<i64>,
}

// ---------------------------------------------------------------------------
// Settings & command payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    En,
    Pl,
}

impl Language {
    pub fn as_str(self) -> &'static str {
        match self {
            Language::En => "en",
            Language::Pl => "pl",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "en" => Ok(Language::En),
            "pl" => Ok(Language::Pl),
            other => Err(AppError::validation(format!("unknown language: {other}"))),
        }
    }
}

impl std::fmt::Display for Language {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Default UI font id; must match a font exposed by the frontend
/// (`maple-mono`, `instrument-sans`, `system`).
pub const DEFAULT_FONT_ID: &str = "maple-mono";
/// Default accent preset id; the frontend owns the palette vocabulary.
pub const DEFAULT_ACCENT_ID: &str = "jade";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub language: Language,
    pub close_to_tray: bool,
    pub hide_on_launch: bool,
    /// UI font id (free-form, frontend-owned vocabulary).
    pub font: String,
    /// Accent preset id (free-form, frontend-owned vocabulary).
    pub accent: String,
    /// `true` once the first-run wizard has been finished or skipped.
    pub onboarding_completed: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: Language::En,
            close_to_tray: true,
            hide_on_launch: true,
            font: DEFAULT_FONT_ID.to_string(),
            accent: DEFAULT_ACCENT_ID.to_string(),
            onboarding_completed: false,
        }
    }
}

impl Settings {
    /// Normalize a free-form display preference id (`font`, `accent`):
    /// trimmed, 1–32 chars from `[a-z0-9-]`. Unknown-but-valid ids are
    /// accepted; the frontend falls back to defaults for ids it does not know.
    pub fn normalize_id(field: &str, value: &str) -> AppResult<String> {
        let trimmed = value.trim();
        let valid = !trimmed.is_empty()
            && trimmed.len() <= 32
            && trimmed
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !valid {
            return Err(AppError::validation(format!(
                "{field} must be 1-32 characters of a-z, 0-9 or '-'"
            )));
        }
        Ok(trimmed.to_string())
    }
}

/// Partial patch for `update_settings`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub language: Option<Language>,
    pub close_to_tray: Option<bool>,
    pub hide_on_launch: Option<bool>,
    pub font: Option<String>,
    pub accent: Option<String>,
    pub onboarding_completed: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub source_id: i64,
    pub candidates_found: i64,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchInfo {
    pub session_id: i64,
}

/// Partial patch for `approve_candidate`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidatePatch {
    pub title: Option<String>,
    pub executable: Option<String>,
    pub args: Option<Vec<String>>,
    pub work_dir: Option<String>,
}

/// Distinguishes an absent field (`None`) from an explicit `null`
/// (`Some(None)`), so patches can clear nullable fields.
fn deserialize_double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Partial patch for `update_game` (subset of editable fields).
///
/// An omitted field keeps the stored value; an explicit `null` clears the
/// nullable fields (`sortTitle`, `workDir`, `notes`, `coverPath`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePatch {
    pub title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub sort_title: Option<Option<String>>,
    #[serde(rename = "type")]
    pub game_type: Option<GameType>,
    pub executable: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub work_dir: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
    pub favorite: Option<bool>,
    pub hidden: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub notes: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub cover_path: Option<Option<String>>,
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub source_id: i64,
    pub current: Option<String>,
    pub candidates_so_far: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFinished {
    pub source_id: i64,
    pub candidates_found: i64,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStarted {
    pub session_id: i64,
    pub game_id: i64,
    pub started_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEnded {
    pub session_id: i64,
    pub game_id: i64,
    pub duration_seconds: i64,
    pub exit_code: Option<i64>,
}

/// Event names, referenced by name to keep Rust and UI in sync.
pub mod events {
    pub const SCAN_PROGRESS: &str = "scan-progress";
    pub const SCAN_FINISHED: &str = "scan-finished";
    pub const SESSION_STARTED: &str = "session-started";
    pub const SESSION_ENDED: &str = "session-ended";
    pub const LIBRARY_CHANGED: &str = "library-changed";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_patch_distinguishes_absence_from_null() {
        let absent: GamePatch = serde_json::from_str("{}").unwrap();
        assert_eq!(absent.work_dir, None);
        assert_eq!(absent.notes, None);

        let cleared: GamePatch = serde_json::from_str(r#"{"workDir":null,"notes":null}"#).unwrap();
        assert_eq!(cleared.work_dir, Some(None));
        assert_eq!(cleared.notes, Some(None));

        let set: GamePatch = serde_json::from_str(r#"{"workDir":"/tmp/games"}"#).unwrap();
        assert_eq!(set.work_dir, Some(Some("/tmp/games".to_string())));
    }

    #[test]
    fn settings_defaults_cover_appearance_fields() {
        let settings = Settings::default();
        assert_eq!(settings.font, DEFAULT_FONT_ID);
        assert_eq!(settings.accent, DEFAULT_ACCENT_ID);
        assert!(!settings.onboarding_completed);
    }

    #[test]
    fn normalize_id_trims_and_rejects_invalid_ids() {
        assert_eq!(
            Settings::normalize_id("font", "  maple-mono ").unwrap(),
            "maple-mono"
        );
        assert!(Settings::normalize_id("accent", "   ").is_err());
        assert!(Settings::normalize_id("accent", "Jade").is_err());
        assert!(Settings::normalize_id("accent", "a_b").is_err());
        assert!(Settings::normalize_id("accent", &"a".repeat(33)).is_err());
    }
}
