# Zinc Launcher — Interface Contract (M1)

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
  language: "en" | "pl" | "fr" | "ru" | "de" | "fi" | "tr";
  closeToTray: boolean;         // default true
  hideOnLaunch: boolean;        // default true
  font: string;                 // UI font id; default "maple-mono"; "custom" → customFont
  customFont: string | null;    // CSS font-family name when font === "custom"; default null
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

interface GamePlaytime {
  gameId: number;
  gameName: string;
  total_sec: number;         // finished sessions only
  last_played: string | null; // newest sessions.endedAt, null when never finished
}

interface PlaytimeStats {
  total_hours: number;       // sum of all total_sec, rounded to 2 decimals
  games: GamePlaytime[];     // whole library, total_sec descending
}

interface PlaytimeTotal {
  total_sec: number;
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
| `get_playtime_stats` | — | `PlaytimeStats` (playtime per game, descending) |
| `get_playtime` | `{ gameId }` | `PlaytimeTotal` (unknown id → `NOT_FOUND`) |
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
| `app://navigate` | `{ page: string }` — open a page from a `zinclaucher://page/<name>` deep link; unknown pages are ignored |

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

- Tray icon always present; menu: **Show Zinc Launcher** (show + focus),
  **Quit** (exit process).
- Tray icon is best-effort: on runtimes without libappindicator the app starts
  without a tray entry.
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
  `~/.local/share/zinc-launcher/prefixes/<gameId>`; `.bat`/`.cmd` entry points
  run through `wine cmd /c`. `WINEPREFIX` / `WINEDLLOVERRIDES`
  (`mscoree,mshtml=` by default) can be overridden per game via `env`.
  Loader proxy DLLs found next to the executable **or in the game root**
  (`winhttp.dll` for BepInEx/doorstop, `dinput8.dll`/`version.dll`/
  `vorbisFile.dll`/`d3d9.dll` for ASI loaders) are merged into
  `WINEDLLOVERRIDES` as `<name>=n,b` — without that Wine keeps its builtin DLL
  and installed mods never load. Scanning the root as well covers games whose
  entry point sits in `bin/`/`x64/` while the loader lives at the root. The
  generated entries form their own `;`-separated Wine override groups
  (`mscoree,mshtml=;winhttp=n,b`); a comma only groups DLL names that share
  one setting, so joining new entries with a comma silently disables them.
  The default `mscoree,mshtml=` and any per-game entries are preserved.
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

## Playtime / Stats

- `launch_game` inserts a `sessions` row (`started_at`, `ended_at` NULL); the
  supervisor waits for the child and on exit calls `finish_session`
  (`ended_at`, `duration_seconds`, `exit_code`) and adds the duration to
  `games.total_seconds` / `last_played_at`.
- Only sessions with a non-NULL `duration_seconds` count towards playtime, so a
  still-running game never inflates the numbers.
- If the launcher died while a game was running, `ended_at` stays NULL. On the
  next start the core stamps `ended_at = now` for every open session but leaves
  the duration NULL (the real stop time is unknown — never guessed, so it is
  excluded from totals).
- `get_playtime_stats() -> { total_hours, games }`: `games` lists the whole
  library ordered by `total_sec` descending, then title (case-insensitive);
  unplayed entries report `total_sec: 0`, `last_played: null`. `total_hours`
  is the sum of all `total_sec` divided by 3600, rounded to 2 decimals.
- `get_playtime({ gameId }) -> { total_sec }`; a game removed from the library
  no longer exists → `NOT_FOUND`. Its sessions are removed with it (FK cascade).
- `session-ended` and `library-changed` are emitted when a game exits, so the
  Statistics tab refreshes without polling.

## Covers (artwork)

- `fetch_cover_candidates(query: string) -> CoverCandidate[]` — keyless Steam
  store search. `CoverCandidate = { provider: "steam", id: string, name:
  string, thumbUrl: string, portraitUrl: string | null, landscapeUrl: string |
  null, heroUrl?: string | null }` (portrait = 600x900 library art, landscape
  = header 460x215, hero = wide Big Picture `library_hero.jpg`; `null` when the
  app id has no such asset). Search failures surface as `IO`.
- `download_cover(gameId, url, variant?: "library" | "bigPicture") -> Game` —
  downloads a provider image (http/https only, 10 MB cap, raster image content
  types only), stores it as `<dataDir>/covers/<prefix>-<gameId>-<unix>.<ext>`
  and sets `coverPath` to the stored file, emitting `library-changed`.
  `variant` defaults to `"library"` (prefix `cover-`); `"bigPicture"` stores
  wide hero art under `hero-<gameId>-…` so it never prunes the poster cover.
  The app has **no separate Big Picture artwork column** — Big Picture renders
  `coverPath` as its background — so both variants update `coverPath`.
  Files are pruned only within the same variant.
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
  `installLoader` is non-null only when Zinc installed the loader itself (read
  from `<dataDir>/games/<gameId>/loader.json`); detected/manual loaders and
  `none` leave it `null`.
  - Detection (first match): `BepInEx/` → `bepinex`; `MelonLoader/` →
    `melonloader`; `worldbox_Data/StreamingAssets/mods/NeoModLoader.dll` (or
    `…/mods/NML/NeoModLoader.dll`, the Workshop layout) → `neomodloader`;
    `MSCLoader.dll` at the root → `mscloader`;
    `tModLoader.exe` → `tmodloader`; `cleo_redux.asi` → `cleoredux`;
    `cleo.asi` → `cleo`; `ScriptHookV.dll` → `scripthook-v`;
    `ScriptHookIV.asi`/`ScriptHookIV.dll` → `scripthook-iv`; `ModData/` →
    `frosty-moddata` (Frosty); `doorstop_config.ini` or `winhttp.dll` /
    `version.dll` at the root → `doorstop`; otherwise `none`. Name matching
    for third-party files is case-insensitive (stays correct on
    case-sensitive filesystems).
  - `modsDir`: `BepInEx/plugins` for bepinex; `MelonLoader/Mods` for
    melonloader; **`worldbox_Data/StreamingAssets/mods` for neomodloader**
    (both `NeoModLoader.dll` and user mods live there; `worldbox_Data`,
    `StreamingAssets` and `mods` are resolved case-insensitively). When that
    folder is absent and a populated legacy `Mods/` at the game root exists,
    the legacy folder is used as a fallback. `Mod/` (or an existing `Mods/`)
    for mscloader — the canonical `Mod/` is reported even before it exists;
    `CLEO/` for cleo/cleoredux; `ModData/` for frosty-moddata; the game root
    itself for `scripthook-v`/`scripthook-iv` (`asi-root` — ASI mods drop
    beside the DLL); `null` + kind `external` for tmodloader (mods live in
    tModLoader's own profile folder and are managed from inside the game);
    otherwise the first of `Mods/`, `MelonLoader/Mods`, `mods/` that exists;
    `null` when none. Loader-owned folders are reported even when empty so
    `install_*` can create them on demand. `installed` lists top-level entries
    of this folder (so `NeoModLoader.dll` is listed alongside user mods).
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
  FrostyToolsuite fork. Archives are extracted into the game folder
  (traversal-safe paths only); a bare-assembly asset (`NeoModLoader.dll`) is
  written straight into `worldbox_Data/StreamingAssets/mods` instead of being
  fed to the zip reader. NeoModLoader is then loaded by WorldBox's own built-in
  mod loader (experimental mode) — it does **not** need a doorstop/winhttp
  proxy. The loader's mods folder is ensured (`BepInEx/plugins`,
  `MelonLoader/Mods`, `worldbox_Data/StreamingAssets/mods`, `Mod/`, `CLEO/`,
  `ModData/`); for NeoModLoader that same StreamingAssets folder is the user
  mods drop target. `worldbox_Data` / `WorldBox_Data` and
  `StreamingAssets/mods` casing are matched case-insensitively. `VALIDATION` when an incompatible
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
  by Zinc, the recorded loader is `install: "manual"`, `loader = "none"`, or the
  state file is missing/corrupt. A lookup failure surfaces as `IO` (retryable).
- `install_mod_archive(gameId, archivePath) -> ModInstallResult` —
  `{ installed: string[], modsDir: string, trashed: boolean }`. Validation
  follows the settings: `modsLenient: false` (strict) accepts only
  `.zip/.7z/.rar` and refuses symlinked entries with `VALIDATION`;
  `modsLenient: true` (default) accepts any extension `7z` can list, **skips**
  symlinked entries with a logged warning, and the size cap is
  `modsMaxMb` (default 1024 MB). Absolute paths and `..` traversal are
  always refused, `__MACOSX` noise is skipped, extraction goes into `modsDir`
  (archives carrying a nested top folder keep it); a NeoModLoader archive that
  ships `mod.json` at its root is wrapped into a per-mod folder
  (`modsDir/<archive-stem>/`), because NML treats the folder holding `mod.json`
  as the mod; `VALIDATION` when no
  mods dir exists yet. After a successful extraction the archive is moved to
  the system trash (`trash` crate, XDG spec); if trashing fails the archive
  stays put and `trashed` is `false` — files are never deleted outright.
- `install_mod_file(gameId, filePath) -> ModInstallResult` — single-file mods
  (`.dll`/`.asi`). Validation: regular file (symlinks refused), only
  `.dll`/`.asi`, at most 64 MB, and the game's loader must be present
  (`VALIDATION` with a UI-readable message: "install Script Hook V first" for
  GTA V, Script Hook IV for GTA IV, CLEO/ASI Loader for GTA classics, a mod
  loader for Unity games). The file is copied (not moved) into the same
  `modsDir` `mods_status` reports — `BepInEx/plugins`, `MelonLoader/Mods`,
  `worldbox_Data/StreamingAssets/mods` for neomodloader, `Mod/`, `CLEO/`,
  `ModData/`, or the game root for `scripthook-v`/`-iv` — and appears in
  `mods_status().installed` (the filesystem is the source of truth; there is
  no separate mods table). `VALIDATION` for `tmodloader` (external profile
  folder) and games without a mods folder. `trashed` is always `false` (the
  source download is kept).
- `uninstall_mod_file(gameId, name)` — removes one installed single-file mod.
  `name` must be a bare file name inside `modsDir` (absolute paths, `..` and
  separators are refused with `VALIDATION`); the file is moved to the system
  trash, never deleted outright.

## Marketplace & Conflicts

### Online catalogue

`GET https://raw.githubusercontent.com/ace2821/zinc-marketplace/main/catalog.json`
returns the static catalogue (`schemaVersion` must be `1`; any other version is
rejected with `VALIDATION`):

```ts
interface CatalogItem {
  id: string;
  type: "theme" | "addon";
  name: string;
  author: string;
  description: string;
  version: string;
  minLauncherVersion: string;   // light semver check against the running build
  installUrl: string;           // http(s) payload: ZIP archive or single file
  sha256: string;               // lowercase hex, verified before install
  previewUrl: string | null;
  games?: string[] | null;      // optional game scoping, null = any game
}
```

### IPC

| Command | Input | Output |
|---|---|---|
| `marketplace_list` | — | `MarketplaceList` — `{ items: CatalogItem[], stale: boolean }` |
| `marketplace_install` | `{ itemId }` | `InstalledAddon` — `{ id, name, version }` |
| `marketplace_uninstall` | `{ itemId }` | — |
| `marketplace_set_active_theme` | `{ id: string \| null }` | `string \| null` (CSS path; `null` = reset to the default look) |
| `detect_conflicts` | `{ gameId }` | `ConflictReport` — `{ gameId, conflicts: { addonOrModA, addonOrModB, files: string[] }[] }` |

- `marketplace_list` caches the catalogue for one hour in
  `<dataDir>/addons/catalog-cache.json`. A fresh cache never hits the network.
  When the network fails the cached list is returned with `stale: true`
  (`CacheStale`); with no cache at all the command fails with `IO`.
- `marketplace_install` looks the item up in the (cached) catalogue, rejects
  `minLauncherVersion` newer than the running build and a SHA-256 mismatch with
  `VALIDATION`, then installs into `<dataDir>/addons/<id>/` with a
  `manifest.json` (`{ id, name, version, type, entry, files }`). Nothing is
  written when verification fails. A ZIP payload is extracted traversal-safe;
  a single-file payload is stored as-is (themes must carry a `.css`).
- `marketplace_set_active_theme` records the active theme id in the database
  (`app_settings`, migration v3) and returns the CSS file path for the UI to
  inject; `null` clears the selection. Uninstalling the active theme clears it
  too.
- `detect_conflicts` uses the same mods directory as `mods_status` (loader
  aware; no loader → the first of `Mods/`, `MelonLoader/Mods`, `mods/`). Each
  top-level entry is one mod; two mods conflict when they contain a file at the
  same relative path inside that folder. All conflicting pairs are reported
  (`n` mods sharing a path → `n·(n-1)/2` rows), each with the sorted shared
  paths. A game without a mods folder reports no conflicts.

## Deep Link

`zinclaucher://` is registered as a URL scheme (`MimeType
x-scheme-handler/zinclaucher` in `io.github.ace2821.ZincLauncher.desktop`, plus
`plugins.deep-link.desktop.schemes` in `tauri.conf.json`).

| URL | Action |
|---|---|
| `zinclaucher://install?id=<itemId>` | Run the regular `marketplace_install` flow for that catalogue item |
| `zinclaucher://page/<name>` | Ask the UI to open a page (`app://navigate` event) |

- The browser hands `zinclaucher://install?id=...` to the OS handler; Zinc
  Launcher parses it, validates the id with the same rules as
  `marketplace_install` (invalid/missing id → `VALIDATION`, ignored with a log
  line) and starts the install in the background.
- Before installing it emits `marketplace://install-started` with
  `{ itemId }`, so the UI can show the install state. When the flow ends it
  emits `marketplace://install-finished` with
  `{ itemId, ok: true, item: InstalledAddon }` or
  `{ itemId, ok: false, error: { code, message } }`.
- Deep links from the launch arguments are handled at startup; later URLs are
  delivered through the plugin's `on_open_url` callback.
- Flatpak uses the same desktop file installed into
  `${FLATPAK_DEST}/share/applications/`; no extra `finish-args` are required.

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

- Config: `~/.config/zinc-launcher/config.toml` (settings; human-editable).
- Data: `~/.local/share/zinc-launcher/` — `library.db`, `logs/`.
  Marketplaces installs live in `addons/<id>/` (see §"Marketplace & Conflicts");
  `images/`, `saves/`, `mods/` arrive in later milestones.)
- SQLite: WAL mode, foreign keys on, versioned migrations table
  `schema_migrations`.

## DB schema (migrations v1 → v3)

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
  JSON; `NULL` means no client.
- v3: `app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)` — app-level
  key/value state that is not user-editable (e.g. the active marketplace
  theme). `SCHEMA_VERSION = 3`.

## Per-game state

- `<dataDir>/games/<gameId>/` holds per-game state written by the core.
  `loader.json` = `{ loaderId, version }` after a successful
  `install_mod_loader` (never written for manual/detected loaders).

## M1 exclusions (do not fake these)

Wine/Proton/RetroArch launching, metadata providers, artwork pipeline, mods,
saves, gamepad, Big Picture, `.desktop` shortcuts, auto-scan watcher,
export/import — all later milestones. UI hides or disables what does not work;
no placeholder buttons.
