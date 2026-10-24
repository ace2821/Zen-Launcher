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
  GamepadEvent,
  GamepadInfo,
  GamepadList,
  LaunchInfo,
  LoaderUpdate,
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
  DEFAULT_GAMEPADS,
  genericDiscoveries,
  loaderName,
  loaderVersion,
  LOADER_CATALOG,
  loadersFor,
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
  /** Pads `list_gamepads` reports. Defaults to one Xbox pad (see `DEFAULT_GAMEPADS`). */
  gamepads?: GamepadInfo[];
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
  /**
   * Pushes one `gamepad-event` through the bus, so a test can drive Big Picture
   * the way a controller would. The real bus is written by the core's `gilrs`
   * thread; there is nothing for a mock to poll.
   */
  sendGamepadEvent(event: GamepadEvent): void;
}

function nowString(clock: () => Date): string {
  return clock().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The contract caps the reported mod list; the mock honours the same cap. */
const INSTALLED_CAP = 50;

const ARCHIVE_PATTERN = /\.(?:zip|7z|rar)$/i;
/** The last extension of a file name, whatever it is (`CoolMod.tar.gz` → `.gz`). */
const TRAILING_EXTENSION = /\.[a-z0-9]+$/i;
const IMAGE_PATTERN = /\.(?:png|jpe?g|webp)$/i;
/** The bounds `Settings::normalize_mods_max_mb` enforces on a patch. */
const MODS_MAX_MB_RANGE = { min: 1, max: 8192 } as const;

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
    client: game.client === null ? null : { ...game.client },
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
 * entries whose runner does not exist yet (retro/mod), and sessions are closed
 * with a timer.
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
  const gamepads = options.gamepads ?? DEFAULT_GAMEPADS;

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
        markers: [],
        installed: [],
      }
    );
  }

  /**
   * Mirrors `mods::status` — including the gate every mods command shares: the
   * core resolves the game folder first and refuses anything that is not a
   * Windows entry. The UI has to live with that answer, so the mock gives it.
   *
   * The catalog half (`supported`, `suggestedLoader`, `loaders`) is derived from
   * the detected engine, exactly as the core does it: an engine the catalog
   * knows nothing about is `supported: false`, which is an answer rather than an
   * error, and the UI renders it as "no known mod support".
   */
  function modsStatusOf(game: Game): ModsStatus {
    if (game.type !== "windows") {
      throw uiError("VALIDATION", "mod loading is only supported for Windows games");
    }
    const seed = modsSeedFor(game.id);
    const loaders = loadersFor(seed.engine, seed.markers);
    return {
      loader: seed.loader,
      modsDir: seed.modsDir === null ? null : `${game.installPath}/${seed.modsDir}`,
      modsDirKind: seed.modsDirKind,
      engine: seed.engine,
      supported: loaders.length > 0,
      suggestedLoader: loaders[0]?.id ?? null,
      loaders,
      installed: [...seed.installed].sort().slice(0, INSTALLED_CAP),
      installLoader: seed.installLoader ?? null,
    };
  }

  /**
   * Where a freshly installed loader keeps its mods — `ensure_loader_dirs` in the
   * core, which is also what makes the drop zone work right after installing.
   */
  function loaderLayout(loaderId: string): Pick<ModsSeed, "loader" | "modsDir" | "modsDirKind"> {
    // Mirrors `mods::ensure_loader_dirs` + detection ids per catalog entry.
    const layouts: Record<string, Pick<ModsSeed, "loader" | "modsDir" | "modsDirKind">> = {
      bepinex5: { loader: "bepinex", modsDir: "BepInEx/plugins", modsDirKind: "bepinex-plugins" },
      bepinex6mono: { loader: "bepinex", modsDir: "BepInEx/plugins", modsDirKind: "bepinex-plugins" },
      bepinex6il2cpp: { loader: "bepinex", modsDir: "BepInEx/plugins", modsDirKind: "bepinex-plugins" },
      melonloader: { loader: "melonloader", modsDir: "MelonLoader/Mods", modsDirKind: "mods" },
      neomodloader: {
        loader: "neomodloader",
        modsDir: "worldbox_Data/StreamingAssets/mods",
        modsDirKind: "mods",
      },
      tmodloader: { loader: "tmodloader", modsDir: null, modsDirKind: "external" },
      cleo5: { loader: "cleo", modsDir: "CLEO", modsDirKind: "mods" },
      cleo4: { loader: "cleo", modsDir: "CLEO", modsDirKind: "mods" },
      cleoredux: { loader: "cleoredux", modsDir: "CLEO", modsDirKind: "mods" },
      frosty: { loader: "frosty-moddata", modsDir: "ModData", modsDirKind: "mods" },
    };
    return layouts[loaderId] ?? { loader: "bepinex", modsDir: "BepInEx/plugins", modsDirKind: "bepinex-plugins" };
  }

  /** Co-install rules mirror `mods::coinstall_ok`. */
  function coinstallOk(current: string, next: string): boolean {
    return current === "none" || next === "frosty" || (next === "cleoredux" && current === "cleo");
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

    sendGamepadEvent(event: GamepadEvent) {
      emit("gamepad-event", { ...event });
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
        client: null,
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
      if (patch.client !== undefined) {
        game.client = patch.client === null ? null : { ...patch.client };
      }

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
      /*
       * The core launches native entries directly and Windows entries through
       * Wine, so both produce a session. A retro or mod entry still needs a
       * runner that has not landed yet, and is the one case the mock refuses —
       * matching the contract rather than inventing a process.
       */
      if (game.type !== "native" && game.type !== "windows") {
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
      if (patch.modsMaxMb !== undefined) {
        const mb = patch.modsMaxMb;
        if (
          !Number.isInteger(mb) ||
          mb < MODS_MAX_MB_RANGE.min ||
          mb > MODS_MAX_MB_RANGE.max
        ) {
          throw uiError(
            "VALIDATION",
            `modsMaxMb must be between ${MODS_MAX_MB_RANGE.min} and ${MODS_MAX_MB_RANGE.max}`,
          );
        }
      }
      if (
        patch.bigPictureLayout !== undefined &&
        !["auto", "xbox", "playstation"].includes(patch.bigPictureLayout)
      ) {
        throw uiError(
          "VALIDATION",
          "bigPictureLayout must be auto, xbox or playstation",
        );
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
      if (patch.autoCovers !== undefined) next.autoCovers = patch.autoCovers;
      if (patch.modsLenient !== undefined) next.modsLenient = patch.modsLenient;
      if (patch.modsMaxMb !== undefined) next.modsMaxMb = patch.modsMaxMb;
      if (patch.useGameMode !== undefined) next.useGameMode = patch.useGameMode;
      if (patch.useMangoHud !== undefined) next.useMangoHud = patch.useMangoHud;
      if (patch.bigPictureLayout !== undefined) {
        next.bigPictureLayout = patch.bigPictureLayout;
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

    async installModLoader(gameId, loaderId?: string) {
      const game = requireGame(gameId);
      const pre = modsStatusOf(game);
      // Same resolution as the core: an explicit id has to be a catalog entry
      // that supports this engine, an omitted one is the suggestion. Either way
      // an impossible choice is one message, not two.
      const chosen =
        loaderId === undefined
          ? pre.suggestedLoader
          : (pre.loaders.find((entry) => entry.id === loaderId)?.id ?? null);
      if (chosen === null) {
        throw uiError("VALIDATION", "no known mod loader supports this game's engine");
      }
      if (pre.loader !== "none" && !coinstallOk(pre.loader, chosen)) {
        throw uiError(
          "VALIDATION",
          `a mod loader is already installed (${pre.loader}) — ${loaderName(chosen)} cannot be layered on top`,
        );
      }
      if (pre.loaders.find((entry) => entry.id === chosen)?.install === "manual") {
        throw uiError("VALIDATION", `${loaderName(chosen)} is installed with its own tooling`);
      }
      await delay(networkMs);

      const seed = modsSeedFor(game.id);
      state.mods.set(gameId, {
        ...seed,
        ...loaderLayout(chosen),
        installLoader: { id: chosen, version: loaderVersion(chosen) },
      });
      // The core answers with a fresh detection pass, not a delta.
      return modsStatusOf(game);
    },

    async checkLoaderUpdates(gameId): Promise<LoaderUpdate | null> {
      const game = requireGame(gameId);
      const seed = modsSeedFor(game.id);
      const installed = seed.installLoader ?? null;
      if (installed === null) return null;
      // Manual loaders carry no download, so the core never checks them.
      const spec = LOADER_CATALOG.find((entry) => entry.id === installed.id);
      if (spec?.install === "manual") return null;
      const latest = loaderVersion(installed.id);
      await delay(networkMs);
      return {
        loaderId: installed.id,
        current: installed.version,
        latest,
        assetUrl: null,
        updatable: latest !== installed.version,
      };
    },

    async installModArchive(gameId, archivePath) {
      const game = requireGame(gameId);
      const status = modsStatusOf(game);
      const archive = archivePath.trim();
      // The validation rules are settings-driven, so the mock reads them per
      // call — a user who switches to strict mode mid-session gets strict mode.
      const lenient = state.settings.modsLenient;

      if (status.modsDir === null) {
        throw uiError("VALIDATION", "no mods folder found — install a mod loader first");
      }
      if (!lenient && !ARCHIVE_PATTERN.test(archive)) {
        throw uiError("VALIDATION", "unsupported archive type — use .zip, .7z or .rar");
      }
      /**
       * Two rules need a real archive on disk and are therefore *not* emulated
       * here: the `modsMaxMb` size cap and the symlink policy. The core reads the
       * file through `7z`; the mock has no file, and inventing a size would be
       * exactly the kind of pretend answer the UI must not be built on.
       */
      await delay(networkMs);

      // The core shells out to 7z and reports the top-level entries it moved into
      // the mods folder. There is no archive to read here, so the mock reports the
      // entry the archive is named after, minus its extension — which is what a
      // well-packed mod looks like, and it keeps the reported shape (bare names,
      // sorted) identical.
      const folder = baseName(archive).replace(TRAILING_EXTENSION, "");
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

    /* -------------------------------------------------------------- gamepad */

    async listGamepads(): Promise<GamepadList> {
      // One pad by default, so `bigPictureLayout: "auto"` resolves to a real
      // answer instead of falling through to the fallback.
      return { pads: gamepads.map((pad) => ({ ...pad })) };
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
