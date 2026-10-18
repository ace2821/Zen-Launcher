import { createTauriApi } from "./ipc";
import { createMockApi, type MockApi } from "./mock";
import type {
  Candidate,
  CandidatePatch,
  CandidateStatus,
  CoverCandidate,
  EventMap,
  EventName,
  Game,
  GamePatch,
  LaunchInfo,
  ModInstallResult,
  ModsStatus,
  ScanSummary,
  Session,
  Settings,
  SettingsPatch,
  Source,
  UnlistenFn,
} from "./types";

export type ApiKind = "tauri" | "mock";

/** One entry of the native file dialog's filter menu. */
export interface FileFilter {
  /** Shown verbatim by the dialog — localized by the caller, never here. */
  name: string;
  /** Extensions without the dot, e.g. `["png", "jpg"]`. */
  extensions: string[];
}

export interface FilePickerOptions {
  title?: string;
  filters?: FileFilter[];
}

/**
 * The single surface the UI talks to. `ipc.ts` implements it against Tauri,
 * `mock/` implements it in memory. Views never import `@tauri-apps/*` directly —
 * everything crossing the process boundary goes through this interface.
 */
export interface LauncherApi {
  readonly kind: ApiKind;

  listSources(): Promise<Source[]>;
  addSource(path: string): Promise<Source>;
  removeSource(id: number): Promise<void>;
  scanSource(id: number): Promise<ScanSummary>;

  listCandidates(status?: CandidateStatus): Promise<Candidate[]>;
  approveCandidate(id: number, patch?: CandidatePatch): Promise<Game>;
  rejectCandidate(id: number): Promise<void>;

  listGames(): Promise<Game[]>;
  getGame(id: number): Promise<Game>;
  updateGame(id: number, patch: GamePatch): Promise<Game>;
  removeGame(id: number): Promise<void>;
  launchGame(id: number): Promise<LaunchInfo>;
  listSessions(gameId: number, limit?: number): Promise<Session[]>;

  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;

  /* -------------------------------------------------------------- artwork */

  /** Keyless Steam store search; an empty query returns no candidates. */
  fetchCoverCandidates(query: string): Promise<CoverCandidate[]>;
  /** Downloads provider artwork, stores it and points `coverPath` at it. */
  downloadCover(gameId: number, url: string): Promise<Game>;
  /** Copies a local raster image in as the cover. The source file is not touched. */
  setCoverFromFile(gameId: number, sourcePath: string): Promise<Game>;

  /* ----------------------------------------------------------------- mods */

  /** Detection only: it reads the game folder, it never writes to it. */
  modsStatus(gameId: number): Promise<ModsStatus>;
  /** Downloads and extracts a loader into the game folder. */
  installModLoader(gameId: number): Promise<ModsStatus>;
  /** Extracts one mod archive into the mods folder and trashes the archive. */
  installModArchive(gameId: number, archivePath: string): Promise<ModInstallResult>;

  /** `tauri-plugin-dialog` `open({ directory: true })`, or a canned path in mock mode. */
  pickDirectory(options?: { title?: string }): Promise<string | null>;
  /** The same dialog for files, e.g. a cover image. */
  pickFile(options?: FilePickerOptions): Promise<string | null>;
  /** `tauri-plugin-opener` `revealItemInDir`; the UI hides the action in mock mode. */
  revealItemInDir(path: string): Promise<void>;

  on<K extends EventName>(
    event: K,
    handler: (payload: EventMap[K]) => void,
  ): Promise<UnlistenFn>;
}

/** The mock adapter adds harness-only helpers (state reset, simulated timing). */
export function isMockApi(api: LauncherApi): api is MockApi {
  return api.kind === "mock";
}

/** Tauri v2 injects this object into the webview before the app script runs. */
export function isTauriAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ !== "undefined"
  );
}

export function resolveApiKind(): ApiKind {
  if (import.meta.env.VITE_MOCK === "1") return "mock";
  return isTauriAvailable() ? "tauri" : "mock";
}

/**
 * Selected once per page load: explicit `VITE_MOCK=1`, otherwise real IPC when
 * Tauri internals are present, otherwise the in-memory adapter so that
 * `bun run dev` and the test suite run in a plain browser.
 */
export const api: LauncherApi =
  resolveApiKind() === "mock" ? createMockApi() : createTauriApi();

export const isMock = api.kind === "mock";
