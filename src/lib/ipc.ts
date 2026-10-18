import type { FilePickerOptions, LauncherApi } from "./api";
import { toUiError } from "./errors";
import { normalizeGamepadList } from "./gamepad";
import type {
  Candidate,
  CandidatePatch,
  CandidateStatus,
  CoverCandidate,
  EventMap,
  EventName,
  Game,
  GamePatch,
  GamepadList,
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

/**
 * Typed wrappers over `invoke` / event `listen`.
 *
 * The Tauri modules are imported lazily so that mock mode (and therefore a plain
 * browser or jsdom) never evaluates them. Every rejection is normalized to a
 * `UiAppError` here — the rest of the UI never sees a raw rejection.
 */
async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw toUiError(error, `IPC command failed: ${command}`);
  }
}

/**
 * Thin wrapper over `tauri-plugin-dialog`'s `open`, shared by the directory and
 * file pickers: both take the same options and both must normalise the plugin's
 * single-or-array answer and turn a rejection into a `UiAppError`.
 */
async function pickPath(
  options: FilePickerOptions & { directory: boolean },
): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  try {
    const picked: unknown = await open({ multiple: false, ...options });
    if (typeof picked === "string") return picked;
    if (Array.isArray(picked) && typeof picked[0] === "string") {
      return picked[0];
    }
    return null;
  } catch (error) {
    throw toUiError(error, "File picker failed");
  }
}

export function createTauriApi(): LauncherApi {
  return {
    kind: "tauri",

    listSources() {
      return invoke<Source[]>("list_sources");
    },

    addSource(path) {
      return invoke<Source>("add_source", { path });
    },

    removeSource(id) {
      return invoke<void>("remove_source", { id });
    },

    scanSource(id) {
      return invoke<ScanSummary>("scan_source", { id });
    },

    listCandidates(status?: CandidateStatus) {
      return invoke<Candidate[]>("list_candidates", { status: status ?? null });
    },

    approveCandidate(id, patch?: CandidatePatch) {
      return invoke<Game>("approve_candidate", { id, patch: patch ?? null });
    },

    rejectCandidate(id) {
      return invoke<void>("reject_candidate", { id });
    },

    listGames() {
      return invoke<Game[]>("list_games");
    },

    getGame(id) {
      return invoke<Game>("get_game", { id });
    },

    updateGame(id, patch: GamePatch) {
      return invoke<Game>("update_game", { id, patch });
    },

    removeGame(id) {
      return invoke<void>("remove_game", { id });
    },

    launchGame(id) {
      return invoke<LaunchInfo>("launch_game", { id });
    },

    listSessions(gameId, limit?: number) {
      return invoke<Session[]>("list_sessions", { gameId, limit: limit ?? null });
    },

    getSettings() {
      return invoke<Settings>("get_settings");
    },

    updateSettings(patch: SettingsPatch) {
      return invoke<Settings>("update_settings", { patch });
    },

    fetchCoverCandidates(query) {
      return invoke<CoverCandidate[]>("fetch_cover_candidates", { query });
    },

    downloadCover(gameId, url) {
      return invoke<Game>("download_cover", { gameId, url });
    },

    setCoverFromFile(gameId, sourcePath) {
      return invoke<Game>("set_cover_from_file", { gameId, sourcePath });
    },

    modsStatus(gameId) {
      return invoke<ModsStatus>("mods_status", { gameId });
    },

    installModLoader(gameId, loaderId?: string) {
      // The core's `loader_id` is optional: `null` means "the suggestion".
      return invoke<ModsStatus>("install_mod_loader", {
        gameId,
        loaderId: loaderId ?? null,
      });
    },

    installModArchive(gameId, archivePath) {
      return invoke<ModInstallResult>("install_mod_archive", { gameId, archivePath });
    },

    async listGamepads(): Promise<GamepadList> {
      // The command answers with a bare array today; the contract reads
      // `{ pads }`. Both are accepted here so the UI survives either.
      return normalizeGamepadList(await invoke<unknown>("list_gamepads"));
    },

    async pickDirectory(options) {
      return pickPath({
        directory: true,
        ...(options?.title ? { title: options.title } : {}),
      });
    },

    async pickFile(options) {
      return pickPath({
        directory: false,
        ...(options?.title ? { title: options.title } : {}),
        ...(options?.filters ? { filters: options.filters } : {}),
      });
    },

    async revealItemInDir(path) {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      try {
        await revealItemInDir(path);
      } catch (error) {
        throw toUiError(error, "Could not open the file manager");
      }
    },

    async on<K extends EventName>(
      event: K,
      handler: (payload: EventMap[K]) => void,
    ): Promise<UnlistenFn> {
      const { listen } = await import("@tauri-apps/api/event");
      try {
        return await listen<EventMap[K]>(event, (message) => {
          handler(message.payload);
        });
      } catch (error) {
        throw toUiError(error, `Could not listen for "${event}"`);
      }
    },
  };
}
