//! Translation-layer runtime discovery.
//!
//! `list_runtimes` scans the well-known compatibility-tool folders for Proton
//! and Wine builds. The launcher never writes into these folders; it only reads
//! the directory layout:
//!
//! - `proton` script at the root → [`RuntimeKind::Proton`]
//! - `files/bin/wine` (or `bin/wine`) → [`RuntimeKind::Wine`]
//!
//! Selection is deterministic: an explicit override wins, otherwise the newest
//! matching build (by version numbers parsed from the directory name, then by
//! name) is used.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::models::{RuntimeInfo, RuntimeKind, TranslationLayer};

/// Which Proton line a directory name belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtonFlavor {
    /// `GE` / `UMU` builds.
    Ge,
    /// `experimental` builds.
    Experimental,
    Other,
}

/// `UMU-Proton-10.0-4` → `[10, 0, 4]`; used for "newest" ordering.
pub fn version_key(name: &str) -> Vec<u64> {
    let mut numbers = Vec::new();
    let mut current = String::new();
    for ch in name.chars() {
        if ch.is_ascii_digit() {
            current.push(ch);
        } else if !current.is_empty() {
            if let Ok(value) = current.parse::<u64>() {
                numbers.push(value);
            }
            current.clear();
        }
    }
    if !current.is_empty()
        && let Ok(value) = current.parse::<u64>()
    {
        numbers.push(value);
    }
    numbers
}

/// Version string derived from the name (`GE-Proton9-20` → `9.20`).
pub fn version_from_name(name: &str) -> Option<String> {
    let key = version_key(name);
    if key.is_empty() {
        None
    } else {
        Some(key.iter().map(u64::to_string).collect::<Vec<_>>().join("."))
    }
}

/// Classify a runtime directory name. `experimental` wins over `GE`, and
/// `UMU` is treated as a GE-class build.
pub fn classify_flavor(name: &str) -> ProtonFlavor {
    let lower = name.to_ascii_lowercase();
    if lower.contains("experimental") {
        ProtonFlavor::Experimental
    } else if lower.contains("ge") || lower.contains("umu") {
        ProtonFlavor::Ge
    } else {
        ProtonFlavor::Other
    }
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && (meta.permissions().mode() & 0o111) != 0)
        .unwrap_or(false)
}

fn is_file(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|meta| meta.is_file())
        .unwrap_or(false)
}

/// Case-insensitive child lookup (`proton`, `files`, `bin`, `wine`).
fn child_ci(dir: &Path, name: &str) -> Option<PathBuf> {
    let wanted = name.to_ascii_lowercase();
    let entries = std::fs::read_dir(dir).ok()?;
    entries.flatten().find_map(|entry| {
        let file_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        (file_name == wanted).then(|| entry.path())
    })
}

/// Resolve a case-insensitive relative path below `dir`.
fn resolve_ci(dir: &Path, components: &[&str]) -> Option<PathBuf> {
    let mut current = dir.to_path_buf();
    for component in components {
        current = child_ci(&current, component)?;
    }
    Some(current)
}

fn wine_binary(dir: &Path) -> Option<PathBuf> {
    // `files/bin/wine` is the standard Proton/GE layout; plain Wine builds
    // (Lutris runners, custom folders) usually use `bin/wine`.
    resolve_ci(dir, &["files", "bin", "wine"])
        .filter(|path| is_file(path))
        .or_else(|| resolve_ci(dir, &["bin", "wine"]).filter(|path| is_file(path)))
}

/// Classify one directory as a Proton or Wine runtime.
pub fn classify_dir(dir: &Path) -> Option<RuntimeKind> {
    if !dir.is_dir() {
        return None;
    }
    // Proton wins: a Proton build also contains `files/bin/wine`.
    if child_ci(dir, "proton").is_some_and(|path| is_executable(&path)) {
        return Some(RuntimeKind::Proton);
    }
    if wine_binary(dir).is_some() {
        return Some(RuntimeKind::Wine);
    }
    None
}

/// Build a [`RuntimeInfo`] from a directory, if it is a runtime.
pub fn runtime_from_dir(dir: &Path) -> Option<RuntimeInfo> {
    let kind = classify_dir(dir)?;
    let name = dir
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| dir.to_string_lossy().into_owned());
    Some(RuntimeInfo {
        path: dir.to_string_lossy().into_owned(),
        kind,
        name: name.clone(),
        version: version_from_name(&name),
    })
}

/// Scan the given root directories (one level deep). Duplicate directories
/// (e.g. `~/.steam/steam` symlinked to `~/.local/share/Steam`) are collapsed.
pub fn scan_roots(roots: &[PathBuf]) -> Vec<RuntimeInfo> {
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let Some(info) = runtime_from_dir(&dir) else {
                continue;
            };
            let dedupe_key = std::fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());
            if !seen.insert(dedupe_key) {
                continue;
            }
            found.push(info);
        }
    }

    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

/// The runtime roots the launcher looks at. Missing roots are simply skipped.
pub fn default_roots() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    vec![
        home.join(".local/share/Steam/compatibilitytools.d"),
        home.join(".steam/steam/compatibilitytools.d"),
        home.join(".local/share/lutris/runners/wine"),
        home.join("Games/runners"),
    ]
    .into_iter()
    .chain(crate::paths::runtimes_dir().ok())
    .collect()
}

/// Scan every default root once.
pub fn scan_runtimes() -> Vec<RuntimeInfo> {
    scan_roots(&default_roots())
}

/// Steam client install path used by Proton (`STEAM_COMPAT_CLIENT_INSTALL_PATH`).
pub fn steam_client_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let primary = home.join(".local/share/Steam");
    if primary.is_dir() {
        return Some(primary);
    }
    let secondary = home.join(".steam/steam");
    if secondary.is_dir() {
        return Some(secondary);
    }
    None
}

fn newest(runtimes: &[RuntimeInfo]) -> Option<RuntimeInfo> {
    runtimes
        .iter()
        .max_by(|a, b| {
            version_key(&a.name)
                .cmp(&version_key(&b.name))
                .then_with(|| a.name.cmp(&b.name))
        })
        .cloned()
}

fn override_runtime(path: Option<&str>, kind: RuntimeKind) -> Option<RuntimeInfo> {
    let path = Path::new(path?);
    let info = if path.is_dir() {
        runtime_from_dir(path)?
    } else {
        // An override may point straight at the script/binary; use its folder.
        runtime_from_dir(path.parent()?)?
    };
    (info.kind == kind).then_some(info)
}

/// Pick a Proton runtime for [`TranslationLayer::ProtonGe`] or
/// [`TranslationLayer::ProtonExperimental`]. Returns `None` when no Proton
/// runtime was discovered (the caller turns that into a descriptive error).
pub fn select_proton_runtime(
    layer: TranslationLayer,
    override_path: Option<&str>,
    runtimes: &[RuntimeInfo],
) -> Option<RuntimeInfo> {
    if let Some(info) = override_runtime(override_path, RuntimeKind::Proton) {
        return Some(info);
    }

    let protons: Vec<&RuntimeInfo> = runtimes
        .iter()
        .filter(|info| info.kind == RuntimeKind::Proton)
        .collect();
    if protons.is_empty() {
        return None;
    }

    let wanted = match layer {
        TranslationLayer::ProtonExperimental => ProtonFlavor::Experimental,
        _ => ProtonFlavor::Ge,
    };
    let matching: Vec<RuntimeInfo> = protons
        .iter()
        .filter(|info| classify_flavor(&info.name) == wanted)
        .map(|info| (*info).clone())
        .collect();
    if !matching.is_empty() {
        return newest(&matching);
    }

    // Documented fallback: any Proton runtime rather than failing the launch.
    newest(
        &protons
            .iter()
            .map(|info| (*info).clone())
            .collect::<Vec<_>>(),
    )
}

/// Pick a Wine runtime for [`TranslationLayer::WineGe`]. GE/UMU builds are
/// preferred; any Wine runtime is an acceptable fallback.
pub fn select_wine_runtime(
    override_path: Option<&str>,
    runtimes: &[RuntimeInfo],
) -> Option<RuntimeInfo> {
    if let Some(info) = override_runtime(override_path, RuntimeKind::Wine) {
        return Some(info);
    }

    let wines: Vec<&RuntimeInfo> = runtimes
        .iter()
        .filter(|info| info.kind == RuntimeKind::Wine)
        .collect();
    if wines.is_empty() {
        return None;
    }

    let ge: Vec<RuntimeInfo> = wines
        .iter()
        .filter(|info| classify_flavor(&info.name) == ProtonFlavor::Ge)
        .map(|info| (*info).clone())
        .collect();
    if !ge.is_empty() {
        return newest(&ge);
    }
    newest(&wines.iter().map(|info| (*info).clone()).collect::<Vec<_>>())
}

/// Locate the wine binary inside a Wine runtime directory.
pub fn wine_binary_path(dir: &Path) -> Option<PathBuf> {
    wine_binary(dir)
}

/// True when `path` is a Proton `proton` script (or a directory holding one).
pub fn is_proton_script(path: &Path) -> bool {
    if path.is_dir() {
        return classify_dir(path) == Some(RuntimeKind::Proton);
    }
    path.file_name()
        .map(|name| name.to_string_lossy().eq_ignore_ascii_case("proton"))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Downloadable runtimes
// ---------------------------------------------------------------------------

/// The translation-layer builds the launcher can install itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeDownloadKind {
    ProtonGe,
    WineGe,
    ProtonExperimental,
}

impl RuntimeDownloadKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RuntimeDownloadKind::ProtonGe => "protonGe",
            RuntimeDownloadKind::WineGe => "wineGe",
            RuntimeDownloadKind::ProtonExperimental => "protonExperimental",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "protonGe" => Ok(RuntimeDownloadKind::ProtonGe),
            "wineGe" => Ok(RuntimeDownloadKind::WineGe),
            "protonExperimental" => Ok(RuntimeDownloadKind::ProtonExperimental),
            other => Err(AppError::validation(format!(
                "unknown runtime kind: {other}"
            ))),
        }
    }
}

/// One row of `runtime_available_downloads` (mirrors the contract).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAvailableDownload {
    pub kind: RuntimeDownloadKind,
    pub name: String,
    pub version: Option<String>,
    pub size_bytes: Option<u64>,
    pub url: Option<String>,
    /// A matching build already exists in a scanned root (nothing to fetch).
    pub installed: bool,
    /// `false` for builds the launcher cannot fetch (Steam-only deliveries).
    pub downloadable: bool,
    /// Why `downloadable` is false, e.g. `"steam-only"`.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    size: u64,
    browser_download_url: String,
}

/// A resolved release asset plus the runtime directory name derived from it.
#[derive(Debug, Clone)]
struct RemoteAsset {
    runtime_name: String,
    asset_name: String,
    size: u64,
    url: String,
}

const PROTON_GE_RELEASE_URL: &str =
    "https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases/latest";
const WINE_GE_RELEASE_URL: &str =
    "https://api.github.com/repos/GloriousEggroll/wine-ge-custom/releases/latest";
const GITHUB_USER_AGENT: &str = concat!("ZincLauncher/", env!("CARGO_PKG_VERSION"));
const MAX_RELEASE_JSON: usize = 2 * 1024 * 1024;
const PROGRESS_CHUNK_BYTES: usize = 2 * 1024 * 1024;

fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(GITHUB_USER_AGENT)
        .build()
}

/// Directory name embedded in a release asset (`GE-Proton11-12-x86_64.tar.gz`
/// → `GE-Proton11-12`, `wine-lutris-GE-Proton8-26-x86_64.tar.xz` →
/// `wine-lutris-GE-Proton8-26`).
pub fn runtime_name_from_asset(asset: &str) -> Option<String> {
    let base = asset
        .strip_suffix(".tar.gz")
        .or_else(|| asset.strip_suffix(".tar.xz"))?;
    for suffix in ["-x86_64", "-aarch64"] {
        if let Some(stripped) = base.strip_suffix(suffix) {
            return Some(stripped.to_string());
        }
    }
    Some(base.to_string())
}

/// Latest Proton-GE tarball for this architecture (x86_64 preferred).
fn pick_proton_asset(release: &GithubRelease) -> AppResult<RemoteAsset> {
    let asset = release
        .assets
        .iter()
        .find(|asset| {
            asset.name.starts_with("GE-Proton")
                && asset.name.ends_with(".tar.gz")
                && asset.name.contains("x86_64")
        })
        .or_else(|| {
            release.assets.iter().find(|asset| {
                asset.name.starts_with("GE-Proton")
                    && asset.name.ends_with(".tar.gz")
                    && !asset.name.contains("aarch64")
            })
        })
        .ok_or_else(|| AppError::not_found("the latest Proton-GE release has no x86_64 tarball"))?;
    remote_asset(asset)
}

/// Latest Wine-GE tarball for this architecture.
fn pick_wine_asset(release: &GithubRelease) -> AppResult<RemoteAsset> {
    let asset = release
        .assets
        .iter()
        .find(|asset| {
            asset.name.starts_with("wine-lutris-GE-Proton")
                && asset.name.ends_with(".tar.xz")
                && asset.name.contains("x86_64")
        })
        .or_else(|| {
            release.assets.iter().find(|asset| {
                asset.name.starts_with("wine-lutris-GE-Proton")
                    && asset.name.ends_with(".tar.xz")
                    && !asset.name.contains("aarch64")
            })
        })
        .ok_or_else(|| AppError::not_found("the latest Wine-GE release has no x86_64 tarball"))?;
    remote_asset(asset)
}

fn remote_asset(asset: &GithubAsset) -> AppResult<RemoteAsset> {
    let runtime_name = runtime_name_from_asset(&asset.name).ok_or_else(|| {
        AppError::validation(format!("unexpected runtime asset name: {}", asset.name))
    })?;
    Ok(RemoteAsset {
        runtime_name,
        asset_name: asset.name.clone(),
        size: asset.size,
        url: asset.browser_download_url.clone(),
    })
}

fn fetch_release(url: &str) -> AppResult<GithubRelease> {
    let response = http_agent()
        .get(url)
        .call()
        .map_err(|err| AppError::io(format!("runtime release lookup failed: {err}")))?;
    let mut body = String::new();
    response
        .into_reader()
        .take((MAX_RELEASE_JSON + 1) as u64)
        .read_to_string(&mut body)
        .map_err(|err| AppError::io(format!("runtime release lookup failed: {err}")))?;
    if body.len() > MAX_RELEASE_JSON {
        return Err(AppError::validation(
            "runtime release response is too large",
        ));
    }
    serde_json::from_str(&body)
        .map_err(|err| AppError::validation(format!("could not parse runtime release: {err}")))
}

fn remote_asset_for(kind: RuntimeDownloadKind) -> AppResult<RemoteAsset> {
    match kind {
        RuntimeDownloadKind::ProtonGe => pick_proton_asset(&fetch_release(PROTON_GE_RELEASE_URL)?),
        RuntimeDownloadKind::WineGe => pick_wine_asset(&fetch_release(WINE_GE_RELEASE_URL)?),
        RuntimeDownloadKind::ProtonExperimental => Err(AppError::unsupported(
            "Proton Experimental is delivered by Steam and has no downloadable tarball",
        )),
    }
}

/// True when a scanned runtime already satisfies `kind`.
pub fn matches_installed(kind: RuntimeDownloadKind, runtimes: &[RuntimeInfo]) -> bool {
    match kind {
        RuntimeDownloadKind::ProtonGe => runtimes.iter().any(|info| {
            info.kind == RuntimeKind::Proton && classify_flavor(&info.name) == ProtonFlavor::Ge
        }),
        RuntimeDownloadKind::WineGe => runtimes.iter().any(|info| {
            info.kind == RuntimeKind::Wine && classify_flavor(&info.name) == ProtonFlavor::Ge
        }),
        RuntimeDownloadKind::ProtonExperimental => runtimes.iter().any(|info| {
            info.kind == RuntimeKind::Proton
                && classify_flavor(&info.name) == ProtonFlavor::Experimental
        }),
    }
}

/// Latest downloadable build per kind (network). `installed` comes from a
/// fresh [`scan_runtimes`] pass, so it covers launcher-managed installs too.
pub fn available_downloads() -> AppResult<Vec<RuntimeAvailableDownload>> {
    let runtimes = scan_runtimes();
    let proton = remote_asset_for(RuntimeDownloadKind::ProtonGe)?;
    let wine = remote_asset_for(RuntimeDownloadKind::WineGe)?;

    let entry = |kind: RuntimeDownloadKind, asset: RemoteAsset| RuntimeAvailableDownload {
        kind,
        name: asset.runtime_name.clone(),
        version: version_from_name(&asset.runtime_name),
        size_bytes: Some(asset.size),
        url: Some(asset.url),
        installed: matches_installed(kind, &runtimes),
        downloadable: true,
        reason: None,
    };

    Ok(vec![
        entry(RuntimeDownloadKind::ProtonGe, proton),
        entry(RuntimeDownloadKind::WineGe, wine),
        RuntimeAvailableDownload {
            kind: RuntimeDownloadKind::ProtonExperimental,
            name: "Proton Experimental".to_string(),
            version: None,
            size_bytes: None,
            url: None,
            installed: matches_installed(RuntimeDownloadKind::ProtonExperimental, &runtimes),
            downloadable: false,
            reason: Some("steam-only".to_string()),
        },
    ])
}

// ---------------------------------------------------------------------------
// Download execution
// ---------------------------------------------------------------------------

fn download_registry()
-> &'static Mutex<std::collections::HashMap<RuntimeDownloadKind, Arc<AtomicBool>>> {
    static REGISTRY: OnceLock<
        Mutex<std::collections::HashMap<RuntimeDownloadKind, Arc<AtomicBool>>>,
    > = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

/// Start a download on a background thread. Returns as soon as the job is
/// registered; progress and completion arrive as events.
pub fn start_download(app: AppHandle, kind: RuntimeDownloadKind) -> AppResult<()> {
    if kind == RuntimeDownloadKind::ProtonExperimental {
        return Err(AppError::unsupported(
            "Proton Experimental is delivered by Steam and cannot be downloaded",
        ));
    }

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut registry = download_registry()
            .lock()
            .map_err(|_| AppError::io("runtime download registry is poisoned"))?;
        if registry.contains_key(&kind) {
            return Err(AppError::validation(format!(
                "{} is already downloading",
                kind.as_str()
            )));
        }
        registry.insert(kind, cancel.clone());
    }

    let spawned = std::thread::Builder::new()
        .name(format!("runtime-download-{}", kind.as_str()))
        .spawn(move || {
            emit_progress(&app, kind, 0, None, None);
            let result = run_download(&app, kind, &cancel);
            if let Ok(mut registry) = download_registry().lock() {
                registry.remove(&kind);
            }
            let payload = match &result {
                Ok(()) => serde_json::json!({ "kind": kind.as_str(), "ok": true }),
                Err(err) => serde_json::json!({
                    "kind": kind.as_str(),
                    "ok": false,
                    "error": { "code": err.code, "message": err.message },
                }),
            };
            let _ = app.emit("runtime-download-finished", payload);
        });
    if let Err(err) = spawned {
        if let Ok(mut registry) = download_registry().lock() {
            registry.remove(&kind);
        }
        return Err(AppError::io(format!(
            "could not start the download thread: {err}"
        )));
    }

    Ok(())
}

/// Ask a running download to stop. Its thread cleans up the partial archive.
pub fn cancel_download(kind: RuntimeDownloadKind) -> AppResult<()> {
    let registry = download_registry()
        .lock()
        .map_err(|_| AppError::io("runtime download registry is poisoned"))?;
    match registry.get(&kind) {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            Ok(())
        }
        None => Err(AppError::validation(format!(
            "{} is not downloading",
            kind.as_str()
        ))),
    }
}

fn emit_progress(
    app: &AppHandle,
    kind: RuntimeDownloadKind,
    downloaded: u64,
    total: Option<u64>,
    eta: Option<u64>,
) {
    let _ = app.emit(
        "runtime-download-progress",
        serde_json::json!({
            "kind": kind.as_str(),
            "downloadedBytes": downloaded,
            "totalBytes": total,
            "etaSeconds": eta,
        }),
    );
}

fn run_download(app: &AppHandle, kind: RuntimeDownloadKind, cancel: &AtomicBool) -> AppResult<()> {
    let asset = remote_asset_for(kind)?;
    let downloads_dir = crate::paths::runtime_downloads_dir()?;
    std::fs::create_dir_all(&downloads_dir)?;
    let archive_path = downloads_dir.join(&asset.asset_name);

    let response = http_agent()
        .get(&asset.url)
        .call()
        .map_err(|err| AppError::io(format!("runtime download failed: {err}")))?;
    let total = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
        .or(Some(asset.size));

    let mut reader = response.into_reader();
    let mut file = std::fs::File::create(&archive_path)?;
    let start = Instant::now();
    let mut downloaded: u64 = 0;
    let mut last_report_bytes: u64 = 0;
    let mut last_report_pct: u64 = 0;
    let mut last_sample = start;
    let mut last_sample_bytes: u64 = 0;
    let mut speed: Option<f64> = None;
    let mut buffer = vec![0u8; 64 * 1024];

    let result = (|| -> AppResult<()> {
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(AppError::validation("download cancelled"));
            }
            let read = reader
                .read(&mut buffer)
                .map_err(|err| AppError::io(format!("runtime download failed: {err}")))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read])?;
            downloaded += read as u64;

            let now = Instant::now();
            let elapsed = now.duration_since(last_sample).as_secs_f64();
            if elapsed >= 0.25 {
                let instant = (downloaded - last_sample_bytes) as f64 / elapsed;
                speed = Some(match speed {
                    Some(previous) => previous * 0.8 + instant * 0.2,
                    None => instant,
                });
                last_sample = now;
                last_sample_bytes = downloaded;
            }

            let percent = total
                .filter(|total| *total > 0)
                .map(|total| downloaded.saturating_mul(100) / total)
                .unwrap_or(0);
            if downloaded.saturating_sub(last_report_bytes) >= PROGRESS_CHUNK_BYTES as u64
                || percent.saturating_sub(last_report_pct) >= 1
            {
                let eta = match (speed, total) {
                    (Some(speed), Some(total)) if speed > 0.0 => {
                        Some(((total.saturating_sub(downloaded)) as f64 / speed).round() as u64)
                    }
                    _ => None,
                };
                emit_progress(app, kind, downloaded, total, eta);
                last_report_bytes = downloaded;
                last_report_pct = percent;
            }
        }
        Ok(())
    })();

    drop(file);
    if let Err(err) = result {
        let _ = std::fs::remove_file(&archive_path);
        return Err(err);
    }
    emit_progress(app, kind, downloaded, total, Some(0));

    let actual = std::fs::metadata(&archive_path)?.len();
    if let Some(expected) = total
        && actual != expected
    {
        let _ = std::fs::remove_file(&archive_path);
        return Err(AppError::io(format!(
            "runtime archive is incomplete ({actual} of {expected} bytes)"
        )));
    }

    let installed = install_from_archive(kind, &archive_path);
    let _ = std::fs::remove_file(&archive_path);
    let name = installed?;
    tracing::info!("installed runtime {name} ({})", kind.as_str());
    // Refresh the scan so the next `runtime_available_downloads` sees it.
    let _ = scan_runtimes();
    Ok(())
}

/// Extract a downloaded tarball into `<dataDir>/runtimes/<name>/`.
fn install_from_archive(kind: RuntimeDownloadKind, archive_path: &Path) -> AppResult<String> {
    let runtimes_dir = crate::paths::runtimes_dir()?;
    std::fs::create_dir_all(&runtimes_dir)?;
    let staging = runtimes_dir.join(format!(".staging-{}-{}", kind.as_str(), std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)?;

    let outcome = (|| -> AppResult<String> {
        if archive_path.to_string_lossy().ends_with(".tar.gz") {
            let file = std::fs::File::open(archive_path)?;
            let decoder = flate2::read::GzDecoder::new(std::io::BufReader::new(file));
            extract_tar(decoder, &staging)?;
        } else {
            let file = std::fs::File::open(archive_path)?;
            let decoder = liblzma::read::XzDecoder::new(std::io::BufReader::new(file));
            extract_tar(decoder, &staging)?;
        }

        let mut roots: Vec<PathBuf> = std::fs::read_dir(&staging)?
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect();
        if roots.len() != 1 {
            return Err(AppError::validation(
                "runtime archive does not contain exactly one top-level directory",
            ));
        }
        let root = roots.remove(0);
        let name = root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or_else(|| AppError::validation("runtime archive has an empty root name"))?;
        let destination = runtimes_dir.join(&name);
        if destination.exists() {
            return Err(AppError::validation(format!(
                "runtime {name} is already installed"
            )));
        }
        std::fs::rename(&root, &destination)?;
        Ok(name)
    })();

    let _ = std::fs::remove_dir_all(&staging);
    outcome
}

/// Relative archive paths may only contain normal components.
fn safe_relative_path(path: &Path) -> bool {
    use std::path::Component;
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

/// Symlink targets are resolved relative to the entry, and must not climb out
/// of the extraction root.
fn safe_symlink_target(entry_path: &Path, target: &Path) -> bool {
    use std::path::Component;
    if target.is_absolute() {
        return false;
    }
    let mut depth = entry_path
        .parent()
        .map(|parent| {
            parent
                .components()
                .filter(|component| matches!(component, Component::Normal(_)))
                .count()
        })
        .unwrap_or(0) as i64;
    for component in target.components() {
        match component {
            Component::Normal(_) => depth += 1,
            Component::CurDir => {}
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            _ => return false,
        }
    }
    true
}

/// Traversal-safe extraction of a tar stream into `destination`.
fn extract_tar<R: Read>(reader: R, destination: &Path) -> AppResult<()> {
    let mut archive = tar::Archive::new(reader);
    let entries = archive
        .entries()
        .map_err(|err| AppError::io(format!("runtime archive is corrupt: {err}")))?;
    for entry in entries {
        let mut entry =
            entry.map_err(|err| AppError::io(format!("runtime archive is corrupt: {err}")))?;
        let path = entry
            .path()
            .map_err(|err| AppError::io(format!("runtime archive is corrupt: {err}")))?
            .into_owned();
        if !safe_relative_path(&path) {
            return Err(AppError::validation(
                "runtime archive contains an unsafe path",
            ));
        }
        if entry.header().entry_type().is_symlink() {
            let target = entry
                .link_name()
                .map_err(|err| AppError::io(format!("runtime archive is corrupt: {err}")))?
                .ok_or_else(|| AppError::validation("runtime archive has a dangling symlink"))?;
            if !safe_symlink_target(&path, &target) {
                return Err(AppError::validation(
                    "runtime archive contains a symlink escaping the install root",
                ));
            }
        } else if entry.header().entry_type().is_hard_link() {
            let target = entry
                .link_name()
                .map_err(|err| AppError::io(format!("runtime archive is corrupt: {err}")))?
                .ok_or_else(|| AppError::validation("runtime archive has a dangling hard link"))?;
            if !safe_relative_path(&target) {
                return Err(AppError::validation(
                    "runtime archive contains a hard link escaping the install root",
                ));
            }
        }
        entry
            .unpack_in(destination)
            .map_err(|err| AppError::io(format!("could not unpack runtime archive: {err}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_exe(path: &Path) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, b"#!/bin/sh\n").unwrap();
        let mut perms = std::fs::metadata(path).unwrap().permissions();
        use std::os::unix::fs::PermissionsExt;
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).unwrap();
    }

    fn proton_dir(root: &Path, name: &str) -> PathBuf {
        let dir = root.join(name);
        write_exe(&dir.join("proton"));
        write_exe(&dir.join("files/bin/wine"));
        write_exe(&dir.join("files/bin/wine64"));
        dir
    }

    fn wine_dir(root: &Path, name: &str) -> PathBuf {
        let dir = root.join(name);
        write_exe(&dir.join("bin/wine"));
        dir
    }

    #[test]
    fn classify_dir_detects_proton_and_wine() {
        let dir = tempdir().unwrap();
        let proton = proton_dir(dir.path(), "UMU-Proton-10.0-4");
        let wine = wine_dir(dir.path(), "wine-ge-8-26");
        let empty = dir.path().join("not-a-runtime");
        std::fs::create_dir_all(&empty).unwrap();

        assert_eq!(classify_dir(&proton), Some(RuntimeKind::Proton));
        assert_eq!(classify_dir(&wine), Some(RuntimeKind::Wine));
        assert_eq!(classify_dir(&empty), None);
    }

    #[test]
    fn classify_dir_is_case_insensitive() {
        let dir = tempdir().unwrap();
        let runtime = dir.path().join("Build");
        write_exe(&runtime.join("Files/Bin/Wine"));
        assert_eq!(classify_dir(&runtime), Some(RuntimeKind::Wine));
    }

    #[test]
    fn scan_roots_finds_nested_runtimes() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("compatibilitytools.d");
        proton_dir(&root, "GE-Proton9-20");
        proton_dir(&root, "UMU-Proton-10.0-4");
        wine_dir(&root, "Wine-GE-Proton8-26");
        std::fs::create_dir_all(root.join("random")).unwrap();

        let mut found = scan_roots(&[root]);
        found.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(found.len(), 3);
        assert!(found.iter().any(|info| info.name == "UMU-Proton-10.0-4"
            && info.kind == RuntimeKind::Proton
            && info.version.as_deref() == Some("10.0.4")));
        assert!(
            found
                .iter()
                .any(|info| info.name == "Wine-GE-Proton8-26" && info.kind == RuntimeKind::Wine)
        );
    }

    #[test]
    fn flavor_and_version_parsing() {
        assert_eq!(classify_flavor("GE-Proton9-20"), ProtonFlavor::Ge);
        assert_eq!(classify_flavor("umu-proton-10"), ProtonFlavor::Ge);
        assert_eq!(
            classify_flavor("Proton-Experimental"),
            ProtonFlavor::Experimental
        );
        assert_eq!(classify_flavor("Proton-9.0"), ProtonFlavor::Other);
        assert_eq!(version_key("GE-Proton9-20"), vec![9, 20]);
        assert_eq!(version_key("no-version"), Vec::<u64>::new());
        assert_eq!(
            version_from_name("UMU-Proton-10.0-4").as_deref(),
            Some("10.0.4")
        );
    }

    #[test]
    fn proton_selection_prefers_newest_ge_and_falls_back() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        proton_dir(root, "GE-Proton9-20");
        proton_dir(root, "UMU-Proton-10.0-4");
        proton_dir(root, "Proton-Experimental");
        let runtimes = scan_roots(&[root.to_path_buf()]);

        let ge = select_proton_runtime(TranslationLayer::ProtonGe, None, &runtimes).unwrap();
        assert_eq!(ge.name, "UMU-Proton-10.0-4");

        let exp =
            select_proton_runtime(TranslationLayer::ProtonExperimental, None, &runtimes).unwrap();
        assert_eq!(exp.name, "Proton-Experimental");

        // No experimental build → any Proton runtime is the documented fallback.
        let only_ge: Vec<RuntimeInfo> = runtimes
            .iter()
            .filter(|info| info.name != "Proton-Experimental")
            .cloned()
            .collect();
        let fallback =
            select_proton_runtime(TranslationLayer::ProtonExperimental, None, &only_ge).unwrap();
        assert_eq!(fallback.name, "UMU-Proton-10.0-4");
    }

    #[test]
    fn override_path_wins_over_newest() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let pinned = proton_dir(root, "GE-Proton8-1");
        proton_dir(root, "UMU-Proton-10.0-4");
        let runtimes = scan_roots(&[root.to_path_buf()]);

        let chosen = select_proton_runtime(
            TranslationLayer::ProtonGe,
            Some(pinned.to_str().unwrap()),
            &runtimes,
        )
        .unwrap();
        assert_eq!(chosen.name, "GE-Proton8-1");
    }

    #[test]
    fn wine_selection_prefers_ge_then_any() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        wine_dir(root, "wine-9.0");
        wine_dir(root, "Wine-GE-Proton8-26");
        let runtimes = scan_roots(&[root.to_path_buf()]);

        let chosen = select_wine_runtime(None, &runtimes).unwrap();
        assert_eq!(chosen.name, "Wine-GE-Proton8-26");

        let only_plain: Vec<RuntimeInfo> = runtimes
            .iter()
            .filter(|info| info.name == "wine-9.0")
            .cloned()
            .collect();
        assert_eq!(
            select_wine_runtime(None, &only_plain).unwrap().name,
            "wine-9.0"
        );
    }

    #[test]
    fn no_proton_runtime_returns_none() {
        assert!(select_proton_runtime(TranslationLayer::ProtonGe, None, &[]).is_none());
    }

    #[test]
    fn runtime_names_are_parsed_from_asset_names() {
        assert_eq!(
            runtime_name_from_asset("GE-Proton11-12-x86_64.tar.gz").as_deref(),
            Some("GE-Proton11-12")
        );
        assert_eq!(
            runtime_name_from_asset("GE-Proton11-12-aarch64.tar.gz").as_deref(),
            Some("GE-Proton11-12")
        );
        assert_eq!(
            runtime_name_from_asset("wine-lutris-GE-Proton8-26-x86_64.tar.xz").as_deref(),
            Some("wine-lutris-GE-Proton8-26")
        );
        assert_eq!(runtime_name_from_asset("GE-Proton11-12.sha512sum"), None);
        assert_eq!(
            version_from_name("GE-Proton11-12").as_deref(),
            Some("11.12")
        );
    }

    #[test]
    fn installed_matching_uses_kind_and_flavor() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        proton_dir(root, "GE-Proton9-20");
        proton_dir(root, "Proton-Experimental");
        wine_dir(root, "Wine-GE-Proton8-26");
        let runtimes = scan_roots(&[root.to_path_buf()]);

        assert!(matches_installed(RuntimeDownloadKind::ProtonGe, &runtimes));
        assert!(matches_installed(
            RuntimeDownloadKind::ProtonExperimental,
            &runtimes
        ));
        assert!(matches_installed(RuntimeDownloadKind::WineGe, &runtimes));
        assert!(!matches_installed(RuntimeDownloadKind::WineGe, &[]));
    }

    #[test]
    fn extract_tar_rejects_traversal_paths() {
        let dir = tempdir().unwrap();
        let destination = dir.path().join("runtime");
        std::fs::create_dir_all(&destination).unwrap();

        let archive = raw_tar_entry("../escaped.txt", b"evil");
        let error = extract_tar(std::io::Cursor::new(archive), &destination).unwrap_err();
        assert_eq!(error.code, crate::error::VALIDATION);
        assert!(!dir.path().join("escaped.txt").exists());
    }

    /// Hand-built ustar entry, because `tar::Header::set_path` refuses `..`.
    fn raw_tar_entry(name: &str, data: &[u8]) -> Vec<u8> {
        let mut header = [0u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        header[100..108].copy_from_slice(b"0000644\0");
        header[108..116].copy_from_slice(b"0000000\0");
        header[116..124].copy_from_slice(b"0000000\0");
        let size = format!("{:011o}\0", data.len());
        header[124..136].copy_from_slice(size.as_bytes());
        header[136..148].copy_from_slice(b"00000000000\0");
        header[156] = b'0';
        for byte in header[148..156].iter_mut() {
            *byte = b' ';
        }
        let checksum: u32 = header.iter().map(|byte| *byte as u32).sum();
        let checksum = format!("{checksum:06o}\0 ");
        header[148..156].copy_from_slice(checksum.as_bytes());

        let mut archive = Vec::new();
        archive.extend_from_slice(&header);
        archive.extend_from_slice(data);
        archive.resize(512 + data.len().div_ceil(512) * 512, 0);
        archive.resize(archive.len() + 1024, 0);
        archive
    }

    #[test]
    fn extract_tar_unpacks_a_normal_archive() {
        let dir = tempdir().unwrap();
        let destination = dir.path().join("runtime");
        std::fs::create_dir_all(&destination).unwrap();

        let mut builder = tar::Builder::new(Vec::new());
        let payload = b"#!/bin/sh\n";
        let mut header = tar::Header::new_gnu();
        header.set_size(payload.len() as u64);
        header.set_mode(0o755);
        header.set_path("GE-Proton9-20/proton").unwrap();
        header.set_cksum();
        builder.append(&header, &payload[..]).unwrap();
        let archive = builder.into_inner().unwrap();

        extract_tar(std::io::Cursor::new(archive), &destination).unwrap();
        assert!(destination.join("GE-Proton9-20/proton").is_file());
    }
}
