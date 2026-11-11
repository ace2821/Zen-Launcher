import { createTauriApi } from "./ipc";
import { createMockApi, type MockApi } from "./mock";
import type {
  Candidate,
  CandidatePatch,
  CandidateStatus,
  CoverCandidate,
  CoverVariant,
  DetectConflictsResult,
  EventMap,
  EventName,
  Game,
  GamePatch,
  GamepadList,
  LaunchInfo,
  MarketplaceInstallResult,
  MarketplaceList,
  ModInstallResult,
  ModsStatus,
  LoaderUpdate,
  PlaytimeStats,
  PlaytimeTotal,
  RuntimeAvailableDownload,
  RuntimeDownloadKind,
  RuntimeInfo,
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

  /* ------------------------------------------------------ playtime / stats */

  /** Finished playtime per game, `total_sec` descending (Statistics tab). */
  getPlaytimeStats(): Promise<PlaytimeStats>;
  /** Finished playtime of one game; unknown ids are rejected with `NOT_FOUND`. */
  getPlaytime(gameId: number): Promise<PlaytimeTotal>;

  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  /** Compatibility-tool runtimes discovered for the translation-layer picker. */
  listRuntimes(): Promise<RuntimeInfo[]>;
  /** Latest downloadable build per translation layer (network lookup). */
  runtimeAvailableDownloads(): Promise<RuntimeAvailableDownload[]>;
  /**
   * Starts a background download. Progress and completion arrive as
   * `runtime-download-progress` / `runtime-download-finished` events.
   */
  runtimeDownload(kind: RuntimeDownloadKind): Promise<void>;
  /** Stops the running download for `kind` and removes the partial archive. */
  runtimeCancelDownload(kind: RuntimeDownloadKind): Promise<void>;

  /* -------------------------------------------------------------- artwork */

  /** Keyless Steam store search; an empty query returns no candidates. */
  fetchCoverCandidates(query: string): Promise<CoverCandidate[]>;
  /**
   * Downloads provider artwork, stores it and points `coverPath` at it.
   * `variant` selects the slot: `"library"` (default, poster) or
   * `"bigPicture"` (wide hero art stored under a `hero-` prefix). Both share
   * the same covers directory and never prune each other; there is no separate
   * Big Picture DB field, so both end up in `coverPath`.
   */
  downloadCover(
    gameId: number,
    url: string,
    variant?: CoverVariant,
  ): Promise<Game>;
  /** Copies a local raster image in as the cover. The source file is not touched. */
  setCoverFromFile(gameId: number, sourcePath: string): Promise<Game>;

  /* ----------------------------------------------------------------- mods */

  /** Detection only: it reads the game folder, it never writes to it. */
  modsStatus(gameId: number): Promise<ModsStatus>;
  /**
   * Downloads and extracts a loader into the game folder. `loaderId` picks a
   * catalog entry from `ModsStatus.loaders`; omitting it installs the suggestion.
   */
  installModLoader(gameId: number, loaderId?: string): Promise<ModsStatus>;
  /** Extracts one mod archive into the mods folder and trashes the archive. */
  installModArchive(gameId: number, archivePath: string): Promise<ModInstallResult>;
  /**
   * Compares the loader Zinc installed for this game with the latest release.
   * `null` when there is nothing Zinc-installed to check (manual/detected loader).
   */
  checkLoaderUpdates(gameId: number): Promise<LoaderUpdate | null>;

  /* -------------------------------------------------------------- gamepad */

  /** Connected pads, used for the Big Picture glyph theme under `auto`. */
  listGamepads(): Promise<GamepadList>;

  /* ------------------------------------------------------------- marketplace */

  /** The catalog of installable themes and addons. `stale` true means the
   * catalog was served from cache / offline and may not reflect the server. */
  marketplace_list(): Promise<MarketplaceList>;

  /** Downloads and installs one catalog item. Returns what was installed. */
  marketplace_install(itemId: number): Promise<MarketplaceInstallResult>;

  /** Removes an installed item. */
  marketplace_uninstall(itemId: number): Promise<void>;

  /** Sets the active theme. `null` resets to no theme. */
  marketplace_set_active_theme(id: number | null): Promise<void>;

  /** Detects file conflicts between installed mods/addons for a game. */
  detect_conflicts(gameId: number): Promise<DetectConflictsResult>;

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

/**
 * Subscribes to `app://navigate`, which the core emits for deep links such as
 * `zinclaucher://marketplace`. The caller decides what each page name means.
 */
export function onNavigate(
  handler: (event: EventMap["app://navigate"]) => void,
): Promise<UnlistenFn> {
  return api.on("app://navigate", handler);
}
