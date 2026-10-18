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
  ModsStatus,
  ScanSummary,
  Session,
  Settings,
  SettingsPatch,
  Source,
  UnlistenFn,
} from "../types";
import {
  coverArtUri,
  coverCandidates,
  createSeedState,
  genericDiscoveries,
  type MockState,
  type ModsSeed,
} from "./data";

type AnyListener = (payload: unknown) => void;

export interface MockOptions {
  /** Simulated delay between scanner progress steps. */
  scanStepMs?: number;
  /** How long a simulated session runs before it is closed. */
  sessionMs?: number;
  /** Injectable clock, so tests get stable timestamps. */
  now?: () => Date;
  /**
   * Stand-in for a `config.toml` already on disk. Partial on purpose: an older
   * file without the appearance keys loads as defaults (see `loadSettings`).
   */
  settings?: Partial<Settings>;
  /**
   * Simulated latency for the provider calls (searching the store, downloading
   * artwork, installing mods). Zero by default so tests stay deterministic; a
   * test that asserts a spinner passes something small instead.
   */
  networkMs?: number;
  /** Forces the "could not move the archive to the trash" path. */
  trashFails?: boolean;
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
  /** Cover URLs the UI asked for, in order. */
  readonly downloadedCoverUrls: string[];
  /** Source images copied in as covers — the originals are never touched. */
  readonly coverSources: string[];
  /** Archives that reached the trash (the ones that failed are simply absent). */
  readonly trashedArchives: string[];
}

function nowString(clock: () => Date): string {
  return clock().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The contract caps the reported mod list; the mock honours the same cap. */
const INSTALLED_CAP = 50;

const ARCHIVE_PATTERN = /\.(?:zip|7z|rar)$/i;
const IMAGE_PATTERN = /\.(?:png|jpe?g|webp)$/i;

/** `BepInEx/plugins/CoolMod.dll` → `CoolMod.dll`. */
function baseName(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

const SETTINGS_ID_MAX = 32;
const SETTINGS_ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * Mirrors the core's rule for `font` / `accent`: the value is trimmed, then
 * rejected outright when it is empty, longer than 32 characters or contains
 * anything outside `[a-z0-9-]`. The UI never sends such a value — but the mock
 * refuses it exactly like the core would, so the contract stays testable.
 */
function normalizeSettingsId(field: "font" | "accent", value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > SETTINGS_ID_MAX ||
    !SETTINGS_ID_PATTERN.test(trimmed)
  ) {
    throw uiError("VALIDATION", `Unsupported ${field} id: ${value}`);
  }
  return trimmed;
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
  /**
   * Provider latency. Zero by default: tests must not wait on invented timers,
   * and a local mock answering instantly is the honest reading of "no network".
   */
  const networkMs = options.networkMs ?? 0;
  const trashFails = options.trashFails ?? false;

  let state: MockState = createSeedState(options.settings);
  let epoch = 0;
  const listeners = new Map<EventName, Set<AnyListener>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const revealedPaths: string[] = [];
  const downloadedCoverUrls: string[] = [];
  const coverSources: string[] = [];
  const trashedArchives: string[] = [];

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

  /** What the mock pretends to have found in a game folder. */
  function modsSeedFor(gameId: number): ModsSeed {
    return (
      state.mods.get(gameId) ?? {
        loader: "none",
        modsDir: null,
        modsDirKind: "none",
        engine: "unknown",
        suggestedLoader: null,
        installed: [],
      }
    );
  }

  /**
   * Mirrors `mods::status` — including the gate every mods command shares: the
   * core resolves the game folder first and refuses anything that is not a
   * Windows entry. The UI has to live with that answer, so the mock gives it.
   */
  function modsStatusOf(game: Game): ModsStatus {
    if (game.type !== "windows") {
      throw uiError("VALIDATION", "mod loading is only supported for Windows games");
    }
    const seed = modsSeedFor(game.id);
    return {
      loader: seed.loader,
      modsDir: seed.modsDir === null ? null : `${game.installPath}/${seed.modsDir}`,
      modsDirKind: seed.modsDirKind,
      engine: seed.engine,
      suggestedLoader: seed.suggestedLoader,
      installed: [...seed.installed].sort().slice(0, INSTALLED_CAP),
    };
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
    downloadedCoverUrls,
    coverSources,
    trashedArchives,

    reset() {
      epoch += 1;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      listeners.clear();
      revealedPaths.length = 0;
      downloadedCoverUrls.length = 0;
      coverSources.length = 0;
      trashedArchives.length = 0;
      state = createSeedState(options.settings);
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
      // Applied field by field so an absent key in the patch can never overwrite
      // a stored value with `undefined`.
      const next: Settings = { ...state.settings };
      if (patch.language !== undefined) next.language = patch.language;
      if (patch.closeToTray !== undefined) next.closeToTray = patch.closeToTray;
      if (patch.hideOnLaunch !== undefined) next.hideOnLaunch = patch.hideOnLaunch;
      if (patch.font !== undefined) {
        next.font = normalizeSettingsId("font", patch.font);
      }
      if (patch.accent !== undefined) {
        next.accent = normalizeSettingsId("accent", patch.accent);
      }
      if (patch.onboardingCompleted !== undefined) {
        next.onboardingCompleted = patch.onboardingCompleted;
      }
      state.settings = next;
      return { ...state.settings };
    },

    /* -------------------------------------------------------- covers (artwork) */

    async fetchCoverCandidates(query) {
      const term = query.trim();
      // The core refuses an empty query outright rather than searching for
      // nothing, so the mock refuses it too.
      if (term.length === 0) {
        throw uiError("VALIDATION", "cover search query is empty");
      }
      await delay(networkMs);
      return coverCandidates(term);
    },

    async downloadCover(gameId, url) {
      const game = requireGame(gameId);
      const source = url.trim();
      // The core accepts http(s) only. The mock never touches the network, so its
      // own candidates are inline `data:` posters — accepting those as well is the
      // one place the mock is deliberately wider than the core, and it cannot
      // leak into a real build.
      if (!/^(?:https?:\/\/|data:image\/)/i.test(source)) {
        throw uiError("VALIDATION", "cover URL must be http(s)");
      }
      await delay(networkMs);
      // The stored "file" is another inline poster, labelled with the game so the
      // grid looks like it does with real artwork behind it.
      game.coverPath = coverArtUri(`downloaded:${source}`, game.title);
      game.updatedAt = nowString(clock);
      downloadedCoverUrls.push(source);
      emit("library-changed", {});
      return copyGame(game);
    },

    async setCoverFromFile(gameId, sourcePath) {
      const game = requireGame(gameId);
      const source = sourcePath.trim();
      // The core sniffs magic bytes; the mock only ever sees a name, so it checks
      // the extension and accepts exactly the same three formats.
      if (!IMAGE_PATTERN.test(source)) {
        throw uiError("VALIDATION", "cover file is not a PNG/JPEG/WebP image");
      }
      await delay(networkMs);
      game.coverPath = coverArtUri(`file:${source}`, game.title);
      game.updatedAt = nowString(clock);
      coverSources.push(source);
      emit("library-changed", {});
      return copyGame(game);
    },

    /* ------------------------------------------------------------------- mods */

    async modsStatus(gameId) {
      return modsStatusOf(requireGame(gameId));
    },

    async installModLoader(gameId) {
      const game = requireGame(gameId);
      const pre = modsStatusOf(game);
      if (pre.loader !== "none") {
        throw uiError("VALIDATION", `a mod loader is already installed (${pre.loader})`);
      }
      if (pre.suggestedLoader === null) {
        throw uiError("VALIDATION", "no known mod loader for this game's engine");
      }
      await delay(networkMs);

      const bepinex = pre.suggestedLoader === "bepinex5";
      const seed = modsSeedFor(game.id);
      state.mods.set(gameId, {
        ...seed,
        loader: bepinex ? "bepinex" : "melonloader",
        // BepInEx keeps plugins in `BepInEx/plugins`; MelonLoader keeps user mods
        // in `MelonLoader/Mods`, which the contract files under the `mods` kind.
        modsDir: bepinex ? "BepInEx/plugins" : "MelonLoader/Mods",
        modsDirKind: bepinex ? "bepinex-plugins" : "mods",
      });
      // The core answers with a fresh detection pass, not a delta.
      return modsStatusOf(game);
    },

    async installModArchive(gameId, archivePath) {
      const game = requireGame(gameId);
      const status = modsStatusOf(game);
      const archive = archivePath.trim();

      if (status.modsDir === null) {
        throw uiError("VALIDATION", "no mods folder found — install a mod loader first");
      }
      if (!ARCHIVE_PATTERN.test(archive)) {
        throw uiError("VALIDATION", "unsupported archive type — use .zip, .7z or .rar");
      }
      await delay(networkMs);

      // The core shells out to 7z and reports the top-level entries it moved into
      // the mods folder. There is no archive to read here, so the mock reports the
      // entry the archive is named after — which is what a well-packed mod looks
      // like, and it keeps the reported shape (bare names, sorted) identical.
      const folder = baseName(archive).replace(ARCHIVE_PATTERN, "");
      const entries = folder.length > 0 ? [folder] : [];
      const seed = modsSeedFor(game.id);
      state.mods.set(gameId, {
        ...seed,
        installed: [...new Set([...seed.installed, ...entries])],
      });

      const trashed = !trashFails;
      if (trashed) trashedArchives.push(archive);
      return { installed: [...entries].sort(), modsDir: status.modsDir, trashed };
    },

    /* ------------------------------------------------------- shell integration */

    async pickDirectory() {
      const taken = new Set(state.sources.map((source) => source.path));
      const available = state.pickablePaths.find((path) => !taken.has(path));
      return available ?? `/home/oliwier/Downloads/zen-games-${state.nextSourceId}`;
    },

    async pickFile(options) {
      // The real dialog is filtered, so the emulated one only offers files the
      // caller's filter would have let through.
      const allowed = options?.filters?.[0]?.extensions;
      const match = state.pickableFiles.find(
        (path) =>
          allowed === undefined ||
          allowed.includes(path.split(".").pop()?.toLowerCase() ?? ""),
      );
      if (match !== undefined) return match;
      return allowed === undefined
        ? "/home/oliwier/Pictures/covers/cover.png"
        : `/home/oliwier/Downloads/picked.${allowed[0]}`;
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
