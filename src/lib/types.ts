/**
 * Mirror of `docs/INTERFACES.md` (M1 contract) — keep 1:1.
 *
 * Conventions from the contract:
 * - JSON over IPC is `camelCase`.
 * - Timestamps are ISO-8601 UTC strings (`"2026-10-17T13:00:00Z"`).
 * - Ids are `i64` numbers; paths are absolute Unix paths.
 * - Options serialize as `null` (never `undefined` / omitted).
 */

export type GameType = "native" | "windows" | "retro" | "mod";

export type EngineKind =
  | "unity"
  | "godot"
  | "unreal"
  | "gamemaker"
  | "renpy"
  | "unknown";

export type CandidateStatus = "pending" | "approved" | "rejected";

/** Computed on read by the core: does the executable exist on disk? */
export type GameStatus = "ready" | "missing";

export type Language = "en" | "pl";

export interface Source {
  id: number;
  path: string;
  /** Applied in M2 (watcher); stored in M1. */
  autoScan: boolean;
  createdAt: string;
  lastScanAt: string | null;
}

export interface Candidate {
  id: number;
  /** Null once its scan root was removed; the row itself stays. */
  sourceId: number | null;
  /** Suggested game root folder. */
  path: string;
  executable: string | null;
  engine: EngineKind;
  suggestedTitle: string;
  /** 0.0–1.0 */
  confidence: number;
  /** e.g. ["UnityPlayer.so", "*_Data directory"] */
  evidence: string[];
  status: CandidateStatus;
  createdAt: string;
}

export interface Game {
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
  /** Local file path; metadata providers fill this in later milestones. */
  coverPath: string | null;
  status: GameStatus;
  createdAt: string;
  updatedAt: string;
  lastPlayedAt: string | null;
  totalSeconds: number;
}

export interface Session {
  id: number;
  gameId: number;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  exitCode: number | null;
}

export interface Settings {
  language: Language;
  /** Default true. */
  closeToTray: boolean;
  /** Default true. */
  hideOnLaunch: boolean;
  /**
   * UI/body font id. Default `"maple-mono"`. The core rejects anything outside
   * `[a-z0-9-]`, longer than 32 chars or empty; an id the UI does not know is
   * normalised to the default instead of being applied (see `lib/appearance.ts`).
   */
  font: string;
  /**
   * Accent preset id. Default `"jade"`; same normalisation rules as `font`.
   */
  accent: string;
  /** Default false: the first-run wizard has not been finished or skipped yet. */
  onboardingCompleted: boolean;
}

export interface ScanSummary {
  sourceId: number;
  candidatesFound: number;
  durationMs: number;
}

export interface LaunchInfo {
  sessionId: number;
}

/** Fields accepted by `approve_candidate`'s `patch`. */
export interface CandidatePatch {
  title?: string;
  executable?: string;
  args?: string[];
  workDir?: string;
}

/** Contract: subset of `title, sortTitle, type, executable, args, env, workDir, tags, favorite, hidden, notes, coverPath`. */
export interface GamePatch {
  title?: string;
  sortTitle?: string | null;
  type?: GameType;
  executable?: string;
  args?: string[];
  env?: Record<string, string>;
  workDir?: string | null;
  tags?: string[];
  favorite?: boolean;
  hidden?: boolean;
  notes?: string | null;
  coverPath?: string | null;
}

export interface SettingsPatch {
  language?: Language;
  closeToTray?: boolean;
  hideOnLaunch?: boolean;
  font?: string;
  accent?: string;
  onboardingCompleted?: boolean;
}

/* ---------------------------------------------------------------------------
 * Covers (artwork)
 * ------------------------------------------------------------------------- */

/** One Steam store search hit. */
export interface CoverCandidate {
  provider: "steam";
  /** Store app id, as a string. */
  id: string;
  name: string;
  /** Always present: the small capsule the store returns for every app. */
  thumbUrl: string;
  /** 600×900 library art — `null` when the app id has no store page. */
  portraitUrl: string | null;
  /** 460×215 header art — `null` when the app id has no store page. */
  landscapeUrl: string | null;
}

/* ---------------------------------------------------------------------------
 * Mods (loaders & installs)
 * ------------------------------------------------------------------------- */

export type ModLoader = "bepinex" | "melonloader" | "doorstop" | "none";
export type ModsDirKind = "bepinex-plugins" | "mods" | "none";
export type ModEngine = "unity-mono" | "unity-il2cpp" | "unknown";
export type SuggestedLoader = "bepinex5" | "melonloader";

export interface ModsStatus {
  loader: ModLoader;
  /** Absolute path — `null` when no mods folder exists yet. */
  modsDir: string | null;
  modsDirKind: ModsDirKind;
  engine: ModEngine;
  /** `null` when the engine is not a supported Unity flavour. */
  suggestedLoader: SuggestedLoader | null;
  /** Top-level entries of `modsDir`, capped at 50 by the core. */
  installed: string[];
}

export interface ModInstallResult {
  /** Entries the archive added to `modsDir`. */
  installed: string[];
  modsDir: string;
  /**
   * Whether the archive reached the system trash. `false` means it could not be
   * moved and is still where it was — nothing is ever deleted outright.
   */
  trashed: boolean;
}

/* ---------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------- */

/** Codes produced by the Rust core (`Result<T, AppError>`). */
export type AppErrorCode =
  | "NOT_FOUND"
  | "IO"
  | "DB"
  | "VALIDATION"
  | "LAUNCH_FAILED"
  | "UNSUPPORTED";

export interface AppError {
  code: AppErrorCode;
  message: string;
}

/* ---------------------------------------------------------------------------
 * Events (Rust → UI)
 * ------------------------------------------------------------------------- */

export interface ScanProgressEvent {
  sourceId: number;
  current: string | null;
  candidatesSoFar: number;
}

export interface SessionStartedEvent {
  sessionId: number;
  gameId: number;
  startedAt: string;
}

export interface SessionEndedEvent {
  sessionId: number;
  gameId: number;
  durationSeconds: number;
  exitCode: number | null;
}

export interface EventMap {
  "scan-progress": ScanProgressEvent;
  "scan-finished": ScanSummary;
  "session-started": SessionStartedEvent;
  "session-ended": SessionEndedEvent;
  "library-changed": Record<string, never>;
}

export type EventName = keyof EventMap;

export type UnlistenFn = () => void;
