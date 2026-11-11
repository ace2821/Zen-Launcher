//! Game runner + process supervisor.
//!
//! Spawn rules (contract §"Launch rules"):
//! - native `.sh` → run through `sh`
//! - native `.AppImage` → ensure the exec bit, run directly
//! - other native → run directly, requires the exec bit, else `LAUNCH_FAILED`
//! - `windows` → system `wine` with a per-game prefix
//!   (`~/.local/share/zinc-launcher/prefixes/<gameId>`); `.bat`/`.cmd` entry
//!   points run through `wine cmd /c`; wine creates the prefix on first run
//! - default cwd = the executable's parent directory
//! - `retro`/`mod` → `UNSUPPORTED` (their runners arrive later)

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use tauri::{AppHandle, Emitter, Manager};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::{
    ClientKind, Game, GameType, RuntimeInfo, SessionEnded, SessionStarted, TranslationLayer, events,
};
use crate::runtime;
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

/// Session environment extras resolved from settings at launch time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LaunchExtras {
    /// Wrap the launch command with `gamemoderun` (best-effort).
    pub game_mode: bool,
    /// Inject `MANGOHUD=1` + `MANGOHUD_DLSYM=1` into the launch env.
    pub mango_hud: bool,
}

impl LaunchExtras {
    /// Both extras off (used by tests and callers without settings).
    pub fn off() -> Self {
        Self {
            game_mode: false,
            mango_hud: false,
        }
    }
}

/// Everything the planner needs to resolve the Windows translation layer.
#[derive(Debug, Clone, PartialEq)]
pub struct TranslationConfig {
    pub layer: TranslationLayer,
    /// Binary/script used by [`TranslationLayer::Custom`].
    pub custom_runtime_path: Option<String>,
    /// Pins a specific runtime directory, bypassing newest-match selection.
    pub runtime_override_path: Option<String>,
    /// Already-scanned runtimes (`runtime::scan_runtimes`).
    pub runtimes: Vec<RuntimeInfo>,
    /// `STEAM_COMPAT_CLIENT_INSTALL_PATH`; `None` when no Steam client exists.
    pub steam_client_dir: Option<PathBuf>,
    /// `<dataDir>/prefixes`; per-game prefixes live below it.
    pub prefixes_dir: PathBuf,
}

impl TranslationConfig {
    /// Plain system `wine` with per-game prefixes (used by tests and callers
    /// without settings). Production passes the config built from settings.
    pub fn normal_wine(prefixes_dir: PathBuf) -> Self {
        Self {
            layer: TranslationLayer::NormalWine,
            custom_runtime_path: None,
            runtime_override_path: None,
            runtimes: Vec::new(),
            steam_client_dir: None,
            prefixes_dir,
        }
    }
}

/// Environment additions required to run a build through its `proton` script.
struct ProtonEnv {
    compatdata: PathBuf,
    steam_client: PathBuf,
}

/// True when `name` is an executable found on PATH.
fn on_path(name: &str) -> bool {
    let Ok(path_var) = std::env::var("PATH") else {
        return false;
    };
    std::env::split_paths(&path_var).any(|dir| {
        let candidate = dir.join(name);
        is_executable(&candidate)
    })
}

/// Pure planning step — no side effects except the `.AppImage` exec bit fixup
/// and creating the Proton compatdata directory.
pub fn build_spawn_plan(
    game: &Game,
    extras: &LaunchExtras,
    translation: &TranslationConfig,
) -> AppResult<SpawnPlan> {
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

    let mut proton_env = None;
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
            let (program, args, env) =
                build_windows_runner(game, &executable, &file_name, translation)?;
            proton_env = env;
            (program, args)
        }
        other => {
            return Err(AppError::unsupported(format!(
                "no runner for game type: {other}"
            )));
        }
    };

    args.extend(game.args.iter().cloned());
    append_client_args(game, &mut args);

    let mut env = game.env.clone();
    if game.game_type == GameType::Windows {
        if let Some(proton) = &proton_env {
            // Proton manages its own prefix inside STEAM_COMPAT_DATA_PATH.
            // It also creates the prefix on first run, so no wineboot is run.
            env.insert(
                "STEAM_COMPAT_CLIENT_INSTALL_PATH".to_string(),
                proton.steam_client.to_string_lossy().into_owned(),
            );
            env.insert(
                "STEAM_COMPAT_DATA_PATH".to_string(),
                proton.compatdata.to_string_lossy().into_owned(),
            );
            env.insert(
                "WINEPREFIX".to_string(),
                proton.compatdata.join("pfx").to_string_lossy().into_owned(),
            );
        } else if !env.contains_key("WINEPREFIX") {
            let prefix = translation.prefixes_dir.join(game.id.to_string());
            env.insert(
                "WINEPREFIX".to_string(),
                prefix.to_string_lossy().into_owned(),
            );
        }
        env.entry("WINEDLLOVERRIDES".to_string())
            .or_insert_with(|| "mscoree,mshtml=".to_string());

        // Mods only load when Wine is told to prefer the *native* proxy DLLs
        // shipped with the loader (BepInEx/doorstop `winhttp.dll`, Ultimate ASI
        // Loader `dinput8/version/vorbisFile/d3d9`, …). Without these
        // overrides Wine keeps its builtin DLL, the loader never runs and the
        // installed mods are silently ignored.
        //
        // Loader DLLs sit next to the executable for most games, but plenty of
        // Unity/Unreal titles put the `.exe` in `bin/`/`x64/` while the loader
        // (and its mods folders) live in the game root. Scan both so the
        // override is not missed.
        let mut native = native_proxy_dlls(executable.parent().unwrap_or(cwd.as_path()));
        let game_root = Path::new(&game.install_path);
        if game_root != cwd.as_path() && game_root != executable.parent().unwrap_or(Path::new("")) {
            native.extend(native_proxy_dlls(game_root));
        }
        native.sort();
        native.dedup();
        let overrides = env.get("WINEDLLOVERRIDES").cloned().unwrap_or_default();
        env.insert(
            "WINEDLLOVERRIDES".to_string(),
            with_native_overrides(overrides, &native),
        );
    }
    if extras.mango_hud {
        env.entry("MANGOHUD".to_string())
            .or_insert_with(|| "1".to_string());
        env.entry("MANGOHUD_DLSYM".to_string())
            .or_insert_with(|| "1".to_string());
    }

    // GameMode wraps the whole command line; off-when-unavailable is expected.
    let plan = if extras.game_mode
        && program.file_name() != Some("gamemoderun".as_ref())
        && on_path("gamemoderun")
    {
        let mut wrapped = vec![program.to_string_lossy().into_owned()];
        wrapped.extend(args);
        SpawnPlan {
            program: PathBuf::from("gamemoderun"),
            args: wrapped,
            cwd,
            env,
        }
    } else {
        SpawnPlan {
            program,
            args,
            cwd,
            env,
        }
    };

    Ok(plan)
}

/// Resolve the program/args/environment for a `windows` game under the
/// configured translation layer. Proton runs get a [`ProtonEnv`]; Wine runs
/// keep the per-game `WINEPREFIX` handled by the caller.
fn build_windows_runner(
    game: &Game,
    executable: &Path,
    file_name: &str,
    translation: &TranslationConfig,
) -> AppResult<(PathBuf, Vec<String>, Option<ProtonEnv>)> {
    let exe = executable.to_string_lossy().into_owned();

    match translation.layer {
        TranslationLayer::NormalWine => Ok((
            PathBuf::from("wine"),
            wine_launch_args(&exe, file_name),
            None,
        )),
        TranslationLayer::Custom => {
            let raw = translation.custom_runtime_path.as_deref().ok_or_else(|| {
                AppError::validation(
                    "translation layer 'custom' needs customRuntimePath (a wine binary or proton script)",
                )
            })?;
            let path = PathBuf::from(raw);
            if !path.exists() {
                return Err(AppError::validation(format!(
                    "custom runtime path does not exist: {}",
                    path.display()
                )));
            }
            if runtime::is_proton_script(&path) {
                let proton = if path.is_dir() {
                    path.join("proton")
                } else {
                    path.clone()
                };
                let env = build_proton_env(game, translation)?;
                Ok((proton, proton_launch_args(&exe), Some(env)))
            } else {
                Ok((path, wine_launch_args(&exe, file_name), None))
            }
        }
        TranslationLayer::WineGe => {
            let info = runtime::select_wine_runtime(
                translation.runtime_override_path.as_deref(),
                &translation.runtimes,
            )
            .ok_or_else(|| {
                AppError::launch_failed(
                    "no Wine runtime found; install a Wine-GE build into \
                     ~/.local/share/Steam/compatibilitytools.d, ~/.local/share/lutris/runners/wine \
                     or ~/.local/share/zinc-launcher/runtimes, or switch the translation layer",
                )
            })?;
            let dir = PathBuf::from(&info.path);
            let binary = runtime::wine_binary_path(&dir).ok_or_else(|| {
                AppError::launch_failed(format!(
                    "Wine runtime {} has no files/bin/wine or bin/wine",
                    dir.display()
                ))
            })?;
            Ok((binary, wine_launch_args(&exe, file_name), None))
        }
        TranslationLayer::ProtonGe | TranslationLayer::ProtonExperimental => {
            let info = runtime::select_proton_runtime(
                translation.layer,
                translation.runtime_override_path.as_deref(),
                &translation.runtimes,
            )
            .ok_or_else(|| {
                AppError::launch_failed(
                    "no Proton runtime found; install a Proton-GE/UMU build into \
                     ~/.local/share/Steam/compatibilitytools.d (or set runtimeOverridePath), \
                     or switch the translation layer",
                )
            })?;
            let dir = PathBuf::from(&info.path);
            let proton = dir.join("proton");
            if !proton.is_file() {
                return Err(AppError::launch_failed(format!(
                    "Proton runtime {} has no proton script",
                    dir.display()
                )));
            }
            let env = build_proton_env(game, translation)?;
            Ok((proton, proton_launch_args(&exe), Some(env)))
        }
    }
}

fn wine_launch_args(exe: &str, file_name: &str) -> Vec<String> {
    let mut args = Vec::new();
    if file_name.ends_with(".bat") || file_name.ends_with(".cmd") {
        args.push("cmd".to_string());
        args.push("/c".to_string());
    }
    args.push(exe.to_string());
    args
}

fn proton_launch_args(exe: &str) -> Vec<String> {
    vec!["run".to_string(), exe.to_string()]
}

/// `STEAM_COMPAT_DATA_PATH` is `<prefixes>/proton-<gameId>`; it must exist
/// before Proton starts. Proton creates `<compatdata>/pfx` itself.
fn build_proton_env(game: &Game, translation: &TranslationConfig) -> AppResult<ProtonEnv> {
    let steam_client = translation.steam_client_dir.clone().ok_or_else(|| {
        AppError::launch_failed(
            "Steam client not found at ~/.local/share/Steam or ~/.steam/steam; \
             it is required for Proton (STEAM_COMPAT_CLIENT_INSTALL_PATH)",
        )
    })?;
    let compatdata = translation.prefixes_dir.join(format!("proton-{}", game.id));
    std::fs::create_dir_all(&compatdata).map_err(|err| {
        AppError::launch_failed(format!(
            "could not create Proton compatdata {}: {err}",
            compatdata.display()
        ))
    })?;
    Ok(ProtonEnv {
        compatdata,
        steam_client,
    })
}

/// Per-client connection flags. Only SA-MP takes them; FiveM/MTA are launched
/// as-is. A port outside 1..=65535 never reaches this point (it deserializes as
/// `None`), so `-p` is only added for a usable port.
fn append_client_args(game: &Game, args: &mut Vec<String>) {
    let Some(client) = &game.client else {
        return;
    };
    if client.kind != ClientKind::Samp {
        return;
    }
    if let Some(host) = client
        .host
        .as_deref()
        .map(str::trim)
        .filter(|h| !h.is_empty())
    {
        args.push("-h".to_string());
        args.push(host.to_string());
    }
    if let Some(port) = client.port {
        if port == 0 {
            tracing::warn!("ignoring invalid SA-MP port 0 for game {}", game.id);
        } else {
            args.push("-p".to_string());
            args.push(port.to_string());
        }
    }
    if let Some(nick) = client
        .nick
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        args.push("-n".to_string());
        args.push(nick.to_string());
    }
}

/// Proxy DLL names through which mod loaders inject themselves on Windows.
/// Only these get a native override — the game's own runtime DLLs must keep
/// Wine's builtin implementation.
const WINE_PROXY_DLLS: &[&str] = &[
    "winhttp.dll",
    "dinput8.dll",
    "version.dll",
    "vorbisfile.dll",
    "d3d9.dll",
    "d3d11.dll",
    "xinput1_3.dll",
    "xinput9_1_0.dll",
    "dsound.dll",
    "ddraw.dll",
    "winmm.dll",
    "dbghelp.dll",
];

/// Loader proxy DLLs present next to the executable (`winhttp.dll` for
/// BepInEx/doorstop, `dinput8.dll` for Ultimate ASI Loader/Script Hook, …).
fn native_proxy_dlls(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<String> = entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase())
        .filter(|name| WINE_PROXY_DLLS.iter().any(|dll| name == dll))
        .collect();
    found.sort();
    found
}

/// Merge `dll=n,b` entries into a `WINEDLLOVERRIDES` value without dropping
/// the existing overrides (`mscoree,mshtml=` by default) or user entries.
///
/// Wine's syntax separates override *groups* with `;` — a comma only groups
/// DLL names that share the same setting (`mscoree,mshtml=`). Joining a new
/// entry to `mscoree,mshtml=` with a comma produced
/// `mscoree,mshtml=,winhttp=n,b`, which Wine parses as "msscoree/mshtml are
/// disabled with the setting `,winhttp=n,b`" — the `winhttp` override was
/// never applied, Wine kept its builtin DLL and BepInEx/doorstop (Ages of
/// Conflict) silently ignored every installed mod.
fn with_native_overrides(existing: String, native: &[String]) -> String {
    let mut value = existing;
    for dll in native {
        let stem = dll.trim_end_matches(".dll");
        let marker = format!("{stem}=");
        // Existing entries live either in their own group (`;`) or share a
        // group with other names (`,`).
        let already = value
            .split([';', ','])
            .any(|part| part.trim().to_ascii_lowercase().starts_with(&marker));
        if already {
            continue;
        }
        if !value.is_empty() && !value.ends_with(';') {
            value.push(';');
        }
        value.push_str(&format!("{stem}=n,b"));
    }
    value
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
            env: BTreeMap::from([("ZINC".to_string(), "1".to_string())]),
            work_dir: None,
            tags: vec![],
            favorite: false,
            hidden: false,
            notes: None,
            cover_path: None,
            client: None,
            status: GameStatus::Ready,
            created_at: "2026-10-17T00:00:00Z".into(),
            updated_at: "2026-10-17T00:00:00Z".into(),
            last_played_at: None,
            total_seconds: 0,
        }
    }

    fn normal_wine_config() -> TranslationConfig {
        TranslationConfig::normal_wine(crate::paths::data_dir().unwrap().join("prefixes"))
    }

    fn write_executable(path: &Path, contents: &[u8]) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, contents).unwrap();
        ensure_executable(path).unwrap();
    }

    #[test]
    fn samp_client_adds_host_port_and_nick_after_game_args() {
        use crate::models::{ClientInfo, ClientKind};
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("gta_sa.exe"), b"MZ").unwrap();
        let mut g = game(dir.path(), "gta_sa.exe", GameType::Windows);
        g.client = Some(ClientInfo {
            kind: ClientKind::Samp,
            host: Some("play.example.com".into()),
            port: Some(7777),
            nick: Some("Zinc".into()),
        });

        let plan = build_spawn_plan(&g, &LaunchExtras::off(), &normal_wine_config()).unwrap();
        let trailing: Vec<&str> = plan.args[1..].iter().map(String::as_str).collect();
        assert_eq!(
            trailing,
            vec![
                "--flag",
                "-h",
                "play.example.com",
                "-p",
                "7777",
                "-n",
                "Zinc"
            ]
        );
    }

    #[test]
    fn samp_out_of_range_port_is_ignored_not_fatal() {
        use crate::models::{ClientInfo, ClientKind};
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("gta_sa.exe"), b"MZ").unwrap();
        let mut g = game(dir.path(), "gta_sa.exe", GameType::Windows);

        // 70000 cannot fit a u16: it deserializes as `None` (logged), which the
        // launch adapter simply skips.
        let client: ClientInfo =
            serde_json::from_str(r#"{"kind":"samp","host":"h","port":70000,"nick":null}"#).unwrap();
        assert_eq!(client.port, None);
        assert_eq!(client.kind, ClientKind::Samp);
        g.client = Some(client);

        let plan = build_spawn_plan(&g, &LaunchExtras::off(), &normal_wine_config()).unwrap();
        assert!(plan.args.iter().any(|arg| arg == "-h"));
        assert!(!plan.args.iter().any(|arg| arg == "-p"));
    }

    #[test]
    fn fivem_and_mta_clients_add_no_extra_args() {
        use crate::models::{ClientInfo, ClientKind};
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("CitizenFX.exe"), b"MZ").unwrap();
        for kind in [ClientKind::Fivem, ClientKind::Mta] {
            let mut g = game(dir.path(), "CitizenFX.exe", GameType::Windows);
            g.client = Some(ClientInfo {
                kind,
                host: Some("ignored".into()),
                port: Some(1234),
                nick: Some("ignored".into()),
            });
            let plan = build_spawn_plan(&g, &LaunchExtras::off(), &normal_wine_config()).unwrap();
            let expected = vec![
                dir.path()
                    .join("CitizenFX.exe")
                    .to_string_lossy()
                    .into_owned(),
                "--flag".to_string(),
            ];
            assert_eq!(plan.args, expected);
        }
    }

    #[test]
    fn shell_script_runs_through_sh() {
        let dir = tempdir().unwrap();
        let script = dir.path().join("run.sh");
        std::fs::write(&script, b"#!/bin/sh\necho hi\n").unwrap();

        let plan = build_spawn_plan(
            &game(dir.path(), "run.sh", GameType::Native),
            &LaunchExtras::off(),
            &normal_wine_config(),
        )
        .unwrap();
        assert_eq!(plan.program, PathBuf::from("sh"));
        assert_eq!(plan.args[0], script.to_string_lossy());
        assert_eq!(plan.args[1], "--flag");
        assert_eq!(plan.cwd, dir.path());
        assert_eq!(plan.env.get("ZINC"), Some(&"1".to_string()));
    }

    #[test]
    fn native_binary_requires_exec_bit() {
        let dir = tempdir().unwrap();
        let binary = dir.path().join("game.x86_64");
        std::fs::write(&binary, b"\x7fELF").unwrap();

        let err = build_spawn_plan(
            &game(dir.path(), "game.x86_64", GameType::Native),
            &LaunchExtras::off(),
            &normal_wine_config(),
        )
        .unwrap_err();
        assert_eq!(err.code, crate::error::LAUNCH_FAILED);

        ensure_executable(&binary).unwrap();
        let plan = build_spawn_plan(
            &game(dir.path(), "game.x86_64", GameType::Native),
            &LaunchExtras::off(),
            &normal_wine_config(),
        )
        .unwrap();
        assert_eq!(plan.program, binary);
    }

    #[test]
    fn appimage_gets_exec_bit_and_runs_directly() {
        let dir = tempdir().unwrap();
        let appimage = dir.path().join("Game.AppImage");
        std::fs::write(&appimage, b"\x7fELF").unwrap();

        let plan = build_spawn_plan(
            &game(dir.path(), "Game.AppImage", GameType::Native),
            &LaunchExtras::off(),
            &normal_wine_config(),
        )
        .unwrap();
        assert_eq!(plan.program, appimage);
        assert!(is_executable(&plan.program));
    }

    #[test]
    fn windows_exe_runs_through_wine() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("game.exe"), b"MZ").unwrap();

        let plan = build_spawn_plan(
            &game(dir.path(), "game.exe", GameType::Windows),
            &LaunchExtras::off(),
            &normal_wine_config(),
        )
        .unwrap();
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
        assert_eq!(plan.env.get("ZINC"), Some(&"1".to_string()));
    }

    #[test]
    fn windows_batch_launcher_runs_through_wine_cmd() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("launcher.bat"), b"@echo off\n").unwrap();

        let plan = build_spawn_plan(
            &game(dir.path(), "launcher.bat", GameType::Windows),
            &LaunchExtras::off(),
            &normal_wine_config(),
        )
        .unwrap();
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

        let plan = build_spawn_plan(&g, &LaunchExtras::off(), &normal_wine_config()).unwrap();
        assert_eq!(
            plan.env.get("WINEPREFIX"),
            Some(&"/custom/prefix".to_string())
        );
    }

    #[test]
    fn retro_and_mod_types_are_unsupported() {
        let dir = tempdir().unwrap();
        write_executable(&dir.path().join("game.x86_64"), b"\x7fELF");
        let err = build_spawn_plan(
            &game(dir.path(), "game.x86_64", GameType::Retro),
            &LaunchExtras::off(),
            &normal_wine_config(),
        )
        .unwrap_err();
        assert_eq!(err.code, crate::error::UNSUPPORTED);
        let err = build_spawn_plan(
            &game(dir.path(), "game.x86_64", GameType::Mod),
            &LaunchExtras::off(),
            &normal_wine_config(),
        )
        .unwrap_err();
        assert_eq!(err.code, crate::error::UNSUPPORTED);
    }

    #[test]
    fn missing_executable_is_launch_failed() {
        let dir = tempdir().unwrap();
        let err = build_spawn_plan(
            &game(dir.path(), "nope.x86_64", GameType::Native),
            &LaunchExtras::off(),
            &normal_wine_config(),
        )
        .unwrap_err();
        assert_eq!(err.code, crate::error::LAUNCH_FAILED);
    }

    #[test]
    fn relative_executable_resolves_against_install_path() {
        let dir = tempdir().unwrap();
        write_executable(&dir.path().join("bin/game.x86_64"), b"\x7fELF");
        let plan = build_spawn_plan(
            &game(dir.path(), "bin/game.x86_64", GameType::Native),
            &LaunchExtras::off(),
            &normal_wine_config(),
        )
        .unwrap();
        assert_eq!(plan.program, dir.path().join("bin/game.x86_64"));
    }

    #[test]
    fn windows_loader_proxy_dlls_get_native_wine_overrides() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("game.exe"), b"MZ").unwrap();
        // BepInEx/doorstop + Ultimate ASI Loader proxies.
        std::fs::write(dir.path().join("winhttp.dll"), b"MZ").unwrap();
        std::fs::write(dir.path().join("dinput8.dll"), b"MZ").unwrap();
        // Unrelated DLLs must not be overridden.
        std::fs::write(dir.path().join("UnityPlayer.dll"), b"MZ").unwrap();

        let plan = build_spawn_plan(
            &game(dir.path(), "game.exe", GameType::Windows),
            &LaunchExtras::off(),
            &normal_wine_config(),
        )
        .unwrap();
        let overrides = plan.env.get("WINEDLLOVERRIDES").unwrap();
        // Wine groups are `;`-separated; only names sharing one setting use
        // commas. Joining with a comma made Wine ignore every later group
        // (the Ages of Conflict "mods never load" bug).
        assert_eq!(
            overrides, "mscoree,mshtml=;dinput8=n,b;winhttp=n,b",
            "{overrides}"
        );
        assert!(!overrides.contains("unityplayer"), "{overrides}");
    }

    #[test]
    fn native_override_groups_are_semicolon_separated_not_comma_joined() {
        // Regression: `mscoree,mshtml=,winhttp=n,b` is a single Wine group
        // whose value is ",winhttp=n,b", so the proxy DLL stays builtin and
        // BepInEx/doorstop never injects the mods.
        let merged =
            with_native_overrides("mscoree,mshtml=".to_string(), &["winhttp.dll".to_string()]);
        assert_eq!(merged, "mscoree,mshtml=;winhttp=n,b");
        let groups: Vec<&str> = merged.split(';').collect();
        assert_eq!(groups, vec!["mscoree,mshtml=", "winhttp=n,b"]);
        assert!(groups.iter().all(|group| group.matches('=').count() == 1));
    }

    #[test]
    fn loader_dlls_in_the_game_root_get_overrides_even_when_the_exe_is_in_a_subfolder() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        // Loader proxies live in the game root; the entry point is in bin/.
        std::fs::write(root.join("winhttp.dll"), b"MZ").unwrap();
        std::fs::write(root.join("dinput8.dll"), b"MZ").unwrap();
        write_executable(&root.join("bin/game.exe"), b"MZ");

        let mut g = game(root, "bin/game.exe", GameType::Windows);
        g.install_path = root.to_string_lossy().into_owned();

        let plan = build_spawn_plan(&g, &LaunchExtras::off(), &normal_wine_config()).unwrap();
        let overrides = plan.env.get("WINEDLLOVERRIDES").unwrap();
        assert!(overrides.contains("winhttp=n,b"), "{overrides}");
        assert!(overrides.contains("dinput8=n,b"), "{overrides}");
    }

    #[test]
    fn user_wine_overrides_are_preserved_and_merged() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("game.exe"), b"MZ").unwrap();
        std::fs::write(dir.path().join("winhttp.dll"), b"MZ").unwrap();
        let mut g = game(dir.path(), "game.exe", GameType::Windows);
        g.env.insert(
            "WINEDLLOVERRIDES".to_string(),
            "mscoree,mshtml=;winhttp=n,b".to_string(),
        );

        let plan = build_spawn_plan(&g, &LaunchExtras::off(), &normal_wine_config()).unwrap();
        assert_eq!(
            plan.env.get("WINEDLLOVERRIDES"),
            Some(&"mscoree,mshtml=;winhttp=n,b".to_string())
        );
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

    fn write_proton_runtime(root: &Path, name: &str) -> PathBuf {
        let dir = root.join(name);
        write_executable(&dir.join("proton"), b"#!/bin/sh\n");
        write_executable(&dir.join("files/bin/wine"), b"#!/bin/sh\n");
        dir
    }

    fn write_wine_runtime(root: &Path, name: &str) -> PathBuf {
        let dir = root.join(name);
        write_executable(&dir.join("files/bin/wine"), b"#!/bin/sh\n");
        dir
    }

    fn translation_from(
        root: &Path,
        prefixes: PathBuf,
        layer: TranslationLayer,
        steam: Option<PathBuf>,
    ) -> TranslationConfig {
        TranslationConfig {
            layer,
            custom_runtime_path: None,
            runtime_override_path: None,
            runtimes: crate::runtime::scan_roots(&[root.to_path_buf()]),
            steam_client_dir: steam,
            prefixes_dir: prefixes,
        }
    }

    #[test]
    fn proton_layer_runs_newest_ge_build_through_proton_run() {
        let dir = tempdir().unwrap();
        let runtimes = dir.path().join("runtimes");
        write_proton_runtime(&runtimes, "GE-Proton9-20");
        write_proton_runtime(&runtimes, "UMU-Proton-10.0-4");
        let steam = dir.path().join("steam");
        std::fs::create_dir_all(&steam).unwrap();
        let prefixes = dir.path().join("prefixes");
        let translation = translation_from(
            &runtimes,
            prefixes.clone(),
            TranslationLayer::ProtonGe,
            Some(steam.clone()),
        );

        let game_dir = dir.path().join("game");
        std::fs::create_dir_all(&game_dir).unwrap();
        std::fs::write(game_dir.join("game.exe"), b"MZ").unwrap();
        let g = game(&game_dir, "game.exe", GameType::Windows);

        let plan = build_spawn_plan(&g, &LaunchExtras::off(), &translation).unwrap();
        let runtime = runtimes.join("UMU-Proton-10.0-4");
        assert_eq!(plan.program, runtime.join("proton"));
        assert_eq!(
            plan.args,
            vec![
                "run".to_string(),
                game_dir.join("game.exe").to_string_lossy().into_owned(),
                "--flag".to_string(),
            ]
        );
        let compatdata = prefixes.join("proton-1");
        assert!(compatdata.is_dir());
        assert_eq!(
            plan.env.get("STEAM_COMPAT_DATA_PATH"),
            Some(&compatdata.to_string_lossy().into_owned())
        );
        assert_eq!(
            plan.env.get("STEAM_COMPAT_CLIENT_INSTALL_PATH"),
            Some(&steam.to_string_lossy().into_owned())
        );
        assert_eq!(
            plan.env.get("WINEPREFIX"),
            Some(&compatdata.join("pfx").to_string_lossy().into_owned())
        );
        // Existing game env is preserved alongside Proton variables.
        assert_eq!(plan.env.get("ZINC"), Some(&"1".to_string()));
    }

    #[test]
    fn proton_experimental_layer_selects_experimental_build() {
        let dir = tempdir().unwrap();
        let runtimes = dir.path().join("runtimes");
        write_proton_runtime(&runtimes, "GE-Proton9-20");
        write_proton_runtime(&runtimes, "Proton-Experimental");
        let steam = dir.path().join("steam");
        std::fs::create_dir_all(&steam).unwrap();
        let translation = translation_from(
            &runtimes,
            dir.path().join("prefixes"),
            TranslationLayer::ProtonExperimental,
            Some(steam),
        );
        let game_dir = dir.path().join("game");
        std::fs::create_dir_all(&game_dir).unwrap();
        std::fs::write(game_dir.join("game.exe"), b"MZ").unwrap();

        let plan = build_spawn_plan(
            &game(&game_dir, "game.exe", GameType::Windows),
            &LaunchExtras::off(),
            &translation,
        )
        .unwrap();
        assert_eq!(
            plan.program,
            runtimes.join("Proton-Experimental").join("proton")
        );
    }

    #[test]
    fn proton_without_steam_client_is_a_descriptive_launch_error() {
        let dir = tempdir().unwrap();
        let runtimes = dir.path().join("runtimes");
        write_proton_runtime(&runtimes, "UMU-Proton-10.0-4");
        let translation = translation_from(
            &runtimes,
            dir.path().join("prefixes"),
            TranslationLayer::ProtonGe,
            None,
        );
        let game_dir = dir.path().join("game");
        std::fs::create_dir_all(&game_dir).unwrap();
        std::fs::write(game_dir.join("game.exe"), b"MZ").unwrap();

        let err = build_spawn_plan(
            &game(&game_dir, "game.exe", GameType::Windows),
            &LaunchExtras::off(),
            &translation,
        )
        .unwrap_err();
        assert_eq!(err.code, crate::error::LAUNCH_FAILED);
        assert!(err.message.contains("Steam"), "{}", err.message);
    }

    #[test]
    fn wine_ge_layer_runs_runtime_wine_with_per_game_prefix() {
        let dir = tempdir().unwrap();
        let runtimes = dir.path().join("runtimes");
        let runtime = write_wine_runtime(&runtimes, "Wine-GE-Proton8-26");
        let prefixes = dir.path().join("prefixes");
        let translation =
            translation_from(&runtimes, prefixes.clone(), TranslationLayer::WineGe, None);
        let game_dir = dir.path().join("game");
        std::fs::create_dir_all(&game_dir).unwrap();
        std::fs::write(game_dir.join("game.exe"), b"MZ").unwrap();

        let plan = build_spawn_plan(
            &game(&game_dir, "game.exe", GameType::Windows),
            &LaunchExtras::off(),
            &translation,
        )
        .unwrap();
        assert_eq!(plan.program, runtime.join("files/bin/wine"));
        assert_eq!(
            plan.env.get("WINEPREFIX"),
            Some(&prefixes.join("1").to_string_lossy().into_owned())
        );
        assert!(!plan.env.contains_key("STEAM_COMPAT_DATA_PATH"));
    }

    #[test]
    fn custom_layer_accepts_a_wine_binary() {
        let dir = tempdir().unwrap();
        let custom = dir.path().join("custom-wine");
        write_executable(&custom, b"#!/bin/sh\n");
        let mut translation = translation_from(
            &dir.path().join("empty"),
            dir.path().join("prefixes"),
            TranslationLayer::Custom,
            None,
        );
        translation.custom_runtime_path = Some(custom.to_string_lossy().into_owned());
        let game_dir = dir.path().join("game");
        std::fs::create_dir_all(&game_dir).unwrap();
        std::fs::write(game_dir.join("game.exe"), b"MZ").unwrap();

        let plan = build_spawn_plan(
            &game(&game_dir, "game.exe", GameType::Windows),
            &LaunchExtras::off(),
            &translation,
        )
        .unwrap();
        assert_eq!(plan.program, custom);
        assert_eq!(plan.args[0], game_dir.join("game.exe").to_string_lossy());
    }

    #[test]
    fn custom_layer_accepts_a_proton_script() {
        let dir = tempdir().unwrap();
        let runtime = write_proton_runtime(&dir.path().join("runtimes"), "My-Proton");
        let steam = dir.path().join("steam");
        std::fs::create_dir_all(&steam).unwrap();
        let mut translation = translation_from(
            &dir.path().join("empty"),
            dir.path().join("prefixes"),
            TranslationLayer::Custom,
            Some(steam),
        );
        translation.custom_runtime_path =
            Some(runtime.join("proton").to_string_lossy().into_owned());
        let game_dir = dir.path().join("game");
        std::fs::create_dir_all(&game_dir).unwrap();
        std::fs::write(game_dir.join("game.exe"), b"MZ").unwrap();

        let plan = build_spawn_plan(
            &game(&game_dir, "game.exe", GameType::Windows),
            &LaunchExtras::off(),
            &translation,
        )
        .unwrap();
        assert_eq!(plan.program, runtime.join("proton"));
        assert_eq!(plan.args[0], "run");
        assert!(plan.env.contains_key("STEAM_COMPAT_DATA_PATH"));
    }

    #[test]
    fn missing_proton_runtime_is_a_descriptive_launch_error() {
        let dir = tempdir().unwrap();
        let translation = translation_from(
            &dir.path().join("empty"),
            dir.path().join("prefixes"),
            TranslationLayer::ProtonGe,
            Some(dir.path().to_path_buf()),
        );
        let game_dir = dir.path().join("game");
        std::fs::create_dir_all(&game_dir).unwrap();
        std::fs::write(game_dir.join("game.exe"), b"MZ").unwrap();

        let err = build_spawn_plan(
            &game(&game_dir, "game.exe", GameType::Windows),
            &LaunchExtras::off(),
            &translation,
        )
        .unwrap_err();
        assert_eq!(err.code, crate::error::LAUNCH_FAILED);
        assert!(err.message.contains("Proton"), "{}", err.message);
    }
}
