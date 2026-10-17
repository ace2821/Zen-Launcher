import { create } from "zustand";
import { currentLanguage, setLanguage, translate } from "../i18n";
import { api } from "../lib/api";
import { toUiError, type UiAppError } from "../lib/errors";
import { formatClockDuration } from "../lib/format";
import type {
  Candidate,
  CandidatePatch,
  Game,
  GamePatch,
  ScanSummary,
  Session,
  Settings,
  SettingsPatch,
  Source,
  UnlistenFn,
} from "../lib/types";
import { confirmDialog } from "./confirm";
import { useShellStore } from "./shell";
import { toastError, toastInfo, toastSuccess } from "./toasts";

export const SESSION_HISTORY_LIMIT = 10;

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export interface ScanProgressState {
  sourceId: number;
  current: string | null;
  candidatesSoFar: number;
}

interface UpdateGameOptions {
  /** Toast title used when the patch is rejected. */
  failureTitle?: string;
}

interface LibraryState {
  status: LoadStatus;
  error: UiAppError | null;
  ready: boolean;
  games: Game[];
  sources: Source[];
  candidates: Candidate[];
  settings: Settings | null;
  currentGame: Game | null;
  sessions: Session[];
  scan: ScanProgressState | null;
  lastScan: ScanSummary | null;
  /** Keyed by action, e.g. `candidate:approve:101`. */
  busy: Record<string, boolean>;

  init(): Promise<void>;
  refreshAll(): Promise<void>;
  refreshGames(): Promise<void>;
  refreshSources(): Promise<void>;
  refreshCandidates(): Promise<void>;
  openGame(gameId: number): Promise<void>;
  addSource(path: string): Promise<void>;
  removeSource(id: number): Promise<void>;
  scanSource(id: number): Promise<void>;
  setScan(scan: ScanProgressState | null): void;
  approveCandidate(id: number, patch?: CandidatePatch): Promise<void>;
  rejectCandidate(id: number): Promise<void>;
  approveAllPending(): Promise<void>;
  rejectAllPending(): Promise<void>;
  updateGame(
    id: number,
    patch: GamePatch,
    options?: UpdateGameOptions,
  ): Promise<Game | null>;
  toggleFavorite(game: Game): Promise<void>;
  removeGame(id: number): Promise<void>;
  launchGame(id: number): Promise<void>;
  revealGame(game: Game): Promise<void>;
  updateSettings(patch: SettingsPatch): Promise<void>;
  reset(): void;
}

let unlisteners: UnlistenFn[] = [];
let initializing: Promise<void> | null = null;

const EMPTY = {
  status: "idle" as LoadStatus,
  error: null,
  ready: false,
  games: [] as Game[],
  sources: [] as Source[],
  candidates: [] as Candidate[],
  settings: null,
  currentGame: null,
  sessions: [] as Session[],
  scan: null,
  lastScan: null,
  busy: {} as Record<string, boolean>,
};

export const useLibraryStore = create<LibraryState>()((set, get) => {
  const run = async (key: string, task: () => Promise<void>): Promise<void> => {
    set((state) => ({ busy: { ...state.busy, [key]: true } }));
    try {
      await task();
    } finally {
      set((state) => {
        const busy = { ...state.busy };
        delete busy[key];
        return { busy };
      });
    }
  };

  async function subscribe(): Promise<void> {
    unlisteners.push(
      await api.on("scan-progress", (payload) => {
        set({
          scan: {
            sourceId: payload.sourceId,
            current: payload.current,
            candidatesSoFar: payload.candidatesSoFar,
          },
        });
      }),
      await api.on("scan-finished", (payload) => {
        set({ scan: null, lastScan: payload });
        toastSuccess(
          translate("import.scanFinished"),
          translate("import.scanFinishedBody", { count: payload.candidatesFound }),
        );
        void get().refreshCandidates();
        void get().refreshSources();
      }),
      await api.on("session-started", (payload) => {
        const title =
          get().games.find((game) => game.id === payload.gameId)?.title ?? "";
        toastInfo(
          translate("details.launched"),
          translate("details.launchedBody", { title }),
        );
      }),
      await api.on("session-ended", (payload) => {
        const title =
          get().games.find((game) => game.id === payload.gameId)?.title ?? "";
        toastInfo(
          translate("details.sessionEnded"),
          translate("details.sessionEndedBody", {
            title,
            duration: formatClockDuration(payload.durationSeconds),
          }),
        );
        void get().refreshAll();
      }),
      await api.on("library-changed", () => {
        void get().refreshAll();
      }),
    );
  }

  return {
    ...EMPTY,

    async init() {
      if (get().ready) return;
      if (initializing !== null) return initializing;
      initializing = (async () => {
        set({ status: "loading", error: null });
        try {
          const settings = await api.getSettings();
          set({ settings });
          if (settings.language !== currentLanguage()) {
            await setLanguage(settings.language);
          }
          await subscribe();
          await get().refreshAll();
          set({ status: "ready", ready: true });
        } catch (error) {
          const uiError = toUiError(error, translate("errors.initFailed"));
          set({ status: "error", error: uiError });
          toastError(translate("errors.initFailed"), uiError);
        } finally {
          initializing = null;
        }
      })();
      return initializing;
    },

    async refreshAll() {
      try {
        const [games, sources, candidates] = await Promise.all([
          api.listGames(),
          api.listSources(),
          api.listCandidates(),
        ]);
        set({ games, sources, candidates, error: null });

        const { selectedGameId, view } = useShellStore.getState();
        if (selectedGameId !== null && view === "game") {
          try {
            const [game, sessions] = await Promise.all([
              api.getGame(selectedGameId),
              api.listSessions(selectedGameId, SESSION_HISTORY_LIMIT),
            ]);
            set({ currentGame: game, sessions });
          } catch {
            // The entry disappeared underneath us (removed elsewhere).
            set({ currentGame: null, sessions: [] });
            useShellStore.getState().goToLibrary();
          }
        }
      } catch (error) {
        const uiError = toUiError(error, translate("errors.initFailed"));
        set({ error: uiError });
        toastError(translate("errors.initFailed"), uiError);
      }
    },

    async refreshGames() {
      try {
        set({ games: await api.listGames() });
      } catch (error) {
        toastError(translate("errors.initFailed"), toUiError(error));
      }
    },

    async refreshSources() {
      try {
        set({ sources: await api.listSources() });
      } catch (error) {
        toastError(translate("errors.initFailed"), toUiError(error));
      }
    },

    async refreshCandidates() {
      try {
        set({ candidates: await api.listCandidates() });
      } catch (error) {
        toastError(translate("errors.initFailed"), toUiError(error));
      }
    },

    async openGame(gameId) {
      useShellStore.getState().goToGame(gameId);
      await run(`game:load:${gameId}`, async () => {
        try {
          const [game, sessions] = await Promise.all([
            api.getGame(gameId),
            api.listSessions(gameId, SESSION_HISTORY_LIMIT),
          ]);
          set({ currentGame: game, sessions });
        } catch (error) {
          set({ currentGame: null, sessions: [] });
          toastError(translate("errors.NOT_FOUND"), toUiError(error));
        }
      });
    },

    async addSource(path) {
      await run("source:add", async () => {
        try {
          const source = await api.addSource(path);
          toastSuccess(translate("import.sourceAdded"), source.path);
          await get().refreshSources();
        } catch (error) {
          toastError(translate("import.sourceAddFailed"), toUiError(error));
        }
      });
    },

    async removeSource(id) {
      const source = get().sources.find((entry) => entry.id === id);
      if (!source) return;
      const confirmed = await confirmDialog({
        title: translate("import.removeSourceTitle", { path: source.path }),
        body: translate("import.removeSourceBody"),
        confirmLabel: translate("common.remove"),
        cancelLabel: translate("common.cancel"),
        tone: "danger",
      });
      if (!confirmed) return;

      await run(`source:remove:${id}`, async () => {
        try {
          await api.removeSource(id);
          toastSuccess(translate("import.sourceRemoved"), source.path);
          await Promise.all([get().refreshSources(), get().refreshCandidates()]);
        } catch (error) {
          toastError(translate("import.sourceRemoveFailed"), toUiError(error));
        }
      });
    },

    async scanSource(id) {
      set({
        scan: { sourceId: id, current: null, candidatesSoFar: 0 },
        lastScan: null,
      });
      await run(`source:scan:${id}`, async () => {
        try {
          const summary = await api.scanSource(id);
          set({ scan: null, lastScan: summary });
          toastSuccess(
            translate("import.scanFinished"),
            translate("import.scanFinishedBody", {
              count: summary.candidatesFound,
            }),
          );
          await Promise.all([get().refreshCandidates(), get().refreshSources()]);
        } catch (error) {
          set({ scan: null });
          toastError(translate("import.scanFailed"), toUiError(error));
        }
      });
    },

    setScan(scan) {
      set({ scan });
    },

    async approveCandidate(id, patch) {
      await run(`candidate:approve:${id}`, async () => {
        try {
          const game = await api.approveCandidate(id, patch);
          toastSuccess(
            translate("import.approvedToast"),
            translate("import.approvedToastBody", { title: game.title }),
          );
          await Promise.all([get().refreshCandidates(), get().refreshGames()]);
        } catch (error) {
          toastError(translate("import.approveFailed"), toUiError(error));
        }
      });
    },

    async rejectCandidate(id) {
      await run(`candidate:reject:${id}`, async () => {
        try {
          await api.rejectCandidate(id);
          const candidate = get().candidates.find((entry) => entry.id === id);
          toastSuccess(
            translate("import.rejectedToast"),
            translate("import.rejectedToastBody", {
              title: candidate?.suggestedTitle ?? "",
            }),
          );
          await get().refreshCandidates();
        } catch (error) {
          toastError(translate("import.rejectFailed"), toUiError(error));
        }
      });
    },

    async approveAllPending() {
      const pending = get().candidates.filter((entry) => entry.status === "pending");
      const approvable = pending.filter(
        (entry) => entry.executable !== null && entry.executable.trim() !== "",
      );
      const skipped = pending.length - approvable.length;

      if (approvable.length === 0) {
        toastInfo(
          translate("import.noPending"),
          translate("import.missingExecutableHint"),
        );
        return;
      }

      await run("candidates:approve-all", async () => {
        let approved = 0;
        let failed = 0;
        for (const candidate of approvable) {
          try {
            await api.approveCandidate(candidate.id);
            approved += 1;
          } catch {
            failed += 1;
          }
        }
        const detail =
          skipped > 0
            ? translate("import.bulkPartial", { count: skipped })
            : failed > 0
              ? translate("import.bulkFailed", { count: failed })
              : undefined;
        if (approved === 0 && failed > 0) {
          toastError(
            translate("import.approveFailed"),
            undefined,
            translate("import.bulkFailed", { count: failed }),
          );
        } else {
          toastSuccess(
            translate("import.bulkApproved", { count: approved }),
            detail,
          );
        }
        await Promise.all([get().refreshCandidates(), get().refreshGames()]);
      });
    },

    async rejectAllPending() {
      const pending = get().candidates.filter((entry) => entry.status === "pending");
      if (pending.length === 0) {
        toastInfo(translate("import.noPending"));
        return;
      }
      const confirmed = await confirmDialog({
        title: translate("import.rejectAllTitle", { count: pending.length }),
        body: translate("import.rejectAllBody"),
        confirmLabel: translate("import.rejectAll", { count: pending.length }),
        cancelLabel: translate("common.cancel"),
        tone: "danger",
      });
      if (!confirmed) return;

      await run("candidates:reject-all", async () => {
        let rejected = 0;
        for (const candidate of pending) {
          try {
            await api.rejectCandidate(candidate.id);
            rejected += 1;
          } catch {
            // Individual failures are summed up in the summary toast.
          }
        }
        toastSuccess(translate("import.bulkRejected", { count: rejected }));
        await get().refreshCandidates();
      });
    },

    async updateGame(id, patch, options) {
      let updated: Game | null = null;
      await run(`game:update:${id}`, async () => {
        try {
          const result = await api.updateGame(id, patch);
          updated = result;
          set((state) => ({
            games: state.games.map((game) => (game.id === id ? result : game)),
            currentGame: state.currentGame?.id === id ? result : state.currentGame,
          }));
        } catch (error) {
          toastError(
            options?.failureTitle ?? translate("details.optionsSaveFailed"),
            toUiError(error),
          );
          updated = null;
        }
      });
      return updated;
    },

    async toggleFavorite(game) {
      const next = !game.favorite;
      set((state) => ({
        games: state.games.map((entry) =>
          entry.id === game.id ? { ...entry, favorite: next } : entry,
        ),
      }));
      const updated = await get().updateGame(
        game.id,
        { favorite: next },
        { failureTitle: translate("library.favoriteFailed") },
      );
      if (updated === null) {
        // Roll the optimistic flip back.
        set((state) => ({
          games: state.games.map((entry) =>
            entry.id === game.id ? { ...entry, favorite: game.favorite } : entry,
          ),
        }));
      }
    },

    async removeGame(id) {
      const game =
        get().games.find((entry) => entry.id === id) ??
        (get().currentGame?.id === id ? get().currentGame : null);
      if (!game) return;

      const confirmed = await confirmDialog({
        title: translate("library.removeTitle", { title: game.title }),
        body: translate("library.removeBody"),
        confirmLabel: translate("library.remove"),
        cancelLabel: translate("common.cancel"),
        tone: "danger",
        note: game.installPath,
      });
      if (!confirmed) return;

      await run(`game:remove:${id}`, async () => {
        try {
          await api.removeGame(id);
          toastSuccess(
            translate("library.removedToast"),
            translate("library.removedToastBody", { title: game.title }),
          );
          if (useShellStore.getState().selectedGameId === id) {
            useShellStore.getState().goToLibrary();
          }
          set({ currentGame: null, sessions: [] });
          await get().refreshGames();
        } catch (error) {
          toastError(translate("library.removeFailed"), toUiError(error));
        }
      });
    },

    async launchGame(id) {
      const title =
        get().currentGame?.id === id
          ? get().currentGame?.title
          : get().games.find((entry) => entry.id === id)?.title;
      await run(`game:launch:${id}`, async () => {
        try {
          await api.launchGame(id);
          toastSuccess(
            translate("details.launched"),
            translate("details.launchedBody", { title: title ?? "" }),
          );
        } catch (error) {
          toastError(translate("details.launchFailed"), toUiError(error));
        }
      });
    },

    async revealGame(game) {
      try {
        await api.revealItemInDir(game.executable || game.installPath);
      } catch (error) {
        toastError(translate("details.revealFailed"), toUiError(error));
      }
    },

    async updateSettings(patch) {
      await run("settings:update", async () => {
        try {
          const settings = await api.updateSettings(patch);
          set({ settings });
          if (patch.language !== undefined && patch.language !== currentLanguage()) {
            await setLanguage(patch.language);
          }
          toastSuccess(translate("settings.settingsSaved"));
        } catch (error) {
          toastError(translate("settings.settingsSaveFailed"), toUiError(error));
        }
      });
    },

    reset() {
      for (const off of unlisteners) off();
      unlisteners = [];
      initializing = null;
      set({ ...EMPTY });
    },
  };
});
