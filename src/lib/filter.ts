import type { Game } from "./types";

export type GameSort = "title" | "recent" | "playtime";

export const GAME_SORTS: readonly GameSort[] = ["title", "recent", "playtime"];

const FOLD: Readonly<Record<string, string>> = {
  ł: "l",
  ż: "z",
  ź: "z",
  ś: "s",
  ć: "c",
  ń: "n",
  ą: "a",
  ę: "e",
  ó: "o",
  ß: "ss",
  đ: "d",
  ø: "o",
  æ: "ae",
};

/**
 * Case-, accent- and diacritic-insensitive fold used for library search. Polish
 * letters are folded explicitly because NFD does not decompose `ł`/`ż`/`ś`.
 */
export function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /[łżźśćńąęóßđøæ]/g,
      (character) => FOLD[character] ?? character,
    )
    .trim();
}

function searchableText(game: Game): string {
  return [game.title, game.sortTitle ?? "", game.installPath, ...game.tags].join(
    "\n",
  );
}

/**
 * Every whitespace-separated term must match, so each extra word narrows the
 * result set.
 */
export function filterGames(games: readonly Game[], query: string): Game[] {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...games];
  return games.filter((game) => {
    const haystack = normalizeSearchText(searchableText(game));
    return terms.every((term) => haystack.includes(term));
  });
}

function titleKey(game: Game): string {
  return game.sortTitle ?? game.title;
}

function lastPlayedValue(game: Game): number {
  return game.lastPlayedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(game.lastPlayedAt);
}

/** Returns a new array; the input order is never mutated. */
export function sortGames(
  games: readonly Game[],
  sort: GameSort,
  locale: string,
): Game[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const byTitle = (a: Game, b: Game) => collator.compare(titleKey(a), titleKey(b));
  const copy = [...games];

  switch (sort) {
    case "title":
      return copy.sort(byTitle);
    case "recent":
      return copy.sort((a, b) => {
        const difference = lastPlayedValue(b) - lastPlayedValue(a);
        return difference !== 0 ? difference : byTitle(a, b);
      });
    case "playtime":
      return copy.sort((a, b) => {
        const difference = b.totalSeconds - a.totalSeconds;
        return difference !== 0 ? difference : byTitle(a, b);
      });
  }
}
