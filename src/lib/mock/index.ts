import type { LauncherApi } from "../api";
import { uiError } from "../errors";
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
  SettingsPatch,
  Source,
  UnlistenFn,
} from "../types";
import { createSeedState, genericDiscoveries, type MockState } from "./data";

type AnyListener = (payload: unknown) => void;

export interface MockOptions {
  /** Simulated delay between scanner progress steps. */
  scanStepMs?: number;
  /** How long a simulated session runs before it is closed. */
  sessionMs?: number;
  /** Injectable clock, so tests get stable timestamps. */
  now?: () => Date;
}

/**
 * Harness-only additions on top of the contract surface.
 */
export interface MockApi extends LauncherApi {
  readonly kind: "mock";
  /** Restores the seed, drops timers/listeners — used between tests. */
  reset(): void;
  /** Paths handed to the opener plugin; always empty in a real build. */
  readonly revealedPaths: string[];
}

function nowString(clock: () => Date): string {
  return clock().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function copySource(source: Source): Source {
  return { ...source };
}

function copyCandidate(candidate: Candidate): Candidate {
  return { ...candidate, evidence: [...candidate.evidence] };
}

function copyGame(game: Game): Game {
  return {
    ...game,
    args: [...game.args],
    env: { ...game.env },
    tags: [...game.tags],
  };
}

function copySession(session: Session): Session {
  return { ...session };
}

/**
 * In-memory stand-in for the Rust core.
 *
 * It mirrors the contract, not the implementation: what we cannot emulate
 * (a real filesystem, real processes) is modelled explicitly — approved games
 * whose executable is missing stay `status: "missing"`, launching is refused for
 * anything but native entries, and sessions are closed with a timer.
 */
export function createMockApi(options: MockOptions = {}): MockApi {
  const scanStepMs = options.scanStepMs ?? 220;
  const sessionMs = options.sessionMs ?? 15_000;
  const clock = options.now ?? (() => new Date());

  let state: MockState = createSeedState();
  let epoch = 0;
  const listeners = new Map<EventName, Set<AnyListener>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const revealedPaths: string[] = [];

  function emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    const registered = listeners.get(event);
    if (!registered) return;
    for (const listener of [...registered]) listener(payload);
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolve();
      }, ms);
      timers.add(timer);
    });
  }

  function requireSource(id: number): Source {
    const source = state.sources.find((entry) => entry.id === id);
    if (!source) throw uiError("NOT_FOUND", `Source ${id} does not exist.`);
    return source;
  }

  function requireCandidate(id: number): Candidate {
    const candidate = state.candidates.find((entry) => entry.id === id);
    if (!candidate) throw uiError("NOT_FOUND", `Candidate ${id} does not exist.`);
    return candidate;
  }

  function requireGame(id: number): Game {
    const game = state.games.find((entry) => entry.id === id);
    if (!game) throw uiError("NOT_FOUND", `Game ${id} is not in the library.`);
    return game;
  }

  /** Emulated "executable exists on disk" check. */
  function computeStatus(executable: string): Game["status"] {
    return state.missingExecutables.has(executable) ? "missing" : "ready";
  }

  function endSession(sessionId: number): void {
    const session = state.sessions.find((entry) => entry.id === sessionId);
    if (!session || session.endedAt !== null) return;
    const endedAt = nowString(clock);
    const durationSeconds = Math.max(
      1,
      Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1_000),
    );
    session.endedAt = endedAt;
    session.durationSeconds = durationSeconds;
    session.exitCode = 0;
    const game = state.games.find((entry) => entry.id === session.gameId);
    if (game) {
      game.totalSeconds += durationSeconds;
      game.updatedAt = endedAt;
    }
    emit("session-ended", {
      sessionId,
      gameId: session.gameId,
      durationSeconds,
      exitCode: 0,
    });
    emit("library-changed", {});
  }

  return {
    kind: "mock",
    revealedPaths,

    reset() {
      epoch += 1;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      listeners.clear();
      revealedPaths.length = 0;
      state = createSeedState();
    },

    /* ---------------------------------------------------------------- sources */

    async listSources() {
      return state.sources.map(copySource);
    },

    async addSource(path) {
      const trimmed = path.trim();
      if (trimmed.length === 0) {
        throw uiError("VALIDATION", "A scan root needs a path.");
      }
      // Contract: adding a root that is already known returns the existing row.
      const existing = state.sources.find((source) => source.path === trimmed);
      if (existing) return copySource(existing);
      const source: Source = {
        id: state.nextSourceId++,
        path: trimmed,
        autoScan: false,
        createdAt: nowString(clock),
        lastScanAt: null,
      };
      state.sources.push(source);
      state.discoveries.set(
        source.id,
        genericDiscoveries().map((seed) => ({
          ...seed,
          folder: `${seed.folder}-${source.id}`,
        })),
      );
      emit("library-changed", {});
      return copySource(source);
    },

    async removeSource(id) {
      const source = requireSource(id);
      // Contract: the root is forgotten; its candidates stay, detached from
      // the removed root, and games are untouched.
      state.sources = state.sources.filter((entry) => entry.id !== source.id);
      state.discoveries.delete(source.id);
      state.candidates = state.candidates.map((candidate) =>
        candidate.sourceId === source.id
          ? { ...candidate, sourceId: null }
          : candidate,
      );
      emit("library-changed", {});
    },

    async scanSource(id) {
      const startedAt = Date.now();
      const myEpoch = epoch;
      const rootPath = requireSource(id).path;
      const pool = state.discoveries.get(id) ?? [];
      const batch = pool.splice(0, 3);
      let candidatesSoFar = 0;

      for (const seed of batch) {
        emit("scan-progress", {
          sourceId: id,
          current: `${rootPath}/${seed.folder}`,
          candidatesSoFar,
        });
        await delay(scanStepMs);
        if (myEpoch !== epoch) {
          return { sourceId: id, candidatesFound: candidatesSoFar, durationMs: 0 };
        }
        const path = `${rootPath}/${seed.folder}`;
        const candidate: Candidate = {
          id: state.nextCandidateId++,
          sourceId: id,
          path,
          executable: seed.executable ? `${path}/${seed.executable}` : null,
          engine: seed.engine,
          suggestedTitle: seed.title,
          confidence: seed.confidence,
          evidence: [...seed.evidence],
          status: "pending",
          createdAt: nowString(clock),
        };
        state.candidates.push(candidate);
        candidatesSoFar += 1;
      }

      emit("scan-progress", { sourceId: id, current: null, candidatesSoFar });
      await delay(scanStepMs);
      if (myEpoch !== epoch) {
        return { sourceId: id, candidatesFound: candidatesSoFar, durationMs: 0 };
      }
      requireSource(id).lastScanAt = nowString(clock);

      const summary: ScanSummary = {
        sourceId: id,
        candidatesFound: candidatesSoFar,
        durationMs: Date.now() - startedAt,
      };
      emit("scan-finished", summary);
      emit("library-changed", {});
      return summary;
    },

    /* ------------------------------------------------------------- candidates */

    async listCandidates(status?: CandidateStatus) {
      return state.candidates
        .filter((candidate) => status === undefined || candidate.status === status)
        .sort((a, b) => b.id - a.id)
        .map(copyCandidate);
    },

    async approveCandidate(id, patch?: CandidatePatch) {
      const candidate = requireCandidate(id);
      if (candidate.status !== "pending") {
        throw uiError(
          "VALIDATION",
          `Candidate "${candidate.suggestedTitle}" was already ${candidate.status}.`,
        );
      }
      const title = (patch?.title ?? candidate.suggestedTitle).trim();
      if (title.length === 0) {
        throw uiError("VALIDATION", "A library entry needs a title.");
      }
      const executable = (patch?.executable ?? candidate.executable ?? "").trim();
      if (executable.length === 0) {
        throw uiError(
          "VALIDATION",
          "No executable selected — set one before approving.",
        );
      }

      const timestamp = nowString(clock);
      const game: Game = {
        id: state.nextGameId++,
        title,
        sortTitle: null,
        // The Rust scanner decides this from the binary; the mock infers it.
        type: executable.toLowerCase().endsWith(".exe") ? "windows" : "native",
        installPath: candidate.path,
        executable,
        args: patch?.args ?? [],
        env: {},
        workDir: patch?.workDir ?? candidate.path,
        tags: [],
        favorite: false,
        hidden: false,
        notes: null,
        coverPath: null,
        status: computeStatus(executable),
        createdAt: timestamp,
        updatedAt: timestamp,
        lastPlayedAt: null,
        totalSeconds: 0,
      };
      candidate.status = "approved";
      state.games.push(game);
      emit("library-changed", {});
      return copyGame(game);
    },

    async rejectCandidate(id) {
      const candidate = requireCandidate(id);
      if (candidate.status !== "pending") {
        throw uiError(
          "VALIDATION",
          `Candidate "${candidate.suggestedTitle}" was already ${candidate.status}.`,
        );
      }
      candidate.status = "rejected";
      emit("library-changed", {});
    },

    /* ------------------------------------------------------------------ games */

    async listGames() {
      return [...state.games]
        .sort((a, b) =>
          (a.sortTitle ?? a.title).localeCompare(b.sortTitle ?? b.title, "en"),
        )
        .map(copyGame);
    },

    async getGame(id) {
      const game = requireGame(id);
      game.status = computeStatus(game.executable);
      return copyGame(game);
    },

    async updateGame(id, patch: GamePatch) {
      const game = requireGame(id);

      if (patch.title !== undefined) {
        const title = patch.title.trim();
        if (title.length === 0) {
          throw uiError("VALIDATION", "A library entry needs a title.");
        }
        game.title = title;
      }
      if (patch.sortTitle !== undefined) game.sortTitle = patch.sortTitle;
      if (patch.type !== undefined) game.type = patch.type;
      if (patch.executable !== undefined) {
        const executable = patch.executable.trim();
        if (executable.length === 0) {
          throw uiError("VALIDATION", "The executable path cannot be empty.");
        }
        game.executable = executable;
        game.status = computeStatus(executable);
      }
      if (patch.args !== undefined) game.args = [...patch.args];
      if (patch.env !== undefined) game.env = { ...patch.env };
      if (patch.workDir !== undefined) game.workDir = patch.workDir;
      if (patch.tags !== undefined) game.tags = [...patch.tags];
      if (patch.favorite !== undefined) game.favorite = patch.favorite;
      if (patch.hidden !== undefined) game.hidden = patch.hidden;
      if (patch.notes !== undefined) game.notes = patch.notes;
      if (patch.coverPath !== undefined) game.coverPath = patch.coverPath;

      game.updatedAt = nowString(clock);
      emit("library-changed", {});
      return copyGame(game);
    },

    async removeGame(id) {
      requireGame(id);
      // Library removal only: no file operation is emulated here at all, which
      // is exactly the contract guarantee. Session rows go with the entry so
      // that no orphan history is left behind.
      state.games = state.games.filter((game) => game.id !== id);
      state.sessions = state.sessions.filter((session) => session.gameId !== id);
      emit("library-changed", {});
    },

    async launchGame(id) {
      const game = requireGame(id);
      if (game.type !== "native") {
        throw uiError(
          "UNSUPPORTED",
          `Launching ${game.type} entries needs a runner that arrives after M1.`,
        );
      }
      if (game.status === "missing") {
        throw uiError("IO", `Executable not found: ${game.executable}`);
      }
      const startedAt = nowString(clock);
      const session: Session = {
        id: state.nextSessionId++,
        gameId: id,
        startedAt,
        endedAt: null,
        durationSeconds: null,
        exitCode: null,
      };
      state.sessions.push(session);
      game.lastPlayedAt = startedAt;
      game.updatedAt = startedAt;
      emit("session-started", {
        sessionId: session.id,
        gameId: id,
        startedAt,
      });
      emit("library-changed", {});

      const timer = setTimeout(() => {
        timers.delete(timer);
        endSession(session.id);
      }, sessionMs);
      timers.add(timer);

      const info: LaunchInfo = { sessionId: session.id };
      return info;
    },

    async listSessions(gameId, limit?: number) {
      const sessions = state.sessions
        .filter((session) => session.gameId === gameId)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
      return (limit === undefined ? sessions : sessions.slice(0, limit)).map(
        copySession,
      );
    },

    /* --------------------------------------------------------------- settings */

    async getSettings() {
      return { ...state.settings };
    },

    async updateSettings(patch: SettingsPatch) {
      if (
        patch.language !== undefined &&
        patch.language !== "en" &&
        patch.language !== "pl"
      ) {
        throw uiError("VALIDATION", `Unsupported language: ${patch.language}`);
      }
      state.settings = { ...state.settings, ...patch };
      return { ...state.settings };
    },

    /* ------------------------------------------------------- shell integration */

    async pickDirectory() {
      const taken = new Set(state.sources.map((source) => source.path));
      const available = state.pickablePaths.find((path) => !taken.has(path));
      return available ?? `/home/oliwier/Downloads/zen-games-${state.nextSourceId}`;
    },

    async revealItemInDir(path) {
      revealedPaths.push(path);
    },

    async on<K extends EventName>(
      event: K,
      handler: (payload: EventMap[K]) => void,
    ): Promise<UnlistenFn> {
      const registered = listeners.get(event) ?? new Set<AnyListener>();
      // Handlers are stored as `unknown` consumers; each listener is only ever
      // invoked with its own event's payload.
      const listener = handler as unknown as AnyListener;
      registered.add(listener);
      listeners.set(event, registered);
      return () => {
        registered.delete(listener);
      };
    },
  };
}
