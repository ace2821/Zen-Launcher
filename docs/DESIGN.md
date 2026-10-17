# Zen Launcher — Design Document

**Version:** 0.1 (draft for approval)
**Date:** 2026-10-17
**Status:** Awaiting owner approval
**License:** MIT

## 1. Vision

Zen Launcher is a local-first, offline-capable game library manager and launcher
for Linux that organizes games you already have — DRM-free store purchases
(GOG, itch.io, Humble), freeware and open-source titles, mods and total
conversions, retro games through RetroArch, and plain game folders on disk —
in one fast, keyboard- and gamepad-friendly place.

It exists because game collections outside Steam deserve first-class
management: launch profiles, artwork, mod handling, save backups — without
store clients, accounts, telemetry, or lock-in.

Scope note: Zen Launcher manages local content only. It does not download games
and does not integrate with content sources or stores. Games enter the library
from local folders (scan + approve) or manual entry.

## 2. Goals and non-goals

### Goals (V1)
- Fast library management for hundreds of games: folder scan, engine-aware
  auto-detection, approve/reject flow.
- One-click launching with per-game profiles: native Linux games, Windows games
  via Wine (per-game prefix) or Proton (umu-launcher), RetroArch for retro.
- First-class mod management for moddable games (detect, install, toggle,
  conflict check, loader support).
- Save auto-backup and restore with version history.
- Big Picture mode with DualShock/Xbox gamepad support.
- EN + PL interface from day one; open source (MIT); AppImage distribution.

### Non-goals (V1)
- Store integrations (GOG/itch API), game downloads, account systems.
- Cloud sync, online achievements, social features.
- Windows/macOS builds (architecture stays port-ready).
- NTFS / removable-media edge cases (collection lives on the system disk).
- Mod sets/variants (Vanilla/Modded/Test) — postponed, design leaves room.
- Portable mode, auto-update of the app itself (info-only notification).

## 3. Platform and stack

| Area | Choice |
|---|---|
| Platform | Linux first (dev target: Arch/CachyOS); Windows port later |
| Shell | Tauri 2 (Rust core + WebView UI) |
| Frontend | React + TypeScript + Vite; TanStack Query/Virtual; zustand; i18next; Framer Motion |
| Backend | Rust: library/scanner/runners/process supervision/`gilrs` gamepad service |
| Database | SQLite (rusqlite, bundled) + on-disk image/cache storage |
| Config | TOML (`~/.config/zen-launcher/config.toml`) |
| Packaging | AppImage (`ZenLauncher-<ver>-x86_64.AppImage`) |
| License | MIT |

Rationale: Rust core matches the owner's stack (ZincTM) and is strong for
process/filesystem work; the web frontend gives the best tools for a polished,
animated library UI; Tauri keeps binaries light and the Windows port cheap.

Name check (2026-10-17): AUR has no `zen-launcher`; GitHub has only small,
unrelated same-name repos (Minecraft/Android/personal). A play-store Android
home-screen launcher uses the same name in a different category. Verdict:
usable for a desktop game-library project.

## 4. Verified requirements (interview record)

- Import: scan folders + human approval of candidates; background auto-scan of
  watched roots (new folder → candidate).
- Engine-aware detection: Unity, Godot, Unreal, GameMaker, plain ELF/.sh/
  AppImage; ignore redistributables and crash handlers; confidence scoring.
- Game entry types: native, Windows (Wine/Proton), emulated (RetroArch),
  mods/total conversions and own builds as normal library entries.
- Metadata providers: Steam (name→appdetails match), SteamGridDB (art),
  ScreenScraper (retro); local files + manual override always available.
  No IGDB in V1. API keys stored locally (file mode 0600).
- Views: cover grid + list/table; game details page; favorites/recent rows.
- Big Picture mode: fullscreen, gamepad-first; DualShock + Xbox pads handled in
  Rust via `gilrs` (WebKitGTK Gamepad API is unreliable), events pushed to UI.
- Launch profiles: args, env vars, working dir + ready toggles: gamemode,
  gamescope, DXVK, MangoHud. No arbitrary pre/post scripts in V1.
- Wine: one prefix per game (created/managed by launcher); Proton via
  umu-launcher / Proton-GE, fallback to system Wine.
- RetroArch: emulator definition (binary, cores dir) + per-game core/ROM entry.
- After Play: launcher hides to tray, session timer runs, one-click return.
- Mods: detect mod dirs per game; install from ZIP/folder; enable/disable
  without deleting; file-conflict detection; BepInEx/MelonLoader support.
- Saves: automatic backup before each session + manual; version history;
  restore in one click; paths auto-detected or user-specified.
- V1 extras: tags and collections, favorites/recents, `.desktop` shortcuts per
  game (KDE menu), background auto-scan, library export/import (JSON).
- i18n: English + Polish from the start.
- First-run wizard: language, font (Maple Mono default; display headings in
  Space Grotesk), accent preset, default library view, window behavior;
  skippable and re-runnable from Settings. Dark theme only for now — light
  theme deferred.
- App updates: check GitHub Releases, notify only.
- Branding: postponed; placeholder icon until a dedicated pass.

## 5. Functional specification

### 5.1 Library and import
- Sources: user adds scan roots (folders under the system disk in V1).
- Scanner: walks root, detects game signatures (Unity `*_Data`+
  `UnityPlayer.so`, Godot `*.pck`, Unreal `Engine/`, GameMaker, generic
  executable dirs), produces candidates with confidence + evidence.
- Import UI: review cards (cover placeholder, detected name/engine/executable)
  → approve, edit, or reject; dedupe by canonical path.
- Manual add: pick folder or executable, set type (native/Wine/Retro/mod).
- Background auto-scan toggle per root; results appear as pending candidates.
- Library entry fields: title, sort title, type, runner profile, tags,
  collections, favorite, hidden, notes, cover/art refs, install path, size,
  last played, total time, status (ready/missing/moved).

### 5.2 Metadata and artwork
- Provider pipeline (pluggable trait): Steam match → SteamGridDB art →
  ScreenScraper (retro) → local files (`cover.jpg`, `*—grid*` naming patterns)
  → manual override.
- All fetches cached locally (DB + image cache); UI never blocks on network;
  offline keeps last known data; per-provider enable/disable.
- Matching: normalized-title search with manual "pick correct match" UI.

### 5.3 Launch engine
- Runner abstraction: argument list, env map, working dir, built-in toggles.
- Native runner: direct exec; `.sh` and AppImage supported (exec bit managed).
- Wine runner: per-game prefix lifecycle (create, configure via `winecfg`
  shortcut, recreate, delete); winetricks hooks postponed. Minimal system-wine
  path already in: `wine` + per-game prefix + `.bat`/`.cmd` via `cmd /c`.
- Proton runner: umu-launcher integration; Proton-GE detection; clear
  fallback rules (Proton-GE → system Wine).
- RetroArch runner: binary + core selection per game, ROM path, per-game
  launch args.
- Toggles: gamemode, gamescope (with sane presets), DXVK (Wine), MangoHud.
- Process supervision: spawn, track PID, capture exit, update session; app
  stays alive in tray during play.

### 5.4 Mods
- Per-game mods tab; mod dir detection (`mods/`, `Mods/`, `_mods/`, custom).
- Install: ZIP or folder → placed in mod dir (strip single top-level folder),
  file manifest recorded for clean uninstall.
- Enable/disable: files moved to stash (`~/.local/share/zen-launcher/mods/…`)
  and restored on toggle; no destructive operations.
- Conflicts: manifests compared; overlap warning with affected-file list.
- Loaders: detect existing BepInEx/MelonLoader installs; guided install from a
  local archive; version display. Auto-download of loaders → post-V1.
- Mod metadata: name, version, source URL note, install date, size.

### 5.5 Saves
- Auto-backup before each launch (if enabled) + manual backup button.
- Versioned ZIP snapshots per game in `~/.local/share/zen-launcher/saves/<game>/`.
- Restore: pick snapshot, overwrite current save dirs (with pre-restore safety
  copy); retention keeps last N + pinned snapshots.
- Save path detection: known native locations, Wine prefix paths, user-defined
  paths per game; dry-run report shows what will be archived.

### 5.6 Interface
- Library: cover grid (default) and list/table view; search + filters (tag,
  type, runner, source root, missing).
- Game details: hero art, Play button, tabs: Mods, Saves, Launch options,
  Notes; session stats.
- Sidebar: favorites, recent, collections, tags, sources; pending candidates
  badge.
- Big Picture: fullscreen grid, gamepad-first navigation, quick play, exit.
- Standard search bar + keyboard navigation (arrows/Enter/Esc); command
  palette (Ctrl+K) consciously dropped from V1.
- Dark theme default (light theme deferred); UI font choice (Maple Mono
  default, display headings in Space Grotesk) and accent presets via first-run
  wizard / Settings; branding pass deferred.
- Notifications: scan finished, backup done, update available.

### 5.7 Extras
- Tags/collections; favorites/recents; `.desktop` shortcut generation
  (`~/.local/share/applications/zen-launcher-<slug>.desktop`).
- Export/import library as JSON (entries, tags, profiles, settings; images
  optional in archive).
- Update check: GitHub Releases API poll (opt-in, info only).

### 5.8 Data and storage
- `~/.config/zen-launcher/config.toml` — settings, provider keys (0600).
- `~/.local/share/zen-launcher/` — `library.db`, `images/`, `saves/`,
  `mods/` (stash), `logs/`.
- DB tables (sketch): `games`, `profiles`, `sources`, `candidates`, `mods`,
  `save_snapshots`, `sessions`, `tags`, `game_tags`, `collections`,
  `collection_games`, `provider_cache`, `settings`.
- Schema migrations from M1 (versioned SQL migrations).

### 5.9 Security and privacy
- No telemetry, no accounts; network only for chosen metadata providers and
  the update check (both toggleable).
- Process spawning via arg arrays only (no shell interpolation of user data).
- Non-destructive defaults: delete actions go to trash/stash or require
  explicit confirmation with file lists.

## 6. Architecture sketch

```
┌─────────────────────────── Tauri 2 app ───────────────────────────┐
│ React/TS UI (Vite)                                                │
│   views: Library · Details · BigPicture · Import · Settings       │
│   state: zustand + TanStack Query · i18n (EN/PL)                  │
└───────────────▲──────────────────────────────┬────────────────────┘
        commands│events (progress, scan, pad)  │invoke
┌───────────────┴──────────────────────────────▼────────────────────┐
│ Rust core                                                          │
│  scanner · engine-detect · library (SQLite/rusqlite)               │
│  runners: native | wine | proton(umu) | retroarch                  │
│  process-supervisor · session-tracker · tray                       │
│  mods (manifests, stash) · saves (snapshots) · desktop-entries     │
│  metadata: steam-match | steamgriddb | screenscraper + cache       │
│  gamepad: gilrs → Tauri events                                     │
└────────────────────────────────────────────────────────────────────┘
```

- Key crates: `tauri` v2, `rusqlite` (bundled), `walkdir`, `notify`,
  `serde`/`toml`, `reqwest` (rustls), `tokio`, `gilrs`, `zip`, `tracing`,
  `thiserror`, `chrono`.
- Long operations (scan, metadata refresh) run as cancellable async tasks with
  progress events.
- Performance targets: cold start < 1.5 s; 1000+ game grid at 60 fps
  (virtualized); 10k-file scan < 5 s typical.

## 7. Testing and verification

- Rust: unit tests for engine detection, runner arg building, mod manifests,
  save-path heuristics (`cargo test`); fixture game trees in `tests/fixtures/`.
- Frontend: Vitest for core views/stores; build + type-check in CI.
- Milestone verification: manual checklist runs on the owner's machine, report
  in `docs/reports/` (Status / Files / How to run / Tests / Diffs / Acceptance).
- CI (GitHub Actions): build, `cargo test`, frontend type-check + tests.

## 8. Roadmap (V1 = milestones M1–M5)

- **M1 — Skeleton and library:** Tauri scaffold, DB + migrations, scan+approve
  import, grid/list library, native launch, session timer, tray.
  *Acceptance:* scan a folder → approve → launch → time counted → state
  persists across restarts.
- **M2 — Launch power:** profiles (args/env/cwd + toggles), Wine per-game
  prefix (minimal system-wine runner already in) + umu/Proton-GE, RetroArch
  runner, `.desktop` shortcuts, auto-scan.
- **M3 — Metadata and order:** Steam match + SteamGridDB + ScreenScraper,
  artwork cache, details view, search/filters, tags/collections,
  favorites/recents, export/import.
- **M4 — Mods and saves:** mods manager (detect/install/toggle/conflicts/
  loaders), save auto-backup + restore with history.
- **M5 — Big Picture and polish:** gamepad (gilrs), Big Picture mode, EN/PL
  i18n complete, update check, AppImage packaging, README/docs, 1.0 release.

Post-V1 backlog: mod variants, portable mode, Windows port, NTFS/removable
media, IGDB provider, loader auto-download, achievements/goals, theming editor.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| WebKitGTK quirks (video, gamepad, perf) | `gilrs` for pads; early M1 spike on the owner's machine |
| Wine prefix complexity (broken translations) | strict per-game prefixes, recreate/repair action, full logging |
| Proton outside Steam | umu-launcher standard; explicit fallback to system Wine |
| ScreenScraper quotas/policy | throttling + cache; degrade gracefully; keys user-supplied |
| Mod variety across games | manifest-based generic approach; start with dir-mods + 2 loaders |
| Metadata match quality | multi-provider + manual override; never block UI |
| Scope creep (BPM + mods + gamepad in V1) | strict milestone order; post-V1 backlog is explicit |

## 10. Open questions for the owner

1. ~~Name: keep **Zen Launcher** despite mild, category-different collisions?~~
   — resolved: keep.
2. Save retention default: keep last 10 + pinned — OK?
3. Tray quick-launch submenu (games list in tray menu) in V1 or later?

## 11. Project names and paths

- Local directory: `~/Projekty/ZenLauncher`
- Repo/binary: `zen-launcher` (GitHub), binary `zen-launcher`
- Data: `~/.config/zen-launcher/`, `~/.local/share/zen-launcher/`
- AppImage: `ZenLauncher-<version>-x86_64.AppImage`

*— end of draft —*
