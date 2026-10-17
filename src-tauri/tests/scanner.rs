//! Integration tests for the scanner against the fixture trees in
//! `tests/fixtures/`. These never touch real game folders.

use std::path::{Path, PathBuf};

use zen_launcher_lib::models::EngineKind;
use zen_launcher_lib::scanner::{self, RawCandidate};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

fn canonical(path: PathBuf) -> PathBuf {
    std::fs::canonicalize(&path).unwrap_or(path)
}

fn scan_fixture(name: &str) -> Vec<RawCandidate> {
    let root = canonical(fixture(name));
    let mut noop = |_: Option<&Path>, _: usize| {};
    scanner::scan(&root, &[], &mut noop)
}

#[test]
fn detects_unity_game() {
    let candidates = scan_fixture("unity_game");
    assert_eq!(candidates.len(), 1, "expected exactly one candidate");

    let candidate = &candidates[0];
    assert_eq!(candidate.engine, EngineKind::Unity);
    assert_eq!(candidate.path, canonical(fixture("unity_game")));
    assert_eq!(
        candidate.executable.as_deref(),
        Some(canonical(fixture("unity_game/MyGame.x86_64")).as_path())
    );
    assert_eq!(candidate.suggested_title, "unity game");
    assert!(candidate.confidence >= 0.9);
    assert!(
        candidate.evidence.iter().any(|e| e.contains("_Data")),
        "evidence should mention the *_Data directory: {:?}",
        candidate.evidence
    );
    assert!(
        candidate.evidence.iter().any(|e| e.contains("UnityPlayer")),
        "evidence should mention UnityPlayer: {:?}",
        candidate.evidence
    );
}

#[test]
fn detects_godot_game() {
    let candidates = scan_fixture("godot_game");
    assert_eq!(candidates.len(), 1);

    let candidate = &candidates[0];
    assert_eq!(candidate.engine, EngineKind::Godot);
    assert_eq!(
        candidate.executable.as_deref(),
        Some(canonical(fixture("godot_game/GodotGame.x86_64")).as_path())
    );
    assert_eq!(candidate.suggested_title, "godot game");
    assert!(candidate.evidence.iter().any(|e| e.contains(".pck")));
}

#[test]
fn detects_executable_script() {
    let candidates = scan_fixture("scripts_game");
    assert_eq!(candidates.len(), 1);

    let candidate = &candidates[0];
    assert_eq!(candidate.engine, EngineKind::Unknown);
    assert_eq!(
        candidate.executable.as_deref(),
        Some(canonical(fixture("scripts_game/run.sh")).as_path())
    );
    assert_eq!(candidate.suggested_title, "scripts game");
}

#[test]
fn detects_appimage() {
    let candidates = scan_fixture("appimage_game");
    assert_eq!(candidates.len(), 1);

    let candidate = &candidates[0];
    assert_eq!(
        candidate.executable.as_deref(),
        Some(canonical(fixture("appimage_game/CoolGame.AppImage")).as_path())
    );
    assert!(candidate.evidence.iter().any(|e| e.contains("AppImage")));
}

#[test]
fn detects_batch_launcher_with_priority() {
    let candidates = scan_fixture("batch_launcher");
    assert_eq!(candidates.len(), 1, "got: {candidates:#?}");

    let candidate = &candidates[0];
    assert_eq!(candidate.engine, EngineKind::Unknown);
    assert_eq!(
        candidate.executable.as_deref(),
        Some(canonical(fixture("batch_launcher/launcher.bat")).as_path())
    );
    assert!(
        candidate.evidence.iter().any(|e| e.contains("batch")),
        "evidence should mention the batch launcher: {:?}",
        candidate.evidence
    );
}

#[test]
fn ignores_redistributables_crash_handlers_and_docs() {
    let candidates = scan_fixture("messy_redist");
    assert!(
        candidates.is_empty(),
        "redistributable tree must produce no candidates, got: {candidates:#?}"
    );
}

#[test]
fn picks_the_deepest_folder_with_an_executable() {
    let candidates = scan_fixture("nested_tree");
    assert_eq!(candidates.len(), 1, "got: {candidates:#?}");
    assert_eq!(
        candidates[0].path,
        canonical(fixture("nested_tree/InnerGame"))
    );
    assert_eq!(candidates[0].suggested_title, "InnerGame");
}

#[test]
fn skips_approved_install_paths() {
    let root = canonical(fixture("unity_game"));
    let mut noop = |_: Option<&Path>, _: usize| {};
    let candidates = scanner::scan(&root, std::slice::from_ref(&root), &mut noop);
    assert!(
        candidates.is_empty(),
        "already-approved game folders must be skipped"
    );
}

#[test]
fn skips_nested_approved_install_paths() {
    let root = canonical(fixture("nested_tree"));
    let approved = canonical(fixture("nested_tree/InnerGame"));
    let mut noop = |_: Option<&Path>, _: usize| {};
    let candidates = scanner::scan(&root, &[approved], &mut noop);
    // The outer shell script is not a game folder once the real game (the
    // nested approved path) is pruned... but the outer script is still a
    // generic candidate, so assert only that the approved path is gone.
    assert!(
        candidates
            .iter()
            .all(|c| c.path != canonical(fixture("nested_tree/InnerGame"))),
        "approved subtree must be pruned"
    );
}

#[test]
fn reports_progress_and_finishes_with_none() {
    let root = canonical(fixture("unity_game"));
    let mut visited: Vec<Option<PathBuf>> = Vec::new();
    let mut progress = |current: Option<&Path>, _found: usize| {
        visited.push(current.map(Path::to_path_buf));
    };
    let _ = scanner::scan(&root, &[], &mut progress);

    assert!(!visited.is_empty());
    assert!(
        visited.iter().any(Option::is_none),
        "the final progress tick must carry `None`"
    );
    assert!(visited.iter().any(|entry| entry.is_some()));
}

#[test]
fn does_not_follow_symlink_loops() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let game = root.join("Game");
    std::fs::create_dir_all(&game).unwrap();
    std::fs::write(game.join("game.x86_64"), b"\x7fELF\x02\x01\x01\x00").unwrap();
    let mut perms = std::fs::metadata(game.join("game.x86_64"))
        .unwrap()
        .permissions();
    use std::os::unix::fs::PermissionsExt;
    perms.set_mode(perms.mode() | 0o755);
    std::fs::set_permissions(game.join("game.x86_64"), perms).unwrap();

    // A symlink pointing back at the scan root would loop forever if followed.
    std::os::unix::fs::symlink(root, root.join("loop")).unwrap();

    let mut noop = |_: Option<&Path>, _: usize| {};
    let candidates = scanner::scan(root, &[], &mut noop);
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].suggested_title, "Game");
}

#[test]
fn elf_without_exec_bit_is_not_a_candidate() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let game = root.join("NotRunnable");
    std::fs::create_dir_all(&game).unwrap();
    std::fs::write(game.join("game.x86_64"), b"\x7fELF\x02\x01\x01\x00").unwrap();
    // Deliberately no exec bit.

    let mut noop = |_: Option<&Path>, _: usize| {};
    assert!(scanner::scan(root, &[], &mut noop).is_empty());
}
