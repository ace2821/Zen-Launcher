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
