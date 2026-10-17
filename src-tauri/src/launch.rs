//! Game runner + process supervisor.
//!
//! Spawn rules (contract §"Launch rules"):
//! - native `.sh` → run through `sh`
//! - native `.AppImage` → ensure the exec bit, run directly
//! - other native → run directly, requires the exec bit, else `LAUNCH_FAILED`
//! - `windows` → system `wine` with a per-game prefix
//!   (`~/.local/share/zen-launcher/prefixes/<gameId>`); `.bat`/`.cmd` entry
//!   points run through `wine cmd /c`; wine creates the prefix on first run
//! - default cwd = the executable's parent directory
//! - `retro`/`mod` → `UNSUPPORTED` (their runners arrive later)

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use tauri::{AppHandle, Emitter, Manager};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::{Game, GameType, SessionEnded, SessionStarted, events};
use crate::paths;
use crate::state::AppState;
use crate::time;

#[derive(Debug, Clone, PartialEq)]
pub struct SpawnPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: BTreeMap<String, String>,
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && (meta.permissions().mode() & 0o111) != 0)
        .unwrap_or(false)
}

/// Add the exec bit (used for `.AppImage`), preserving the rest of the mode.
pub fn ensure_executable(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = std::fs::metadata(path)?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(permissions.mode() | 0o755);
    std::fs::set_permissions(path, permissions)?;
    Ok(())
}

/// Pure planning step — no side effects except the `.AppImage` exec bit fixup.
pub fn build_spawn_plan(game: &Game) -> AppResult<SpawnPlan> {
    let executable = db::resolve_executable(&game.install_path, &game.executable);
    if !executable.exists() {
        return Err(AppError::launch_failed(format!(
            "executable not found: {}",
            executable.display()
        )));
    }

    let cwd = match game.work_dir.as_deref() {
        Some(dir) if !dir.is_empty() => {
            let dir = PathBuf::from(dir);
            if dir.is_dir() {
                dir
            } else {
                return Err(AppError::validation(format!(
                    "working directory does not exist: {}",
                    dir.display()
                )));
            }
        }
        _ => executable.parent().map(Path::to_path_buf).ok_or_else(|| {
            AppError::launch_failed(format!(
                "executable has no parent directory: {}",
                executable.display()
            ))
        })?,
    };

    let file_name = executable
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    let (program, mut args) = match game.game_type {
        GameType::Native => {
            if file_name.ends_with(".sh") {
                (
                    PathBuf::from("sh"),
                    vec![executable.to_string_lossy().into_owned()],
                )
            } else if file_name.ends_with(".appimage") {
                ensure_executable(&executable)?;
                (executable.clone(), Vec::new())
            } else if is_executable(&executable) {
                (executable.clone(), Vec::new())
            } else {
                return Err(AppError::launch_failed(format!(
                    "{} is not executable (missing exec bit)",
                    executable.display()
                )));
            }
        }
        GameType::Windows => {
            // `.bat`/`.cmd` entry points run through `cmd /c`; `.exe` (and
            // anything else) starts directly. Wine creates the prefix on
            // first run.
            let mut wine_args = vec![executable.to_string_lossy().into_owned()];
            if file_name.ends_with(".bat") || file_name.ends_with(".cmd") {
                wine_args.insert(0, "/c".to_string());
                wine_args.insert(0, "cmd".to_string());
            }
            (PathBuf::from("wine"), wine_args)
        }
        other => {
            return Err(AppError::unsupported(format!(
                "no runner for game type: {other}"
            )));
        }
    };

    args.extend(game.args.iter().cloned());

    let mut env = game.env.clone();
    if game.game_type == GameType::Windows {
        if !env.contains_key("WINEPREFIX") {
            let prefix = paths::data_dir()?
                .join("prefixes")
                .join(game.id.to_string());
            env.insert(
                "WINEPREFIX".to_string(),
                prefix.to_string_lossy().into_owned(),
            );
        }
        env.entry("WINEDLLOVERRIDES".to_string())
            .or_insert_with(|| "mscoree,mshtml=".to_string());
    }

    Ok(SpawnPlan {
        program,
        args,
        cwd,
        env,
    })
}

/// Wine requires the `WINEPREFIX` directory to exist before it starts
/// (`wine` chdirs into it); create the full path when one is planned.
fn ensure_prefix_dir(env: &BTreeMap<String, String>) -> AppResult<()> {
    if let Some(prefix) = env.get("WINEPREFIX") {
        std::fs::create_dir_all(prefix).map_err(|err| {
            AppError::launch_failed(format!("could not create wine prefix {prefix}: {err}"))
        })?;
    }
    Ok(())
}

/// Start the process described by `plan`. The child is detached from our
/// stdio so it can outlive the launcher window.
pub fn spawn(plan: &SpawnPlan) -> AppResult<Child> {
    ensure_prefix_dir(&plan.env)?;
    let mut command = Command::new(&plan.program);
    command
        .args(&plan.args)
        .current_dir(&plan.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for (key, value) in &plan.env {
        command.env(key, value);
    }
    command.spawn().map_err(|err| {
        AppError::launch_failed(format!("failed to start {}: {err}", plan.program.display()))
    })
}

/// Wait for the child in a background thread, then close the session, update
/// game statistics and emit `session-ended` + `library-changed`.
///
/// The DB mutex is only taken *after* the wait, never across it.
pub fn supervise(
    app: AppHandle,
    session_id: i64,
    game_id: i64,
    started_at: String,
    mut child: Child,
) {
    std::thread::spawn(move || {
        let status = child.wait();
        let ended_at = time::now_iso();
        let duration_seconds = time::elapsed_seconds_since(&started_at);
        let exit_code = match &status {
            Ok(status) => status.code().map(i64::from),
            Err(err) => {
                tracing::warn!("supervisor: wait failed for session {session_id}: {err}");
                None
            }
        };

        let state = app.state::<AppState>();
        match state.lock_db() {
            Ok(conn) => {
                if let Err(err) =
                    db::finish_session(&conn, session_id, &ended_at, duration_seconds, exit_code)
                {
                    tracing::error!("supervisor: could not close session {session_id}: {err}");
                }
                if let Err(err) =
                    db::record_game_played(&conn, game_id, &ended_at, duration_seconds)
                {
                    tracing::error!("supervisor: could not update game {game_id}: {err}");
                }
            }
            Err(err) => tracing::error!("supervisor: {err}"),
        }

        let _ = app.emit(
            events::SESSION_ENDED,
            SessionEnded {
                session_id,
                game_id,
                duration_seconds,
                exit_code,
            },
        );
        let _ = app.emit(events::LIBRARY_CHANGED, serde_json::json!({}));

        match status {
            Ok(status) => tracing::info!("session {session_id} ended with {status}"),
            Err(_) => tracing::warn!("session {session_id} ended without a status"),
        }
    });
}

/// Convenience used by `launch_game` for the `session-started` event.
pub fn session_started(session_id: i64, game_id: i64, started_at: &str) -> SessionStarted {
    SessionStarted {
        session_id,
        game_id,
        started_at: started_at.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::GameStatus;
    use std::collections::BTreeMap;
    use tempfile::tempdir;

    fn game(install_path: &Path, executable: &str, game_type: GameType) -> Game {
        Game {
            id: 1,
            title: "Test".into(),
            sort_title: None,
            game_type,
            install_path: install_path.to_string_lossy().into_owned(),
            executable: executable.to_string(),
            args: vec!["--flag".into()],
            env: BTreeMap::from([("ZEN".to_string(), "1".to_string())]),
            work_dir: None,
            tags: vec![],
            favorite: false,
            hidden: false,
            notes: None,
            cover_path: None,
            status: GameStatus::Ready,
            created_at: "2026-10-17T00:00:00Z".into(),
            updated_at: "2026-10-17T00:00:00Z".into(),
            last_played_at: None,
            total_seconds: 0,
        }
    }

    fn write_executable(path: &Path, contents: &[u8]) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, contents).unwrap();
        ensure_executable(path).unwrap();
    }

    #[test]
    fn shell_script_runs_through_sh() {
        let dir = tempdir().unwrap();
        let script = dir.path().join("run.sh");
        std::fs::write(&script, b"#!/bin/sh\necho hi\n").unwrap();

        let plan = build_spawn_plan(&game(dir.path(), "run.sh", GameType::Native)).unwrap();
        assert_eq!(plan.program, PathBuf::from("sh"));
        assert_eq!(plan.args[0], script.to_string_lossy());
        assert_eq!(plan.args[1], "--flag");
        assert_eq!(plan.cwd, dir.path());
        assert_eq!(plan.env.get("ZEN"), Some(&"1".to_string()));
    }

    #[test]
    fn native_binary_requires_exec_bit() {
        let dir = tempdir().unwrap();
        let binary = dir.path().join("game.x86_64");
        std::fs::write(&binary, b"\x7fELF").unwrap();

        let err = build_spawn_plan(&game(dir.path(), "game.x86_64", GameType::Native)).unwrap_err();
        assert_eq!(err.code, crate::error::LAUNCH_FAILED);

        ensure_executable(&binary).unwrap();
        let plan = build_spawn_plan(&game(dir.path(), "game.x86_64", GameType::Native)).unwrap();
        assert_eq!(plan.program, binary);
    }

    #[test]
    fn appimage_gets_exec_bit_and_runs_directly() {
        let dir = tempdir().unwrap();
        let appimage = dir.path().join("Game.AppImage");
        std::fs::write(&appimage, b"\x7fELF").unwrap();

        let plan = build_spawn_plan(&game(dir.path(), "Game.AppImage", GameType::Native)).unwrap();
        assert_eq!(plan.program, appimage);
        assert!(is_executable(&plan.program));
    }

    #[test]
    fn windows_exe_runs_through_wine() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("game.exe"), b"MZ").unwrap();

        let plan = build_spawn_plan(&game(dir.path(), "game.exe", GameType::Windows)).unwrap();
        assert_eq!(plan.program, PathBuf::from("wine"));
        assert_eq!(plan.args[0], dir.path().join("game.exe").to_string_lossy());
        assert_eq!(plan.args[1], "--flag");
        assert_eq!(plan.cwd, dir.path());
        let prefix = plan.env.get("WINEPREFIX").expect("prefix env is set");
        assert!(
            Path::new(prefix).ends_with("prefixes/1"),
            "prefix should live under the app data dir, got: {prefix}"
        );
        assert_eq!(
            plan.env.get("WINEDLLOVERRIDES"),
            Some(&"mscoree,mshtml=".to_string())
        );
        assert_eq!(plan.env.get("ZEN"), Some(&"1".to_string()));
    }

    #[test]
    fn windows_batch_launcher_runs_through_wine_cmd() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("launcher.bat"), b"@echo off\n").unwrap();

        let plan = build_spawn_plan(&game(dir.path(), "launcher.bat", GameType::Windows)).unwrap();
        assert_eq!(plan.program, PathBuf::from("wine"));
        assert_eq!(plan.args[0], "cmd");
        assert_eq!(plan.args[1], "/c");
        assert_eq!(
            plan.args[2],
            dir.path().join("launcher.bat").to_string_lossy()
        );
        assert_eq!(plan.args[3], "--flag");
    }

    #[test]
    fn windows_game_env_overrides_wine_defaults() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("game.exe"), b"MZ").unwrap();
        let mut g = game(dir.path(), "game.exe", GameType::Windows);
        g.env
            .insert("WINEPREFIX".to_string(), "/custom/prefix".to_string());

        let plan = build_spawn_plan(&g).unwrap();
        assert_eq!(
            plan.env.get("WINEPREFIX"),
            Some(&"/custom/prefix".to_string())
        );
    }

    #[test]
    fn retro_and_mod_types_are_unsupported() {
        let dir = tempdir().unwrap();
        write_executable(&dir.path().join("game.x86_64"), b"\x7fELF");
        let err = build_spawn_plan(&game(dir.path(), "game.x86_64", GameType::Retro)).unwrap_err();
        assert_eq!(err.code, crate::error::UNSUPPORTED);
        let err = build_spawn_plan(&game(dir.path(), "game.x86_64", GameType::Mod)).unwrap_err();
        assert_eq!(err.code, crate::error::UNSUPPORTED);
    }

    #[test]
    fn missing_executable_is_launch_failed() {
        let dir = tempdir().unwrap();
        let err = build_spawn_plan(&game(dir.path(), "nope.x86_64", GameType::Native)).unwrap_err();
        assert_eq!(err.code, crate::error::LAUNCH_FAILED);
    }

    #[test]
    fn relative_executable_resolves_against_install_path() {
        let dir = tempdir().unwrap();
        write_executable(&dir.path().join("bin/game.x86_64"), b"\x7fELF");
        let plan =
            build_spawn_plan(&game(dir.path(), "bin/game.x86_64", GameType::Native)).unwrap();
        assert_eq!(plan.program, dir.path().join("bin/game.x86_64"));
    }

    #[test]
    fn spawn_creates_missing_wine_prefix_directory() {
        let dir = tempdir().unwrap();
        let prefix = dir.path().join("deep/prefix");
        let env = BTreeMap::from([(
            "WINEPREFIX".to_string(),
            prefix.to_string_lossy().into_owned(),
        )]);

        ensure_prefix_dir(&env).unwrap();
        assert!(prefix.is_dir());
        // No WINEPREFIX planned → no-op.
        ensure_prefix_dir(&BTreeMap::new()).unwrap();
    }
}
