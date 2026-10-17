import type { LauncherApi } from "./api";
import { toUiError } from "./errors";
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

    async pickDirectory(options) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      try {
        const picked: unknown = await open({
          directory: true,
          multiple: false,
          ...(options?.title ? { title: options.title } : {}),
        });
        if (typeof picked === "string") return picked;
        if (Array.isArray(picked) && typeof picked[0] === "string") {
          return picked[0];
        }
        return null;
      } catch (error) {
        throw toUiError(error, "Directory picker failed");
      }
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
