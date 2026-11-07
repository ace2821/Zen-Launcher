//! Integration tests for mod conflict detection against the fixture trees in
//! `tests/fixtures/`. These never touch real game folders.

use std::path::{Path, PathBuf};

use zen_launcher_lib::conflicts;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

#[test]
fn fixture_overlap_is_reported_with_the_shared_file() {
    let report = conflicts::detect(1, &fixture("mods_game"));
    assert_eq!(report.game_id, 1);
    assert_eq!(report.conflicts.len(), 1);
    let conflict = &report.conflicts[0];
    assert_eq!(conflict.addon_or_mod_a, "ModA");
    assert_eq!(conflict.addon_or_mod_b, "ModB");
    assert_eq!(conflict.files, vec!["textures/skin.dds".to_string()]);
}

#[test]
fn fixture_without_shared_paths_is_clean() {
    let report = conflicts::detect(2, &fixture("mods_game_clean"));
    assert_eq!(report.game_id, 2);
    assert!(report.conflicts.is_empty());
}

#[test]
fn fixture_with_three_mods_sharing_one_file_reports_all_pairs() {
    let report = conflicts::detect(3, &fixture("mods_game_three"));
    assert_eq!(report.conflicts.len(), 3);
    assert!(
        report
            .conflicts
            .iter()
            .all(|conflict| conflict.files == vec!["shared.txt".to_string()])
    );
}

#[test]
fn conflicts_are_scoped_per_game() {
    let first = conflicts::detect(10, &fixture("mods_game"));
    let second = conflicts::detect(11, &fixture("mods_game_clean"));
    assert_eq!((first.game_id, second.game_id), (10, 11));
    assert_eq!(first.conflicts.len(), 1);
    assert!(second.conflicts.is_empty());
}
