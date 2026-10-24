//! Tauri commands — the IPC surface defined in `docs/INTERFACES.md`.
//!
//! Rules of engagement:
//! - The DB mutex is never held across long operations (scan, spawn, wait).
//! - Progress/result events are emitted from here; the UI never polls.
//! - Errors are `AppError { code, message }`.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{self, NewCandidate, NewGame};
use crate::error::{AppError, AppResult};
use crate::launch;
use crate::models::{
    Candidate, CandidatePatch, CandidateStatus, Game, GamePatch, LaunchInfo, ScanFinished,
    ScanProgress, ScanSummary, Session, Settings, SettingsPatch, Source, events,
};
use crate::scanner;
use crate::settings;
use crate::state::AppState;
use crate::time;

/// How often `scan-progress` may fire.
const PROGRESS_THROTTLE: Duration = Duration::from_millis(150);

fn emit_library_changed(app: &AppHandle) {
    let _ = app.emit(events::LIBRARY_CHANGED, serde_json::json!({}));
}

fn to_path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_sources(state: State<'_, AppState>) -> AppResult<Vec<Source>> {
    let conn = state.lock_db()?;
    db::list_sources(&conn)
}

#[tauri::command]
pub fn add_source(state: State<'_, AppState>, path: String) -> AppResult<Source> {
    let raw = Path::new(&path);
    if !raw.exists() {
        return Err(AppError::validation(format!("path does not exist: {path}")));
    }
    if !raw.is_dir() {
        return Err(AppError::validation(format!(
            "path is not a directory: {path}"
        )));
    }
    let canonical = std::fs::canonicalize(raw)?;
    let canonical_path = to_path_string(&canonical);

    let conn = state.lock_db()?;
    // Dedupe by canonical path: adding the same root twice returns the existing row.
    if let Some(existing) = db::find_source_by_path(&conn, &canonical_path)? {
        return Ok(existing);
    }
    db::insert_source(&conn, &canonical_path, false)
}

#[tauri::command]
pub fn remove_source(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.lock_db()?;
    // Candidates/games are intentionally untouched (contract).
    db::delete_source(&conn, id)
}

#[tauri::command]
pub async fn scan_source(app: AppHandle, id: i64) -> AppResult<ScanSummary> {
    let started = Instant::now();
    let task_app = app.clone();

    let summary = tauri::async_runtime::spawn_blocking(move || -> AppResult<ScanSummary> {
        let state = task_app.state::<AppState>();

        let (root, skip_paths) = {
            let conn = state.lock_db()?;
            let source = db::get_source(&conn, id)?;
            let skip = db::approved_install_paths(&conn)?;
            (
                PathBuf::from(source.path),
                skip.into_iter().map(PathBuf::from).collect::<Vec<_>>(),
            )
        };

        let mut last_emit = Instant::now() - PROGRESS_THROTTLE;
        let mut progress = |current: Option<&Path>, found: usize| {
            if last_emit.elapsed() >= PROGRESS_THROTTLE {
                last_emit = Instant::now();
                let _ = task_app.emit(
                    events::SCAN_PROGRESS,
                    ScanProgress {
                        source_id: id,
                        current: current.map(to_path_string),
                        candidates_so_far: found as i64,
                    },
                );
            }
        };

        let raw = scanner::scan(&root, &skip_paths, &mut progress);
        let candidates_found = raw.len() as i64;

        {
            let conn = state.lock_db()?;
            for candidate in &raw {
                let new = NewCandidate {
                    path: to_path_string(&candidate.path),
                    executable: candidate
                        .executable
                        .as_ref()
                        .map(|path| to_path_string(path)),
                    engine: candidate.engine,
                    suggested_title: candidate.suggested_title.clone(),
                    confidence: candidate.confidence,
                    evidence: candidate.evidence.clone(),
                };
                db::upsert_pending_candidate(&conn, id, &new)?;
            }
            db::touch_source_last_scan(&conn, id, &time::now_iso())?;
        }

        Ok(ScanSummary {
            source_id: id,
            candidates_found,
            duration_ms: started.elapsed().as_millis() as i64,
        })
    })
    .await
    .map_err(|err| AppError::db(format!("scan task failed: {err}")))??;

    let _ = app.emit(
        events::SCAN_FINISHED,
        ScanFinished {
            source_id: summary.source_id,
            candidates_found: summary.candidates_found,
            duration_ms: summary.duration_ms,
        },
    );

    Ok(summary)
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_candidates(
    state: State<'_, AppState>,
    status: Option<String>,
) -> AppResult<Vec<Candidate>> {
    let status = match status {
        Some(raw) if !raw.trim().is_empty() => Some(CandidateStatus::parse(raw.trim())?),
        _ => None,
    };
    let conn = state.lock_db()?;
    db::list_candidates(&conn, status)
}

#[tauri::command]
pub fn approve_candidate(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    patch: Option<CandidatePatch>,
) -> AppResult<Game> {
    let patch = patch.unwrap_or_default();
    let conn = state.lock_db()?;
    let candidate = db::get_candidate(&conn, id)?;

    let install_path = candidate.path.clone();
    let executable_raw = patch
        .executable
        .clone()
        .or_else(|| candidate.executable.clone())
        .ok_or_else(|| {
            AppError::validation("candidate has no executable; supply one in the patch")
        })?;
    let executable = if Path::new(&executable_raw).is_absolute() {
        executable_raw
    } else {
        to_path_string(&Path::new(&install_path).join(&executable_raw))
    };

    // Type inference: `.exe`/`.bat`/`.cmd` → windows, everything else → native.
    let executable_lower = executable.to_ascii_lowercase();
    let game_type = if executable_lower.ends_with(".exe")
        || executable_lower.ends_with(".bat")
        || executable_lower.ends_with(".cmd")
    {
        crate::models::GameType::Windows
    } else {
        crate::models::GameType::Native
    };

    let title = patch
        .title
        .clone()
        .unwrap_or_else(|| candidate.suggested_title.clone());

    // Client metadata is re-detected at import time (candidates do not store it).
    let client = scanner::detect_client(Path::new(&install_path));

    // Dedupe by canonical install path.
    if let Some(existing) = db::find_game_by_install_path(&conn, &install_path)? {
        db::set_candidate_status(&conn, id, CandidateStatus::Approved)?;
        drop(conn);
        // Head start on the Wine prefix so the first Play is fast.
        crate::wine::initialize_for_game(&existing);
        spawn_auto_cover(app.clone(), &state, &existing);
        emit_library_changed(&app);
        return Ok(existing);
    }

    let game = db::insert_game(
        &conn,
        &NewGame {
            title,
            sort_title: None,
            game_type,
            install_path,
            executable,
            args: patch.args.unwrap_or_default(),
            env: Default::default(),
            work_dir: patch.work_dir,
            tags: Vec::new(),
            client,
        },
    )?;
    db::set_candidate_status(&conn, id, CandidateStatus::Approved)?;
    drop(conn);

    // Head start on the Wine prefix so the first Play is fast.
    crate::wine::initialize_for_game(&game);
    spawn_auto_cover(app.clone(), &state, &game);
    emit_library_changed(&app);
    Ok(game)
}

/// Kick a background best-effort cover fetch for a freshly approved game
/// (settings: `autoCovers`).
fn spawn_auto_cover(app: AppHandle, state: &State<'_, AppState>, game: &Game) {
    let auto = state
        .lock_settings()
        .map(|settings| settings.auto_covers)
        .unwrap_or(false);
    if !auto {
        return;
    }
    let game_id = game.id;
    let title = game.title.clone();
    std::thread::Builder::new()
        .name("auto-cover".to_string())
        .spawn(move || {
            let covers = match crate::paths::covers_dir() {
                Ok(dir) => dir,
                Err(err) => {
                    tracing::warn!("auto covers skipped: {err:?}");
                    return;
                }
            };
            match crate::covers::download_top_match(&covers, game_id, &title) {
                Ok(_) => {
                    tracing::info!("auto cover stored for game {game_id}");
                    emit_library_changed(&app);
                }
                Err(err) => {
                    tracing::info!("auto cover unavailable for game {game_id}: {err}");
                }
            }
        })
        .ok();
}

#[tauri::command]
pub fn reject_candidate(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.lock_db()?;
    // Validate existence first so we return NOT_FOUND rather than silently no-op.
    db::get_candidate(&conn, id)?;
    db::set_candidate_status(&conn, id, CandidateStatus::Rejected)?;
    drop(conn);
    emit_library_changed(&app);
    Ok(())
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_games(state: State<'_, AppState>) -> AppResult<Vec<Game>> {
    let conn = state.lock_db()?;
    db::list_games(&conn)
}

#[tauri::command]
pub fn get_game(state: State<'_, AppState>, id: i64) -> AppResult<Game> {
    let conn = state.lock_db()?;
    db::get_game(&conn, id)
}

#[tauri::command]
pub fn update_game(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    patch: GamePatch,
) -> AppResult<Game> {
    let conn = state.lock_db()?;
    let game = db::update_game(&conn, id, &patch)?;
    drop(conn);
    emit_library_changed(&app);
    Ok(game)
}

#[tauri::command]
pub fn remove_game(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.lock_db()?;
    // Library removal only — files on disk are never touched.
    db::delete_game(&conn, id)?;
    drop(conn);
    emit_library_changed(&app);
    Ok(())
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn launch_game(app: AppHandle, id: i64) -> AppResult<LaunchInfo> {
    let state = app.state::<AppState>();

    let game = {
        let conn = state.lock_db()?;
        db::get_game(&conn, id)?
    };
    let hide_on_launch = { state.lock_settings()?.hide_on_launch };
    let launch_extras = {
        let settings = state.lock_settings()?;
        launch::LaunchExtras {
            game_mode: settings.use_game_mode,
            mango_hud: settings.use_mango_hud,
        }
    };

    // Planning can fail (unsupported type, missing exec bit) — nothing is
    // persisted before it succeeds.
    let plan = launch::build_spawn_plan(&game, &launch_extras)?;

    let started_at = time::now_iso();
    let session = {
        let conn = state.lock_db()?;
        db::insert_session(&conn, id, &started_at)?
    };

    let _ = app.emit(
        events::SESSION_STARTED,
        launch::session_started(session.id, id, &started_at),
    );

    if hide_on_launch {
        crate::tray::hide_main_window(&app);
    }

    let child = match launch::spawn(&plan) {
        Ok(child) => child,
        Err(err) => {
            // Roll back the session so a failed start leaves no phantom entry.
            if let Ok(conn) = state.lock_db() {
                let _ = db::delete_session(&conn, session.id);
            }
            return Err(err);
        }
    };

    launch::supervise(app.clone(), session.id, id, started_at, child);

    Ok(LaunchInfo {
        session_id: session.id,
    })
}

#[tauri::command]
pub fn list_sessions(
    state: State<'_, AppState>,
    game_id: i64,
    limit: Option<i64>,
) -> AppResult<Vec<Session>> {
    let conn = state.lock_db()?;
    db::list_sessions(&conn, game_id, limit)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    Ok(state.lock_settings()?.clone())
}

#[tauri::command]
pub fn update_settings(state: State<'_, AppState>, patch: SettingsPatch) -> AppResult<Settings> {
    let mut patch = patch;
    if let Some(font) = patch.font.take() {
        patch.font = Some(Settings::normalize_id("font", &font)?);
    }
    if let Some(accent) = patch.accent.take() {
        patch.accent = Some(Settings::normalize_id("accent", &accent)?);
    }
    if let Some(layout) = patch.big_picture_layout.take() {
        patch.big_picture_layout = Some(Settings::normalize_big_picture_layout(&layout)?);
    }
    if let Some(max_mb) = patch.mods_max_mb.take() {
        patch.mods_max_mb = Some(Settings::normalize_mods_max_mb(max_mb)?);
    }
    let updated = {
        let mut settings = state.lock_settings()?;
        settings::apply_patch(&mut settings, patch);
        settings.clone()
    };
    // Persist outside the lock; settings are written atomically enough for M1.
    settings::save_to(&state.config_path, &updated)?;
    Ok(updated)
}

// ---------------------------------------------------------------------------
// Covers (artwork)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn fetch_cover_candidates(
    query: String,
) -> AppResult<Vec<crate::covers::CoverCandidate>> {
    crate::covers::fetch_candidates(&query)
}

#[tauri::command]
pub async fn download_cover(
    app: AppHandle,
    state: State<'_, AppState>,
    game_id: i64,
    url: String,
) -> AppResult<Game> {
    let covers = crate::paths::covers_dir()?;
    let path = crate::covers::download(&covers, game_id, &url)?;
    apply_cover(app, state, game_id, path).await
}

#[tauri::command]
pub async fn set_cover_from_file(
    app: AppHandle,
    state: State<'_, AppState>,
    game_id: i64,
    source_path: String,
) -> AppResult<Game> {
    let covers = crate::paths::covers_dir()?;
    let path = crate::covers::set_from_file(&covers, game_id, Path::new(&source_path))?;
    apply_cover(app, state, game_id, path).await
}

/// Persist a stored cover file as the game's coverPath, then notify the UI.
async fn apply_cover(
    app: AppHandle,
    state: State<'_, AppState>,
    game_id: i64,
    path: PathBuf,
) -> AppResult<Game> {
    let patch = GamePatch {
        cover_path: Some(Some(path.to_string_lossy().into_owned())),
        ..Default::default()
    };
    let conn = state.lock_db()?;
    let game = db::update_game(&conn, game_id, &patch)?;
    drop(conn);
    emit_library_changed(&app);
    Ok(game)
}

// ---------------------------------------------------------------------------
// Mods (loaders & installs)
// ---------------------------------------------------------------------------

/// Resolve the game row without holding the DB lock, verifying the folder
/// exists on disk (required by every mods operation).
fn game_root_for(state: &State<'_, AppState>, game_id: i64) -> AppResult<PathBuf> {
    let conn = state.lock_db()?;
    let game = db::get_game(&conn, game_id)?;
    drop(conn);

    if !matches!(game.game_type, crate::models::GameType::Windows) {
        return Err(AppError::validation(
            "mod loading is only supported for Windows games",
        ));
    }
    let root = PathBuf::from(&game.install_path);
    if !root.is_dir() {
        return Err(AppError::validation("game folder not found on disk"));
    }
    Ok(root)
}

#[tauri::command]
pub fn mods_status(state: State<'_, AppState>, game_id: i64) -> AppResult<crate::mods::ModsStatus> {
    let root = game_root_for(&state, game_id)?;
    let state_dir = crate::paths::game_state_dir(game_id)?;
    Ok(crate::mods::status_with_install(&root, &state_dir))
}

#[tauri::command]
pub async fn install_mod_loader(
    state: State<'_, AppState>,
    game_id: i64,
    loader_id: Option<String>,
) -> AppResult<crate::mods::ModsStatus> {
    let root = game_root_for(&state, game_id)?;
    let state_dir = crate::paths::game_state_dir(game_id)?;
    crate::mods::install_loader(&root, loader_id.as_deref(), &state_dir)
}

/// Compare the loader Zen installed for this game with the latest release.
/// `null` when there is nothing Zen-installed to check (manual/detected loaders).
#[tauri::command]
pub async fn check_loader_updates(
    state: State<'_, AppState>,
    game_id: i64,
) -> AppResult<Option<crate::mods::LoaderUpdate>> {
    // Resolve the game so an unknown id is NOT_FOUND rather than a silent null.
    let _ = game_root_for(&state, game_id)?;
    let state_dir = crate::paths::game_state_dir(game_id)?;
    crate::mods::check_loader_updates(&state_dir)
}

#[tauri::command]
pub async fn install_mod_archive(
    state: State<'_, AppState>,
    game_id: i64,
    archive_path: String,
) -> AppResult<crate::mods::ModInstallResult> {
    let root = game_root_for(&state, game_id)?;
    let (lenient, max_mb) = {
        let settings = state.lock_settings()?;
        (settings.mods_lenient, settings.mods_max_mb)
    };
    let staging = crate::paths::data_dir()?.join("staging");
    crate::mods::install_archive(
        &root,
        Path::new(&archive_path),
        &staging,
        lenient,
        max_mb.max(1) as u64 * 1024 * 1024,
    )
}

/// Connected pads for `list_gamepads` — contract shape: `{ pads: [...] }`.
#[tauri::command]
pub fn list_gamepads() -> AppResult<serde_json::Value> {
    let pads = crate::input::list_gamepads();
    Ok(serde_json::json!({ "pads": pads }))
}
