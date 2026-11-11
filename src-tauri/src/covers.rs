//! Keyless Steam cover search + artwork storage.
//!
//! The V1 provider is Steam's public `storesearch` endpoint (no API key): it
//! answers with `{id, name, tiny_image}` matches, and cover images come from
//! Steam's public CDN for that app id. Downloads are capped and validated by
//! magic bytes before anything is stored.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const SEARCH_URL: &str = "https://store.steampowered.com/api/storesearch/";
const USER_AGENT: &str = concat!("ZincLauncher/", env!("CARGO_PKG_VERSION"));
const MAX_COVER_BYTES: usize = 10 * 1024 * 1024;

/// A cover candidate from a provider search.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverCandidate {
    pub provider: &'static str,
    pub id: String,
    pub name: String,
    pub thumb_url: String,
    pub portrait_url: Option<String>,
    pub landscape_url: Option<String>,
    /// Wide Big Picture hero art (`library_hero.jpg`). `null` when the
    /// provider has no hero asset for the app.
    pub hero_url: Option<String>,
}

/// What the downloaded artwork is used for. `library` is the regular poster
/// cover; `bigPicture` stores a wide hero image in the same covers directory
/// under a `hero-` file prefix (so both can coexist for one game).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverVariant {
    Library,
    BigPicture,
}

impl CoverVariant {
    fn prefix(self) -> &'static str {
        match self {
            CoverVariant::Library => "cover",
            CoverVariant::BigPicture => "hero",
        }
    }
}

#[derive(Debug, Deserialize)]
struct StoreSearch {
    #[serde(default)]
    items: Vec<StoreItem>,
}

#[derive(Debug, Deserialize)]
struct StoreItem {
    #[serde(rename = "type")]
    kind: String,
    id: u64,
    name: String,
    #[serde(rename = "tiny_image")]
    tiny_image: String,
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(USER_AGENT)
        .build()
}

/// Search the provider by free-text query (game title).
pub fn fetch_candidates(query: &str) -> AppResult<Vec<CoverCandidate>> {
    let term = query.trim();
    if term.is_empty() {
        return Err(AppError::validation("cover search query is empty"));
    }

    let url = format!("{SEARCH_URL}?term={}&l=english&cc=US", percent_encode(term));
    let body = agent()
        .get(&url)
        .call()
        .map_err(|err| AppError::io(format!("cover search failed: {err}")))?
        .into_string()
        .map_err(|err| AppError::io(format!("cover search failed: {err}")))?;
    let parsed: StoreSearch = serde_json::from_str(&body)
        .map_err(|err| AppError::io(format!("could not parse cover search response: {err}")))?;

    Ok(parsed
        .items
        .iter()
        .filter(|item| item.kind == "app")
        .take(8)
        .map(|item| CoverCandidate {
            provider: "steam",
            id: item.id.to_string(),
            name: item.name.clone(),
            thumb_url: item.tiny_image.clone(),
            portrait_url: Some(library_url(item.id)),
            landscape_url: Some(header_url(item.id)),
            hero_url: Some(hero_url(item.id)),
        })
        .collect())
}

/// Download a provider image and store it for the game; returns the new path.
pub fn download(covers_dir: &Path, game_id: i64, url: &str) -> AppResult<PathBuf> {
    download_variant(covers_dir, game_id, url, CoverVariant::Library)
}

/// Download a provider image for a specific use (`library` poster or
/// `bigPicture` hero art). The stored file name carries the variant prefix so
/// the two never prune each other.
pub fn download_variant(
    covers_dir: &Path,
    game_id: i64,
    url: &str,
    variant: CoverVariant,
) -> AppResult<PathBuf> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::validation("cover URL must be http(s)"));
    }
    let response = agent()
        .get(url)
        .call()
        .map_err(|err| AppError::io(format!("cover download failed: {err}")))?;
    let content_type = response
        .header("content-type")
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !content_type.starts_with("image/") {
        return Err(AppError::validation(format!(
            "cover URL did not return an image (content type: {content_type})"
        )));
    }

    let mut bytes = Vec::new();
    response
        .into_reader()
        .take((MAX_COVER_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|err| AppError::io(format!("cover download failed: {err}")))?;
    if bytes.len() > MAX_COVER_BYTES {
        return Err(AppError::validation("cover is larger than 10 MB"));
    }

    let ext = image_extension(&bytes)
        .ok_or_else(|| AppError::validation("cover is not a PNG/JPEG/WebP image"))?;
    store_cover(covers_dir, game_id, &bytes, ext, variant)
}

/// Copy a local image file into the covers dir (source is never touched).
pub fn set_from_file(covers_dir: &Path, game_id: i64, source: &Path) -> AppResult<PathBuf> {
    let bytes = std::fs::read(source).map_err(|err| {
        AppError::io(format!(
            "could not read cover file {}: {err}",
            source.display()
        ))
    })?;
    if bytes.len() > MAX_COVER_BYTES {
        return Err(AppError::validation("cover is larger than 10 MB"));
    }
    let ext = image_extension(&bytes)
        .ok_or_else(|| AppError::validation("cover file is not a PNG/JPEG/WebP image"))?;
    store_cover(covers_dir, game_id, &bytes, ext, CoverVariant::Library)
}

fn library_url(id: u64) -> String {
    format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/library_600x900.jpg")
}

fn header_url(id: u64) -> String {
    format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/header.jpg")
}

/// Steam's wide Big Picture hero art (the same asset the Big Picture UI and
/// Steam client use as a game background).
fn hero_url(id: u64) -> String {
    format!("https://steamcdn-a.akamaihd.net/steam/apps/{id}/library_hero.jpg")
}

/// Best-effort auto-cover: search by the title and store the first good
/// candidate image (portrait > landscape > thumb, then the next candidate).
/// Used by the settings-driven auto-cover on game approval.
pub fn download_top_match(covers_dir: &Path, game_id: i64, query: &str) -> AppResult<PathBuf> {
    let candidates = fetch_candidates(query)?;
    let mut urls: Vec<String> = Vec::new();
    for candidate in candidates.iter() {
        urls.push(
            candidate
                .portrait_url
                .clone()
                .or_else(|| candidate.landscape_url.clone())
                .unwrap_or_else(|| candidate.thumb_url.clone()),
        );
        if urls.len() >= 3 {
            break;
        }
    }
    let mut last_err: Option<AppError> = None;
    for url in urls {
        match download(covers_dir, game_id, &url) {
            Ok(path) => return Ok(path),
            Err(err) => last_err = Some(err),
        }
    }
    Err(last_err.unwrap_or_else(|| {
        AppError::validation(format!("no cover candidates found for {query:?}"))
    }))
}

fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn store_cover(
    covers_dir: &Path,
    game_id: i64,
    bytes: &[u8],
    ext: &str,
    variant: CoverVariant,
) -> AppResult<PathBuf> {
    std::fs::create_dir_all(covers_dir)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = covers_dir.join(format!("{}-{game_id}-{stamp}.{ext}", variant.prefix()));
    std::fs::write(&path, bytes)?;
    remove_previous_covers(covers_dir, game_id, variant, &path);
    Ok(path)
}

/// Covers are rewritten on every write; drop stale files of the same game and
/// variant so the covers dir never grows unboundedly. Only removes
/// `<prefix>-<id>-*` files, so the library poster and the Big Picture hero art
/// can coexist for one game.
fn remove_previous_covers(covers_dir: &Path, game_id: i64, variant: CoverVariant, keep: &Path) {
    let prefix = format!("{}-{game_id}-", variant.prefix());
    let Ok(entries) = std::fs::read_dir(covers_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep {
            continue;
        }
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn percent_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char);
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn image_extension_detects_magic_bytes() {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend_from_slice(b"rest");
        assert_eq!(image_extension(&png), Some("png"));

        let mut jpg = vec![0xFF, 0xD8, 0xFF, 0xE0];
        jpg.extend_from_slice(b"rest");
        assert_eq!(image_extension(&jpg), Some("jpg"));

        let mut webp = b"RIFF".to_vec();
        webp.extend_from_slice(&[0, 0, 0, 0]);
        webp.extend_from_slice(b"WEBP");
        assert_eq!(image_extension(&webp), Some("webp"));

        assert_eq!(image_extension(b"plain text"), None);
    }

    #[test]
    fn store_cover_writes_unique_file_and_prunes_previous_ones() {
        let dir = tempdir().unwrap();
        let covers = dir.path().join("covers");

        let first = store_cover(&covers, 7, b"one", "png", CoverVariant::Library).unwrap();
        assert!(first.is_file());
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = store_cover(&covers, 7, b"two", "png", CoverVariant::Library).unwrap();
        assert!(second.is_file());

        let leftovers: Vec<_> = std::fs::read_dir(&covers)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(
            leftovers.len(),
            1,
            "old covers of the same game should be pruned: {leftovers:?}"
        );
        assert_eq!(std::fs::read(&second).unwrap(), b"two");

        store_cover(&covers, 8, b"other game", "png", CoverVariant::Library).unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(&covers)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(leftovers.len(), 2);
    }

    #[test]
    fn library_and_big_picture_covers_coexist_for_the_same_game() {
        let dir = tempdir().unwrap();
        let covers = dir.path().join("covers");

        let library = store_cover(&covers, 7, b"poster", "png", CoverVariant::Library).unwrap();
        let hero = store_cover(&covers, 7, b"hero", "jpg", CoverVariant::BigPicture).unwrap();

        assert!(library.is_file());
        assert!(hero.is_file());
        assert!(
            library
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("cover-7-")
        );
        assert!(
            hero.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("hero-7-")
        );

        // Rewriting the hero art must not prune the library poster, and vice
        // versa.
        std::thread::sleep(std::time::Duration::from_millis(5));
        let hero2 = store_cover(&covers, 7, b"hero2", "jpg", CoverVariant::BigPicture).unwrap();
        assert!(library.is_file());
        assert!(!hero.exists());
        assert!(hero2.is_file());

        std::thread::sleep(std::time::Duration::from_millis(5));
        let library2 = store_cover(&covers, 7, b"poster2", "png", CoverVariant::Library).unwrap();
        assert!(hero2.is_file());
        assert!(!library.exists());
        assert!(library2.is_file());
    }

    #[test]
    fn cover_variant_parses_from_the_ipc_spelling() {
        let library: CoverVariant = serde_json::from_str("\"library\"").unwrap();
        let big: CoverVariant = serde_json::from_str("\"bigPicture\"").unwrap();
        assert_eq!(library, CoverVariant::Library);
        assert_eq!(big, CoverVariant::BigPicture);
        assert_eq!(library.prefix(), "cover");
        assert_eq!(big.prefix(), "hero");
        assert!(serde_json::from_str::<CoverVariant>("\"BigPicture\"").is_err());
    }

    #[test]
    fn steam_hero_url_is_the_wide_library_asset() {
        assert_eq!(
            hero_url(367520),
            "https://steamcdn-a.akamaihd.net/steam/apps/367520/library_hero.jpg"
        );
    }

    #[test]
    fn percent_encode_escapes_query_components() {
        assert_eq!(percent_encode("Ages of Conflict"), "Ages%20of%20Conflict");
        assert_eq!(percent_encode("a&b=c"), "a%26b%3Dc");
    }
}
