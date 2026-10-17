import { createTauriApi } from "./ipc";
import { createMockApi, type MockApi } from "./mock";
import type {
  Candidate,
  CandidatePatch,
  CandidateStatus,
  EventMap,
  EventName,
  Game,
  GamePatch,
  LaunchInfo,
  ScanSummary,
  Session,
  Settings,
  SettingsPatch,
  Source,
  UnlistenFn,
} from "./types";

export type ApiKind = "tauri" | "mock";

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

  /** `tauri-plugin-dialog` `open({ directory: true })`, or a canned path in mock mode. */
  pickDirectory(options?: { title?: string }): Promise<string | null>;
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
