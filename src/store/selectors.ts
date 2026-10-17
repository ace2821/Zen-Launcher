import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { filterGames, sortGames } from "../lib/filter";
import type { Game } from "../lib/types";
import { useLibraryStore } from "./library";
import { useShellStore } from "./shell";

export function useCurrentLocale(): string {
  const { i18n } = useTranslation();
  return i18n.language;
}

/**
 * Search + sort applied to the library snapshot. Derived, never stored: the
 * store keeps the raw entities and the view pipeline stays pure and testable.
 */
export function useFilteredGames(): Game[] {
  const games = useLibraryStore((state) => state.games);
  const search = useShellStore((state) => state.search);
  const sort = useShellStore((state) => state.sort);
  const locale = useCurrentLocale();

  return useMemo(
    () => sortGames(filterGames(games, search), sort, locale),
    [games, search, sort, locale],
  );
}

export function usePendingCandidates() {
  const candidates = useLibraryStore((state) => state.candidates);
  return useMemo(
    () => candidates.filter((candidate) => candidate.status === "pending"),
    [candidates],
  );
}
