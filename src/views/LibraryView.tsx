import { FolderInput, Library, RefreshCw, SearchX, TriangleAlert } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { GameGrid } from "../components/library/GameGrid";
import { GameTable } from "../components/library/GameTable";
import styles from "../components/library/library.module.css";
import { Button } from "../components/ui/Button";
import { EmptyState, Skeleton } from "../components/ui/Feedback";
import type { Game } from "../lib/types";
import { useLibraryStore } from "../store/library";
import { useFilteredGames } from "../store/selectors";
import { useShellStore } from "../store/shell";

const SKELETON_TILES = 12;

function LibrarySkeleton() {
  return (
    <div className={styles.skeletonScroll}>
      <div className={styles.skeletonGrid}>
        {Array.from({ length: SKELETON_TILES }, (_, index) => (
          <div className={styles.skeletonCard} key={index}>
            <Skeleton className={styles.skeletonCover} />
            <Skeleton className={styles.skeletonLine} />
            <Skeleton className={styles.skeletonLineShort} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function LibraryView() {
  const { t } = useTranslation();
  const status = useLibraryStore((state) => state.status);
  const games = useLibraryStore((state) => state.games);
  const error = useLibraryStore((state) => state.error);
  const init = useLibraryStore((state) => state.init);
  const openGame = useLibraryStore((state) => state.openGame);
  const layout = useShellStore((state) => state.layout);
  const search = useShellStore((state) => state.search);
  const setSearch = useShellStore((state) => state.setSearch);
  const goToImport = useShellStore((state) => state.goToImport);
  const filtered = useFilteredGames();

  const handleOpen = useCallback(
    (game: Game) => {
      void openGame(game.id);
    },
    [openGame],
  );

  if (games.length === 0 && (status === "idle" || status === "loading")) {
    return <LibrarySkeleton />;
  }

  if (games.length === 0 && status === "error") {
    return (
      <div className={styles.emptyWrap}>
        <EmptyState
          icon={TriangleAlert}
          title={t("errors.initFailed")}
          body={error?.message ?? ""}
          action={
            <Button icon={RefreshCw} onClick={() => void init()}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className={styles.emptyWrap}>
        <EmptyState
          icon={Library}
          title={t("library.emptyTitle")}
          body={t("library.emptyBody")}
          action={
            <Button variant="primary" icon={FolderInput} onClick={goToImport}>
              {t("library.emptyAction")}
            </Button>
          }
        />
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className={styles.emptyWrap}>
        <EmptyState
          icon={SearchX}
          title={t("library.noResultsTitle")}
          body={t("library.noResultsBody", { query: search })}
          action={
            <Button onClick={() => setSearch("")}>{t("library.noResultsAction")}</Button>
          }
        />
      </div>
    );
  }

  return layout === "grid" ? (
    <GameGrid games={filtered} onOpen={handleOpen} />
  ) : (
    <GameTable games={filtered} onOpen={handleOpen} />
  );
}
