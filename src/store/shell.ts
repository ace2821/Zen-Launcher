import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GameSort } from "../lib/filter";

export type ViewName =
  | "library"
  | "import"
  | "settings"
  | "game"
  | "bigPicture"
  | "bigPictureDashboard"
  | "marketplace"
  | "statystyki";
export type LayoutMode = "grid" | "list";

interface ShellState {
  view: ViewName;
  selectedGameId: number | null;
  search: string;
  sort: GameSort;
  layout: LayoutMode;

  goToLibrary(): void;
  goToImport(): void;
  goToSettings(): void;
  goToMarketplace(): void;
  goToStatistics(): void;
  goToGame(gameId: number): void;
  /** Fullscreen couch view; `goToLibrary` (or Escape) is the way back. */
  goToBigPicture(): void;
  /** PS5-style dashboard view; `goToLibrary` (or Escape) is the way back. */
  goToBigPictureDashboard(): void;
  setSearch(value: string): void;
  setSort(sort: GameSort): void;
  setLayout(layout: LayoutMode): void;
}

const INITIAL = {
  view: "library" as ViewName,
  selectedGameId: null,
  search: "",
  sort: "title" as GameSort,
  layout: "grid" as LayoutMode,
};

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      ...INITIAL,

      goToLibrary: () => set({ view: "library", selectedGameId: null }),
      goToImport: () => set({ view: "import", selectedGameId: null }),
      goToSettings: () => set({ view: "settings", selectedGameId: null }),
      goToGame: (gameId) => set({ view: "game", selectedGameId: gameId }),
      goToBigPicture: () => set({ view: "bigPicture" }),
      goToBigPictureDashboard: () => set({ view: "bigPictureDashboard" }),
      goToMarketplace: () => set({ view: "marketplace", selectedGameId: null }),
      goToStatistics: () => set({ view: "statystyki", selectedGameId: null }),
      setSearch: (search) => set({ search }),
      setSort: (sort) => set({ sort }),
      setLayout: (layout) => set({ layout }),
    }),
    {
      name: "zinc-launcher.ui",
      // Navigation and the transient search are deliberately not persisted.
      partialize: (state) => ({ sort: state.sort, layout: state.layout }),
    },
  ),
);
