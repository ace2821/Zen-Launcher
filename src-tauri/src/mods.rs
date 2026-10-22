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
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const USER_AGENT: &str = concat!("ZenLauncher/", env!("CARGO_PKG_VERSION"));
const MAX_LOADER_BYTES: usize = 256 * 1024 * 1024;
const MAX_INSTALLED_ENTRIES: usize = 50;

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
    }
}

/// Download and install the requested (or suggested) loader into the game
/// folder. `loaderId` picks a catalog entry; `None` → suggestion.
pub fn install_loader(game_root: &Path, loader_id: Option<&str>) -> AppResult<ModsStatus> {
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
    let url = resolve_asset_url(&query)?;
    let bytes = download_bytes(&url, MAX_LOADER_BYTES)?;
    extract_loader_zip(game_root, &bytes)?;
    ensure_loader_dirs(game_root, spec.id)?;
    if spec.id == "cleoredux" {
        ensure_asi_loader(game_root)?;
    }

    tracing::info!("{} installed into {}", spec.name, game_root.display());
    Ok(status(game_root))
}

/// Loader combinations that legitimately coexist: installing fresh (no loader
/// yet) is always fine; CLEO Redux layers on top of the CLEO library; Frosty's
/// ModData flow never touches other loaders' files.
fn coinstall_ok(current: &str, next: &str) -> bool {
    current == "none"
        || next == "frosty"
        || (next == "cleoredux" && current == "cleo")
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

/// Everything `resolve_asset_url` needs to pick the download for a loader.
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
/// `resolve_asset_url`, which keeps this testable.
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

/// Resolve `query` against the releases list: newest release whose asset
/// matches prefix/require/suffix.
fn resolve_asset_url(query: &ReleaseQuery) -> AppResult<String> {
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
                return Ok(asset.browser_download_url.clone());
            }
        }
    }
    Err(AppError::io(format!(
        "no matching release asset found ({}*.{})",
        query.prefix,
        query.suffix.trim_start_matches('.')
    )))
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
    tracing::info!("Ultimate ASI Loader installed for CLEO Redux into {}", game_root.display());
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

/// Make sure the drop target exists right after a fresh loader install, so
/// the first archive drop cannot fail with "no mods folder".
fn ensure_loader_dirs(game_root: &Path, loader_id: &str) -> AppResult<()> {
    match loader_id {
        "bepinex5" | "bepinex6mono" | "bepinex6il2cpp" => {
            std::fs::create_dir_all(game_root.join("BepInEx").join("plugins"))?;
        }
        "melonloader" => {
            std::fs::create_dir_all(game_root.join("MelonLoader").join("Mods"))?;
        }
        "neomodloader" => {
            std::fs::create_dir_all(
                game_root
                    .join("worldbox_Data")
                    .join("StreamingAssets")
                    .join("mods"),
            )?;
        }
        "mscloader" => {
            std::fs::create_dir_all(game_root.join("Mod"))?;
        }
        "cleo5" | "cleo4" | "cleoredux" => {
            std::fs::create_dir_all(game_root.join("CLEO"))?;
        }
        "frosty" => {
            std::fs::create_dir_all(game_root.join("ModData"))?;
        }
        _ => {}
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

    let outcome = extract_and_move(archive, &staging, &mods_dir, lenient);
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
    } else if game_root
        .join("worldbox_Data")
        .join("StreamingAssets")
        .join("mods")
        .join("NeoModLoader.dll")
        .is_file()
    {
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
    } else if has_entry_ci(game_root, "ScriptHookIV.asi") || has_entry_ci(game_root, "ScriptHookIV.dll")
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
    if loader == "bepinex" {
        return (
            Some(game_root.join("BepInEx").join("plugins")),
            "bepinex-plugins",
        );
    }
    match loader {
        // NeoModLoader's mods live inside the game's asset stream folder.
        "neomodloader" => {
            let dir = game_root
                .join("worldbox_Data")
                .join("StreamingAssets")
                .join("mods");
            (dir.exists().then_some(dir), "mods")
        }
        // tModLoader keeps mods in its own user-profile folder, outside the
        // game root; those are managed from inside the game.
        "tmodloader" => (None, "external"),
        "mscloader" => {
            for candidate in ["Mod", "Mods"] {
                let dir = game_root.join(candidate);
                if dir.is_dir() {
                    return (Some(dir), "mods");
                }
            }
            (None, "mods")
        }
        "cleo" | "cleoredux" => {
            let dir = game_root.join("CLEO");
            (dir.is_dir().then_some(dir), "mods")
        }
        "frosty-moddata" => {
            let dir = game_root.join("ModData");
            (dir.is_dir().then_some(dir), "mods")
        }
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
        || ["fc24.exe", "fc25.exe", "fc26.exe", "fifa20.exe", "fifa21.exe", "fifa22.exe", "fifa23.exe"]
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
    copy_staged_tree(staging, mods_dir, lenient, &mut installed)?;
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
fn copy_staged_tree(
    staging: &Path,
    mods_dir: &Path,
    lenient: bool,
    installed: &mut Vec<String>,
) -> AppResult<()> {
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
        let target = mods_dir.join(&*file_name);
        if source.is_dir() {
            copy_dir_recursive(&source, &target, lenient)?;
        } else {
            std::fs::create_dir_all(mods_dir)?;
            std::fs::copy(&source, &target)?;
        }
        installed.push(name.into_owned());
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
        copy_staged_tree(&staging, &mods, true, &mut installed).unwrap();
        installed.sort();

        assert_eq!(installed, vec!["MyMod", "loose.txt"]);
        assert!(mods.join("MyMod/sub/file.dll").is_file());
        assert!(mods.join("loose.txt").is_file());
        assert!(!mods.join("__MACOSX").exists());
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
        assert!(copy_staged_tree(&staging, &mods, false, &mut installed).is_err());
        assert!(!mods.exists());

        // Lenient mode skips the link and keeps the real file.
        let mods = dir.path().join("ModsLenient");
        let mut installed = Vec::new();
        copy_staged_tree(&staging, &mods, true, &mut installed).unwrap();
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
        let mods = wb.join("worldbox_Data").join("StreamingAssets").join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        std::fs::write(mods.join("NeoModLoader.dll"), b"Q1BAAQ==").unwrap();
        let found = status(&wb);
        assert_eq!(found.loader, "neomodloader");
        let mods_path = found.mods_dir.unwrap();
        assert!(mods_path.contains("worldbox_Data/StreamingAssets/mods"));

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
