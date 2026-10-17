//! Best-effort Wine prefix setup.
//!
//! Windows entries run through the system `wine` with a per-game prefix under
//! `~/.local/share/zen-launcher/prefixes/<gameId>` (see `docs/INTERFACES.md`).
//! A prefix only becomes usable after `wineboot -u` has initialised it, and
//! that first run costs tens of seconds — so instead of paying it on the
//! first Play we prepare prefixes in the background: once at startup for
//! every Windows game in the library, and again right after a Windows game is
//! approved. Failures are logged and swallowed; `launch_game` stays the
//! source of truth and works without this module (just slower on first run).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

use crate::error::AppResult;
use crate::models::{Game, GameStatus, GameType};
use crate::paths;

/// `system.reg` exists in every prefix `wineboot` has initialised.
const READY_MARKER: &str = "system.reg";

/// Prefixes with a `wineboot` already in flight, so an approve racing the
/// startup sweep (or a double approve) never spawns two setups for one prefix.
fn in_flight() -> &'static Mutex<HashSet<PathBuf>> {
    static IN_FLIGHT: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

/// The per-game prefix directory — the same layout `launch.rs` plans into
/// `WINEPREFIX`. Keep the two in sync when the shape ever changes.
pub fn prefix_dir(game_id: i64) -> AppResult<PathBuf> {
    Ok(paths::data_dir()?
        .join("prefixes")
        .join(game_id.to_string()))
}

fn is_ready(prefix: &Path) -> bool {
    prefix.join(READY_MARKER).is_file()
}

/// Only present Windows games have a prefix worth preparing.
fn needs_prefix(game_type: GameType, status: GameStatus) -> bool {
    game_type == GameType::Windows && status != GameStatus::Missing
}

/// Kick off `wineboot -u` in the background for one prefix. No-op when the
/// prefix is already initialised (or being initialised). Never fails: setup is
/// a head start, not a gate.
pub fn initialize_async(prefix: PathBuf) {
    if is_ready(&prefix) {
        return;
    }
    {
        let mut in_flight = in_flight().lock().expect("wine in-flight set poisoned");
        if !in_flight.insert(prefix.clone()) {
            return;
        }
    }

    std::thread::spawn(move || {
        let outcome = run_wineboot(&prefix);
        in_flight()
            .lock()
            .expect("wine in-flight set poisoned")
            .remove(&prefix);
        match outcome {
            Ok(()) => tracing::info!("wine prefix ready at {}", prefix.display()),
            Err(err) => tracing::warn!(
                "wine prefix setup for {} did not finish: {err}",
                prefix.display()
            ),
        }
    });
}

/// Prepare the prefix of one game, if it has one to prepare.
pub fn initialize_for_game(game: &Game) {
    if !needs_prefix(game.game_type, game.status) {
        return;
    }
    match prefix_dir(game.id) {
        Ok(prefix) => initialize_async(prefix),
        Err(err) => tracing::warn!("could not resolve the wine prefix path: {err:?}"),
    }
}

/// Startup sweep: hand every Windows game to the background initialiser.
pub fn initialize_missing(games: &[Game]) {
    for game in games {
        initialize_for_game(game);
    }
}

/// Create the prefix directory and let `wineboot -u` populate it. Wine requires
/// the directory to exist before it starts (`wine` chdirs into it).
fn run_wineboot(prefix: &Path) -> Result<(), String> {
    std::fs::create_dir_all(prefix)
        .map_err(|err| format!("could not create {}: {err}", prefix.display()))?;

    let status = Command::new("wineboot")
        .arg("-u")
        .env("WINEPREFIX", prefix)
        .env("WINEDLLOVERRIDES", "mscoree,mshtml=")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|err| format!("could not start wineboot (is wine installed?): {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("wineboot exited with {status}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn prefix_is_ready_only_after_wineboot_leaves_the_marker() {
        let dir = tempdir().unwrap();
        assert!(!is_ready(dir.path()));

        std::fs::write(dir.path().join(READY_MARKER), b"").unwrap();
        assert!(is_ready(dir.path()));
    }

    #[test]
    fn only_present_windows_games_need_a_prefix() {
        assert!(needs_prefix(GameType::Windows, GameStatus::Ready));
        assert!(!needs_prefix(GameType::Windows, GameStatus::Missing));
        assert!(!needs_prefix(GameType::Native, GameStatus::Ready));
    }
}
