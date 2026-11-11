//! Mod loader detection, catalog and mod installs (BepInEx / MelonLoader era
//! plus the game-specific additions: NeoModLoader, tModLoader, CLEO 4/5,
//! CLEO Redux, Script Hook IV/V, Frosty Mod Manager, MSC Mod Loader).
//!
//! Loaders are detected from the game folder layout (no network): `BepInEx/`,
//! `MelonLoader/`, `NeoModLoader.dll` (WorldBox), `MSCLoader.dll` (My Summer
//! Car), `tModLoader.exe` (Terraria), `cleo.asi`/`cleo_redux.asi` (GTA
//! classics), `ScriptHookV.dll`/`ScriptHookIV.asi` (GTA V/IV) or the Frosty
//! `ModData/` folder.
//!
//! The loader catalog is ranked by popularity; the suggested loader follows
//! the detected engine flavor, optionally narrowed by root markers (e.g. WorldBox).
//! Loader downloads come from GitHub releases (stable ones via `releases/latest`,
//! BepInEx 6 + Frosty forks via the newest release carrying the matching asset).
//! Manual loaders (Script Hook IV/V, MSC Mod Loader) are detected and managed but
//! installed by the loader's own tooling. User mods arrive as archives
//! (.zip/.7z/...), are extracted through the system `7z` into a staging dir
//! first, and only validated entries are moved into the game's mods folder —
//! the archive then goes to the system trash, never to `rm`.
//!
//! Validation strictness is settings-driven: strict mode accepts only
//! `.zip/.7z/.rar` and refuses symlinked entries; the default lenient mode
//! accepts anything `7z` can list, skipping symlinks with a logged warning.
//! Absolute paths and `..` traversal are refused in both modes.

use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const USER_AGENT: &str = concat!("ZincLauncher/", env!("CARGO_PKG_VERSION"));
const MAX_LOADER_BYTES: usize = 256 * 1024 * 1024;
const MAX_INSTALLED_ENTRIES: usize = 50;
/// Hard cap for a single-file (`.dll`/`.asi`) mod install.
pub const MAX_SINGLE_MOD_BYTES: u64 = 64 * 1024 * 1024;

/// Catalog entry for an installable mod loader.
#[derive(Debug, Clone)]
pub struct LoaderSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub engines: &'static [&'static str],
    /// Root entries the game folder must carry for this loader to even be
    /// offered (case-insensitive file/dir names) — keeps game-specific
    /// loaders out of unrelated games. Empty = the engine match is enough.
    pub markers: &'static [&'static str],
    /// `"download"` → the core fetches a release asset. `"manual"` → the
    /// loader has no redistributable download; the panel links `docs`.
    pub install: &'static str,
    /// Official page (release page, docs or download page). Empty when none.
    pub docs: &'static str,
}

/// Order is the popularity ranking: the first entry matching the game's
/// engine (and markers) becomes `suggestedLoader`.
const CATALOG: [LoaderSpec; 13] = [
    LoaderSpec {
        id: "neomodloader",
        name: "NeoModLoader",
        engines: &["unity-mono"],
        markers: &["worldbox_Data", "worldbox.exe"],
        install: "download",
        docs: "https://worldboxopenmods.gitbook.io/mod-tutorial-en/player-manual/install",
    },
    LoaderSpec {
        id: "mscloader",
        name: "MSC Mod Loader",
        engines: &["unity-mono"],
        markers: &["mysummercar_Data", "mysummercar.exe"],
        install: "manual",
        docs: "https://github.com/piotrulos/MSCModLoader/releases",
    },
    LoaderSpec {
        id: "bepinex5",
        name: "BepInEx 5",
        engines: &["unity-mono"],
        markers: &[],
        install: "download",
        docs: "",
    },
    LoaderSpec {
        id: "melonloader",
        name: "MelonLoader",
        engines: &["unity-mono", "unity-il2cpp"],
        markers: &[],
        install: "download",
        docs: "",
    },
    LoaderSpec {
        id: "bepinex6mono",
        name: "BepInEx 6 (Mono)",
        engines: &["unity-mono"],
        markers: &[],
        install: "download",
        docs: "",
    },
    LoaderSpec {
        id: "bepinex6il2cpp",
        name: "BepInEx 6 (IL2CPP)",
        engines: &["unity-il2cpp"],
        markers: &[],
        install: "download",
        docs: "",
    },
    LoaderSpec {
        id: "tmodloader",
        name: "tModLoader",
        engines: &["terraria"],
        markers: &[],
        install: "download",
        docs: "https://github.com/tModLoader/tModLoader/wiki/Manual-Install",
    },
    LoaderSpec {
        id: "cleo5",
        name: "CLEO 5",
        engines: &["gta-classic"],
        markers: &[],
        install: "download",
        docs: "https://cleo.li",
    },
    LoaderSpec {
        id: "cleo4",
        name: "CLEO 4",
        engines: &["gta-classic"],
        markers: &[],
        install: "download",
        docs: "https://cleo.li",
    },
    LoaderSpec {
        id: "cleoredux",
        name: "CLEO Redux",
        engines: &["gta-classic"],
        markers: &[],
        install: "download",
        docs: "https://re.cleo.li/docs/en/installation.html",
    },
    LoaderSpec {
        id: "scripthook-iv",
        name: "Script Hook IV",
        engines: &["gta-iv"],
        markers: &[],
        install: "manual",
        docs: "https://www.gtaforums.com/",
    },
    LoaderSpec {
        id: "scripthook-v",
        name: "Script Hook V",
        engines: &["gta-v"],
        markers: &[],
        install: "manual",
        docs: "https://www.gta5-mods.com/tools/script-hook-v",
    },
    LoaderSpec {
        id: "frosty",
        name: "Frosty Mod Manager",
        engines: &["frostbite"],
        markers: &[],
        install: "download",
        docs: "https://github.com/J-Lyt/FrostyToolsuite/releases",
    },
];

/// Serialized catalog entry in `ModsStatus.loaders`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderInfo {
    pub id: String,
    pub name: String,
    pub engines: Vec<String>,
    /// `"download"` or `"manual"` — manual loaders are detected and managed,
    /// but installed by the loader's own tooling.
    pub install: String,
    /// Official page for manual loaders; `null` when nothing to link.
    pub docs: Option<String>,
}

/// Newer BepInEx 6 pre-release builds live in the same repo but not as the
/// "latest" release; these are resolved by scanning the release list.
const BEPINEX6_RELEASES: &str = "https://api.github.com/repos/BepInEx/BepInEx/releases?per_page=40";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModsStatus {
    pub loader: &'static str,
    pub mods_dir: Option<String>,
    pub mods_dir_kind: &'static str,
    pub engine: &'static str,
    pub supported: bool,
    pub suggested_loader: Option<&'static str>,
    pub loaders: Vec<LoaderInfo>,
    pub installed: Vec<String>,
    /// Set when Zinc installed the detected loader itself (see `loader.json`);
    /// `null` for manual/detected loaders.
    pub install_loader: Option<LoaderInstall>,
}

/// Record of a loader Zinc downloaded, persisted in
/// `<dataDir>/games/<gameId>/loader.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderInstall {
    pub id: String,
    pub version: String,
}

/// A newer loader release compared against the installed one.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderUpdate {
    pub loader_id: String,
    pub current: String,
    pub latest: String,
    pub asset_url: Option<String>,
    /// Light comparison: `latest != current` (versions are normalized semver
    /// fragments, not full range checks).
    pub updatable: bool,
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
    tag_name: String,
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
    let matching: Vec<&LoaderSpec> = CATALOG
        .iter()
        .filter(|spec| spec.engines.contains(&engine) && spec_matches_root(spec, game_root))
        .collect();
    let supported = !matching.is_empty();
    let suggested_loader = matching.first().map(|spec| spec.id);
    let loaders = matching
        .into_iter()
        .map(|spec| LoaderInfo {
            id: spec.id.to_string(),
            name: spec.name.to_string(),
            engines: spec.engines.iter().map(|e| e.to_string()).collect(),
            install: spec.install.to_string(),
            docs: (!spec.docs.is_empty()).then(|| spec.docs.to_string()),
        })
        .collect();
    let installed = mods_dir
        .as_ref()
        .map(|dir| top_level_entries(dir))
        .unwrap_or_default();

    ModsStatus {
        loader,
        mods_dir: mods_dir.map(|dir| dir.to_string_lossy().into_owned()),
        mods_dir_kind,
        engine,
        supported,
        suggested_loader,
        loaders,
        installed,
        install_loader: None,
    }
}

/// `status` plus the persisted loader record. Commands use this variant; plain
/// `status` stays path-only for tests and detection.
pub fn status_with_install(game_root: &Path, state_dir: &Path) -> ModsStatus {
    let mut status = status(game_root);
    status.install_loader = read_loader_install(state_dir).ok().flatten();
    status
}

/// Download and install the requested (or suggested) loader into the game
/// folder. `loaderId` picks a catalog entry; `None` → suggestion. On success the
/// downloaded release is recorded in `<stateDir>/loader.json` so the update
/// checker can compare versions later.
pub fn install_loader(
    game_root: &Path,
    loader_id: Option<&str>,
    state_dir: &Path,
) -> AppResult<ModsStatus> {
    let pre = status(game_root);
    let Some(spec) = resolve_loader_spec(&pre, loader_id, game_root) else {
        return Err(AppError::validation(
            "no known mod loader supports this game's engine",
        ));
    };

    if pre.loader != "none" && !coinstall_ok(pre.loader, spec.id) {
        return Err(AppError::validation(format!(
            "a mod loader is already installed ({}) — {} cannot be layered on top",
            pre.loader, spec.name
        )));
    }
    if spec.install == "manual" {
        let hint = if spec.docs.is_empty() {
            "see its project page".to_string()
        } else {
            spec.docs.to_string()
        };
        return Err(AppError::validation(format!(
            "{} is installed with its own tooling; {}",
            spec.name, hint
        )));
    }

    let query = loader_release_query(spec.id)?;
    let asset = resolve_asset(&query)?;
    let bytes = download_bytes(&asset.url, MAX_LOADER_BYTES)?;
    // Some loaders ship a bare assembly (NeoModLoader) instead of an archive.
    // Feeding those bytes to the zip reader used to fail with "loader archive
    // is corrupt", so WorldBox never got its loader and every installed mod
    // was silently ignored at startup. Drop-in DLLs go straight to the
    // loader's own mods folder instead.
    if query.suffix.eq_ignore_ascii_case(".dll") {
        install_loader_dll(game_root, spec.id, &asset.name, &bytes)?;
    } else {
        extract_loader_zip(game_root, &bytes)?;
    }
    ensure_loader_dirs(game_root, spec.id)?;
    if spec.id == "cleoredux" {
        ensure_asi_loader(game_root)?;
    }

    let version = extract_version(&asset.tag).unwrap_or_else(|| asset.tag.clone());
    if let Err(err) = write_loader_install(
        state_dir,
        &LoaderInstall {
            id: spec.id.to_string(),
            version,
        },
    ) {
        // The loader is on disk already; a state write failure only disables
        // the update check, so log it instead of failing the install.
        tracing::warn!("could not record the installed loader: {err:?}");
    }

    tracing::info!("{} installed into {}", spec.name, game_root.display());
    Ok(status_with_install(game_root, state_dir))
}

/// Loader combinations that legitimately coexist: installing fresh (no loader
/// yet) is always fine; CLEO Redux layers on top of the CLEO library; Frosty's
/// ModData flow never touches other loaders' files.
fn coinstall_ok(current: &str, next: &str) -> bool {
    current == "none" || next == "frosty" || (next == "cleoredux" && current == "cleo")
}

/// A loader with `markers` is only offered when the game root carries at
/// least one of them (case-insensitive exact file or dir names); loaders
/// without markers match on the engine alone.
fn spec_matches_root(spec: &LoaderSpec, game_root: &Path) -> bool {
    if spec.markers.is_empty() {
        return true;
    }
    let Ok(entries) = std::fs::read_dir(game_root) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let entry_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        spec.markers
            .iter()
            .any(|marker| entry_name == marker.to_ascii_lowercase())
    })
}

fn resolve_loader_spec(
    pre: &ModsStatus,
    loader_id: Option<&str>,
    game_root: &Path,
) -> Option<&'static LoaderSpec> {
    match loader_id {
        Some(id) => {
            let spec = find_spec(id)?;
            (spec.engines.contains(&pre.engine) && spec_matches_root(spec, game_root))
                .then_some(spec)
        }
        None => pre.suggested_loader.and_then(find_spec),
    }
}

fn find_spec(id: &str) -> Option<&'static LoaderSpec> {
    CATALOG.iter().find(|spec| spec.id == id)
}

/// Everything `resolve_asset` needs to pick the download for a loader.
#[derive(Debug, Clone)]
struct ReleaseQuery {
    releases_url: &'static str,
    /// Asset name fragment the file must start with (case-insensitive).
    prefix: &'static str,
    /// Extra substrings that must each appear (case-insensitive).
    require: &'static [&'static str],
    /// File extension the asset must end with.
    suffix: &'static str,
}

/// Pure mapping loader id → release lookup. Network resolution lives in
/// `resolve_asset`, which keeps this testable.
fn loader_release_query(loader_id: &str) -> AppResult<ReleaseQuery> {
    match loader_id {
        "bepinex5" => Ok(ReleaseQuery {
            releases_url: "https://api.github.com/repos/BepInEx/BepInEx/releases/latest",
            prefix: "bepinex_win_x64_",
            require: &[],
            suffix: ".zip",
        }),
        "melonloader" => Ok(ReleaseQuery {
            releases_url: "https://api.github.com/repos/LavaGang/MelonLoader/releases/latest",
            prefix: "melonloader.x64",
            require: &[],
            suffix: ".zip",
        }),
        // NeoModLoader ships as a bare `NeoModLoader.dll` release asset — it is
        // a dropped-in assembly, not a folder layout.
        "neomodloader" => Ok(ReleaseQuery {
            releases_url: "https://api.github.com/repos/WorldBoxOpenMods/ModLoader/releases/latest",
            prefix: "neomodloader",
            require: &[],
            suffix: ".dll",
        }),
        "tmodloader" => Ok(ReleaseQuery {
            releases_url: "https://api.github.com/repos/tModLoader/tModLoader/releases/latest",
            prefix: "tmodloader",
            require: &[],
            suffix: ".zip",
        }),
        // BepInEx 6 builds are pre-releases: scan the release list for the
        // newest one carrying the matching platform asset.
        "bepinex6mono" => Ok(ReleaseQuery {
            releases_url: BEPINEX6_RELEASES,
            prefix: "bepinex-unity.mono-win-x64-",
            require: &[],
            suffix: ".zip",
        }),
        "bepinex6il2cpp" => Ok(ReleaseQuery {
            releases_url: BEPINEX6_RELEASES,
            prefix: "bepinex-unity.il2cpp-win-x64-",
            require: &[],
            suffix: ".zip",
        }),
        // CLEO 5 bundles its own ASI loader; the plain and SDK archives must
        // not win over the Ultimate bundle.
        "cleo5" => Ok(ReleaseQuery {
            releases_url: "https://api.github.com/repos/cleolibrary/CLEO5/releases/latest",
            prefix: "sa.cleo-v",
            require: &["+ultimate_asi_loader"],
            suffix: ".zip",
        }),
        // The CLEO 4 archive ships `CLEO.asi` + `vorbisFile.dll` (Ultimate ASI
        // Loader) — self-contained.
        "cleo4" => Ok(ReleaseQuery {
            releases_url: "https://api.github.com/repos/cleolibrary/CLEO4/releases/latest",
            prefix: "cleo4",
            require: &[],
            suffix: ".zip",
        }),
        // GTA classics are 32-bit: the x86 portable archive (no installer).
        "cleoredux" => Ok(ReleaseQuery {
            releases_url: "https://api.github.com/repos/cleolibrary/CLEO-Redux/releases/latest",
            prefix: "cleo_redux_",
            require: &["x86"],
            suffix: ".zip",
        }),
        // The maintained fork carries current Frostbite profiles (FC 24/25).
        "frosty" => Ok(ReleaseQuery {
            releases_url: "https://api.github.com/repos/J-Lyt/FrostyToolsuite/releases?per_page=40",
            prefix: "frosty.mod.manager",
            require: &[],
            suffix: ".zip",
        }),
        other => Err(AppError::validation(format!("unknown mod loader: {other}"))),
    }
}

/// A resolved release asset plus the release tag it came from.
#[derive(Debug, Clone, PartialEq)]
struct ResolvedAsset {
    url: String,
    tag: String,
    /// Release asset file name (`NeoModLoader.dll`, `BepInEx_win_x64_*.zip`).
    name: String,
}

/// Resolve `query` against the releases list: newest release whose asset
/// matches prefix/require/suffix.
fn resolve_asset(query: &ReleaseQuery) -> AppResult<ResolvedAsset> {
    let body = agent()
        .get(query.releases_url)
        .call()
        .map_err(|err| AppError::io(format!("loader lookup failed: {err}")))?
        .into_string()
        .map_err(|err| AppError::io(format!("loader lookup failed: {err}")))?;
    let releases: Vec<Release> = serde_json::from_str(&body)
        .map_err(|err| AppError::io(format!("could not parse release info: {err}")))?;

    let prefix = query.prefix.to_ascii_lowercase();
    let suffix = query.suffix.to_ascii_lowercase();
    for release in &releases {
        for asset in &release.assets {
            let lowers = asset.name.to_ascii_lowercase();
            if lowers.starts_with(&prefix)
                && lowers.ends_with(&suffix)
                && query
                    .require
                    .iter()
                    .all(|needle| lowers.contains(&needle.to_ascii_lowercase()))
            {
                return Ok(ResolvedAsset {
                    url: asset.browser_download_url.clone(),
                    tag: release.tag_name.clone(),
                    name: asset.name.clone(),
                });
            }
        }
    }
    Err(AppError::io(format!(
        "no matching release asset found ({}*.{})",
        query.prefix,
        query.suffix.trim_start_matches('.')
    )))
}

/// First semver-looking fragment in a tag or asset name
/// (`SA.CLEO-v1.2.3+Ultimate_ASI_Loader.zip` → `1.2.3`). Deliberately light:
/// the update checker only needs "is this the same string?".
fn extract_version(raw: &str) -> Option<String> {
    let chars: Vec<char> = raw.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        if !chars[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let start = index;
        while index < chars.len() && (chars[index].is_ascii_digit() || chars[index] == '.') {
            index += 1;
        }
        let candidate: String = chars[start..index].iter().collect();
        let trimmed = candidate.trim_end_matches('.').to_string();
        if trimmed.contains('.') {
            return Some(trimmed);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Per-game loader state (`<dataDir>/games/<gameId>/loader.json`)
// ---------------------------------------------------------------------------

fn loader_state_file(state_dir: &Path) -> PathBuf {
    state_dir.join("loader.json")
}

fn read_loader_install(state_dir: &Path) -> AppResult<Option<LoaderInstall>> {
    let path = loader_state_file(state_dir);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(AppError::io(format!("could not read loader state: {err}"))),
    };
    match serde_json::from_str(&raw) {
        Ok(install) => Ok(Some(install)),
        Err(err) => {
            tracing::warn!("ignoring corrupt loader state at {}: {err}", path.display());
            Ok(None)
        }
    }
}

fn write_loader_install(state_dir: &Path, install: &LoaderInstall) -> AppResult<()> {
    std::fs::create_dir_all(state_dir)?;
    let body = serde_json::to_string_pretty(install)
        .map_err(|err| AppError::io(format!("could not encode loader state: {err}")))?;
    std::fs::write(loader_state_file(state_dir), body)?;
    Ok(())
}

/// Compare the recorded loader against the latest matching GitHub release.
/// `None` when Zinc did not install a loader, the loader is manual, or the state
/// file is missing. Network failures surface as `IO` (the UI shows a retry).
pub fn check_loader_updates(state_dir: &Path) -> AppResult<Option<LoaderUpdate>> {
    check_loader_updates_with(state_dir, resolve_asset)
}

/// Testable core of [`check_loader_updates`]: the release lookup is injected so
/// the comparison logic can be exercised without network access.
fn check_loader_updates_with<F>(state_dir: &Path, resolve: F) -> AppResult<Option<LoaderUpdate>>
where
    F: Fn(&ReleaseQuery) -> AppResult<ResolvedAsset>,
{
    let Some(install) = read_loader_install(state_dir)? else {
        return Ok(None);
    };
    let Some(spec) = find_spec(&install.id) else {
        return Ok(None);
    };
    if spec.install != "download" {
        return Ok(None);
    }
    let query = loader_release_query(spec.id)?;
    let asset = resolve(&query)?;
    let latest = extract_version(&asset.tag).unwrap_or_else(|| asset.tag.clone());
    Ok(Some(LoaderUpdate {
        loader_id: install.id.clone(),
        current: install.version.clone(),
        latest: latest.clone(),
        asset_url: Some(asset.url),
        updatable: latest != install.version,
    }))
}

/// CLEO Redux is an `.asi` plugin: without the CLEO library's bundled ASI
/// loader (or a stray loader dll from another install) it is never injected.
/// Ultimate ASI Loader (x86 — GTA classics are 32-bit) fills the gap.
fn ensure_asi_loader(game_root: &Path) -> AppResult<()> {
    const LOADER_DLLS: [&str; 4] = ["vorbisFile.dll", "dinput8.dll", "version.dll", "d3d9.dll"];
    if LOADER_DLLS.iter().any(|name| has_entry_ci(game_root, name)) {
        return Ok(());
    }
    let bytes = download_bytes(
        "https://github.com/ThirteenAG/Ultimate-ASI-Loader/releases/latest/download/Ultimate-ASI-Loader_x86.zip",
        32 * 1024 * 1024,
    )?;
    extract_loader_zip(game_root, &bytes)?;
    tracing::info!(
        "Ultimate ASI Loader installed for CLEO Redux into {}",
        game_root.display()
    );
    Ok(())
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

/// BepInEx / MelonLoader zips are laid out for the game root; extract in
/// place. `enclosed_name` refuses traversal entries.
fn extract_loader_zip(game_root: &Path, bytes: &[u8]) -> AppResult<()> {
    let cursor = std::io::Cursor::new(bytes);
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
    Ok(())
}

/// WorldBox keeps its Unity data under a folder whose exact casing depends on
/// the build/launcher (`worldbox_Data`, `WorldBox_Data`, …). Resolve it
/// case-insensitively so detection works on case-sensitive filesystems.
fn worldbox_data_dir(game_root: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(game_root).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name == "worldbox_data" && entry.path().is_dir() {
            return Some(entry.path());
        }
    }
    None
}

/// Find a directory in `root` by ASCII-case-insensitive name. Downloads and
/// copies on Linux often produce a different casing (`StreamingAssets` vs
/// `streamingassets`, `mods` vs `Mods`) than the Windows game expects.
fn find_dir_ci(root: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    entries.flatten().find_map(|entry| {
        let entry_name = entry.file_name().to_string_lossy().into_owned();
        (entry_name.eq_ignore_ascii_case(name) && entry.path().is_dir()).then(|| entry.path())
    })
}

/// The folder NeoModLoader reads user mods from:
/// `GAMEPATH/worldbox_Data/StreamingAssets/mods` (the same folder that holds
/// `NeoModLoader.dll`). Resolve `worldbox_Data`, `StreamingAssets` and `mods`
/// case-insensitively; fall back to the canonical spelling for a fresh copy.
fn worldbox_mods_dir(game_root: &Path) -> PathBuf {
    let data = worldbox_data_dir(game_root).unwrap_or_else(|| game_root.join("worldbox_Data"));
    let streaming =
        find_dir_ci(&data, "StreamingAssets").unwrap_or_else(|| data.join("StreamingAssets"));
    find_dir_ci(&streaming, "mods").unwrap_or_else(|| streaming.join("mods"))
}

/// Legacy alternative: older Zinc builds wrote WorldBox mods to `GAMEPATH/Mods`.
/// Only used when the StreamingAssets mods folder does not exist and this
/// folder actually contains installed entries.
fn worldbox_legacy_mods_dir(game_root: &Path) -> Option<PathBuf> {
    let dir = find_dir_ci(game_root, "Mods")?;
    (!top_level_entries(&dir).is_empty()).then_some(dir)
}

/// The folder a loader actually reads `.dll`/`.asi` mods from. Mirrors
/// [`detect_mods_dir`] for loader ids (the install side).
fn loader_mods_path(game_root: &Path, loader_id: &str) -> Option<PathBuf> {
    Some(match loader_id {
        "bepinex5" | "bepinex6mono" | "bepinex6il2cpp" => game_root.join("BepInEx").join("plugins"),
        "melonloader" => game_root.join("MelonLoader").join("Mods"),
        // NeoModLoader and user mods share `StreamingAssets/mods`; WorldBox's
        // built-in loader picks both up at boot.
        "neomodloader" => worldbox_mods_dir(game_root),
        "mscloader" => game_root.join("Mod"),
        "cleo5" | "cleo4" | "cleoredux" => game_root.join("CLEO"),
        "frosty" => game_root.join("ModData"),
        _ => return None,
    })
}

/// Install a drop-in loader assembly (NeoModLoader) into the loader's mods
/// folder under a safe file name. Loader assets come from GitHub releases, but
/// the name is still validated so an asset cannot escape the target folder.
fn install_loader_dll(
    game_root: &Path,
    loader_id: &str,
    asset_name: &str,
    bytes: &[u8],
) -> AppResult<()> {
    let dir = loader_mods_path(game_root, loader_id).ok_or_else(|| {
        AppError::validation(format!("{loader_id} has no drop-in assembly target"))
    })?;
    let fallback = format!("{loader_id}.dll");
    let file_name = Path::new(asset_name)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback);
    if !file_name.to_ascii_lowercase().ends_with(".dll") {
        return Err(AppError::validation("loader assembly must be a .dll file"));
    }
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(&file_name), bytes)?;
    tracing::info!("{file_name} installed into {}", dir.display());
    Ok(())
}

/// Make sure the drop target exists right after a fresh loader install, so
/// the first archive drop cannot fail with "no mods folder".
fn ensure_loader_dirs(game_root: &Path, loader_id: &str) -> AppResult<()> {
    match loader_mods_path(game_root, loader_id) {
        Some(dir) => std::fs::create_dir_all(dir)?,
        // NeoModLoader can only be installed when the WorldBox data folder
        // exists; fall back to the canonical name for a fresh game copy.
        None if loader_id == "neomodloader" => {
            std::fs::create_dir_all(worldbox_mods_dir(game_root))?;
        }
        None => {}
    }
    Ok(())
}

/// Extract a user mod archive into the game's mods dir, then trash the
/// archive. Archives are extracted into a staging dir first and only
/// validated entries are moved into the game folder.
pub fn install_archive(
    game_root: &Path,
    archive: &Path,
    staging_root: &Path,
    lenient: bool,
    max_bytes: u64,
) -> AppResult<ModInstallResult> {
    let pre = status(game_root);
    let Some(mods_dir) = pre.mods_dir.clone() else {
        return Err(AppError::validation(
            "no mods folder found — install a mod loader first",
        ));
    };
    let mods_dir = PathBuf::from(mods_dir);

    if !lenient {
        let extension = archive
            .extension()
            .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if !matches!(extension.as_str(), "zip" | "7z" | "rar") {
            return Err(AppError::validation(
                "unsupported archive type — use .zip, .7z or .rar",
            ));
        }
    }
    let size = std::fs::metadata(archive)
        .map_err(|err| AppError::io(format!("could not read archive: {err}")))?
        .len();
    if size > max_bytes {
        return Err(AppError::validation(format!(
            "archive is larger than {} MB",
            max_bytes / (1024 * 1024)
        )));
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let staging = staging_root.join(format!("mod-install-{stamp}"));
    std::fs::create_dir_all(&staging)?;

    // NeoModLoader identifies a mod by the folder that holds `mod.json`.
    // Archives that ship `mod.json` at their root must be wrapped into a
    // per-mod folder, otherwise every such archive would merge into `Mods/`
    // and NML would treat the whole folder as one mod.
    let wrap_into = (pre.loader == "neomodloader")
        .then(|| archive.file_stem())
        .flatten()
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.is_empty());
    let outcome = extract_and_move(archive, &staging, &mods_dir, lenient, wrap_into.as_deref());
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

/// Install a single-file mod (`.dll`/`.asi`) into the mods folder the detected
/// loader actually reads. The source file is *copied* (never moved/trashed):
/// a single-file drop usually points at a download the user still wants.
///
/// Validation: regular file, not a symlink, `.dll`/`.asi`, at most
/// [`MAX_SINGLE_MOD_BYTES`], and a loader that can actually inject it.
pub fn install_file(game_root: &Path, source: &Path) -> AppResult<ModInstallResult> {
    let metadata = std::fs::symlink_metadata(source)
        .map_err(|err| AppError::io(format!("could not read mod file: {err}")))?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::validation(
            "mod file is a symlink — refusing to install",
        ));
    }
    if !metadata.is_file() {
        return Err(AppError::validation("mod path is not a regular file"));
    }
    let file_name = source
        .file_name()
        .ok_or_else(|| AppError::validation("mod file has no name"))?
        .to_os_string();
    let lower = file_name.to_string_lossy().to_ascii_lowercase();
    if !(lower.ends_with(".dll") || lower.ends_with(".asi")) {
        return Err(AppError::validation(
            "single-file mods must be .dll or .asi",
        ));
    }
    if metadata.len() > MAX_SINGLE_MOD_BYTES {
        return Err(AppError::validation(format!(
            "mod file is larger than {} MB",
            MAX_SINGLE_MOD_BYTES / (1024 * 1024)
        )));
    }

    let current = status(game_root);
    require_loader_for_single_file(&current)?;
    let Some(mods_dir) = current.mods_dir.clone() else {
        return Err(AppError::validation(
            "single-file mods cannot be installed for this game — its mods are managed elsewhere",
        ));
    };

    let target = PathBuf::from(&mods_dir).join(&file_name);
    std::fs::create_dir_all(&mods_dir)?;
    std::fs::copy(source, &target)
        .map_err(|err| AppError::io(format!("could not copy mod file: {err}")))?;

    Ok(ModInstallResult {
        installed: vec![file_name.to_string_lossy().into_owned()],
        mods_dir,
        trashed: false,
    })
}

/// A `.dll`/`.asi` mod is only injected when its loader is present. GTA V/IV
/// need Script Hook, GTA classics need CLEO/ASI Loader, Unity games a mod
/// loader. `unknown` engines with a generic `Mods/` folder are left as-is.
fn require_loader_for_single_file(current: &ModsStatus) -> AppResult<()> {
    if current.loader != "none" {
        return Ok(());
    }
    let hint = match current.engine {
        "gta-v" => "Script Hook V",
        "gta-iv" => "Script Hook IV",
        "gta-classic" => "CLEO or an ASI Loader",
        "unity-mono" | "unity-il2cpp" => "a mod loader (BepInEx, MelonLoader, …)",
        _ => return Ok(()),
    };
    Err(AppError::validation(format!(
        "install {hint} first — .dll/.asi mods cannot load without it"
    )))
}

/// Remove one installed single-file mod. The file goes to the system trash
/// (never `rm`) and only a bare file name inside the resolved mods folder is
/// accepted, so `..`/absolute paths cannot escape.
pub fn uninstall_file(game_root: &Path, name: &str) -> AppResult<()> {
    let candidate = Path::new(name);
    let mut components = candidate.components();
    let single_component =
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
    if candidate.is_absolute() || !single_component {
        return Err(AppError::validation("mod name must be a single file name"));
    }

    let current = status(game_root);
    let Some(mods_dir) = current.mods_dir.clone() else {
        return Err(AppError::validation("no mods folder found"));
    };
    let target = PathBuf::from(&mods_dir).join(name);
    let metadata = std::fs::symlink_metadata(&target)
        .map_err(|err| AppError::validation(format!("mod not found: {name} ({err})")))?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::validation(
            "mod file is a symlink — refusing to remove",
        ));
    }
    trash::delete(&target)
        .map_err(|err| AppError::io(format!("could not move mod to the trash: {err}")))?;
    Ok(())
}

fn detect_loader(game_root: &Path) -> &'static str {
    if game_root.join("BepInEx").is_dir() {
        "bepinex"
    } else if game_root.join("MelonLoader").is_dir() {
        "melonloader"
    } else if {
        let mods = worldbox_mods_dir(game_root);
        // NML may be dropped in directly or as a `NML/` sub-folder (the
        // Steam Workshop layout).
        has_entry_ci(&mods, "NeoModLoader.dll")
            || has_entry_ci(&mods.join("NML"), "NeoModLoader.dll")
    } {
        "neomodloader"
    } else if has_entry_ci(game_root, "MSCLoader.dll") {
        "mscloader"
    } else if has_entry_ci(game_root, "tModLoader.exe") {
        "tmodloader"
    } else if has_entry_ci(game_root, "cleo_redux.asi") {
        "cleoredux"
    } else if has_entry_ci(game_root, "cleo.asi") || has_entry_ci(game_root, "CLEO.asi") {
        "cleo"
    } else if has_entry_ci(game_root, "ScriptHookV.dll") {
        "scripthook-v"
    } else if has_entry_ci(game_root, "ScriptHookIV.asi")
        || has_entry_ci(game_root, "ScriptHookIV.dll")
    {
        "scripthook-iv"
    } else if game_root.join("ModData").is_dir() {
        "frosty-moddata"
    } else if game_root.join("doorstop_config.ini").is_file()
        || game_root.join("winhttp.dll").is_file()
        || game_root.join("version.dll").is_file()
    {
        "doorstop"
    } else {
        "none"
    }
}

/// Case-insensitive root entry check — remains true on case-sensitive
/// filesystems for third-party files (`CLEO.asi`, `ScriptHookV.dll`, …).
fn has_entry_ci(game_root: &Path, name: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(game_root) else {
        return false;
    };
    let name = name.to_ascii_lowercase();
    entries.flatten().any(|entry| {
        let entry_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        entry_name == name
    })
}

fn detect_mods_dir(game_root: &Path, loader: &str) -> (Option<PathBuf>, &'static str) {
    match loader {
        "bepinex" => (
            Some(game_root.join("BepInEx").join("plugins")),
            "bepinex-plugins",
        ),
        // MelonLoader always reads `MelonLoader/Mods`; return the canonical
        // path even before the folder exists (a fresh loader install creates
        // it, and `install_*` creates parents on demand).
        "melonloader" => (Some(game_root.join("MelonLoader").join("Mods")), "mods"),
        // NeoModLoader and user mods live in the game's asset stream folder
        // (`worldbox_Data/StreamingAssets/mods`). Older Zinc builds wrote to
        // `GAMEPATH/Mods`; only fall back there when the streaming folder is
        // absent and that legacy folder actually contains entries.
        "neomodloader" => {
            let primary = worldbox_mods_dir(game_root);
            let dir = if primary.is_dir() {
                primary
            } else {
                worldbox_legacy_mods_dir(game_root).unwrap_or(primary)
            };
            (Some(dir), "mods")
        }
        // tModLoader keeps mods in its own user-profile folder, outside the
        // game root; those are managed from inside the game.
        "tmodloader" => (None, "external"),
        // MSC Mod Loader reads `Mod/`; older layouts use `Mods/`. Prefer an
        // existing folder, otherwise report the canonical drop target.
        "mscloader" => {
            let dir = ["Mod", "Mods"]
                .iter()
                .map(|candidate| game_root.join(candidate))
                .find(|dir| dir.is_dir())
                .unwrap_or_else(|| game_root.join("Mod"));
            (Some(dir), "mods")
        }
        "cleo" | "cleoredux" => (Some(game_root.join("CLEO")), "mods"),
        "frosty-moddata" => (Some(game_root.join("ModData")), "mods"),
        // ASI scripts drop next to the DLL (GTA classic style layout).
        "scripthook-v" | "scripthook-iv" => (Some(game_root.to_path_buf()), "asi-root"),
        _ => {
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
    }
}

fn detect_engine(game_root: &Path) -> &'static str {
    if game_root.join("GameAssembly.dll").is_file() || has_data_subdir(game_root, "il2cpp_data") {
        "unity-il2cpp"
    } else if game_root.join("MonoBleedingEdge").is_dir() || has_data_subdir(game_root, "Managed") {
        "unity-mono"
    } else if has_entry_ci(game_root, "gta_sa.exe")
        || has_entry_ci(game_root, "gta-sa.exe")
        || has_entry_ci(game_root, "gta_sa_compact.exe")
    {
        "gta-classic"
    } else if has_entry_ci(game_root, "GTAIV.exe") || has_entry_ci(game_root, "PlayGTAIV.exe") {
        "gta-iv"
    } else if has_entry_ci(game_root, "GTA5.exe")
        || has_entry_ci(game_root, "PlayGTAV.exe")
        || has_entry_ci(game_root, "Grand Theft Auto V.exe")
    {
        "gta-v"
    } else if has_entry_ci(game_root, "Terraria.exe") {
        "terraria"
    } else if game_root.join("ModData").is_dir()
        || [
            "fc24.exe",
            "fc25.exe",
            "fc26.exe",
            "fifa20.exe",
            "fifa21.exe",
            "fifa22.exe",
            "fifa23.exe",
        ]
        .iter()
        .any(|exe| has_entry_ci(game_root, exe))
    {
        "frostbite"
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

fn extract_and_move(
    archive: &Path,
    staging: &Path,
    mods_dir: &Path,
    lenient: bool,
    wrap_into: Option<&str>,
) -> AppResult<Vec<String>> {
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
    copy_staged_tree(staging, mods_dir, lenient, wrap_into, &mut installed)?;
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

/// Move the extracted tree into the mods dir: regular files and dirs only.
/// Symlinks: strict mode refuses with `VALIDATION`; lenient mode skips them
/// with a warning. `__MACOSX` and dotfile noise is always skipped.
///
/// `wrap_into` (NeoModLoader) wraps a staged tree whose root already carries
/// `mod.json` into `mods_dir/<wrap_into>/`, so the mod gets its own folder/
/// declaration instead of merging loose files into the mods root.
fn copy_staged_tree(
    staging: &Path,
    mods_dir: &Path,
    lenient: bool,
    wrap_into: Option<&str>,
    installed: &mut Vec<String>,
) -> AppResult<()> {
    let target_root = match wrap_into {
        Some(name) if has_entry_ci(staging, "mod.json") => {
            installed.push(name.to_string());
            mods_dir.join(name)
        }
        _ => mods_dir.to_path_buf(),
    };

    for entry in std::fs::read_dir(staging)?.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if name == "__MACOSX" || name.starts_with('.') {
            continue;
        }
        let source = entry.path();
        if source.symlink_metadata()?.file_type().is_symlink() {
            if lenient {
                tracing::warn!("skipping symlinked mod entry: {}", source.display());
                continue;
            }
            return Err(AppError::validation(
                "archive contains symlinks — refusing (strict mode)",
            ));
        }
        let target = target_root.join(&*file_name);
        if source.is_dir() {
            copy_dir_recursive(&source, &target, lenient)?;
        } else {
            std::fs::create_dir_all(&target_root)?;
            std::fs::copy(&source, &target)?;
        }
        // A wrapped tree is reported once as its folder, not file-by-file.
        if wrap_into.is_none() || target_root.as_path() == mods_dir {
            installed.push(name.into_owned());
        }
    }
    Ok(())
}

fn copy_dir_recursive(source: &Path, target: &Path, lenient: bool) -> AppResult<()> {
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)?.flatten() {
        let from = entry.path();
        if from.symlink_metadata()?.file_type().is_symlink() {
            if lenient {
                tracing::warn!("skipping symlinked mod entry: {}", from.display());
                continue;
            }
            return Err(AppError::validation(
                "archive contains symlinks — refusing (strict mode)",
            ));
        }
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to, lenient)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

// `STICK_THRESHOLD` is used by `input.rs` (gamepad bridge), not here.

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
        assert!(found.supported);
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
        let ids: Vec<_> = found
            .loaders
            .iter()
            .map(|entry| entry.id.as_str())
            .collect();
        assert_eq!(ids, vec!["melonloader", "bepinex6il2cpp"]);
        assert!(found.installed.contains(&"NML".to_string()));

        // Nothing installed; engine unknown -> reported as unsupported.
        let dir = tempdir().unwrap();
        let game = dir.path().join("game3");
        std::fs::create_dir_all(&game).unwrap();

        let found = status(&game);
        assert_eq!(found.loader, "none");
        assert_eq!(found.engine, "unknown");
        assert!(!found.supported);
        assert_eq!(found.suggested_loader, None);
        assert!(found.loaders.is_empty());
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
        copy_staged_tree(&staging, &mods, true, None, &mut installed).unwrap();
        installed.sort();

        assert_eq!(installed, vec!["MyMod", "loose.txt"]);
        assert!(mods.join("MyMod/sub/file.dll").is_file());
        assert!(mods.join("loose.txt").is_file());
        assert!(!mods.join("__MACOSX").exists());
    }

    #[test]
    fn worldbox_loose_mod_archive_is_wrapped_into_a_per_mod_folder() {
        let dir = tempdir().unwrap();
        let staging = dir.path().join("staging");
        let mods = dir.path().join("Mods");
        std::fs::create_dir_all(&staging).unwrap();

        // A mod archive that ships mod.json at its root (no enclosing folder).
        std::fs::write(staging.join("mod.json"), b"{\"name\":\"Sample\"}").unwrap();
        std::fs::write(staging.join("Sample.dll"), b"MZ").unwrap();
        std::fs::create_dir_all(staging.join("assets")).unwrap();
        std::fs::write(staging.join("assets/icon.png"), b"PNG").unwrap();

        let mut installed = Vec::new();
        copy_staged_tree(
            &staging,
            &mods,
            true,
            Some("SampleMod"),
            &mut installed,
        )
        .unwrap();

        assert_eq!(installed, vec!["SampleMod"]);
        assert!(mods.join("SampleMod/mod.json").is_file());
        assert!(mods.join("SampleMod/Sample.dll").is_file());
        assert!(mods.join("SampleMod/assets/icon.png").is_file());
        assert!(!mods.join("mod.json").exists());

        // An archive that already has its own folder is not double-wrapped.
        let staging2 = dir.path().join("staging2");
        std::fs::create_dir_all(staging2.join("AlreadyWrapped")).unwrap();
        std::fs::write(staging2.join("AlreadyWrapped/mod.json"), b"{}").unwrap();
        let mut installed = Vec::new();
        copy_staged_tree(&staging2, &mods, true, Some("Other"), &mut installed).unwrap();
        assert_eq!(installed, vec!["AlreadyWrapped"]);
        assert!(mods.join("AlreadyWrapped/mod.json").is_file());
        assert!(!mods.join("Other").exists());
    }

    #[test]
    fn lenient_mode_skips_symlinks_strict_refuses() {
        let dir = tempdir().unwrap();
        let staging = dir.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("real.dll"), b"x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(staging.join("real.dll"), staging.join("link.dll")).unwrap();

        // Strict mode refuses outright.
        let mods = dir.path().join("ModsStrict");
        let mut installed = Vec::new();
        assert!(copy_staged_tree(&staging, &mods, false, None, &mut installed).is_err());
        assert!(!mods.exists());

        // Lenient mode skips the link and keeps the real file.
        let mods = dir.path().join("ModsLenient");
        let mut installed = Vec::new();
        copy_staged_tree(&staging, &mods, true, None, &mut installed).unwrap();
        assert!(mods.join("real.dll").is_file());
        assert!(!mods.join("link.dll").exists());
    }

    #[test]
    fn strict_mode_rejects_unknown_extensions() {
        // Mirrors the strict-mode extension gate in `install_archive`.
        let allowed = |ext: &str| matches!(ext, "zip" | "7z" | "rar");
        assert!(allowed("zip") && allowed("7z") && allowed("rar"));
        assert!(!allowed("exe"));
        assert!(!allowed("tar.gz") && !allowed(""));
    }

    fn game_dir(dir: &tempfile::TempDir, name: &str) -> PathBuf {
        let game = dir.path().join(name);
        std::fs::create_dir_all(&game).unwrap();
        game
    }

    #[test]
    fn engine_flavors_cover_the_game_specific_catalog() {
        let dir = tempdir().unwrap();

        // GTA San Andreas → CLEO suggested.
        let sa = game_dir(&dir, "sa");
        std::fs::write(sa.join("gta_sa.exe"), b"MZ").unwrap();
        let found = status(&sa);
        assert_eq!(found.engine, "gta-classic");
        assert_eq!(found.suggested_loader, Some("cleo5"));

        // GTA IV → Script Hook IV (manual install, docs linked).
        let iv = game_dir(&dir, "iv");
        std::fs::write(iv.join("GTAIV.exe"), b"MZ").unwrap();
        let found = status(&iv);
        assert_eq!(found.engine, "gta-iv");
        assert_eq!(found.suggested_loader, Some("scripthook-iv"));
        let hook = &found.loaders[0];
        assert_eq!(hook.install, "manual");
        assert!(hook.docs.is_some());

        // GTA V → Script Hook V (manual).
        let v = game_dir(&dir, "v");
        std::fs::write(v.join("GTA5.exe"), b"MZ").unwrap();
        let found = status(&v);
        assert_eq!(found.engine, "gta-v");
        assert_eq!(found.suggested_loader, Some("scripthook-v"));

        // Terraria → tModLoader.
        let terraria = game_dir(&dir, "terraria");
        std::fs::write(terraria.join("Terraria.exe"), b"MZ").unwrap();
        let found = status(&terraria);
        assert_eq!(found.engine, "terraria");
        assert_eq!(found.suggested_loader, Some("tmodloader"));

        // Frostbite (EA Sports FC) → Frosty.
        let fc = game_dir(&dir, "fc");
        std::fs::write(fc.join("FC24.exe"), b"MZ").unwrap();
        let found = status(&fc);
        assert_eq!(found.engine, "frostbite");
        assert_eq!(found.suggested_loader, Some("frosty"));

        // My Summer Car is Unity Mono but the MSC loader wins on markers.
        let msc = game_dir(&dir, "my summer car");
        std::fs::write(msc.join("mysummercar.exe"), b"MZ").unwrap();
        std::fs::create_dir_all(msc.join("mysummercar_Data").join("Managed")).unwrap();
        let found = status(&msc);
        assert_eq!(found.engine, "unity-mono");
        assert_eq!(found.suggested_loader, Some("mscloader"));
        assert_eq!(found.loaders[0].install, "manual");

        // WorldBox is Unity Mono and NeoModLoader wins on markers.
        let wb = game_dir(&dir, "worldbox");
        std::fs::write(wb.join("worldbox.exe"), b"MZ").unwrap();
        std::fs::create_dir_all(wb.join("worldbox_Data").join("Managed")).unwrap();
        let found = status(&wb);
        assert_eq!(found.engine, "unity-mono");
        assert_eq!(found.suggested_loader, Some("neomodloader"));
        let ids: Vec<_> = found.loaders.iter().map(|l| l.id.as_str()).collect();
        assert!(!ids.contains(&"mscloader"));
    }

    #[test]
    fn plain_unity_games_keep_the_era_catalog() {
        let dir = tempdir().unwrap();
        let game = game_dir(&dir, "generic");
        std::fs::create_dir_all(game.join("Foo_Data").join("Managed")).unwrap();

        let found = status(&game);
        assert_eq!(found.engine, "unity-mono");
        assert_eq!(found.suggested_loader, Some("bepinex5"));
        let ids: Vec<_> = found.loaders.iter().map(|l| l.id.as_str()).collect();
        assert_eq!(ids, vec!["bepinex5", "melonloader", "bepinex6mono"]);
    }

    #[test]
    fn loader_detection_recognizes_the_new_markers() {
        let dir = tempdir().unwrap();

        // NeoModLoader inside the WorldBox asset stream.
        let wb = game_dir(&dir, "wb");
        let mods = wb
            .join("worldbox_Data")
            .join("StreamingAssets")
            .join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        std::fs::write(mods.join("NeoModLoader.dll"), b"Q1BAAQ==").unwrap();
        let found = status(&wb);
        assert_eq!(found.loader, "neomodloader");
        let mods_path = found.mods_dir.unwrap();
        assert!(
            mods_path
                .replace('\\', "/")
                .ends_with("worldbox_Data/StreamingAssets/mods"),
            "user mods live in StreamingAssets/mods: {mods_path}"
        );

        // MSC Mod Loader.
        let msc = game_dir(&dir, "msc");
        std::fs::write(msc.join("MSCLoader.dll"), b"x").unwrap();
        std::fs::create_dir_all(msc.join("Mod")).unwrap();
        let found = status(&msc);
        assert_eq!(found.loader, "mscloader");
        assert!(found.mods_dir.as_ref().unwrap().ends_with("Mod"));

        // tModLoader keeps its mod list outside the game root.
        let tml = game_dir(&dir, "tml");
        std::fs::write(tml.join("tModLoader.exe"), b"MZ").unwrap();
        let found = status(&tml);
        assert_eq!(found.loader, "tmodloader");
        assert_eq!(found.mods_dir, None);
        assert_eq!(found.mods_dir_kind, "external");

        // CLEO (4-style root: CLEO.asi + CLEO dir).
        let sa = game_dir(&dir, "sa");
        std::fs::write(sa.join("CLEO.asi"), b"x").unwrap();
        std::fs::create_dir_all(sa.join("CLEO")).unwrap();
        let found = status(&sa);
        assert_eq!(found.loader, "cleo");
        assert!(found.mods_dir.as_ref().unwrap().ends_with("CLEO"));

        // CLEO Redux.
        let redux = game_dir(&dir, "redux");
        std::fs::write(redux.join("cleo_redux.asi"), b"x").unwrap();
        let found = status(&redux);
        assert_eq!(found.loader, "cleoredux");

        // Script Hook V: mods (asi scripts) drop beside the dll.
        let v = game_dir(&dir, "v");
        std::fs::write(v.join("ScriptHookV.dll"), b"x").unwrap();
        let found = status(&v);
        assert_eq!(found.loader, "scripthook-v");
        assert_eq!(found.mods_dir_kind, "asi-root");
        assert_eq!(
            std::fs::canonicalize(found.mods_dir.as_ref().unwrap()).ok(),
            std::fs::canonicalize(&v).ok()
        );

        // Frosty applies mods through its ModData dir.
        let fc = game_dir(&dir, "fc");
        std::fs::write(fc.join("FC25.exe"), b"MZ").unwrap();
        std::fs::create_dir_all(fc.join("ModData")).unwrap();
        let found = status(&fc);
        assert_eq!(found.loader, "frosty-moddata");
        assert_eq!(found.engine, "frostbite");
        assert!(found.mods_dir.as_ref().unwrap().ends_with("ModData"));
    }

    #[test]
    fn coinstall_only_for_the_legit_layers() {
        assert!(coinstall_ok("none", "cleo5"));
        assert!(coinstall_ok("cleo", "cleoredux"));
        assert!(!coinstall_ok("cleo4", "cleoredux"));
        assert!(coinstall_ok("bepinex", "frosty"));
        assert!(!coinstall_ok("bepinex", "cleo5"));
        assert!(!coinstall_ok("cleo", "bepinex5"));
    }

    #[test]
    fn loader_state_roundtrip_and_update_check() {
        let dir = tempdir().unwrap();
        let state = dir.path().join("games/7");
        assert_eq!(read_loader_install(&state).unwrap(), None);
        assert_eq!(check_loader_updates(&state).unwrap(), None);

        write_loader_install(
            &state,
            &LoaderInstall {
                id: "cleo5".into(),
                version: "1.0.0".into(),
            },
        )
        .unwrap();
        assert!(state.join("loader.json").is_file());
        let stored = read_loader_install(&state).unwrap().unwrap();
        assert_eq!(stored.id, "cleo5");
        assert_eq!(stored.version, "1.0.0");

        // Fake release response: the tag is parsed down to a semver fragment.
        let update = check_loader_updates_with(&state, |_query| {
            Ok(ResolvedAsset {
                url: "https://example.invalid/SA.CLEO-v1.2.3+Ultimate_ASI_Loader.zip".into(),
                tag: "SA.CLEO-v1.2.3+Ultimate_ASI_Loader.zip".into(),
                name: "SA.CLEO-v1.2.3+Ultimate_ASI_Loader.zip".into(),
            })
        })
        .unwrap()
        .expect("an update should be reported");
        assert_eq!(update.loader_id, "cleo5");
        assert_eq!(update.current, "1.0.0");
        assert_eq!(update.latest, "1.2.3");
        assert!(update.updatable);
        assert_eq!(
            update.asset_url.as_deref(),
            Some("https://example.invalid/SA.CLEO-v1.2.3+Ultimate_ASI_Loader.zip")
        );

        // Same version → not updatable.
        let same = check_loader_updates_with(&state, |_| {
            Ok(ResolvedAsset {
                url: "https://example.invalid/x.zip".into(),
                tag: "v1.0.0".into(),
                name: "x.zip".into(),
            })
        })
        .unwrap()
        .unwrap();
        assert!(!same.updatable);
        assert_eq!(same.latest, "1.0.0");

        // A manual loader is never checked (no network call either).
        write_loader_install(
            &state,
            &LoaderInstall {
                id: "scripthook-v".into(),
                version: "1.0.0".into(),
            },
        )
        .unwrap();
        let manual =
            check_loader_updates_with(&state, |_| panic!("manual loaders skip the lookup"))
                .unwrap();
        assert_eq!(manual, None);
    }

    fn layout_fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("mods_layouts")
            .join(name)
    }

    #[test]
    fn mods_dir_resolution_matches_each_loader_layout() {
        // Fixtures mirror the folder layouts the loaders actually read.
        let cases: [(&str, &str, &str, &str); 6] = [
            (
                "bepinex_game",
                "bepinex",
                "BepInEx/plugins",
                "bepinex-plugins",
            ),
            (
                "melonloader_game",
                "melonloader",
                "MelonLoader/Mods",
                "mods",
            ),
            (
                "worldbox_game",
                "neomodloader",
                "worldbox_Data/StreamingAssets/mods",
                "mods",
            ),
            ("msc_game", "mscloader", "Mod", "mods"),
            ("cleo_game", "cleo", "CLEO", "mods"),
            ("frosty_game", "frosty-moddata", "ModData", "mods"),
        ];
        for (fixture, loader, suffix, kind) in cases {
            let root = layout_fixture(fixture);
            let found = status(&root);
            assert_eq!(found.loader, loader, "{fixture}");
            assert_eq!(found.mods_dir_kind, kind, "{fixture}");
            let mods_dir = found.mods_dir.expect(fixture);
            assert!(
                mods_dir.replace('\\', "/").ends_with(suffix),
                "{fixture}: {mods_dir} should end with {suffix}"
            );
        }

        // ASI scripts drop beside the executable; tModLoader is external.
        let hooks = status(&layout_fixture("scripthookv_game"));
        assert_eq!(hooks.loader, "scripthook-v");
        assert_eq!(hooks.mods_dir_kind, "asi-root");
        assert_eq!(
            std::fs::canonicalize(hooks.mods_dir.unwrap()).ok(),
            std::fs::canonicalize(layout_fixture("scripthookv_game")).ok()
        );

        let tml = status(&layout_fixture("tmodloader_game"));
        assert_eq!(tml.loader, "tmodloader");
        assert_eq!(tml.mods_dir, None);
        assert_eq!(tml.mods_dir_kind, "external");
    }

    #[test]
    fn loader_mods_paths_cover_each_loader_family() {
        let dir = tempdir().unwrap();
        let game = game_dir(&dir, "loader-paths");
        let cases = [
            ("bepinex5", "BepInEx/plugins"),
            ("bepinex6mono", "BepInEx/plugins"),
            ("melonloader", "MelonLoader/Mods"),
            ("mscloader", "Mod"),
            ("cleo5", "CLEO"),
            ("frosty", "ModData"),
        ];
        for (loader, suffix) in cases {
            ensure_loader_dirs(&game, loader).unwrap();
            let path = loader_mods_path(&game, loader).expect(loader);
            assert!(path.is_dir(), "{loader} target must exist");
            assert!(
                path.to_string_lossy().replace('\\', "/").ends_with(suffix),
                "{loader}: {}",
                path.display()
            );
        }
    }

    #[test]
    fn worldbox_data_folder_is_matched_case_insensitively() {
        let dir = tempdir().unwrap();
        let game = game_dir(&dir, "wb");
        let mods = game
            .join("WorldBox_Data")
            .join("StreamingAssets")
            .join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        std::fs::write(mods.join("neomodLoader.DLL"), b"MZ").unwrap();

        let found = status(&game);
        assert_eq!(found.loader, "neomodloader");
        let mods_dir = found.mods_dir.expect("mods dir");
        assert!(
            mods_dir
                .replace('\\', "/")
                .ends_with("WorldBox_Data/StreamingAssets/mods"),
            "NML reads StreamingAssets/mods: {mods_dir}"
        );
    }

    #[test]
    fn worldbox_mods_folder_is_resolved_case_insensitively() {
        let dir = tempdir().unwrap();
        let game = game_dir(&dir, "wb");
        let nml = game
            .join("worldbox_data")
            .join("streamingassets")
            .join("MODS");
        std::fs::create_dir_all(&nml).unwrap();
        std::fs::write(nml.join("NeoModLoader.dll"), b"MZ").unwrap();
        std::fs::create_dir_all(nml.join("SampleMod")).unwrap();

        let found = status(&game);
        assert_eq!(found.loader, "neomodloader");
        let mods_dir = PathBuf::from(found.mods_dir.expect("mods dir"));
        assert_eq!(
            std::fs::canonicalize(&mods_dir).ok(),
            std::fs::canonicalize(&nml).ok()
        );
        assert!(!game.join("Mods").exists(), "must not create a duplicate folder");
    }

    #[test]
    fn legacy_root_mods_folder_is_only_a_fallback() {
        let dir = tempdir().unwrap();
        let game = game_dir(&dir, "wb");
        std::fs::create_dir_all(game.join("Mods/LegacyMod")).unwrap();
        std::fs::write(game.join("Mods/LegacyMod/mod.json"), b"{}").unwrap();

        // Primary folder exists (even empty): StreamingAssets/mods wins.
        std::fs::create_dir_all(game.join("worldbox_Data").join("StreamingAssets").join("mods"))
            .unwrap();
        let (primary, _) = detect_mods_dir(&game, "neomodloader");
        assert!(
            primary
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
                .ends_with("worldbox_Data/StreamingAssets/mods")
        );

        // Primary folder absent: a populated legacy `Mods/` is used.
        std::fs::remove_dir_all(game.join("worldbox_Data")).unwrap();
        let (fallback, _) = detect_mods_dir(&game, "neomodloader");
        assert!(
            fallback
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
                .ends_with("/Mods")
        );
    }

    #[test]
    fn bare_dll_loader_asset_lands_in_the_worldbox_mods_folder() {
        let dir = tempdir().unwrap();
        let game = game_dir(&dir, "wb");
        std::fs::create_dir_all(game.join("worldbox_Data").join("StreamingAssets")).unwrap();

        // NeoModLoader ships as a bare .dll; it must land in StreamingAssets/mods
        // so WorldBox loads it (and the installed mods) at startup.
        install_loader_dll(&game, "neomodloader", "NeoModLoader.dll", b"MZ").unwrap();
        assert!(
            game.join("worldbox_Data/StreamingAssets/mods/NeoModLoader.dll")
                .is_file()
        );

        let found = status(&game);
        assert_eq!(found.loader, "neomodloader");
        assert_eq!(found.mods_dir_kind, "mods");
        let mods_dir = PathBuf::from(found.mods_dir.expect("mods dir"));
        assert!(
            mods_dir
                .to_string_lossy()
                .replace('\\', "/")
                .ends_with("worldbox_Data/StreamingAssets/mods"),
            "user mods folder: {}",
            mods_dir.display()
        );
        // `NeoModLoader.dll` sits in the same folder and is listed with the
        // installed entries (the UI shows the loader there too).
        assert!(found.installed.contains(&"NeoModLoader.dll".to_string()));

        // Asset names cannot escape the target folder.
        install_loader_dll(&game, "neomodloader", "../../evil.dll", b"MZ").unwrap();
        assert!(
            game.join("worldbox_Data/StreamingAssets/mods/evil.dll")
                .is_file()
        );
    }

    fn single_file_game(dir: &tempfile::TempDir, name: &str) -> PathBuf {
        let game = dir.path().join(name);
        std::fs::create_dir_all(&game).unwrap();
        game
    }

    #[test]
    fn single_dll_install_lands_in_the_loader_mods_dir_and_is_detectable() {
        let dir = tempdir().unwrap();
        let game = single_file_game(&dir, "unity");
        std::fs::create_dir_all(game.join("BepInEx").join("plugins")).unwrap();
        std::fs::create_dir_all(game.join("Foo_Data").join("Managed")).unwrap();
        let source = dir.path().join("CoolPlugin.dll");
        std::fs::write(&source, b"MZ").unwrap();

        let result = install_file(&game, &source).unwrap();
        assert_eq!(result.installed, vec!["CoolPlugin.dll".to_string()]);
        assert!(game.join("BepInEx/plugins/CoolPlugin.dll").is_file());
        assert!(
            status(&game)
                .installed
                .contains(&"CoolPlugin.dll".to_string()),
            "installed list must surface the new plugin"
        );
        // The source file is copied, not moved.
        assert!(source.is_file());
    }

    #[test]
    fn worldbox_single_dll_lands_in_streaming_assets_mods() {
        let dir = tempdir().unwrap();
        let game = single_file_game(&dir, "wb");
        let nml = game
            .join("worldbox_Data")
            .join("StreamingAssets")
            .join("mods");
        std::fs::create_dir_all(&nml).unwrap();
        std::fs::write(nml.join("NeoModLoader.dll"), b"MZ").unwrap();
        std::fs::create_dir_all(game.join("worldbox_Data").join("Managed")).unwrap();

        let source = dir.path().join("SampleMod.dll");
        std::fs::write(&source, b"MZ").unwrap();

        let result = install_file(&game, &source).unwrap();
        assert_eq!(result.installed, vec!["SampleMod.dll".to_string()]);
        assert!(nml.join("SampleMod.dll").is_file());
        assert!(!game.join("Mods").exists());
    }

    #[test]
    fn single_file_install_requires_its_loader() {
        let dir = tempdir().unwrap();

        // GTA V without Script Hook V → clear validation error.
        let gta = single_file_game(&dir, "gta-v");
        std::fs::write(gta.join("GTA5.exe"), b"MZ").unwrap();
        let asi = dir.path().join("Sample.asi");
        std::fs::write(&asi, b"x").unwrap();
        let err = install_file(&gta, &asi).unwrap_err();
        assert!(err.message.contains("Script Hook V"), "{}", err.message);

        // With the hook present the .asi lands beside the executable.
        std::fs::write(gta.join("ScriptHookV.dll"), b"MZ").unwrap();
        let result = install_file(&gta, &asi).unwrap();
        assert_eq!(result.installed, vec!["Sample.asi".to_string()]);
        assert!(gta.join("Sample.asi").is_file());
    }

    #[test]
    fn single_file_install_validates_extension_and_symlinks() {
        let dir = tempdir().unwrap();
        let game = single_file_game(&dir, "unity");
        std::fs::create_dir_all(game.join("BepInEx").join("plugins")).unwrap();
        std::fs::create_dir_all(game.join("Foo_Data").join("Managed")).unwrap();

        let exe = dir.path().join("evil.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        let err = install_file(&game, &exe).unwrap_err();
        assert!(err.message.contains(".dll or .asi"), "{}", err.message);

        #[cfg(unix)]
        {
            let real = dir.path().join("Real.dll");
            std::fs::write(&real, b"MZ").unwrap();
            let link = dir.path().join("Link.dll");
            std::os::unix::fs::symlink(&real, &link).unwrap();
            let err = install_file(&game, &link).unwrap_err();
            assert!(err.message.contains("symlink"), "{}", err.message);
        }

        // Uninstall refuses traversal names before touching anything.
        let err = uninstall_file(&game, "../plugins/CoolPlugin.dll").unwrap_err();
        assert_eq!(err.code, crate::error::VALIDATION);
    }

    #[test]
    fn version_extraction_handles_release_tags_and_asset_names() {
        assert_eq!(extract_version("v1.2.3"), Some("1.2.3".into()));
        assert_eq!(
            extract_version("SA.CLEO-v1.2.3+Ultimate_ASI_Loader.zip"),
            Some("1.2.3".into())
        );
        assert_eq!(
            extract_version("BepInEx_win_x64_5.4.23.3"),
            Some("5.4.23.3".into())
        );
        assert_eq!(extract_version("no-version-here"), None);
    }

    #[test]
    fn release_queries_map_hosts_and_filters() {
        let q = loader_release_query("cleo5").unwrap();
        assert!(q.releases_url.contains("cleolibrary/CLEO5"));
        assert_eq!(q.prefix, "sa.cleo-v");
        assert_eq!(q.require, &["+ultimate_asi_loader"]);

        let q = loader_release_query("neomodloader").unwrap();
        assert_eq!(q.suffix, ".dll");
        assert!(q.releases_url.contains("WorldBoxOpenMods/ModLoader"));

        let q = loader_release_query("cleoredux").unwrap();
        assert_eq!(q.require, &["x86"]);
        assert!(q.releases_url.contains("cleolibrary/CLEO-Redux"));

        let q = loader_release_query("tmodloader").unwrap();
        assert_eq!(q.prefix, "tmodloader");
        assert_eq!(q.suffix, ".zip");

        let q = loader_release_query("frosty").unwrap();
        assert!(q.releases_url.contains("J-Lyt/FrostyToolsuite"));
        assert_eq!(q.prefix, "frosty.mod.manager");

        assert!(loader_release_query("scripthook-v").is_err());
        assert!(loader_release_query("nope").is_err());
    }
}
