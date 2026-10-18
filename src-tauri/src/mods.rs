//! Mod loader detection and mod installs (BepInEx / MelonLoader era).
//!
//! Loaders are detected from the game folder layout (no network): `BepInEx/`,
//! `MelonLoader/`, or a Doorstop marker file (`doorstop_config.ini`,
//! `winhttp.dll`, `version.dll`) for community loaders such as NeoModLoader.
//! Loader downloads come from GitHub releases; user mods arrive as archives
//! (.zip/.7z/.rar), are extracted through the system `7z` into a staging dir
//! first, and only validated entries are moved into the game's mods folder —
//! the archive then goes to the system trash, never to `rm`.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const USER_AGENT: &str = concat!("ZenLauncher/", env!("CARGO_PKG_VERSION"));
const MAX_LOADER_BYTES: usize = 256 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_INSTALLED_ENTRIES: usize = 50;

/// Layout snapshot of a game folder for the mods panel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModsStatus {
    pub loader: &'static str,
    pub mods_dir: Option<String>,
    pub mods_dir_kind: &'static str,
    pub engine: &'static str,
    pub suggested_loader: Option<&'static str>,
    pub installed: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInstallResult {
    pub installed: Vec<String>,
    pub mods_dir: String,
    pub trashed: bool,
}

#[derive(Debug, Deserialize)]
struct Release {
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Debug, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent(USER_AGENT)
        .build()
}

/// Inspect a game folder: which loader, where mods go, what is installed.
pub fn status(game_root: &Path) -> ModsStatus {
    let loader = detect_loader(game_root);
    let (mods_dir, mods_dir_kind) = detect_mods_dir(game_root, loader);
    let engine = detect_engine(game_root);
    let suggested_loader = match engine {
        "unity-mono" => Some("bepinex5"),
        "unity-il2cpp" => Some("melonloader"),
        _ => None,
    };
    let installed = mods_dir
        .as_ref()
        .map(|dir| top_level_entries(dir))
        .unwrap_or_default();

    ModsStatus {
        loader,
        mods_dir: mods_dir.map(|dir| dir.to_string_lossy().into_owned()),
        mods_dir_kind,
        engine,
        suggested_loader,
        installed,
    }
}

/// Download and install the suggested loader into the game folder.
pub fn install_loader(game_root: &Path) -> AppResult<ModsStatus> {
    let pre = status(game_root);
    if pre.loader != "none" {
        return Err(AppError::validation(format!(
            "a mod loader is already installed ({})",
            pre.loader
        )));
    }
    let (repo, matcher) = match pre.suggested_loader {
        Some("bepinex5") => ("BepInEx/BepInEx", AssetMatch::BepInEx),
        Some("melonloader") => ("LavaGang/MelonLoader", AssetMatch::MelonLoader),
        _ => {
            return Err(AppError::validation(
                "no known mod loader for this game's engine",
            ));
        }
    };

    let url = latest_loader_asset(repo, matcher)?;
    let bytes = download_bytes(&url, MAX_LOADER_BYTES)?;

    // BepInEx / MelonLoader zips are laid out for the game root; extract in
    // place. `enclosed_name` refuses traversal entries.
    let cursor = std::io::Cursor::new(&bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|err| AppError::io(format!("loader archive is corrupt: {err}")))?;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|err| AppError::io(err.to_string()))?;
        let Some(relative) = file.enclosed_name() else {
            return Err(AppError::validation(
                "loader archive contains an unsafe path",
            ));
        };
        let target = game_root.join(relative);
        if file.is_dir() {
            std::fs::create_dir_all(&target)?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::io::copy(&mut file, &mut std::fs::File::create(&target)?)?;
        }
    }
    if pre.suggested_loader == Some("bepinex5") {
        std::fs::create_dir_all(game_root.join("BepInEx").join("plugins"))?;
    }

    tracing::info!("mod loader installed into {}", game_root.display());
    Ok(status(game_root))
}

/// Extract a user mod archive into the game's mods dir, then trash the
/// archive. Archives are extracted into a staging dir first and only
/// validated entries are moved into the game folder.
pub fn install_archive(
    game_root: &Path,
    archive: &Path,
    staging_root: &Path,
) -> AppResult<ModInstallResult> {
    let pre = status(game_root);
    let Some(mods_dir) = pre.mods_dir.clone() else {
        return Err(AppError::validation(
            "no mods folder found — install a mod loader first",
        ));
    };
    let mods_dir = PathBuf::from(mods_dir);

    let extension = archive
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(extension.as_str(), "zip" | "7z" | "rar") {
        return Err(AppError::validation(
            "unsupported archive type — use .zip, .7z or .rar",
        ));
    }
    let size = std::fs::metadata(archive)
        .map_err(|err| AppError::io(format!("could not read archive: {err}")))?
        .len();
    if size > MAX_ARCHIVE_BYTES {
        return Err(AppError::validation("archive is larger than 512 MB"));
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let staging = staging_root.join(format!("mod-install-{stamp}"));
    std::fs::create_dir_all(&staging)?;

    let outcome = extract_and_move(archive, &staging, &mods_dir);
    let _ = std::fs::remove_dir_all(&staging);
    let installed = outcome?;

    let trashed = match trash::delete(archive) {
        Ok(()) => true,
        Err(err) => {
            tracing::warn!("could not move {} to the trash: {err}", archive.display());
            false
        }
    };

    Ok(ModInstallResult {
        installed,
        mods_dir: mods_dir.to_string_lossy().into_owned(),
        trashed,
    })
}

fn detect_loader(game_root: &Path) -> &'static str {
    if game_root.join("BepInEx").is_dir() {
        "bepinex"
    } else if game_root.join("MelonLoader").is_dir() {
        "melonloader"
    } else if game_root.join("doorstop_config.ini").is_file()
        || game_root.join("winhttp.dll").is_file()
        || game_root.join("version.dll").is_file()
    {
        "doorstop"
    } else {
        "none"
    }
}

fn detect_mods_dir(game_root: &Path, loader: &str) -> (Option<PathBuf>, &'static str) {
    if loader == "bepinex" {
        return (
            Some(game_root.join("BepInEx").join("plugins")),
            "bepinex-plugins",
        );
    }
    for candidate in [
        game_root.join("Mods"),
        game_root.join("MelonLoader").join("Mods"),
        game_root.join("mods"),
    ] {
        if candidate.is_dir() {
            return (Some(candidate), "mods");
        }
    }
    (None, "none")
}

fn detect_engine(game_root: &Path) -> &'static str {
    if game_root.join("GameAssembly.dll").is_file() || has_data_subdir(game_root, "il2cpp_data") {
        "unity-il2cpp"
    } else if game_root.join("MonoBleedingEdge").is_dir() || has_data_subdir(game_root, "Managed") {
        "unity-mono"
    } else {
        "unknown"
    }
}

fn has_data_subdir(game_root: &Path, marker: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(game_root) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let path = entry.path();
        path.is_dir()
            && entry.file_name().to_string_lossy().ends_with("_Data")
            && path.join(marker).exists()
    })
}

fn top_level_entries(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names.truncate(MAX_INSTALLED_ENTRIES);
    names
}

fn extract_and_move(archive: &Path, staging: &Path, mods_dir: &Path) -> AppResult<Vec<String>> {
    let paths = archive_entry_paths(archive)?;
    if !entry_paths_are_safe(&paths) {
        return Err(AppError::validation(
            "archive contains unsafe paths — refusing to extract",
        ));
    }
    run_7z(&[
        "x".to_string(),
        "-y".to_string(),
        format!("-o{}", staging.display()),
        archive.to_string_lossy().into_owned(),
    ])?;

    let mut installed = Vec::new();
    copy_staged_tree(staging, mods_dir, &mut installed)?;
    installed.sort();
    Ok(installed)
}

/// `-slt` listing: one `Path = ...` line per entry, robust for spaces.
fn archive_entry_paths(archive: &Path) -> AppResult<Vec<String>> {
    let output = std::process::Command::new("7z")
        .arg("l")
        .arg("-slt")
        .arg(archive)
        .output()
        .map_err(|err| AppError::io(format!("could not run 7z (is it installed?): {err}")))?;
    if !output.status.success() {
        return Err(AppError::io(format!(
            "could not list archive: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .lines()
        .filter_map(|line| line.strip_prefix("Path = "))
        .map(str::to_string)
        .collect())
}

/// Absolute paths, drive letters and `..` traversal all refuse to extract.
fn entry_paths_are_safe(paths: &[String]) -> bool {
    paths.iter().all(|raw| {
        let normalized = raw.replace('\\', "/");
        if normalized.starts_with('/') {
            return false;
        }
        let bytes = normalized.as_bytes();
        if bytes.len() >= 2 && bytes[1] == b':' {
            return false;
        }
        normalized.split('/').all(|component| component != "..")
    })
}

fn run_7z(args: &[String]) -> AppResult<()> {
    let output = std::process::Command::new("7z")
        .args(args)
        .output()
        .map_err(|err| AppError::io(format!("could not run 7z (is it installed?): {err}")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::io(format!(
            "7z failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}

/// Move the extracted tree into the mods dir: regular files and dirs only,
/// no symlinks, `__MACOSX` and dotfile noise skipped.
fn copy_staged_tree(staging: &Path, mods_dir: &Path, installed: &mut Vec<String>) -> AppResult<()> {
    for entry in std::fs::read_dir(staging)?.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == "__MACOSX" || name_str.starts_with('.') {
            continue;
        }
        let source = entry.path();
        if source.symlink_metadata()?.file_type().is_symlink() {
            return Err(AppError::validation("archive contains symlinks — refusing"));
        }
        let target = mods_dir.join(&*name);
        if source.is_dir() {
            copy_dir_recursive(&source, &target)?;
        } else {
            std::fs::create_dir_all(mods_dir)?;
            std::fs::copy(&source, &target)?;
        }
        installed.push(name_str.into_owned());
    }
    Ok(())
}

fn copy_dir_recursive(source: &Path, target: &Path) -> AppResult<()> {
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)?.flatten() {
        let from = entry.path();
        if from.symlink_metadata()?.file_type().is_symlink() {
            return Err(AppError::validation("archive contains symlinks — refusing"));
        }
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

enum AssetMatch {
    BepInEx,
    MelonLoader,
}

impl AssetMatch {
    fn matches(&self, name: &str) -> bool {
        match self {
            // `releases/latest` on BepInEx/BepInEx is the stable 5.x line
            // (the 6.x bleeding edge builds are pre-releases).
            AssetMatch::BepInEx => name.starts_with("BepInEx_win_x64_") && name.ends_with(".zip"),
            AssetMatch::MelonLoader => name == "MelonLoader.x64.zip",
        }
    }
}

fn latest_loader_asset(repo: &str, matcher: AssetMatch) -> AppResult<String> {
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let body = agent()
        .get(&url)
        .call()
        .map_err(|err| AppError::io(format!("loader lookup failed: {err}")))?
        .into_string()
        .map_err(|err| AppError::io(format!("loader lookup failed: {err}")))?;
    let release: Release = serde_json::from_str(&body)
        .map_err(|err| AppError::io(format!("could not parse release info: {err}")))?;
    release
        .assets
        .iter()
        .find(|asset| matcher.matches(&asset.name))
        .map(|asset| asset.browser_download_url.clone())
        .ok_or_else(|| AppError::io(format!("no matching release asset found for {repo}")))
}

fn download_bytes(url: &str, max_bytes: usize) -> AppResult<Vec<u8>> {
    let response = agent()
        .get(url)
        .call()
        .map_err(|err| AppError::io(format!("download failed: {err}")))?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|err| AppError::io(format!("download failed: {err}")))?;
    if bytes.len() > max_bytes {
        return Err(AppError::validation("downloaded file is too large"));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn status_detects_loaders_engines_and_mods_dirs() {
        // BepInEx + Unity Mono
        let dir = tempdir().unwrap();
        let game = dir.path().join("game");
        std::fs::create_dir_all(game.join("BepInEx").join("plugins")).unwrap();
        std::fs::create_dir_all(game.join("Foo_Data").join("Managed")).unwrap();

        let found = status(&game);
        assert_eq!(found.loader, "bepinex");
        assert_eq!(found.mods_dir_kind, "bepinex-plugins");
        assert_eq!(found.engine, "unity-mono");
        assert_eq!(found.suggested_loader, Some("bepinex5"));
        assert!(found.installed.is_empty());

        // Doorstop-based community loader (NeoModLoader-style) + IL2CPP.
        let dir = tempdir().unwrap();
        let game = dir.path().join("game2");
        std::fs::create_dir_all(game.join("Mods").join("NML")).unwrap();
        std::fs::write(game.join("winhttp.dll"), b"MZ").unwrap();
        std::fs::write(game.join("GameAssembly.dll"), b"MZ").unwrap();

        let found = status(&game);
        assert_eq!(found.loader, "doorstop");
        assert_eq!(found.mods_dir_kind, "mods");
        assert_eq!(found.engine, "unity-il2cpp");
        assert_eq!(found.suggested_loader, Some("melonloader"));
        assert!(found.installed.contains(&"NML".to_string()));

        // Nothing installed.
        let dir = tempdir().unwrap();
        let game = dir.path().join("game3");
        std::fs::create_dir_all(&game).unwrap();

        let found = status(&game);
        assert_eq!(found.loader, "none");
        assert_eq!(found.mods_dir, None);
        assert_eq!(found.suggested_loader, None);
    }

    #[test]
    fn archive_paths_must_stay_inside_the_target() {
        assert!(entry_paths_are_safe(&[
            "mods/abc.dll".into(),
            "readme.txt".into()
        ]));
        assert!(!entry_paths_are_safe(&["../evil.dll".into()]));
        assert!(!entry_paths_are_safe(&["/etc/passwd".into()]));
        assert!(!entry_paths_are_safe(&["C:\\evil.dll".into()]));
    }

    #[test]
    fn staged_entries_land_in_the_mods_dir() {
        let dir = tempdir().unwrap();
        let staging = dir.path().join("staging");
        let mods = dir.path().join("Mods");

        std::fs::create_dir_all(staging.join("MyMod/sub")).unwrap();
        std::fs::write(staging.join("MyMod/sub/file.dll"), b"x").unwrap();
        std::fs::write(staging.join("loose.txt"), b"y").unwrap();
        std::fs::create_dir_all(staging.join("__MACOSX")).unwrap();
        std::fs::write(staging.join("__MACOSX/junk"), b"z").unwrap();

        let mut installed = Vec::new();
        copy_staged_tree(&staging, &mods, &mut installed).unwrap();
        installed.sort();

        assert_eq!(installed, vec!["MyMod", "loose.txt"]);
        assert!(mods.join("MyMod/sub/file.dll").is_file());
        assert!(mods.join("loose.txt").is_file());
        assert!(!mods.join("__MACOSX").exists());
    }
}
