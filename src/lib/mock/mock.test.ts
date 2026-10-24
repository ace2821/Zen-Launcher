import { beforeEach, describe, expect, it } from "vitest";
import type {
  GamepadEvent,
  ScanProgressEvent,
  ScanSummary,
  SessionEndedEvent,
  SessionStartedEvent,
} from "../types";
import { DEFAULT_SETTINGS, SEED_NOW } from "./data";
import { createMockApi, type MockApi } from "./index";
/**
 * The mock adapter is the reference emulation of the frozen contract, so it is
 * tested as a contract: shapes, guarantees and refusal cases — not internals.
 */
function makeApi(): MockApi {
  return createMockApi({
    scanStepMs: 0,
    sessionMs: 30,
    now: () => new Date(SEED_NOW),
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let api: MockApi;

beforeEach(() => {
  api = makeApi();
});

describe("mock adapter — seed", () => {
  it("starts from a library that covers every M1 case", async () => {
    const games = await api.listGames();
    const sources = await api.listSources();
    const candidates = await api.listCandidates();

    expect(sources.length).toBeGreaterThanOrEqual(3);
    expect(games.length).toBeGreaterThanOrEqual(8);

    // Types, statuses and play history all appear in the seed.
    expect(new Set(games.map((game) => game.type))).toEqual(
      new Set(["native", "windows", "retro", "mod"]),
    );
    expect(games.some((game) => game.status === "missing")).toBe(true);
    expect(games.some((game) => game.totalSeconds === 0)).toBe(true);

    // One pending candidate per engine, and candidates without an executable.
    const pending = candidates.filter((candidate) => candidate.status === "pending");
    expect(pending.length).toBeGreaterThanOrEqual(6);
    expect(pending.some((candidate) => candidate.executable === null)).toBe(true);
    expect(candidates.some((candidate) => candidate.status === "rejected")).toBe(true);
  });

  it("sorts games by title and hands out copies", async () => {
    const first = await api.listGames();
    const titles = first.map((game) => game.sortTitle ?? game.title);
    expect([...titles].sort((a, b) => a.localeCompare(b, "en"))).toEqual(titles);

    first[0].title = "mutated";
    first[0].tags.push("mutated");
    const again = await api.listGames();
    expect(again[0].title).not.toBe("mutated");
    expect(again[0].tags).not.toContain("mutated");
  });

  it("keeps the documented settings defaults", async () => {
    await expect(api.getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("loads a config written before the appearance keys existed", async () => {
    // Exactly what an install from the previous milestone has on disk.
    const legacy = createMockApi({
      settings: { language: "pl", closeToTray: false, hideOnLaunch: false },
    });
    await expect(legacy.getSettings()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      language: "pl",
      closeToTray: false,
      hideOnLaunch: false,
    });
  });

  it("keeps usable stored values and defaults the unusable ones", async () => {
    const stored = createMockApi({
      settings: {
        // A file from a build that knew an id this one does not: handed to the
        // UI unchanged on purpose, because *it* owns the graceful fallback.
        font: "comic-neue",
        // Nonsense in the file must not cost the user their other settings.
        accent: "   ",
        onboardingCompleted: true,
        language: "de" as unknown as "en",
      },
    });
    await expect(stored.getSettings()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      font: "comic-neue",
      onboardingCompleted: true,
    });
  });
});

describe("mock adapter — scanning", () => {
  it("reports progress, finishes, and files the discoveries as pending candidates", async () => {
    const progress: ScanProgressEvent[] = [];
    const finished: ScanSummary[] = [];
    await api.on("scan-progress", (payload) => progress.push(payload));
    await api.on("scan-finished", (payload) => finished.push(payload));

    const before = await api.listCandidates();
    const summary = await api.scanSource(1);
    const after = await api.listCandidates();

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((event) => event.sourceId === 1)).toBe(true);
    expect(finished).toEqual([summary]);
    expect(summary.sourceId).toBe(1);
    expect(summary.candidatesFound).toBeGreaterThan(0);
    expect(after.length).toBe(before.length + summary.candidatesFound);

    const created = after.filter(
      (candidate) => !before.some((entry) => entry.id === candidate.id),
    );
    expect(created.every((candidate) => candidate.status === "pending")).toBe(true);

    const sources = await api.listSources();
    expect(sources.find((source) => source.id === 1)?.lastScanAt).not.toBeNull();
  });

  it("refuses unknown sources", async () => {
    await expect(api.scanSource(999)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("treats an existing scan root as idempotent and rejects blank paths", async () => {
    const [existing] = await api.listSources();
    const sourcesBefore = await api.listSources();

    // Contract: adding a root that is already known returns the existing row.
    await expect(api.addSource(existing.path)).resolves.toEqual(existing);
    expect(await api.listSources()).toEqual(sourcesBefore);

    await expect(api.addSource("   ")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("forgets a root while its candidates stay detached", async () => {
    const all = await api.listCandidates();
    const fromRootOne = all.filter((candidate) => candidate.sourceId === 1);
    expect(fromRootOne.length).toBeGreaterThan(0);
    const gamesBefore = await api.listGames();

    await api.removeSource(1);

    const after = await api.listCandidates();
    expect(after).toHaveLength(all.length);
    expect(after.filter((candidate) => candidate.sourceId === 1)).toHaveLength(0);
    expect(after.filter((candidate) => candidate.sourceId === null)).toHaveLength(
      fromRootOne.length,
    );
    expect(await api.listGames()).toEqual(gamesBefore);
    await expect(api.scanSource(1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("mock adapter — candidate review", () => {
  it("approves with an edited title and executable", async () => {
    const gamesBefore = await api.listGames();
    const game = await api.approveCandidate(101, {
      title: "Death's Door (GOG)",
      executable: "/tmp/fake/DeathsDoor.x86_64",
    });

    expect(game.title).toBe("Death's Door (GOG)");
    expect(game.executable).toBe("/tmp/fake/DeathsDoor.x86_64");
    expect(game.type).toBe("native");
    expect(game.status).toBe("ready");
    expect(game.favorite).toBe(false);

    const games = await api.listGames();
    expect(games.length).toBe(gamesBefore.length + 1);

    const candidates = await api.listCandidates();
    expect(candidates.find((entry) => entry.id === 101)?.status).toBe("approved");
  });

  it("infers a windows entry from a .exe and emulates a missing file", async () => {
    const windows = await api.approveCandidate(103, {
      executable: "/tmp/fake/Tournament.exe",
    });
    expect(windows.type).toBe("windows");
    expect(windows.status).toBe("ready");

    const missing = await api.approveCandidate(102, {
      executable: "/home/oliwier/Games/Rogue Legacy/RogueLegacy.x86_64",
    });
    expect(missing.status).toBe("missing");
  });

  it("refuses an approval without an executable or without a title", async () => {
    await expect(api.approveCandidate(107)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      api.approveCandidate(101, { executable: "   " }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(api.approveCandidate(101, { title: "  " })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("refuses to re-decide a candidate", async () => {
    await api.rejectCandidate(101);
    await expect(api.approveCandidate(101)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(api.rejectCandidate(109)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("rejects a candidate and announces the change", async () => {
    let changes = 0;
    await api.on("library-changed", () => {
      changes += 1;
    });

    await api.rejectCandidate(106);

    const candidates = await api.listCandidates();
    expect(candidates.find((entry) => entry.id === 106)?.status).toBe("rejected");
    expect(changes).toBeGreaterThan(0);
    // Rejection never removes anything from the library.
    expect((await api.listGames()).length).toBeGreaterThan(0);
  });
});

describe("mock adapter — games", () => {
  it("validates updates instead of storing empty values", async () => {
    await expect(api.updateGame(1, { title: "" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(api.updateGame(1, { executable: " " })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(api.updateGame(999, { favorite: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("round-trips the launch-options subset of the patch", async () => {
    const updated = await api.updateGame(2, {
      args: ["-screen-width", "1920", "Player One"],
      env: { SDL_VIDEODRIVER: "x11" },
      workDir: null,
      favorite: true,
      notes: "hello",
    });

    expect(updated.args).toEqual(["-screen-width", "1920", "Player One"]);
    expect(updated.env).toEqual({ SDL_VIDEODRIVER: "x11" });
    expect(updated.workDir).toBeNull();
    expect(updated.favorite).toBe(true);
    expect(updated.notes).toBe("hello");

    // A fresh read returns the stored values, not the patch object we sent.
    const reread = await api.getGame(2);
    expect(reread.args).toEqual(updated.args);
    expect(reread.env).toEqual(updated.env);
  });

  it("round-trips client metadata and distinguishes omitted from null", async () => {
    const samp = {
      kind: "samp" as const,
      host: "play.example.com",
      port: 7777,
      nick: "Zen",
    };
    const updated = await api.updateGame(2, { client: samp });
    expect(updated.client).toEqual(samp);
    expect((await api.getGame(2)).client).toEqual(samp);

    // Omitted `client` keeps the stored value — unlike an explicit null.
    const kept = await api.updateGame(2, { favorite: true });
    expect(kept.client).toEqual(samp);

    const cleared = await api.updateGame(2, { client: null });
    expect(cleared.client).toBeNull();
    expect((await api.getGame(2)).client).toBeNull();
  });

  it("refuses entries whose runner has not landed, and a missing executable", async () => {
    // A mod (7) and a retro (10) entry still need a runner that arrives after
    // M1; a native entry whose binary is gone (11) is an IO failure.
    await expect(api.launchGame(7)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(api.launchGame(10)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(api.launchGame(11)).rejects.toMatchObject({ code: "IO" });
  });

  it("opens a session for a Windows entry, the same shape as a native one", async () => {
    const started: SessionStartedEvent[] = [];
    await api.on("session-started", (payload) => started.push(payload));

    // Morrowind (9) is a Windows entry: the core runs it through Wine.
    const info = await api.launchGame(9);
    expect(started).toHaveLength(1);
    expect(started[0].gameId).toBe(9);
    expect(started[0].sessionId).toBe(info.sessionId);

    const running = await api.listSessions(9, 1);
    expect(running[0].endedAt).toBeNull();
  });

  it("opens and closes a session for a native entry", async () => {
    const started: SessionStartedEvent[] = [];
    const ended: SessionEndedEvent[] = [];
    await api.on("session-started", (payload) => started.push(payload));
    await api.on("session-ended", (payload) => ended.push(payload));

    const info = await api.launchGame(1);
    expect(started).toHaveLength(1);
    expect(started[0].gameId).toBe(1);
    expect(started[0].sessionId).toBe(info.sessionId);

    const running = await api.listSessions(1, 1);
    expect(running[0].endedAt).toBeNull();
    expect(running[0].durationSeconds).toBeNull();

    await sleep(60);

    expect(ended).toHaveLength(1);
    expect(ended[0].sessionId).toBe(info.sessionId);
    expect(ended[0].exitCode).toBe(0);

    const closed = await api.listSessions(1, 1);
    expect(closed[0].endedAt).not.toBeNull();
    expect(closed[0].durationSeconds).toBeGreaterThan(0);
  });

  it("returns the newest sessions first, capped by the limit", async () => {
    const sessions = await api.listSessions(1);
    expect(sessions.length).toBeGreaterThan(5);
    for (let index = 1; index < sessions.length; index += 1) {
      expect(Date.parse(sessions[index - 1].startedAt)).toBeGreaterThanOrEqual(
        Date.parse(sessions[index].startedAt),
      );
    }
    expect(await api.listSessions(1, 3)).toHaveLength(3);
  });

  it("removes an entry and its history without touching anything else", async () => {
    const games = await api.listGames();
    const sessions = await api.listSessions(1);

    await api.removeGame(1);

    const remaining = await api.listGames();
    expect(remaining.length).toBe(games.length - 1);
    expect(remaining.some((game) => game.id === 1)).toBe(false);
    await expect(api.getGame(1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await api.listSessions(1)).toHaveLength(0);
    expect(sessions.length).toBeGreaterThan(0);
  });
});

describe("mock adapter — shell integration", () => {
  it("validates settings patches", async () => {
    await expect(
      api.updateSettings({ language: "de" as unknown as "en" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(api.updateSettings({ closeToTray: false })).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      closeToTray: false,
    });
  });

  it("refuses a size limit or a glyph theme the core would refuse", async () => {
    for (const mb of [0, 8193, 1.5, Number.NaN]) {
      await expect(api.updateSettings({ modsMaxMb: mb })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    await expect(
      api.updateSettings({
        bigPictureLayout: "switch" as unknown as "auto",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    // A refused patch leaves every stored value exactly where it was.
    await expect(api.getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips all six fields this round added", async () => {
    const patched = await api.updateSettings({
      autoCovers: false,
      modsLenient: false,
      modsMaxMb: 4096,
      useGameMode: false,
      useMangoHud: true,
      bigPictureLayout: "playstation",
    });

    expect(patched).toEqual({
      ...DEFAULT_SETTINGS,
      autoCovers: false,
      modsLenient: false,
      modsMaxMb: 4096,
      useGameMode: false,
      useMangoHud: true,
      bigPictureLayout: "playstation",
    });
    await expect(api.getSettings()).resolves.toEqual(patched);

    // And one field at a time, without dragging the others along.
    const single = await api.updateSettings({ bigPictureLayout: "xbox" });
    expect(single.bigPictureLayout).toBe("xbox");
    expect(single.modsMaxMb).toBe(4096);
    expect(single.useMangoHud).toBe(true);
  });

  it("applies appearance fields one at a time and keeps the rest", async () => {
    const afterFont = await api.updateSettings({ font: "instrument-sans" });
    expect(afterFont.font).toBe("instrument-sans");
    expect(afterFont.accent).toBe("jade");

    const afterAccent = await api.updateSettings({ accent: "plum" });
    expect(afterAccent).toEqual({
      ...DEFAULT_SETTINGS,
      font: "instrument-sans",
      accent: "plum",
    });

    // Finishing the tour is one more field, nothing else moves.
    const finished = await api.updateSettings({ onboardingCompleted: true });
    expect(finished.font).toBe("instrument-sans");
    expect(finished.onboardingCompleted).toBe(true);
  });

  it("refuses appearance ids the core would refuse", async () => {
    // Same rule as the core: trim, then reject empty / >32 chars / outside [a-z0-9-].
    const rejected = [
      "",
      "   ",
      "Jade",
      "maple mono",
      "jade!",
      "a".repeat(33),
    ];
    for (const value of rejected) {
      await expect(api.updateSettings({ font: value })).rejects.toMatchObject({
        code: "VALIDATION",
      });
      await expect(api.updateSettings({ accent: value })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }

    // A stored value survives a refused patch.
    await api.updateSettings({ accent: "rose" });
    await expect(api.updateSettings({ accent: "Rose" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect((await api.getSettings()).accent).toBe("rose");
  });

  it("trims an id that arrives with padding", async () => {
    await expect(api.updateSettings({ font: "  system  " })).resolves.toMatchObject({
      font: "system",
    });
  });

  it("hands out a fresh directory each time and records revealed paths", async () => {
    const first = await api.pickDirectory();
    expect(first).not.toBeNull();

    const source = await api.addSource(first as string);
    const second = await api.pickDirectory();
    expect(second).not.toBe(first);
    expect(source.lastScanAt).toBeNull();

    await api.revealItemInDir("/tmp/x");
    expect(api.revealedPaths).toEqual(["/tmp/x"]);
  });

  it("resets back to the seed", async () => {
    await api.rejectCandidate(101);
    await api.removeGame(1);
    api.reset();

    expect((await api.listCandidates()).find((entry) => entry.id === 101)?.status).toBe(
      "pending",
    );
    expect((await api.listGames()).some((game) => game.id === 1)).toBe(true);
    expect(api.revealedPaths).toEqual([]);
  });

  it("unsubscribes listeners through the returned function", async () => {
    let hits = 0;
    const off = await api.on("library-changed", () => {
      hits += 1;
    });
    await api.rejectCandidate(101);
    expect(hits).toBe(1);
    off();
    await api.rejectCandidate(102);
    expect(hits).toBe(1);
  });
});

describe("mock adapter — covers", () => {
  it("refuses an empty query the way the core does", async () => {
    await expect(api.fetchCoverCandidates("   ")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("answers a search with poster-ready candidates, deterministically", async () => {
    const found = await api.fetchCoverCandidates("Hollow Knight");

    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(8);
    expect(found[0]).toMatchObject({ provider: "steam", name: "Hollow Knight" });
    // The mock never touches the network: every URL is inline.
    expect(
      found.every(
        (entry) =>
          entry.thumbUrl.startsWith("data:image/") &&
          (entry.portraitUrl === null || entry.portraitUrl.startsWith("data:image/")),
      ),
    ).toBe(true);
    // Some store entries have no library art; the UI has to fall back.
    expect(found.some((entry) => entry.portraitUrl === null)).toBe(true);
    await expect(api.fetchCoverCandidates("Hollow Knight")).resolves.toEqual(found);
  });

  it("stores a picked cover and announces the library change", async () => {
    const changes: number[] = [];
    await api.on("library-changed", () => changes.push(1));

    const [candidate] = await api.fetchCoverCandidates("Celeste");
    const url = candidate.portraitUrl ?? candidate.thumbUrl;
    const updated = await api.downloadCover(2, url);

    expect(updated.id).toBe(2);
    expect(updated.coverPath).toMatch(/^data:image\//);
    expect(api.downloadedCoverUrls).toEqual([url]);
    expect(changes).toHaveLength(1);
    await expect(api.getGame(2)).resolves.toMatchObject({
      coverPath: updated.coverPath,
    });
  });

  it("refuses a cover URL that is not an image source", async () => {
    await expect(api.downloadCover(1, "file:///etc/passwd")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(api.downloadCover(999, "https://example.test/a.png")).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
  });

  it("copies a local image in, leaving the source untouched", async () => {
    const updated = await api.setCoverFromFile(1, "/home/oliwier/art/hollow-alt.png");

    expect(updated.coverPath).toMatch(/^data:image\//);
    expect(api.coverSources).toEqual(["/home/oliwier/art/hollow-alt.png"]);
    await expect(api.setCoverFromFile(1, "/home/oliwier/notes.txt")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("mock adapter — mods", () => {
  it("refuses mods for anything that is not a Windows entry", async () => {
    // The core resolves the game folder for every mods command and rejects
    // non-Windows entries there, so the mock does the same.
    await expect(api.modsStatus(1)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(api.installModLoader(1)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("reports the loader, the mods folder and what is installed", async () => {
    const bepinex = await api.modsStatus(13);
    expect(bepinex).toMatchObject({
      loader: "bepinex",
      modsDir: "/home/oliwier/Games/ULTRAKILL/BepInEx/plugins",
      modsDirKind: "bepinex-plugins",
      engine: "unity-mono",
      suggestedLoader: "bepinex5",
    });
    // Sorted, as the core's directory listing is.
    expect(bepinex.installed).toEqual(["CustomWeapons.dll", "UltraQoL", "config"]);

    await expect(api.modsStatus(12)).resolves.toMatchObject({
      loader: "none",
      modsDir: null,
      modsDirKind: "none",
      engine: "unity-il2cpp",
      suggestedLoader: "melonloader",
      installed: [],
    });

    // A community doorstop loader files its mods under `Mods/`.
    await expect(api.modsStatus(9)).resolves.toMatchObject({
      loader: "doorstop",
      modsDir: "/home/oliwier/Games/Morrowind/Mods",
      modsDirKind: "mods",
      suggestedLoader: null,
    });
  });

  it("ranks the catalog for the engine, and says so when there is none", async () => {
    const il2cpp = await api.modsStatus(12);
    expect(il2cpp.supported).toBe(true);
    expect(il2cpp.loaders.map((entry) => entry.id)).toEqual([
      "melonloader",
      "bepinex6il2cpp",
    ]);
    // The top of that ranking is the suggestion — never a separate list.
    expect(il2cpp.suggestedLoader).toBe(il2cpp.loaders[0].id);
    // The names are the products, not ids: the UI prints them verbatim.
    expect(il2cpp.loaders[0].name).toBe("MelonLoader");

    // Morrowind's engine could not be told apart, which is an answer: no loader
    // to offer and nothing for the UI to write.
    await expect(api.modsStatus(9)).resolves.toMatchObject({
      supported: false,
      suggestedLoader: null,
      loaders: [],
    });
  });

  it("refuses a second loader, or one the engine gives no reason for", async () => {
    await expect(api.installModLoader(13)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(api.installModLoader(9)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    // An explicit id still has to be a catalog entry this engine can run.
    await expect(api.installModLoader(12, "bepinex5")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("installs the loader the id names, not the suggestion", async () => {
    const after = await api.installModLoader(12, "bepinex6il2cpp");

    expect(after).toMatchObject({
      loader: "bepinex",
      modsDir: "/home/oliwier/Games/Vampire Survivors/BepInEx/plugins",
      modsDirKind: "bepinex-plugins",
    });
  });

  it("records the installed loader and checks it without faking an update", async () => {
    const after = await api.installModLoader(12, "bepinex6il2cpp");
    expect(after.installLoader).toEqual({ id: "bepinex6il2cpp", version: "6.0.0" });

    // A detected/manual loader has no `loader.json` equivalent → no check.
    await expect(api.checkLoaderUpdates(13)).resolves.toBeNull();

    await expect(api.checkLoaderUpdates(12)).resolves.toEqual({
      loaderId: "bepinex6il2cpp",
      current: "6.0.0",
      latest: "6.0.0",
      assetUrl: null,
      updatable: false,
    });
  });

  it("installs the suggested loader and reports the new layout", async () => {
    const after = await api.installModLoader(12);

    expect(after).toMatchObject({
      loader: "melonloader",
      modsDir: "/home/oliwier/Games/Vampire Survivors/MelonLoader/Mods",
      modsDirKind: "mods",
    });
    // Installing twice is refused rather than silently repeated.
    await expect(api.installModLoader(12)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("installs an archive into the mods folder and trashes it", async () => {
    const result = await api.installModArchive(13, "/tmp/CoolMod-2.1.zip");

    expect(result).toMatchObject({
      modsDir: "/home/oliwier/Games/ULTRAKILL/BepInEx/plugins",
      trashed: true,
    });
    expect(result.installed).toEqual(["CoolMod-2.1"]);
    expect(api.trashedArchives).toEqual(["/tmp/CoolMod-2.1.zip"]);
    await expect(api.modsStatus(13)).resolves.toMatchObject({
      installed: ["CoolMod-2.1", "CustomWeapons.dll", "UltraQoL", "config"],
    });
  });

  it("keeps the archive when the move to the trash fails", async () => {
    const failing = createMockApi({
      trashFails: true,
      now: () => new Date(SEED_NOW),
    });

    const result = await failing.installModArchive(13, "/tmp/CoolMod.zip");

    expect(result.trashed).toBe(false);
    expect(failing.trashedArchives).toEqual([]);
  });

  it("holds an archive to the validation mode the settings name", async () => {
    // Vampire Survivors has no mods folder yet: refused whatever the rules say.
    await expect(api.installModArchive(12, "/tmp/CoolMod.zip")).rejects.toMatchObject({
      code: "VALIDATION",
    });

    // Lenient (the default) accepts any type, because that is what the core asks
    // 7z to read. The limit and the symlink rule need a real archive on disk and
    // are therefore not emulated here at all.
    await expect(api.installModArchive(13, "/tmp/CoolMod.tar.gz")).resolves.toMatchObject({
      modsDir: "/home/oliwier/Games/ULTRAKILL/BepInEx/plugins",
      trashed: true,
    });

    // Strict: the three archive types and nothing else.
    await api.updateSettings({ modsLenient: false });
    await expect(api.installModArchive(13, "/tmp/Another.tar.gz")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(api.installModArchive(13, "/tmp/CoolMod.7z")).resolves.toMatchObject({
      trashed: true,
    });
  });
});

describe("mock adapter — gamepad", () => {
  it("answers list_gamepads in the contract shape", async () => {
    await expect(api.listGamepads()).resolves.toEqual({
      pads: [{ id: 0, name: "Xbox Wireless Controller", kind: "xbox" }],
    });
  });

  it("can be told there is no pad, or a different family", async () => {
    const none = createMockApi({ gamepads: [] });
    await expect(none.listGamepads()).resolves.toEqual({ pads: [] });

    const dualsense = createMockApi({
      gamepads: [{ id: 1, name: "DualSense Wireless Controller", kind: "playstation" }],
    });
    await expect(dualsense.listGamepads()).resolves.toEqual({
      pads: [{ id: 1, name: "DualSense Wireless Controller", kind: "playstation" }],
    });
  });

  it("pushes gamepad events through the bus a test can drive", async () => {
    const seen: GamepadEvent[] = [];
    await api.on("gamepad-event", (payload) => seen.push(payload));

    api.sendGamepadEvent({
      kind: "button-press",
      pad: 0,
      name: "South",
      code: "South",
    });

    expect(seen).toEqual([
      { kind: "button-press", pad: 0, name: "South", code: "South" },
    ]);
  });
});
