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
  client: ClientInfo | null;  // detected (or manually patched) multiplayer client
  status: "ready" | "missing"; // computed on read (executable exists?)
  createdAt: string;
  updatedAt: string;
  lastPlayedAt: string | null;
  totalSeconds: number;
}

/** Only these three client layouts are first-class — no `generic` variant. */
type ClientKind = "samp" | "fivem" | "mta";

interface ClientInfo {
  kind: ClientKind;
  host: string | null;  // SA-MP `-h`; ignored by FiveM/MTA
  port: number | null;  // SA-MP `-p`; out-of-range values deserialize as null
  nick: string | null;  // SA-MP `-n`
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
`args`, `env`, `workDir`, `tags`, `favorite`, `hidden`, `notes`, `coverPath`,
`client`.

Patch semantics: an omitted field keeps its stored value; an explicit `null`
clears the nullable fields (`sortTitle`, `workDir`, `notes`, `coverPath`,
`client`). For `client`, an omitted key differs from `null`: `null` clears the
detected/manual client, `{ kind, host?, port?, nick? }` replaces it. Empty
`title`/`executable` are rejected with `VALIDATION`. A `client.port` outside
`1..=65535` is stored as `null` (ignored with a warning) rather than rejecting
the patch.

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
- Client adapters (`game.client`): SA-MP (`kind: "samp"`) appends `-h <host>`,
  `-p <port>`, `-n <nick>` after the stored `args`, each only when present
  (`port` must be 1..=65535; invalid values are ignored, never a failed launch).
  FiveM (`fivem`) and MTA (`mta`) add no arguments — their launchers read their
  own config. Client detection (scanner): a folder carrying `FiveM.app/`,
  `CitizenFX.exe` or `FiveM.exe` → `fivem`; `Multi Theft Auto.exe` → `mta`; a
  GTA San Andreas root (`gta_sa.exe` or a "GTA San Andreas" folder name) that
  also carries `samp.exe` → `samp` (the base game stays the launch target).

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
  `{ loader: "bepinex" | "melonloader" | "neomodloader" | "mscloader" |
  "tmodloader" | "cleo" | "cleoredux" | "scripthook-v" | "scripthook-iv" |
  "frosty-moddata" | "doorstop" | "none", modsDir: string | null, modsDirKind:
  "bepinex-plugins" | "mods" | "asi-root" | "external" | "none", engine:
  "unity-mono" | "unity-il2cpp" | "gta-classic" | "gta-iv" | "gta-v" |
  "terraria" | "frostbite" | "unknown", supported: boolean, suggestedLoader:
  string | null, loaders: { id: string, name: string, engines: string[],
  install: "download" | "manual", docs: string | null }[], installed: string[],
  installLoader: { id: string, version: string } | null }`.
  `installLoader` is non-null only when Zen installed the loader itself (read
  from `<dataDir>/games/<gameId>/loader.json`); detected/manual loaders and
  `none` leave it `null`.
  - Detection (first match): `BepInEx/` → `bepinex`; `MelonLoader/` →
    `melonloader`; `worldbox_Data/StreamingAssets/mods/NeoModLoader.dll` →
    `neomodloader`; `MSCLoader.dll` at the root → `mscloader`;
    `tModLoader.exe` → `tmodloader`; `cleo_redux.asi` → `cleoredux`;
    `cleo.asi` → `cleo`; `ScriptHookV.dll` → `scripthook-v`;
    `ScriptHookIV.asi`/`ScriptHookIV.dll` → `scripthook-iv`; `ModData/` →
    `frosty-moddata` (Frosty); `doorstop_config.ini` or `winhttp.dll` /
    `version.dll` at the root → `doorstop`; otherwise `none`. Name matching
    for third-party files is case-insensitive (stays correct on
    case-sensitive filesystems).
  - `modsDir`: `BepInEx/plugins` for bepinex; `worldbox_Data/StreamingAssets/
    mods` for neomodloader; `Mod/` (or `Mods/`) for mscloader; `CLEO/` for
    cleo/cleoredux; `ModData/` for frosty-moddata; the game root itself for
    `scripthook-v`/`scripthook-iv` (`asi-root` — ASI mods drop beside the
    DLL); `null` + kind `external` for tmodloader (mods live in tModLoader's
    own profile folder and are managed from inside the game); otherwise the
    first of `Mods/`, `MelonLoader/Mods`, `mods/` that exists; `null` when
    none.
  - `installed`: top-level entries of `modsDir` (cap 50), for the drop zone.
  - Engine: `*_Data/il2cpp_data` or `GameAssembly.dll` → `unity-il2cpp`;
    `MonoBleedingEdge/` or `*_Data/Managed/` → `unity-mono`; `gta_sa.exe` /
    `gta-sa.exe` / `gta_sa_compact.exe` → `gta-classic`; `GTAIV.exe` /
    `PlayGTAIV.exe` → `gta-iv`; `GTA5.exe` / `PlayGTAV.exe` / `Grand Theft
    Auto V.exe` → `gta-v`; `Terraria.exe` → `terraria`; `ModData/` or an
    EA Sports FC / FIFA exe (`FC24-26.exe`, `FIFA20-23.exe`) → `frostbite`.
  - `supported`: `engine` matches catalog entries (AND the loader's root
    markers when it has any). For `engine: "unknown"` it is `false` — the
    UI shows "this game has no known mod support".
  - `loaders`: catalog entries matching the game's engine (and markers),
    ranked by popularity: `neomodloader` (NeoModLoader, WorldBox only —
    requires the `worldbox_Data` marker), `mscloader` (MSC Mod Loader, My
    Summer Car only), `bepinex5`, `melonloader`, `bepinex6mono`,
    `bepinex6il2cpp` (Unity era), `tmodloader` (Terraria), `cleo5`, `cleo4`,
    `cleoredux` (GTA classics), `scripthook-iv` (GTA IV), `scripthook-v`
    (GTA V), `frosty` (Frostbite — EA Sports FC 24/25; FC 26 unverified).
    `install` says whether the core downloads the loader (`download`) or the
    loader is installed by its own tooling (`manual`: Script Hook IV/V carry
    no redistributable download; MSC Mod Loader ships an installer — run it
    under Wine). `docs` links the manual loader's official page (`null` for
    download loaders except the informational ones). `suggestedLoader` =
    the top-ranked entry (`neomodloader` for WorldBox, `mscloader` for My
    Summer Car, `bepinex5` for plain Unity Mono, `melonloader` for Unity
    IL2CPP, `cleo5` for GTA classics, `tmodloader` for Terraria, `frosty`
    for Frostbite).
- `install_mod_loader(gameId, loaderId?) -> ModsStatus` — `loaderId` picks a
  catalog entry (`null`/omitted → `suggestedLoader`). Source assets from
  GitHub: BepInEx 5 from `releases/latest` (`BepInEx_win_x64_*.zip`),
  MelonLoader from `releases/latest` (`MelonLoader.x64.zip`), BepInEx 6
  entries from the newest release whose assets contain
  `BepInEx-Unity.Mono-win-x64-*.zip` / `BepInEx-Unity.IL2CPP-win-x64-*.zip`,
  NeoModLoader takes the `NeoModLoader.dll` asset (WorldBoxOpenMods/ModLoader),
  tModLoader takes `tModLoader*.zip`, CLEO 5 takes the
  `SA.CLEO-v*+Ultimate_ASI_Loader.zip` bundle, CLEO 4 takes `CLEO4.zip`
  (ships its own ASI loader), CLEO Redux takes the x86 portable archive and
  installs Ultimate ASI Loader (x86) when no ASI loader dll is present,
  Frosty takes the newest `Frosty.Mod.Manager.*.zip` from J-Lyt's
  FrostyToolsuite fork. The archive is extracted into the game folder
  (traversal-safe paths only) and the loader's mods folder is ensured
  (`BepInEx/plugins`, `MelonLoader/Mods`, `worldbox_Data/StreamingAssets/
  mods`, `Mod/`, `CLEO/`, `ModData/`). `VALIDATION` when an incompatible
  loader is already installed (co-installation is allowed only for CLEO
  Redux on top of `cleo` and Frosty on anything), the engine is unsupported,
  the loader is manual (`scripthook-iv/-v`, `mscloader` — install with the
  loader's own tooling), or the id is unknown; nothing is written on
  failure. A successful install records `{ loaderId, version }` in
  `<dataDir>/games/<gameId>/loader.json` (`version` = semver fragment of the
  GitHub release tag) and returns it as `installLoader`.
- `check_loader_updates(gameId) -> LoaderUpdate | null` —
  `LoaderUpdate = { loaderId: string, current: string, latest: string,
  assetUrl: string | null, updatable: boolean }`. Reads `loader.json`, looks up
  the newest matching release for that loader and extracts a light semver
  fragment from the release tag (e.g. `SA.CLEO-v1.2.3+…` → `1.2.3`).
  `updatable = latest != current`. Returns `null` when no loader was installed
  by Zen, the recorded loader is `install: "manual"`, `loader = "none"`, or the
  state file is missing/corrupt. A lookup failure surfaces as `IO` (retryable).
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
- Client markers (case-insensitive): `FiveM.app/` or `CitizenFX.exe`/`FiveM.exe`
  → `client.kind = "fivem"`; `Multi Theft Auto.exe` → `"mta"`; GTA San Andreas
  root (`gta_sa.exe` or "GTA San Andreas" folder) carrying `samp.exe` → `"samp"`
  with `gta_sa.exe` still the executable. The client is written to `Game.client`
  when the candidate is approved (manual `update_game` patches can override it).
- `confidence` from weighted evidence; `suggestedTitle` = cleaned folder name.
- Fixture trees for tests live in `src-tauri/tests/fixtures/`.

## Storage paths (M1)

- Config: `~/.config/zen-launcher/config.toml` (settings; human-editable).
- Data: `~/.local/share/zen-launcher/` — `library.db`, `logs/`.
  (`images/`, `saves/`, `mods/` arrive in later milestones.)
- SQLite: WAL mode, foreign keys on, versioned migrations table
  `schema_migrations`.

## DB schema (migrations v1 → v2)

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
      cover_path TEXT, client TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      last_played_at TEXT, total_seconds INTEGER NOT NULL DEFAULT 0);
sessions(id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
         started_at TEXT NOT NULL, ended_at TEXT, duration_seconds INTEGER, exit_code INTEGER);
schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
```

- v2: `ALTER TABLE games ADD COLUMN client TEXT NULL;` — `ClientInfo` encoded as
  JSON; `NULL` means no client. `SCHEMA_VERSION = 2`.

## Per-game state

- `<dataDir>/games/<gameId>/` holds per-game state written by the core.
  `loader.json` = `{ loaderId, version }` after a successful
  `install_mod_loader` (never written for manual/detected loaders).

## M1 exclusions (do not fake these)

Wine/Proton/RetroArch launching, metadata providers, artwork pipeline, mods,
saves, gamepad, Big Picture, `.desktop` shortcuts, auto-scan watcher,
export/import — all later milestones. UI hides or disables what does not work;
no placeholder buttons.
