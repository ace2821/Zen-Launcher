//! Pure, testable game scanner.
//!
//! Walks a root recursively, detects engine signatures and plausible primary
//! executables, and returns [`RawCandidate`]s. No database, no Tauri, no
//! display — everything here is unit-testable.
//!
//! Contract heuristics (`docs/INTERFACES.md`):
//! - Unity: `*_Data/` directory + `UnityPlayer.so`/`UnityPlayer.dll`
//! - Godot: `*.pck` next to an executable
//! - Unreal: `Engine/` or `Binaries/Linux/`
//! - GameMaker (`*.yyp`, `*.win`) / Ren'Py (`renpy/`)
//! - generic fallback: ELF magic + executable bit, `.sh`, `.AppImage`, `.bat` (Windows batch launchers)
//! - ignore `*setup*`, `*redist*`, `unins*`, `crash*`, `_CommonRedist`,
//!   `DirectX`, `dotnet`, `vc_redist`, `support/`, `docs/`
//! - candidate = deepest folder that contains a plausible primary executable

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::models::EngineKind;

/// Depth cap protecting the walker from pathological trees.
pub const MAX_DEPTH: usize = 16;

const ELF_MAGIC: [u8; 4] = [0x7f, b'E', b'L', b'F'];

#[derive(Debug, Clone, PartialEq)]
pub struct RawCandidate {
    pub path: PathBuf,
    pub executable: Option<PathBuf>,
    pub engine: EngineKind,
    pub suggested_title: String,
    pub confidence: f64,
    pub evidence: Vec<String>,
}

/// Progress callback: `(current_directory_or_none, candidates_so_far)`.
pub type ProgressFn<'a> = &'a mut dyn FnMut(Option<&Path>, usize);

// ---------------------------------------------------------------------------
// Name rules
// ---------------------------------------------------------------------------

/// Pitfall names that must never yield or contain candidates.
pub fn is_ignored_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }
    const SUBSTRINGS: &[&str] = &[
        "setup",
        "redist",
        "unins",
        "crash",
        "_commonredist",
        "directx",
        "dotnet",
        "vc_redist",
    ];
    if SUBSTRINGS.iter().any(|needle| lower.contains(needle)) {
        return true;
    }
    matches!(lower.as_str(), "support" | "docs")
}

/// Directories that belong to an engine's internal layout and can never be a
/// game root (their parent carries the signature).
pub fn is_structural_dir(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with("_data") {
        return true;
    }
    matches!(
        lower.as_str(),
        "engine" | "binaries" | "managed" | "monobleedingedge" | "renpy" | "py3-linux-x86_64"
    )
}

// ---------------------------------------------------------------------------
// Small filesystem helpers
// ---------------------------------------------------------------------------

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && (meta.permissions().mode() & 0o111) != 0)
        .unwrap_or(false)
}

fn is_elf(path: &Path) -> bool {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).is_ok() && magic == ELF_MAGIC
}

fn is_elf_executable(path: &Path) -> bool {
    is_executable(path) && is_elf(path)
}

#[derive(Debug, Clone)]
struct Entry {
    name: String,
    path: PathBuf,
    is_dir: bool,
}

/// Non-recursive, filtered directory listing (skips ignored names, hidden
/// entries, and symlinks so scanner logic stays loop-free).
fn read_entries(dir: &Path) -> Vec<Entry> {
    let read = match std::fs::read_dir(dir) {
        Ok(read) => read,
        Err(err) => {
            tracing::debug!("scan: cannot read {}: {err}", dir.display());
            return Vec::new();
        }
    };

    let mut entries = Vec::new();
    for item in read.flatten() {
        let file_type = match item.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || is_ignored_name(&name) {
            continue;
        }
        entries.push(Entry {
            name,
            path: item.path(),
            is_dir: file_type.is_dir(),
        });
    }
    entries
}

fn files_of(entries: &[Entry]) -> Vec<&Entry> {
    entries.iter().filter(|entry| !entry.is_dir).collect()
}

fn dirs_of(entries: &[Entry]) -> Vec<&Entry> {
    entries.iter().filter(|entry| entry.is_dir).collect()
}

/// ELF executables in `dir`, best "primary" first: a name matching the folder
/// wins, then shorter names, then alphabetical. Shared objects are excluded.
fn elf_executables_in(dir: &Path, base: &str) -> Vec<PathBuf> {
    let base_key = normalize_key(base);
    let mut found: Vec<PathBuf> = read_entries(dir)
        .into_iter()
        .filter(|entry| !entry.is_dir)
        .filter(|entry| !is_library_name(&entry.name))
        .filter(|entry| is_elf_executable(&entry.path))
        .map(|entry| entry.path)
        .collect();

    found.sort_by(|a, b| {
        let a_name = a
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        let b_name = b
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        let a_match = u8::from(!base_key.is_empty() && a_name.contains(&base_key));
        let b_match = u8::from(!base_key.is_empty() && b_name.contains(&base_key));
        b_match
            .cmp(&a_match)
            .then(a_name.len().cmp(&b_name.len()))
            .then(a_name.cmp(&b_name))
    });
    found
}

fn first_elf_executable_in(dir: &Path) -> Option<PathBuf> {
    let base = base_name(dir);
    elf_executables_in(dir, &base).into_iter().next()
}

fn is_library_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".so") || lower.contains(".so.") || lower.ends_with(".dll")
}

fn first_exe_in(dir: &Path) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = read_entries(dir)
        .into_iter()
        .filter(|entry| !entry.is_dir)
        .filter(|entry| entry.name.to_ascii_lowercase().ends_with(".exe"))
        .filter(|entry| !entry.name.to_ascii_lowercase().starts_with("unityplayer"))
        .map(|entry| entry.path)
        .collect();
    found.sort();
    found.into_iter().next()
}

fn first_with_suffix(entries: &[&Entry], suffix: &str) -> Option<PathBuf> {
    entries
        .iter()
        .find(|entry| entry.name.to_ascii_lowercase().ends_with(suffix))
        .map(|entry| entry.path.clone())
}

/// `.bat` launchers in a folder: `launcher.bat` wins, then the shortest name,
/// then alphabetical.
fn first_bat_launcher(files: &[&Entry]) -> Option<PathBuf> {
    let mut found: Vec<&Entry> = files
        .iter()
        .copied()
        .filter(|entry| entry.name.to_ascii_lowercase().ends_with(".bat"))
        .collect();
    found.sort_by(|a, b| {
        let a_name = a.name.to_ascii_lowercase();
        let b_name = b.name.to_ascii_lowercase();
        let a_launcher = u8::from(a_name == "launcher.bat");
        let b_launcher = u8::from(b_name == "launcher.bat");
        b_launcher
            .cmp(&a_launcher)
            .then(a_name.len().cmp(&b_name.len()))
            .then(a_name.cmp(&b_name))
    });
    found.first().map(|entry| entry.path.clone())
}

fn existing_file(dir: &Path, names: &[String]) -> Option<PathBuf> {
    names
        .iter()
        .map(|name| dir.join(name))
        .find(|candidate| candidate.is_file())
}

fn normalize_key(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn base_name(dir: &Path) -> String {
    dir.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Engine detection
// ---------------------------------------------------------------------------

fn detect_dir(dir: &Path) -> Option<RawCandidate> {
    let base = base_name(dir);
    if base.is_empty() || is_structural_dir(&base) {
        return None;
    }

    let entries = read_entries(dir);
    let files = files_of(&entries);
    let dirs = dirs_of(&entries);
    let file_names: Vec<String> = files
        .iter()
        .map(|entry| entry.name.to_ascii_lowercase())
        .collect();
    let dir_names: Vec<String> = dirs
        .iter()
        .map(|entry| entry.name.to_ascii_lowercase())
        .collect();

    let has = |names: &[String], needle: &str| names.iter().any(|name| name == needle);
    let title = clean_title(&base);

    // ---- Unity -----------------------------------------------------------
    if let Some(data_dir) = dirs
        .iter()
        .find(|entry| entry.name.to_ascii_lowercase().ends_with("_data"))
    {
        let in_root = has(&file_names, "unityplayer.so") || has(&file_names, "unityplayer.dll");
        let in_data = data_dir.path.join("UnityPlayer.so").is_file()
            || data_dir.path.join("UnityPlayer.dll").is_file();
        if in_root || in_data {
            let stem = data_dir
                .name
                .strip_suffix("_Data")
                .or_else(|| {
                    data_dir
                        .name
                        .to_ascii_lowercase()
                        .strip_suffix("_data")
                        .map(|_| &data_dir.name[..data_dir.name.len() - 5])
                })
                .unwrap_or(&base)
                .to_string();
            let executable = existing_file(
                dir,
                &[
                    format!("{stem}.x86_64"),
                    format!("{stem}.x86"),
                    format!("{stem}.exe"),
                    stem.clone(),
                ],
            )
            .or_else(|| first_elf_executable_in(dir))
            .or_else(|| first_exe_in(dir));

            let marker = if in_data {
                format!("{}/UnityPlayer.so", data_dir.name)
            } else {
                "UnityPlayer.so".to_string()
            };
            return Some(RawCandidate {
                path: dir.to_path_buf(),
                engine: EngineKind::Unity,
                suggested_title: title,
                confidence: if executable.is_some() { 0.95 } else { 0.8 },
                evidence: vec!["*_Data directory".to_string(), marker],
                executable,
            });
        }
    }

    // ---- Unreal ----------------------------------------------------------
    let has_engine = has(&dir_names, "engine");
    let has_binaries = has(&dir_names, "binaries");
    let binaries_linux = dir.join("Binaries").join("Linux");
    if has_engine || has_binaries || binaries_linux.is_dir() {
        let mut evidence = Vec::new();
        if has_engine {
            evidence.push("Engine/ directory".to_string());
        }
        let mut executable = None;
        if binaries_linux.is_dir() {
            evidence.push("Binaries/Linux/ directory".to_string());
            executable = first_elf_executable_in(&binaries_linux);
        }
        if executable.is_none() {
            executable = first_elf_executable_in(dir)
                .or_else(|| first_with_suffix(&files, ".sh"))
                .or_else(|| first_exe_in(dir));
        }
        return Some(RawCandidate {
            path: dir.to_path_buf(),
            engine: EngineKind::Unreal,
            suggested_title: title,
            confidence: if has_engine { 0.9 } else { 0.75 },
            evidence,
            executable,
        });
    }

    // ---- Ren'Py ----------------------------------------------------------
    if has(&dir_names, "renpy") {
        let mut evidence = vec!["renpy/ directory".to_string()];
        if has(&dir_names, "game") {
            evidence.push("game/ directory".to_string());
        }
        let scripted = dir.join(format!("{base}.sh"));
        let executable = if scripted.is_file() {
            Some(scripted)
        } else {
            first_with_suffix(&files, ".sh")
                .or_else(|| first_elf_executable_in(dir))
                .or_else(|| {
                    let launcher = dir.join(format!("{base}.py"));
                    launcher.is_file().then_some(launcher)
                })
        };
        return Some(RawCandidate {
            path: dir.to_path_buf(),
            engine: EngineKind::Renpy,
            suggested_title: title,
            confidence: 0.9,
            evidence,
            executable,
        });
    }

    // ---- Godot -----------------------------------------------------------
    if let Some(pack) = files
        .iter()
        .find(|entry| entry.name.to_ascii_lowercase().ends_with(".pck"))
    {
        let executable = first_elf_executable_in(dir).or_else(|| first_exe_in(dir));
        return Some(RawCandidate {
            path: dir.to_path_buf(),
            engine: EngineKind::Godot,
            suggested_title: title,
            confidence: if executable.is_some() { 0.9 } else { 0.6 },
            evidence: vec![
                format!("{} (Godot pack)", pack.name),
                "executable next to *.pck".to_string(),
            ],
            executable,
        });
    }

    // ---- GameMaker -------------------------------------------------------
    let yyp = files
        .iter()
        .find(|entry| entry.name.to_ascii_lowercase().ends_with(".yyp"));
    let win = files
        .iter()
        .find(|entry| entry.name.to_ascii_lowercase().ends_with(".win"));
    if let Some(marker) = yyp.or(win) {
        let executable = first_elf_executable_in(dir).or_else(|| first_exe_in(dir));
        let mut evidence = vec![format!("{} (GameMaker signature)", marker.name)];
        if executable.is_some() {
            evidence.push("executable in game folder".to_string());
        }
        return Some(RawCandidate {
            path: dir.to_path_buf(),
            engine: EngineKind::Gamemaker,
            suggested_title: title,
            confidence: if executable.is_some() { 0.75 } else { 0.6 },
            evidence,
            executable,
        });
    }

    // ---- Generic ---------------------------------------------------------
    if let Some(appimage) = files
        .iter()
        .find(|entry| entry.name.to_ascii_lowercase().ends_with(".appimage"))
    {
        return Some(RawCandidate {
            path: dir.to_path_buf(),
            engine: EngineKind::Unknown,
            suggested_title: title,
            confidence: 0.6,
            evidence: vec![format!("{} (AppImage)", appimage.name)],
            executable: Some(appimage.path.clone()),
        });
    }

    if let Some(elf) = first_elf_executable_in(dir) {
        return Some(RawCandidate {
            path: dir.to_path_buf(),
            engine: EngineKind::Unknown,
            suggested_title: title,
            confidence: 0.6,
            evidence: vec![
                format!(
                    "{} (ELF executable)",
                    elf.file_name().unwrap().to_string_lossy()
                ),
                "executable bit set".to_string(),
            ],
            executable: Some(elf),
        });
    }

    if let Some(script) = first_with_suffix(&files, ".sh") {
        return Some(RawCandidate {
            path: dir.to_path_buf(),
            engine: EngineKind::Unknown,
            suggested_title: title,
            confidence: 0.5,
            evidence: vec![format!(
                "{} (shell script)",
                script.file_name().unwrap().to_string_lossy()
            )],
            executable: Some(script),
        });
    }

    if let Some(batch) = first_bat_launcher(&files) {
        return Some(RawCandidate {
            path: dir.to_path_buf(),
            engine: EngineKind::Unknown,
            suggested_title: title,
            confidence: 0.5,
            evidence: vec![format!(
                "{} (Windows batch launcher)",
                batch.file_name().unwrap().to_string_lossy()
            )],
            executable: Some(batch),
        });
    }

    None
}

// ---------------------------------------------------------------------------
// Title cleaning
// ---------------------------------------------------------------------------

const PLATFORM_SUFFIXES: &[&str] = &[
    "x86_64",
    "aarch64",
    "linux64",
    "linux32",
    "linux",
    "amd64",
    "windows",
    "win64",
    "win32",
    "x64",
    "x86",
    "win",
    "macos",
    "osx",
    "universal",
    "multi",
];

fn is_version_token(token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    let (body, prefixed) = match token.strip_prefix(['v', 'V']) {
        Some(rest) => (rest, true),
        None => (token, false),
    };
    if body.is_empty() {
        return false;
    }
    if !body.contains('.') && !prefixed {
        return false;
    }
    body.chars().all(|c| c.is_ascii_digit() || c == '.')
}

fn strip_platform_suffix(value: &str) -> Option<String> {
    let trimmed = value.trim_end();
    let lower = trimmed.to_ascii_lowercase();
    for suffix in PLATFORM_SUFFIXES {
        if lower.ends_with(suffix) {
            let cut = trimmed.len() - suffix.len();
            let before = &trimmed[..cut];
            let separated = before.is_empty() || before.ends_with(['_', '-', '.', ' ']);
            if separated {
                let head = before
                    .trim_end_matches(['_', '-', '.', ' '])
                    .trim_end()
                    .to_string();
                if !head.is_empty() {
                    return Some(head);
                }
            }
        }
    }
    None
}

fn strip_version_suffix(value: &str) -> Option<String> {
    let trimmed = value.trim_end();
    let sep = trimmed.rfind(['_', '-', ' '])?;
    let unit = &trimmed[sep + 1..];
    if is_version_token(unit) {
        let head = trimmed[..sep]
            .trim_end_matches(['_', '-', '.', ' '])
            .trim_end()
            .to_string();
        if !head.is_empty() {
            return Some(head);
        }
    }
    None
}

/// Human-friendly title from a folder name: `My_Game_v1.2.3-linux` → `My Game`.
/// Never returns an empty string (falls back to the trimmed input).
pub fn clean_title(folder_name: &str) -> String {
    let mut current = folder_name.trim().to_string();
    for _ in 0..12 {
        let next = strip_platform_suffix(&current).or_else(|| strip_version_suffix(&current));
        match next {
            Some(next) => current = next,
            None => break,
        }
    }
    let spaced = current.replace('_', " ");
    let cleaned = spaced
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(['-', '.', ' '])
        .to_string();
    if cleaned.is_empty() {
        folder_name.trim().to_string()
    } else {
        cleaned
    }
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/// Walk `root`, skipping `skip_paths` subtrees (already-approved games), and
/// return candidates sorted by path.
///
/// Symlinks are never followed, so symlink loops cannot happen; the `MAX_DEPTH`
/// cap bounds pathological trees.
pub fn scan(root: &Path, skip_paths: &[PathBuf], progress: ProgressFn<'_>) -> Vec<RawCandidate> {
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let skip: Vec<PathBuf> = skip_paths
        .iter()
        .map(|path| std::fs::canonicalize(path).unwrap_or_else(|_| path.clone()))
        .collect();

    let mut candidates: Vec<RawCandidate> = Vec::new();

    let walker = WalkDir::new(&root)
        .follow_links(false)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.depth() > 0 && (name.starts_with('.') || is_ignored_name(&name)) {
                return false;
            }
            if skip.iter().any(|skipped| {
                entry.path() == skipped.as_path() || entry.path().starts_with(skipped)
            }) {
                return false;
            }
            true
        });

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                tracing::warn!("scan: skipping unreadable entry: {err}");
                continue;
            }
        };
        if !entry.file_type().is_dir() {
            continue;
        }
        progress(Some(entry.path()), candidates.len());
        if let Some(candidate) = detect_dir(entry.path()) {
            candidates.push(candidate);
        }
    }

    progress(None, candidates.len());
    finalize(candidates)
}

/// Dedupe, drop engine-internal descendants, then keep the deepest folder when
/// a generic chain nests (contract rule).
fn finalize(mut candidates: Vec<RawCandidate>) -> Vec<RawCandidate> {
    candidates.sort_by(|a, b| a.path.cmp(&b.path));
    candidates.dedup_by(|a, b| a.path == b.path);

    let engine_roots: Vec<PathBuf> = candidates
        .iter()
        .filter(|candidate| candidate.engine != EngineKind::Unknown)
        .map(|candidate| candidate.path.clone())
        .collect();
    candidates.retain(|candidate| {
        !engine_roots
            .iter()
            .any(|root| candidate.path != *root && candidate.path.starts_with(root))
    });

    let paths: Vec<PathBuf> = candidates.iter().map(|c| c.path.clone()).collect();
    candidates.retain(|candidate| {
        !paths
            .iter()
            .any(|path| path != &candidate.path && path.starts_with(&candidate.path))
    });

    candidates.sort_by(|a, b| a.path.cmp(&b.path));
    candidates
}

// ---------------------------------------------------------------------------
// Unit tests (pure logic; fixture-based integration tests live in tests/)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignore_rules_cover_contract_pitfalls() {
        for name in [
            "setup.exe",
            "vc_redist.x64.exe",
            "_CommonRedist",
            "unins000.exe",
            "crashhandler",
            "DirectX",
            "dotnet",
            "support",
            "docs",
            "Install_Redist",
        ] {
            assert!(is_ignored_name(name), "{name} should be ignored");
        }
        for name in ["MyGame", "GodotGame", "bin", "lib", "game", "Linux"] {
            assert!(!is_ignored_name(name), "{name} should not be ignored");
        }
    }

    #[test]
    fn structural_dirs_are_not_candidate_roots() {
        assert!(is_structural_dir("MyGame_Data"));
        assert!(is_structural_dir("renpy"));
        assert!(is_structural_dir("Engine"));
        assert!(!is_structural_dir("MyGame"));
    }

    #[test]
    fn title_cleaning_strips_separators_platform_and_version() {
        assert_eq!(clean_title("My_Game"), "My Game");
        assert_eq!(clean_title("My_Game_v1.2.3-linux"), "My Game");
        assert_eq!(clean_title("Shooter_x86_64"), "Shooter");
        assert_eq!(clean_title("RPG-win64"), "RPG");
        assert_eq!(clean_title("Puzzle 2"), "Puzzle 2");
        assert_eq!(clean_title("Game 1.0"), "Game");
        assert_eq!(clean_title("  Spaced  Name  "), "Spaced Name");
        // Never empty.
        assert_eq!(clean_title("linux"), "linux");
    }

    #[test]
    fn deepest_folder_wins_for_generic_chain() {
        let candidates = vec![
            RawCandidate {
                path: PathBuf::from("/games/Bundle"),
                executable: Some(PathBuf::from("/games/Bundle/run")),
                engine: EngineKind::Unknown,
                suggested_title: "Bundle".into(),
                confidence: 0.6,
                evidence: vec![],
            },
            RawCandidate {
                path: PathBuf::from("/games/Bundle/Real"),
                executable: Some(PathBuf::from("/games/Bundle/Real/run")),
                engine: EngineKind::Unknown,
                suggested_title: "Real".into(),
                confidence: 0.6,
                evidence: vec![],
            },
        ];
        let result = finalize(candidates);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].path, PathBuf::from("/games/Bundle/Real"));
    }

    #[test]
    fn engine_root_beats_nested_executable() {
        let candidates = vec![
            RawCandidate {
                path: PathBuf::from("/games/UE"),
                executable: Some(PathBuf::from("/games/UE/Binaries/Linux/UE")),
                engine: EngineKind::Unreal,
                suggested_title: "UE".into(),
                confidence: 0.9,
                evidence: vec![],
            },
            RawCandidate {
                path: PathBuf::from("/games/UE/Binaries/Linux"),
                executable: Some(PathBuf::from("/games/UE/Binaries/Linux/UE")),
                engine: EngineKind::Unknown,
                suggested_title: "Linux".into(),
                confidence: 0.6,
                evidence: vec![],
            },
        ];
        let result = finalize(candidates);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].path, PathBuf::from("/games/UE"));
        assert_eq!(result[0].engine, EngineKind::Unreal);
    }

    #[test]
    fn version_token_detection() {
        assert!(is_version_token("1.2.3"));
        assert!(is_version_token("v1"));
        assert!(is_version_token("v2.0"));
        assert!(!is_version_token("2"));
        assert!(!is_version_token("beta"));
        assert!(!is_version_token(""));
    }
}
