# Zen Launcher — Interface Contract (M1)

Contract between the Rust core (`src-tauri/`) and the UI (`src/`). Any change
to shapes below must land on both sides in the same commit, with this file
updated first. Mirror types 1:1 in `src/lib/types.ts`.

## Conventions

- JSON over IPC uses `camelCase` (Rust: `#[serde(rename_all = "camelCase")]`).
- Timestamps are ISO-8601 UTC strings (`"2026-10-17T13:00:00Z"`).
- Ids are `i64` numbers. Paths are absolute Unix paths.
- Options serialize as `null` (never `undefined` / omitted).
- Errors: commands return `Result<T, AppError>`; `AppError = { code, message }`
  with codes: `NOT_FOUND`, `IO`, `DB`, `VALIDATION`, `LAUNCH_FAILED`,
  `UNSUPPORTED`.
- Long operations emit progress events; the UI never polls.

## Domain types (M1)

```ts
type GameType = "native" | "windows" | "retro" | "mod";
type EngineKind = "unity" | "godot" | "unreal" | "gamemaker" | "renpy" | "unknown";

interface Source {
  id: number;
  path: string;
  autoScan: boolean;          // applied in M2 (watcher); stored in M1
  createdAt: string;
  lastScanAt: string | null;
}

interface Candidate {
  id: number;
  sourceId: number | null;    // null once its scan root was removed
  path: string;               // suggested game root folder
  executable: string | null;
  engine: EngineKind;
  suggestedTitle: string;
  confidence: number;         // 0.0–1.0
  evidence: string[];         // e.g. ["UnityPlayer.so", "*_Data directory"]
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface Game {
  id: number;
  title: string;
  sortTitle: string | null;
  type: GameType;
  installPath: string;
  executable: string;
  args: string[];
  env: Record<string, string>;
  workDir: string | null;
  tags: string[];
  favorite: boolean;
  hidden: boolean;
  notes: string | null;
  coverPath: string | null;   // local file path (providers fill in later milestones)
  status: "ready" | "missing"; // computed on read (executable exists?)
  createdAt: string;
  updatedAt: string;
  lastPlayedAt: string | null;
  totalSeconds: number;
}

interface Session {
  id: number;
  gameId: number;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  exitCode: number | null;
}

interface Settings {
  language: "en" | "pl";
  closeToTray: boolean;         // default true
  hideOnLaunch: boolean;        // default true
  font: string;                 // UI font id; default "maple-mono"
  accent: string;               // accent preset id; default "jade"
  onboardingCompleted: boolean; // default false; set by the first-run wizard
}

interface ScanSummary {
  sourceId: number;
  candidatesFound: number;
  durationMs: number;
}

interface LaunchInfo {
  sessionId: number;
}
```

## Commands (`invoke`)

| Command | Input | Output |
|---|---|---|
| `list_sources` | — | `Source[]` |
| `add_source` | `{ path }` | `Source` (an existing root returns the existing row) |
| `remove_source` | `{ id }` | — (root only: candidates stay, detached — `sourceId` null; games untouched) |
| `scan_source` | `{ id }` | `ScanSummary` (async; emits progress events) |
| `list_candidates` | `{ status? }` | `Candidate[]` |
| `approve_candidate` | `{ id, patch?: { title?, executable?, args?, workDir? } }` | `Game` |
| `reject_candidate` | `{ id }` | — |
| `list_games` | — | `Game[]` |
| `get_game` | `{ id }` | `Game` |
| `update_game` | `{ id, patch }` | `Game` (patch = subset of editable fields) |
| `remove_game` | `{ id }` | — (removes from library with its play history; never touches files) |
| `launch_game` | `{ id }` | `LaunchInfo` (native + `windows` via system wine; `retro`/`mod` → `UNSUPPORTED`) |
| `list_sessions` | `{ gameId, limit? }` | `Session[]` (newest first) |
| `get_settings` | — | `Settings` |
| `update_settings` | `{ patch }` | `Settings` |

Editable `update_game` fields: `title`, `sortTitle`, `type`, `executable`,
`args`, `env`, `workDir`, `tags`, `favorite`, `hidden`, `notes`, `coverPath`.

Patch semantics: an omitted field keeps its stored value; an explicit `null`
clears the nullable fields (`sortTitle`, `workDir`, `notes`, `coverPath`).
Empty `title`/`executable` are rejected with `VALIDATION`.

`update_settings` patch semantics: every field is optional; an omitted field
keeps its stored value. `font`/`accent` are trimmed and must be 1–32 chars of
`[a-z0-9-]` (else `VALIDATION`); unknown-but-valid ids are accepted — the UI
falls back to its defaults (`maple-mono`, `jade`). A config file that predates
these fields loads them as defaults. Persisted settings now also carry:
`autoCovers` (bool, default `true` — covers fetched on approve), `modsLenient`
(bool, default `true` — lenient mod archive validation), `modsMaxMb`
(integer, default `1024`), `useGameMode` (bool, default `true` — wraps
launches with `gamemoderun` when available), `useMangoHud` (bool, default
`false` — injects `MANGOHUD=1`), `bigPictureLayout` (`"auto" | "xbox" |
"playstation"`, default `"auto"`).

## Events (Rust → UI)

| Event | Payload |
|---|---|
| `scan-progress` | `{ sourceId, current: string \| null, candidatesSoFar: number }` |
| `scan-finished` | `{ sourceId, candidatesFound: number, durationMs: number }` |
| `session-started` | `{ sessionId, gameId, startedAt }` |
| `session-ended` | `{ sessionId, gameId, durationSeconds, exitCode: number \| null }` |
| `library-changed` | `{}` — UI invalidates its queries |
| `gamepad-event` | `{ kind: "button-press" \| "button-release" \| "axis", pad: number, name: string \| null, code: string }` — Big Picture navigation |

## Plugins & capabilities

- `tauri-plugin-dialog` (Rust) — UI uses `@tauri-apps/plugin-dialog`
  `open({ directory: true })` to pick scan roots. Capability must allow
  `dialog:allow-open`.
- `tauri-plugin-opener` (already in template) — UI uses `revealItemInDir` for
  "show in file manager". Capability must allow `opener:allow-reveal-item-in-dir`.
- Big Picture toggles fullscreen from the UI — capability must allow
  `window:allow-set-fullscreen`.
- `gilrs` (Rust, not a Tauri plugin) — gamepad thread + `gamepad-event`.

## Tray and window behavior (M1)

- Tray icon always present; menu: **Show Zen Launcher** (show + focus),
  **Quit** (exit process).
- Window close button hides to tray when `settings.closeToTray` (default true);
  tray Quit is the real exit.
- On `launch_game` with `settings.hideOnLaunch` (default true) the window hides
  immediately; the session keeps running in the background.

## First-run onboarding

- The UI shows the wizard while `settings.onboardingCompleted` is false;
  finishing or skipping sets it to true. The wizard is re-runnable from
  Settings.
- Wizard choices persist through `update_settings`: `language`, `font`,
  `accent`, `closeToTray`, `hideOnLaunch`.
- Default library view (grid/list) stays UI-local (existing persisted layout
  store) — not part of the IPC contract.
- Default UI font is `maple-mono`; display headings are Space Grotesk. Light
  theme is deferred; accents are dark-theme presets.

## Launch rules (M1)

- `native`: `.sh` through `sh`; `.AppImage` exec bit ensured; otherwise direct
  exec (exec bit required, else `LAUNCH_FAILED`).
- `windows`: system `wine` with a per-game prefix at
  `~/.local/share/zen-launcher/prefixes/<gameId>`; `.bat`/`.cmd` entry points
  run through `wine cmd /c`. `WINEPREFIX` / `WINEDLLOVERRIDES`
  (`mscoree,mshtml=` by default) can be overridden per game via `env`.
- Wine prefixes are also prepared in the background (`wineboot -u`,
  best-effort) at app start for every Windows game and right after a Windows
  game is approved; `launch_game` does not depend on it — a still-running
  setup only means Wine waits for the prefix lock on the first Play.
- `retro` / `mod` → `UNSUPPORTED` (their runners arrive in later milestones).
- Session environment extras (settings-driven, best-effort): when `useGameMode`
  is set and `gamemoderun` is on PATH the launch command is wrapped with it;
  when `useMangoHud` is set the launch env gains `MANGOHUD=1` +
  `MANGOHUD_DLSYM=1` (overlay for Vulkan/DXVK/GL). No per-game overrides yet.
- Default cwd = the executable's directory (`workDir` overrides). Session
  supervision tracks the direct child; launchers that exit immediately end the
  session early (known limitation).

## Covers (artwork)

- `fetch_cover_candidates(query: string) -> CoverCandidate[]` — keyless Steam
  store search. `CoverCandidate = { provider: "steam", id: string, name:
  string, thumbUrl: string, portraitUrl: string | null, landscapeUrl: string |
  null }` (portrait = 600x900 library art, landscape = header 460x215; `null`
  when the app id has no store page). Search failures surface as `IO`.
- `download_cover(gameId, url) -> Game` — downloads a provider image
  (http/https only, 10 MB cap, raster image content types only), stores it as
  `<dataDir>/covers/cover-<gameId>-<unix>.<ext>`, sets `coverPath` to the
  stored file (replacing the previous cover file) and emits `library-changed`.
- `set_cover_from_file(gameId, sourcePath) -> Game` — copies a local raster
  image (`.png/.jpg/.jpeg/.webp`) into the covers dir with the same naming and
  sets `coverPath`; the source file is never touched.
- Rendering: covers reach the webview through the Tauri asset protocol with a
  scope limited to `<dataDir>/covers/**`. File names are unique per write, so
  no cache busting is needed.

## Mods (loaders & installs)

- `mods_status(gameId) -> ModsStatus`:
  `{ loader: "bepinex" | "melonloader" | "doorstop" | "none", modsDir: string |
  null, modsDirKind: "bepinex-plugins" | "mods" | "none", engine: "unity-mono"
  | "unity-il2cpp" | "unknown", supported: boolean, suggestedLoader: string |
  null, loaders: { id: string, name: string, engines: string[] }[], installed:
  string[] }`.
  - Detection: `BepInEx/` → `bepinex`; `MelonLoader/` → `melonloader`;
    `doorstop_config.ini` or `winhttp.dll` / `version.dll` at the game root →
    `doorstop` (community loaders, e.g. NeoModLoader); otherwise `none`.
  - `modsDir`: `BepInEx/plugins` for bepinex; otherwise the first of `Mods/`,
    `MelonLoader/Mods`, `mods/` that exists; `null` when none.
  - `installed`: top-level entries of `modsDir` (cap 50), for the drop zone.
  - Engine: `*_Data/il2cpp_data` or `GameAssembly.dll` → `unity-il2cpp`;
    `MonoBleedingEdge/` or `*_Data/Managed/` → `unity-mono`.
  - `supported`: `engine` is a known Unity flavor AND the catalog has a
    matching loader. For `engine: "unknown"` it is `false` — the UI shows
    "this game has no known mod support".
  - `loaders`: catalog entries matching the game's engine, ranked by
    popularity: `bepinex5` (BepInEx 5, mono, stable), `bepinex6mono`
    (BepInEx 6 mono), `bepinex6il2cpp` (BepInEx 6 IL2CPP), `melonloader`
    (MelonLoader, mono + IL2CPP). `suggestedLoader` = the top-ranked entry
    (`bepinex5` for Unity Mono, `melonloader` for Unity IL2CPP).
- `install_mod_loader(gameId, loaderId?) -> ModsStatus` — `loaderId` picks a
  catalog entry (`null`/omitted → `suggestedLoader`). Source assets from
  GitHub: BepInEx 5 from `releases/latest` (`BepInEx_win_x64_*.zip`),
  MelonLoader from `releases/latest` (`MelonLoader.x64.zip`), BepInEx 6
  entries from the newest release whose assets contain
  `BepInEx-Unity.Mono-win-x64-*.zip` / `BepInEx-Unity.IL2CPP-win-x64-*.zip`.
  The archive is extracted into the game folder (traversal-safe paths only)
  and `BepInEx/plugins` is ensured for BepInEx entries. `VALIDATION` when a
  loader is already installed, the engine is unsupported (`unknown` → "no mod
  support"), the game type is not `windows`, or the id is unknown; nothing is
  written on failure.
- `install_mod_archive(gameId, archivePath) -> ModInstallResult` —
  `{ installed: string[], modsDir: string, trashed: boolean }`. Validation
  follows the settings: `modsLenient: false` (strict) accepts only
  `.zip/.7z/.rar` and refuses symlinked entries with `VALIDATION`;
  `modsLenient: true` (default) accepts any extension `7z` can list, **skips**
  symlinked entries with a logged warning, and the size cap is
  `modsMaxMb` (default 1024 MB). Absolute paths and `..` traversal are
  always refused, `__MACOSX` noise is skipped, extraction goes into `modsDir`
  (archives carrying a nested top folder keep it), `VALIDATION` when no mods
  dir exists yet. After a successful extraction the archive is moved to the
  system trash (`trash` crate, XDG spec); if trashing fails the archive stays
  put and `trashed` is `false` — files are never deleted outright.

## Covers auto-install (settings-driven)

- On `approve_candidate` when `settings.autoCovers` is `true`, a background
  thread runs the same Steam title search used by `fetch_cover_candidates`;
  the top `app` result's portrait is downloaded with the same caps/validation
  and set as `coverPath` (best-effort — failures are logged and leave the
  cover empty); `library-changed` notifies the UI either way.

## Gamepad & Big Picture

- The Rust core runs a `gilrs` polling thread and emits `gamepad-event` on
  the event bus (shape above). Button codes are gilrs `GamepadButtonType`
  ids (`South`, `North`, `East`, `West`, `DPadUp`, `Start`, `Select`, ...).
- Analog sticks are reduced in the core to synthetic 4-way axis events
  (`code: "AxisLeft" | "AxisRight" | "AxisUp" | "AxisDown"`) with a 120 ms
  held-repeat cadence, so menu navigation feels console-like without the
  webview drowning in raw axis samples.
- `list_gamepads() -> { pads: { id: number, name: string, kind: "xbox" |
  "playstation" | "unknown" }[] }`; kind inferred from the device name
  ("Xbox" → xbox; "DualShock"/"DualSense"/"PlayStation" → playstation).
  The UI applies `settings.bigPictureLayout` (`auto` → detected kind, else
  `xbox` / `playstation` glyph theme for face buttons).
- Big Picture is a UI route on the main window; fullscreen is toggled from
  the webview via `window:allow-set-fullscreen`; `Escape`/`Start` exits.


## Scanner heuristics (M1 minimum)

- Walk each source root recursively; skip already-approved game folders.
- Detect engines with file signatures, e.g.:
  - Unity: `*_Data/` directory + `UnityPlayer.so` (or `UnityPlayer.dll`)
  - Godot: `*.pck` next to an executable
  - Unreal: `*/Binaries/Linux/` or `Engine/` directory
  - GameMaker / Ren'Py: known file patterns (`*.yyp`, `renpy/`)
- Generic fallback: executable bit + ELF magic, `.exe` (Windows builds such as
  Electron games), `.sh`, `.AppImage`. Native ELF wins over `.exe` when both
  are present; Windows `.exe` runs through Wine on approval.
- Windows batch launchers: `.bat` files in generic folders (`launcher.bat`
  preferred over other names).
- `.exe` choice: folder-name match first, then shorter name, then alphabetical
  (shared with the ELF rule); `UnityPlayer*.exe` never wins.
- Ignore pitfalls: `*setup*`, `*redist*`, `unins*`, `crash*`, `_CommonRedist`,
  `DirectX`, `dotnet`, `vc_redist`, `support/`, `docs/`.
- Candidate = deepest folder that contains a plausible primary executable.
- `confidence` from weighted evidence; `suggestedTitle` = cleaned folder name.
- Fixture trees for tests live in `src-tauri/tests/fixtures/`.

## Storage paths (M1)

- Config: `~/.config/zen-launcher/config.toml` (settings; human-editable).
- Data: `~/.local/share/zen-launcher/` — `library.db`, `logs/`.
  (`images/`, `saves/`, `mods/` arrive in later milestones.)
- SQLite: WAL mode, foreign keys on, versioned migrations table
  `schema_migrations`.

## DB schema (migration v1)

```sql
sources(id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, auto_scan INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, last_scan_at TEXT);
candidates(id INTEGER PRIMARY KEY, source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
           path TEXT NOT NULL, executable TEXT, engine TEXT NOT NULL DEFAULT 'unknown',
           suggested_title TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0,
           evidence_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
           created_at TEXT NOT NULL);
games(id INTEGER PRIMARY KEY, title TEXT NOT NULL, sort_title TEXT, type TEXT NOT NULL DEFAULT 'native',
      install_path TEXT NOT NULL, executable TEXT NOT NULL, args_json TEXT NOT NULL DEFAULT '[]',
      env_json TEXT NOT NULL DEFAULT '{}', work_dir TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
      favorite INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, notes TEXT,
      cover_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      last_played_at TEXT, total_seconds INTEGER NOT NULL DEFAULT 0);
sessions(id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
         started_at TEXT NOT NULL, ended_at TEXT, duration_seconds INTEGER, exit_code INTEGER);
schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
```

## M1 exclusions (do not fake these)

Wine/Proton/RetroArch launching, metadata providers, artwork pipeline, mods,
saves, gamepad, Big Picture, `.desktop` shortcuts, auto-scan watcher,
export/import — all later milestones. UI hides or disables what does not work;
no placeholder buttons.
