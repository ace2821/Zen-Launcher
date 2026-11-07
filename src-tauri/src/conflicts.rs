//! Mod conflict detection for a single game.
//!
//! Mods are the top-level entries of the game's mods folder (the same folder
//! `mods::status` reports — BepInEx plugins, MelonLoader mods, `Mods/`, CLEO,
//! …). Two mods conflict when they carry a file at the same relative path
//! inside the mods folder; without a mod loader the comparison falls back to
//! plain relative paths in the mods dir.
//!
//! The report is intentionally pairwise: every pair of mods that share at
//! least one path becomes one row with the shared paths sorted.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::mods;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub addon_or_mod_a: String,
    pub addon_or_mod_b: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictReport {
    pub game_id: i64,
    pub conflicts: Vec<Conflict>,
}

/// Detect overlapping files between the mods installed for one game.
pub fn detect(game_id: i64, game_root: &Path) -> ConflictReport {
    let status = mods::status(game_root);
    let Some(mods_dir) = status.mods_dir.as_deref().map(PathBuf::from) else {
        return ConflictReport {
            game_id,
            conflicts: Vec::new(),
        };
    };

    ConflictReport {
        game_id,
        conflicts: detect_in_dir(&mods_dir),
    }
}

/// Pure directory scan: `mods_dir/<mod>/...` → relative file paths.
pub fn detect_in_dir(mods_dir: &Path) -> Vec<Conflict> {
    let Ok(entries) = std::fs::read_dir(mods_dir) else {
        return Vec::new();
    };

    // relative path → mods that ship it
    let mut owners: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            for file in relative_files(&path) {
                owners.entry(file).or_default().insert(name.clone());
            }
        } else if path.is_file() {
            owners.entry(name.clone()).or_default().insert(name);
        }
    }

    // pair → shared files
    let mut pairs: BTreeMap<(String, String), BTreeSet<String>> = BTreeMap::new();
    for (file, mods) in owners {
        if mods.len() < 2 {
            continue;
        }
        let mods: Vec<String> = mods.into_iter().collect();
        for left in 0..mods.len() {
            for right in (left + 1)..mods.len() {
                pairs
                    .entry((mods[left].clone(), mods[right].clone()))
                    .or_default()
                    .insert(file.clone());
            }
        }
    }

    pairs
        .into_iter()
        .map(|((a, b), files)| Conflict {
            addon_or_mod_a: a,
            addon_or_mod_b: b,
            files: files.into_iter().collect(),
        })
        .collect()
}

/// Every regular file under `root`, as a `/`-separated path relative to it.
fn relative_files(root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        files.push(relative.to_string_lossy().replace('\\', "/"));
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write(root: &Path, relative: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, b"x").unwrap();
    }

    #[test]
    fn overlapping_files_produce_one_conflict() {
        let dir = tempdir().unwrap();
        let mods = dir.path().join("Mods");
        write(&mods, "ModA/textures/skin.dds");
        write(&mods, "ModA/data/config.ini");
        write(&mods, "ModB/textures/skin.dds");

        let conflicts = detect_in_dir(&mods);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].addon_or_mod_a, "ModA");
        assert_eq!(conflicts[0].addon_or_mod_b, "ModB");
        assert_eq!(conflicts[0].files, vec!["textures/skin.dds".to_string()]);
    }

    #[test]
    fn disjoint_mods_report_no_conflicts() {
        let dir = tempdir().unwrap();
        let mods = dir.path().join("Mods");
        write(&mods, "ModA/a.txt");
        write(&mods, "ModB/b.txt");

        assert!(detect_in_dir(&mods).is_empty());
    }

    #[test]
    fn three_mods_sharing_one_file_produce_all_pairs() {
        let dir = tempdir().unwrap();
        let mods = dir.path().join("Mods");
        for name in ["ModA", "ModB", "ModC"] {
            write(&mods, &format!("{name}/shared.txt"));
        }

        let conflicts = detect_in_dir(&mods);
        // C(3, 2) = 3 pairs, each carrying the shared path.
        assert_eq!(conflicts.len(), 3);
        let pairs: Vec<(String, String)> = conflicts
            .iter()
            .map(|c| (c.addon_or_mod_a.clone(), c.addon_or_mod_b.clone()))
            .collect();
        assert_eq!(
            pairs,
            vec![
                ("ModA".to_string(), "ModB".to_string()),
                ("ModA".to_string(), "ModC".to_string()),
                ("ModB".to_string(), "ModC".to_string()),
            ]
        );
        assert!(conflicts.iter().all(|c| c.files == vec!["shared.txt".to_string()]));
    }

    #[test]
    fn missing_mods_dir_is_clean_and_reports_the_game() {
        let dir = tempdir().unwrap();
        let report = detect(42, dir.path());
        assert_eq!(report.game_id, 42);
        assert!(report.conflicts.is_empty());

        // A real mods dir through the loader detection path.
        let mods = dir.path().join("Mods");
        write(&mods, "ModA/shared.txt");
        write(&mods, "ModB/shared.txt");
        let report = detect(7, dir.path());
        assert_eq!(report.game_id, 7);
        assert_eq!(report.conflicts.len(), 1);
        assert_eq!(report.conflicts[0].files, vec!["shared.txt".to_string()]);
    }
}
