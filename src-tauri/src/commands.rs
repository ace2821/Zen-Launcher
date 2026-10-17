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

    // Type inference: `.exe` → windows, everything else → native.
    let game_type = if executable.to_ascii_lowercase().ends_with(".exe") {
        crate::models::GameType::Windows
    } else {
        crate::models::GameType::Native
    };

    let title = patch
        .title
        .clone()
        .unwrap_or_else(|| candidate.suggested_title.clone());

    // Dedupe by canonical install path.
    if let Some(existing) = db::find_game_by_install_path(&conn, &install_path)? {
        db::set_candidate_status(&conn, id, CandidateStatus::Approved)?;
        drop(conn);
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
        },
    )?;
    db::set_candidate_status(&conn, id, CandidateStatus::Approved)?;
    drop(conn);

    emit_library_changed(&app);
    Ok(game)
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

    // Planning can fail (unsupported type, missing exec bit) — nothing is
    // persisted before it succeeds.
    let plan = launch::build_spawn_plan(&game)?;

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
    let updated = {
        let mut settings = state.lock_settings()?;
        settings::apply_patch(&mut settings, patch);
        settings.clone()
    };
    // Persist outside the lock; settings are written atomically enough for M1.
    settings::save_to(&state.config_path, &updated)?;
    Ok(updated)
}
