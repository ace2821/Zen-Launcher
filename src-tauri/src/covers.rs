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
const USER_AGENT: &str = concat!("ZenLauncher/", env!("CARGO_PKG_VERSION"));
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
        })
        .collect())
}

/// Download a provider image and store it for the game; returns the new path.
pub fn download(covers_dir: &Path, game_id: i64, url: &str) -> AppResult<PathBuf> {
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
    store_cover(covers_dir, game_id, &bytes, ext)
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
    store_cover(covers_dir, game_id, &bytes, ext)
}

fn library_url(id: u64) -> String {
    format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/library_600x900.jpg")
}

fn header_url(id: u64) -> String {
    format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/header.jpg")
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

fn store_cover(covers_dir: &Path, game_id: i64, bytes: &[u8], ext: &str) -> AppResult<PathBuf> {
    std::fs::create_dir_all(covers_dir)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = covers_dir.join(format!("cover-{game_id}-{stamp}.{ext}"));
    std::fs::write(&path, bytes)?;
    remove_previous_covers(covers_dir, game_id, &path);
    Ok(path)
}

/// Covers are rewritten on every write; drop stale files of the same game so
/// the covers dir never grows unboundedly. Only removes `cover-<id>-*` files.
fn remove_previous_covers(covers_dir: &Path, game_id: i64, keep: &Path) {
    let prefix = format!("cover-{game_id}-");
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

        let first = store_cover(&covers, 7, b"one", "png").unwrap();
        assert!(first.is_file());
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = store_cover(&covers, 7, b"two", "png").unwrap();
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

        store_cover(&covers, 8, b"other game", "png").unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(&covers)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(leftovers.len(), 2);
    }

    #[test]
    fn percent_encode_escapes_query_components() {
        assert_eq!(percent_encode("Ages of Conflict"), "Ages%20of%20Conflict");
        assert_eq!(percent_encode("a&b=c"), "a%26b%3Dc");
    }
}
