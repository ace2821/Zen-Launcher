//! Online marketplace catalog, package installs and the active theme.
//!
//! The catalog is a static `catalog.json` on GitHub raw (see
//! `docs/INTERFACES.md` §"Marketplace & Conflicts") cached for one hour in
//! `<dataDir>/addons/catalog-cache.json`. A network failure falls back to the
//! cached copy with `stale: true`; with no cache at all it surfaces as `IO`.
//!
//! Every item installs into `<dataDir>/addons/<id>/` with a `manifest.json`.
//! Themes are CSS token files (`entry` points at the CSS) and the active theme
//! id lives in the DB (`app_settings`, migration v3), never in the
//! user-editable TOML config.
//!
//! Packages are downloaded with `ureq`, verified against the catalog `sha256`
//! before anything touches disk, and unpacked through the `zip` crate when the
//! payload is a ZIP archive (traversal-safe entries only). Single-file
//! payloads (CSS/JS) are stored as-is.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

pub const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/ace2821/zen-marketplace/main/catalog.json";
pub const CATALOG_SCHEMA_VERSION: u32 = 1;
/// Catalog cache lifetime (seconds).
pub const CACHE_TTL_SECS: u64 = 60 * 60;
const USER_AGENT: &str = concat!("ZenLauncher/", env!("CARGO_PKG_VERSION"));
const MAX_CATALOG_BYTES: usize = 8 * 1024 * 1024;
const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
pub const MANIFEST_FILE: &str = "manifest.json";
pub const CACHE_FILE: &str = "catalog-cache.json";
pub const ACTIVE_THEME_KEY: &str = "marketplace.activeTheme";

/// `theme` (CSS token file) or `addon` (small JS/CSS payload).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CatalogKind {
    Theme,
    Addon,
}

impl CatalogKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CatalogKind::Theme => "theme",
            CatalogKind::Addon => "addon",
        }
    }
}

/// One entry of the online catalog (mirrors the contract 1:1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: CatalogKind,
    pub name: String,
    pub author: String,
    #[serde(default)]
    pub description: String,
    pub version: String,
    pub min_launcher_version: String,
    pub install_url: String,
    pub sha256: String,
    pub preview_url: Option<String>,
    #[serde(default)]
    pub games: Option<Vec<String>>,
}

/// Result of `marketplace_list`: cached items plus the offline flag.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceList {
    pub items: Vec<CatalogItem>,
    /// `true` when the network failed and the list came from an expired cache.
    pub stale: bool,
}

/// What `marketplace_install` reports back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAddon {
    pub id: String,
    pub name: String,
    pub version: String,
}

/// Persisted `<addons>/<id>/manifest.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(rename = "type")]
    pub kind: CatalogKind,
    /// Relative entry file (CSS for themes, first payload file otherwise).
    pub entry: Option<String>,
    pub files: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CatalogFile {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    #[serde(default)]
    items: Vec<CatalogItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedCatalog {
    fetched_at: u64,
    items: Vec<CatalogItem>,
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(USER_AGENT)
        .build()
}

// ---------------------------------------------------------------------------
// Catalog parsing & cache
// ---------------------------------------------------------------------------

/// Parse `catalog.json`. Only schema version 1 is understood.
pub fn parse_catalog(raw: &str) -> AppResult<Vec<CatalogItem>> {
    let file: CatalogFile = serde_json::from_str(raw)
        .map_err(|err| AppError::validation(format!("could not parse marketplace catalog: {err}")))?;
    if file.schema_version != CATALOG_SCHEMA_VERSION {
        return Err(AppError::validation(format!(
            "unsupported marketplace schema version: {}",
            file.schema_version
        )));
    }
    Ok(file.items)
}

/// Network fetch of the live catalog.
pub fn fetch_catalog() -> AppResult<Vec<CatalogItem>> {
    let response = agent()
        .get(CATALOG_URL)
        .call()
        .map_err(|err| AppError::io(format!("marketplace catalog download failed: {err}")))?;
    let mut body = String::new();
    response
        .into_reader()
        .take((MAX_CATALOG_BYTES + 1) as u64)
        .read_to_string(&mut body)
        .map_err(|err| AppError::io(format!("marketplace catalog download failed: {err}")))?;
    if body.len() > MAX_CATALOG_BYTES {
        return Err(AppError::validation("marketplace catalog is too large"));
    }
    parse_catalog(&body)
}

pub fn cache_path(addons_dir: &Path) -> PathBuf {
    addons_dir.join(CACHE_FILE)
}

fn read_cache(addons_dir: &Path) -> Option<CachedCatalog> {
    let raw = std::fs::read_to_string(cache_path(addons_dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_cache(addons_dir: &Path, fetched_at: u64, items: &[CatalogItem]) -> AppResult<()> {
    std::fs::create_dir_all(addons_dir)?;
    let payload = CachedCatalog {
        fetched_at,
        items: items.to_vec(),
    };
    let body = serde_json::to_string(&payload)
        .map_err(|err| AppError::io(format!("could not encode marketplace cache: {err}")))?;
    std::fs::write(cache_path(addons_dir), body)?;
    Ok(())
}

/// Load the catalog with the one-hour cache. `fetch` is injected so tests can
/// exercise freshness and stale-fallback without touching the network.
///
/// - fresh cache → no network call;
/// - expired/missing cache → fetch, then cache the result;
/// - fetch failure with a cache → cached items with `stale: true`;
/// - fetch failure with no cache → `IO`.
pub fn load_catalog<F>(addons_dir: &Path, now: u64, fetch: F) -> AppResult<MarketplaceList>
where
    F: FnOnce() -> AppResult<Vec<CatalogItem>>,
{
    let cached = read_cache(addons_dir);

    if let Some(cache) = &cached
        && now.saturating_sub(cache.fetched_at) < CACHE_TTL_SECS
    {
        return Ok(MarketplaceList {
            items: cache.items.clone(),
            stale: false,
        });
    }

    match fetch() {
        Ok(items) => {
            if let Err(err) = write_cache(addons_dir, now, &items) {
                tracing::warn!("could not persist the marketplace cache: {err:?}");
            }
            Ok(MarketplaceList { items, stale: false })
        }
        Err(err) => match cached {
            Some(cache) => {
                tracing::warn!("marketplace offline — serving the stale catalog: {err:?}");
                Ok(MarketplaceList {
                    items: cache.items,
                    stale: true,
                })
            }
            None => Err(err),
        },
    }
}

// ---------------------------------------------------------------------------
// Version gating
// ---------------------------------------------------------------------------

/// Numeric parts of a light semver (`1.2.0-beta` → `[1, 2, 0]`).
fn version_parts(raw: &str) -> Vec<u64> {
    raw.split(['-', '+'])
        .next()
        .unwrap_or(raw)
        .split('.')
        .map(|part| part.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

/// `true` when `current` is at least `required` (missing parts count as 0).
pub fn version_at_least(current: &str, required: &str) -> bool {
    let current = version_parts(current);
    let required = version_parts(required);
    let len = current.len().max(required.len());
    for index in 0..len {
        let a = current.get(index).copied().unwrap_or(0);
        let b = required.get(index).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    true
}

/// Reject items that need a newer launcher than this build.
pub fn ensure_compatible(item: &CatalogItem) -> AppResult<()> {
    let current = env!("CARGO_PKG_VERSION");
    if !version_at_least(current, &item.min_launcher_version) {
        return Err(AppError::validation(format!(
            "{} {} requires Zen Launcher {} or newer (running {})",
            item.name, item.version, item.min_launcher_version, current
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Download & hashing
// ---------------------------------------------------------------------------

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Case-insensitive SHA-256 check against the catalog value.
pub fn verify_sha256(bytes: &[u8], expected: &str) -> AppResult<()> {
    let actual = sha256_hex(bytes);
    if actual.eq_ignore_ascii_case(expected.trim()) {
        Ok(())
    } else {
        Err(AppError::validation(
            "marketplace package failed its SHA-256 check",
        ))
    }
}

/// Download a package payload (capped at 64 MB).
pub fn download_package(url: &str) -> AppResult<Vec<u8>> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::validation(
            "marketplace package URL must be http(s)",
        ));
    }
    let response = agent()
        .get(url)
        .call()
        .map_err(|err| AppError::io(format!("marketplace download failed: {err}")))?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take((MAX_PACKAGE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|err| AppError::io(format!("marketplace download failed: {err}")))?;
    if bytes.len() > MAX_PACKAGE_BYTES {
        return Err(AppError::validation("marketplace package is too large"));
    }
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// Install / uninstall
// ---------------------------------------------------------------------------

/// Item ids become directory names: refuse anything that could escape the
/// addons dir.
pub fn validate_id(id: &str) -> AppResult<()> {
    let valid = !id.is_empty()
        && id.len() <= 96
        && !id.contains('/')
        && !id.contains('\\')
        && id != "."
        && id != ".."
        && !id.contains("..")
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if valid {
        Ok(())
    } else {
        Err(AppError::validation("invalid marketplace item id"))
    }
}

// ---------------------------------------------------------------------------
// Deep links
// ---------------------------------------------------------------------------

/// URL scheme registered for `zenlauncher://` deep links.
pub const DEEP_LINK_SCHEME: &str = "zenlauncher";

/// Action encoded by a `zenlauncher://` URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeepLinkAction {
    /// `zenlauncher://install?id=<itemId>` — start a marketplace install.
    Install { item_id: String },
    /// `zenlauncher://page/<name>` — ask the UI to open a page.
    Page { name: String },
}

/// Parse a deep link URL into an action. Unknown hosts, a missing `id` and
/// invalid item ids are rejected with `VALIDATION` (they never reach the
/// installer).
pub fn parse_deep_link(raw: &str) -> AppResult<DeepLinkAction> {
    let rest = raw
        .strip_prefix("zenlauncher://")
        .ok_or_else(|| AppError::validation(format!("not a zenlauncher:// URL: {raw}")))?;

    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    let path = path.trim_end_matches('/');

    match path {
        "install" => {
            let item_id = query_param(query, "id").unwrap_or_default();
            validate_id(&item_id)?;
            Ok(DeepLinkAction::Install { item_id })
        }
        other if other.starts_with("page/") => {
            let name = other["page/".len()..].to_string();
            if name.is_empty() {
                return Err(AppError::validation("deep link page name is empty"));
            }
            Ok(DeepLinkAction::Page { name })
        }
        "" => Err(AppError::validation("deep link is missing an action")),
        other => Err(AppError::validation(format!(
            "unknown deep link action: {other}"
        ))),
    }
}

/// First value of `key` in a `k=v&k=v` query string (raw, undecoded — item ids
/// are restricted to ASCII alphanumerics, `-`, `_` and `.` anyway).
fn query_param(query: &str, key: &str) -> Option<String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.to_string())
}

pub fn addon_dir(addons_dir: &Path, id: &str) -> PathBuf {
    addons_dir.join(id)
}

/// Verify and install a downloaded package. On any failure nothing is left
/// behind (the staging dir is removed and the previous install is untouched
/// until the new tree is complete).
pub fn install_item(
    addons_dir: &Path,
    item: &CatalogItem,
    bytes: &[u8],
) -> AppResult<InstalledAddon> {
    validate_id(&item.id)?;
    ensure_compatible(item)?;
    verify_sha256(bytes, &item.sha256)?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let staging = addons_dir.join(format!(".staging-{}-{stamp}", item.id));
    std::fs::create_dir_all(&staging)?;

    let result = (|| -> AppResult<AddonManifest> {
        let files = if is_zip(bytes) {
            extract_zip(&staging, bytes)?
        } else {
            write_single_file(&staging, item, bytes)?
        };
        let entry = pick_entry(item, &files).ok_or_else(|| {
            AppError::validation(format!(
                "{} contains no usable {} file",
                item.name,
                item.kind.as_str()
            ))
        })?;
        Ok(AddonManifest {
            id: item.id.clone(),
            name: item.name.clone(),
            version: item.version.clone(),
            kind: item.kind,
            entry: Some(entry),
            files,
        })
    })();

    let manifest = match result {
        Ok(manifest) => manifest,
        Err(err) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(err);
        }
    };

    if let Err(err) = write_manifest(&staging, &manifest) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(err);
    }

    // Swap the new tree in only once it is complete.
    let target = addon_dir(addons_dir, &item.id);
    if target.exists() {
        std::fs::remove_dir_all(&target)?;
    }
    std::fs::rename(&staging, &target)?;

    tracing::info!(
        "installed marketplace {} {} into {}",
        item.kind.as_str(),
        item.id,
        target.display()
    );
    Ok(InstalledAddon {
        id: item.id.clone(),
        name: item.name.clone(),
        version: item.version.clone(),
    })
}

fn is_zip(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06")
}

fn write_single_file(
    staging: &Path,
    item: &CatalogItem,
    bytes: &[u8],
) -> AppResult<Vec<String>> {
    let name = package_file_name(&item.install_url, item.kind);
    let target = staging.join(&name);
    std::fs::write(&target, bytes)?;
    Ok(vec![name])
}

/// File name for a single-file payload: URL tail when sane, otherwise a
/// kind-appropriate fallback (`.css` for themes).
fn package_file_name(url: &str, kind: CatalogKind) -> String {
    let fallback = match kind {
        CatalogKind::Theme => "theme.css",
        CatalogKind::Addon => "payload.bin",
    };
    let tail = url
        .split(['?', '#'])
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string();
    let safe = !tail.is_empty()
        && tail != "."
        && tail != ".."
        && !tail.contains("..")
        && tail
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if safe {
        tail
    } else {
        fallback.to_string()
    }
}

/// Extract a ZIP payload traversal-safely; returns the stored relative paths.
fn extract_zip(staging: &Path, bytes: &[u8]) -> AppResult<Vec<String>> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|err| AppError::io(format!("marketplace package is corrupt: {err}")))?;
    let mut files = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| AppError::io(err.to_string()))?;
        let Some(relative) = entry.enclosed_name() else {
            return Err(AppError::validation(
                "marketplace package contains an unsafe path",
            ));
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        let target = staging.join(&relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::io::copy(&mut entry, &mut std::fs::File::create(&target)?)?;
            files.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
    files.sort();
    Ok(files)
}

fn pick_entry(item: &CatalogItem, files: &[String]) -> Option<String> {
    match item.kind {
        CatalogKind::Theme => files
            .iter()
            .find(|file| file.to_ascii_lowercase().ends_with(".css"))
            .cloned(),
        CatalogKind::Addon => files.first().cloned(),
    }
}

fn write_manifest(dir: &Path, manifest: &AddonManifest) -> AppResult<()> {
    let body = serde_json::to_string_pretty(manifest)
        .map_err(|err| AppError::io(format!("could not encode addon manifest: {err}")))?;
    std::fs::write(dir.join(MANIFEST_FILE), body)?;
    Ok(())
}

/// Read the manifest of an installed item.
pub fn read_manifest(addons_dir: &Path, id: &str) -> AppResult<AddonManifest> {
    validate_id(id)?;
    let path = addon_dir(addons_dir, id).join(MANIFEST_FILE);
    let raw = std::fs::read_to_string(&path)
        .map_err(|_| AppError::not_found(format!("addon {id} is not installed")))?;
    serde_json::from_str(&raw)
        .map_err(|err| AppError::io(format!("corrupt addon manifest for {id}: {err}")))
}

/// Remove an installed item. Unknown ids are `NOT_FOUND`.
pub fn uninstall_item(addons_dir: &Path, id: &str) -> AppResult<()> {
    validate_id(id)?;
    let target = addon_dir(addons_dir, id);
    if !target.is_dir() {
        return Err(AppError::not_found(format!("addon {id} is not installed")));
    }
    std::fs::remove_dir_all(&target)?;
    tracing::info!("removed marketplace addon {id}");
    Ok(())
}

/// All installed items (manifests readable), sorted by id.
pub fn list_installed(addons_dir: &Path) -> Vec<InstalledAddon> {
    let Ok(entries) = std::fs::read_dir(addons_dir) else {
        return Vec::new();
    };
    let mut installed: Vec<InstalledAddon> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let id = entry.file_name().to_string_lossy().into_owned();
            read_manifest(addons_dir, &id)
                .ok()
                .map(|manifest| InstalledAddon {
                    id: manifest.id,
                    name: manifest.name,
                    version: manifest.version,
                })
        })
        .collect();
    installed.sort_by(|a, b| a.id.cmp(&b.id));
    installed
}

/// CSS path of an installed theme (used by `marketplace_set_active_theme`).
pub fn theme_css_path(addons_dir: &Path, id: &str) -> AppResult<PathBuf> {
    let manifest = read_manifest(addons_dir, id)?;
    if manifest.kind != CatalogKind::Theme {
        return Err(AppError::validation(format!("{id} is not a theme")));
    }
    let entry = manifest
        .entry
        .ok_or_else(|| AppError::validation(format!("theme {id} has no CSS entry")))?;
    Ok(addon_dir(addons_dir, id).join(entry))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn item(id: &str, kind: CatalogKind, payload: &[u8]) -> CatalogItem {
        CatalogItem {
            id: id.into(),
            kind,
            name: "Test Item".into(),
            author: "ace".into(),
            description: "test".into(),
            version: "1.0.0".into(),
            min_launcher_version: "1.0.0".into(),
            install_url: format!("https://example.invalid/{id}.css"),
            sha256: sha256_hex(payload),
            preview_url: None,
            games: None,
        }
    }

    #[test]
    fn catalog_parse_accepts_v1_and_rejects_other_versions() {
        let raw = r#"{
            "schemaVersion": 1,
            "items": [{
                "id": "jade-dark", "type": "theme", "name": "Jade Dark",
                "author": "ace", "description": "d", "version": "1.0.0",
                "minLauncherVersion": "1.2.0",
                "installUrl": "https://example.invalid/jade.css",
                "sha256": "00", "previewUrl": "https://example.invalid/p.png"
            }]
        }"#;
        let items = parse_catalog(raw).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, CatalogKind::Theme);
        assert_eq!(items[0].min_launcher_version, "1.2.0");
        assert_eq!(items[0].games, None);

        let bad = raw.replace("\"schemaVersion\": 1", "\"schemaVersion\": 2");
        assert!(parse_catalog(&bad).is_err());
    }

    #[test]
    fn sha256_verification_rejects_mismatch() {
        let payload = b"body { color: red; }";
        assert!(verify_sha256(payload, &sha256_hex(payload)).is_ok());
        assert!(verify_sha256(payload, &sha256_hex(payload).to_uppercase()).is_ok());
        let err = verify_sha256(payload, &"0".repeat(64)).unwrap_err();
        assert_eq!(err.code, crate::error::VALIDATION);
    }

    #[test]
    fn install_uninstall_roundtrip_writes_manifest() {
        let dir = tempdir().unwrap();
        let addons = dir.path().join("addons");
        let payload = b":root { --accent: #12c48b; }";
        let catalog_item = item("jade-dark", CatalogKind::Theme, payload);

        let installed = install_item(&addons, &catalog_item, payload).unwrap();
        assert_eq!(installed.id, "jade-dark");
        assert_eq!(installed.version, "1.0.0");

        let manifest = read_manifest(&addons, "jade-dark").unwrap();
        assert_eq!(manifest.kind, CatalogKind::Theme);
        assert_eq!(manifest.entry.as_deref(), Some("jade-dark.css"));
        assert_eq!(
            std::fs::read(theme_css_path(&addons, "jade-dark").unwrap()).unwrap(),
            payload
        );
        assert_eq!(list_installed(&addons), vec![installed]);

        uninstall_item(&addons, "jade-dark").unwrap();
        assert!(read_manifest(&addons, "jade-dark").is_err());
        assert!(uninstall_item(&addons, "jade-dark").is_err());
    }

    #[test]
    fn install_refuses_bad_hash_and_leaves_nothing() {
        let dir = tempdir().unwrap();
        let addons = dir.path().join("addons");
        let payload = b"payload";
        let mut catalog_item = item("bad-hash", CatalogKind::Theme, payload);
        catalog_item.sha256 = "f".repeat(64);

        let err = install_item(&addons, &catalog_item, payload).unwrap_err();
        assert_eq!(err.code, crate::error::VALIDATION);
        assert!(!addons.join("bad-hash").exists());
        let leftovers: Vec<_> = std::fs::read_dir(&addons)
            .map(|entries| entries.flatten().collect())
            .unwrap_or_default();
        assert!(leftovers.is_empty(), "staging must be cleaned up");
    }

    #[test]
    fn stale_cache_is_served_when_fetch_fails() {
        let dir = tempdir().unwrap();
        let addons = dir.path().join("addons");
        let cached_item = item("cached", CatalogKind::Addon, b"x");

        // Warm the cache at t=1000.
        let first = load_catalog(&addons, 1_000, || Ok(vec![cached_item.clone()])).unwrap();
        assert!(!first.stale);

        // Fresh cache: the fetcher must not run.
        let fresh = load_catalog(&addons, 1_000 + CACHE_TTL_SECS - 1, || {
            panic!("fresh cache must not hit the network")
        })
        .unwrap();
        assert!(!fresh.stale);
        assert_eq!(fresh.items, vec![cached_item.clone()]);

        // Expired cache + failing network → stale fallback.
        let stale = load_catalog(&addons, 1_000 + CACHE_TTL_SECS + 10, || {
            Err(AppError::io("offline"))
        })
        .unwrap();
        assert!(stale.stale);
        assert_eq!(stale.items, vec![cached_item]);

        // No cache + failing network → IO.
        let empty = dir.path().join("empty-addons");
        let err = load_catalog(&empty, 1_000, || Err(AppError::io("offline"))).unwrap_err();
        assert_eq!(err.code, crate::error::IO);
    }

    #[test]
    fn install_rejects_outdated_launcher_requirement() {
        let dir = tempdir().unwrap();
        let addons = dir.path().join("addons");
        let payload = b"payload";
        let mut catalog_item = item("future", CatalogKind::Addon, payload);
        catalog_item.min_launcher_version = "99.0.0".into();

        let err = install_item(&addons, &catalog_item, payload).unwrap_err();
        assert_eq!(err.code, crate::error::VALIDATION);
        assert!(!addons.join("future").exists());
    }

    #[test]
    fn version_at_least_compares_numeric_parts() {
        assert!(version_at_least("1.2.0", "1.2.0"));
        assert!(version_at_least("1.2.1", "1.2.0"));
        assert!(version_at_least("2.0", "1.9.9"));
        // Light numeric comparison: the prerelease suffix is ignored.
        assert!(version_at_least("1.2.0-beta", "1.2.0"));
        assert!(!version_at_least("1.1.9", "1.2"));
    }

    #[test]
    fn zip_payload_extracts_and_installs_theme() {
        use std::io::Write;
        let dir = tempdir().unwrap();
        let addons = dir.path().join("addons");
        let mut zip_bytes = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut zip_bytes));
            writer
                .start_file::<_, ()>("theme/tokens.css", zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b":root { --accent: red; }").unwrap();
            writer.finish().unwrap();
        }
        let mut catalog_item = item("zipped", CatalogKind::Theme, &zip_bytes);
        catalog_item.install_url = "https://example.invalid/zipped.zip".into();

        install_item(&addons, &catalog_item, &zip_bytes).unwrap();
        let manifest = read_manifest(&addons, "zipped").unwrap();
        assert_eq!(manifest.entry.as_deref(), Some("theme/tokens.css"));
        assert!(addons.join("zipped/theme/tokens.css").is_file());
    }

    #[test]
    fn invalid_ids_cannot_escape_the_addons_dir() {
        for id in ["../evil", "a/b", "..", "", "a\\b"] {
            assert!(validate_id(id).is_err(), "{id:?} must be rejected");
        }
        assert!(validate_id("jade-dark_2").is_ok());
    }

    #[test]
    fn deep_link_install_with_id_parses() {
        assert_eq!(
            parse_deep_link("zenlauncher://install?id=jade-dark").unwrap(),
            DeepLinkAction::Install {
                item_id: "jade-dark".into()
            }
        );
        // Extra query params and a trailing slash are tolerated.
        assert_eq!(
            parse_deep_link("zenlauncher://install/?id=jade-dark&ref=web").unwrap(),
            DeepLinkAction::Install {
                item_id: "jade-dark".into()
            }
        );
        // Path-style page links.
        assert_eq!(
            parse_deep_link("zenlauncher://page/library").unwrap(),
            DeepLinkAction::Page {
                name: "library".into()
            }
        );
    }

    #[test]
    fn deep_link_install_without_id_is_rejected() {
        let err = parse_deep_link("zenlauncher://install").unwrap_err();
        assert_eq!(err.code, crate::error::VALIDATION);

        let err = parse_deep_link("zenlauncher://install?ref=web").unwrap_err();
        assert_eq!(err.code, crate::error::VALIDATION);

        // An id that could escape the addons dir is refused before install.
        let err = parse_deep_link("zenlauncher://install?id=../evil").unwrap_err();
        assert_eq!(err.code, crate::error::VALIDATION);
    }

    #[test]
    fn deep_link_unknown_path_or_scheme_is_rejected() {
        let err = parse_deep_link("zenlauncher://bogus").unwrap_err();
        assert_eq!(err.code, crate::error::VALIDATION);

        let err = parse_deep_link("https://example.com/install?id=x").unwrap_err();
        assert_eq!(err.code, crate::error::VALIDATION);
    }
}
