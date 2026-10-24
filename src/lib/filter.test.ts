import { describe, expect, it } from "vitest";
import { filterGames, normalizeSearchText, sortGames } from "./filter";
import type { Game } from "./types";

function makeGame(overrides: Partial<Game> & { id: number; title: string }): Game {
  return {
    sortTitle: null,
    type: "native",
    installPath: `/games/${overrides.id}`,
    executable: `/games/${overrides.id}/run`,
    args: [],
    env: {},
    workDir: null,
    tags: [],
    favorite: false,
    hidden: false,
    notes: null,
    coverPath: null,
    client: null,
    status: "ready",
    createdAt: "2026-10-17T12:00:00Z",
    updatedAt: "2026-10-17T12:00:00Z",
    lastPlayedAt: null,
    totalSeconds: 0,
    ...overrides,
  };
}

const CELESTE = makeGame({
  id: 1,
  title: "Celeste",
  tags: ["platformer", "precision"],
  installPath: "/games/itch/celeste",
  totalSeconds: 48_300,
  lastPlayedAt: "2026-10-05T21:00:00Z",
});

const MORROWIND = makeGame({
  id: 2,
  title: "The Elder Scrolls III: Morrowind",
  sortTitle: "Elder Scrolls III: Morrowind",
  type: "windows",
  tags: ["rpg"],
  totalSeconds: 94_800,
  lastPlayedAt: "2026-09-19T22:15:00Z",
});

const DUPA = makeGame({
  id: 3,
  title: "Zażółć Gęślą Jaźń",
  tags: ["polish"],
  totalSeconds: 0,
});

const OPEN_TTD = makeGame({
  id: 4,
  title: "OpenTTD",
  tags: ["tycoon"],
  totalSeconds: 223_200,
  lastPlayedAt: "2026-09-28T18:22:00Z",
});

const ALL = [CELESTE, MORROWIND, DUPA, OPEN_TTD];

describe("normalizeSearchText", () => {
  it("folds case, accents and Polish letters", () => {
    expect(normalizeSearchText("Łódź")).toBe("lodz");
    expect(normalizeSearchText("  Zażółć Gęślą  ")).toBe("zazolc gesla");
    expect(normalizeSearchText("CAFÉ")).toBe("cafe");
    expect(normalizeSearchText("Straße")).toBe("strasse");
  });
});

describe("filterGames", () => {
  it("returns everything for an empty or whitespace query", () => {
    expect(filterGames(ALL, "")).toHaveLength(4);
    expect(filterGames(ALL, "   ")).toHaveLength(4);
  });

  it("matches title, tags and install path, diacritic-insensitively", () => {
    expect(filterGames(ALL, "celeste").map((game) => game.id)).toEqual([1]);
    expect(filterGames(ALL, "tycoon").map((game) => game.id)).toEqual([4]);
    expect(filterGames(ALL, "itch").map((game) => game.id)).toEqual([1]);
    expect(filterGames(ALL, "zazolc").map((game) => game.id)).toEqual([3]);
  });

  it("requires every term to match, so extra words narrow the set", () => {
    expect(filterGames(ALL, "elder scrolls").map((game) => game.id)).toEqual([2]);
    expect(filterGames(ALL, "elder celeste")).toHaveLength(0);
  });

  it("matches the sort title even when it differs from the display title", () => {
    expect(filterGames(ALL, "morrowind").map((game) => game.id)).toEqual([2]);
  });

  it("never mutates the input array", () => {
    const input = [...ALL];
    filterGames(input, "celeste");
    expect(input).toEqual(ALL);
  });
});

describe("sortGames", () => {
  it("sorts by title, honouring sortTitle", () => {
    expect(sortGames(ALL, "title", "en").map((game) => game.id)).toEqual([
      1, 2, 4, 3,
    ]);
  });

  it("sorts by most recent session, pushing never-played entries last", () => {
    expect(sortGames(ALL, "recent", "en").map((game) => game.id)).toEqual([
      1, 4, 2, 3,
    ]);
  });

  it("sorts by playtime, highest first", () => {
    expect(sortGames(ALL, "playtime", "en").map((game) => game.id)).toEqual([
      4, 2, 1, 3,
    ]);
  });

  it("returns a new array and leaves the input order untouched", () => {
    const input = [...ALL];
    const sorted = sortGames(input, "playtime", "en");
    expect(sorted).not.toBe(input);
    expect(input).toEqual(ALL);
  });
});
