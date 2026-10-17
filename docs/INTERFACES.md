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
these fields loads them as defaults.

## Events (Rust → UI)

| Event | Payload |
|---|---|
| `scan-progress` | `{ sourceId, current: string \| null, candidatesSoFar: number }` |
| `scan-finished` | `{ sourceId, candidatesFound: number, durationMs: number }` |
| `session-started` | `{ sessionId, gameId, startedAt }` |
| `session-ended` | `{ sessionId, gameId, durationSeconds, exitCode: number \| null }` |
| `library-changed` | `{}` — UI invalidates its queries |

## Plugins & capabilities

- `tauri-plugin-dialog` (Rust) — UI uses `@tauri-apps/plugin-dialog`
  `open({ directory: true })` to pick scan roots. Capability must allow
  `dialog:allow-open`.
- `tauri-plugin-opener` (already in template) — UI uses `revealItemInDir` for
  "show in file manager". Capability must allow `opener:allow-reveal-item-in-dir`.
- No other plugins in M1.

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
- Default UI font is `maple-mono`; display/serif headings stay Instrument
  Serif. Light theme is deferred; accents are dark-theme presets.

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
- Default cwd = the executable's directory (`workDir` overrides). Session
  supervision tracks the direct child; launchers that exit immediately end the
  session early (known limitation).

## Scanner heuristics (M1 minimum)

- Walk each source root recursively; skip already-approved game folders.
- Detect engines with file signatures, e.g.:
  - Unity: `*_Data/` directory + `UnityPlayer.so` (or `UnityPlayer.dll`)
  - Godot: `*.pck` next to an executable
  - Unreal: `*/Binaries/Linux/` or `Engine/` directory
  - GameMaker / Ren'Py: known file patterns (`*.yyp`, `renpy/`)
- Generic fallback: executable bit + ELF magic, `.sh`, `.AppImage`.
- Windows batch launchers: `.bat` files in generic folders (`launcher.bat`
  preferred over other names).
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
