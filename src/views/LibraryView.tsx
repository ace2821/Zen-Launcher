import { FolderInput, Library, RefreshCw, SearchX, TriangleAlert } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { GameGrid } from "../components/library/GameGrid";
import { GameTable } from "../components/library/GameTable";
import { Recents } from "../components/library/Recents";
import styles from "../components/library/library.module.css";
import { Button } from "../components/ui/Button";
import { EmptyState, Skeleton } from "../components/ui/Feedback";
import type { Game } from "../lib/types";
import { useFormatters } from "../lib/hooks";
import { useLibraryStore } from "../store/library";
import { useFilteredGames } from "../store/selectors";
import { useShellStore } from "../store/shell";

const SKELETON_TILES = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

function LibraryStat({
  value,
  label,
}: {
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function StatSeparator() {
  return <span className={styles.statSep} aria-hidden>·</span>;
}

export function LibraryView() {
  const { t } = useTranslation();
  const { playtime } = useFormatters();
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

  const totalSeconds = games.reduce((sum, game) => sum + game.totalSeconds, 0);
  const totalPlaytime = playtime(totalSeconds);
  const weekAgo = Date.now() - WEEK_MS;
  const weekCount = games.filter(
    (game) =>
      game.lastPlayedAt !== null && Date.parse(game.lastPlayedAt) >= weekAgo,
  ).length;

  if (games.length === 0 && (status === "idle" || status === "loading")) {
    return <LibrarySkeleton />;
  }

  if (games.length === 0 && status === "error") {
    return (
      <div className={[styles.emptyWrap, styles.emptyPattern].filter(Boolean).join(" ")}>
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
      <div className={[styles.emptyWrap, styles.emptyPattern].filter(Boolean).join(" ")}>
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
      <div className={[styles.emptyWrap, styles.emptyPattern].filter(Boolean).join(" ")}>
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

  return (
    <div className={styles.libraryWrap}>
      <header className={styles.libraryHero}>
        <h1 className={styles.heroTitle}>{t("library.heroTitle")}</h1>
        <p className={styles.heroBody}>{t("library.heroBody")}</p>
        <div className={styles.statRow}>
          <LibraryStat value={games.length} label={t("library.statTitles")} />
          <StatSeparator />
          <LibraryStat value={totalPlaytime} label={t("library.statPlaytime")} />
          <StatSeparator />
          <LibraryStat value={weekCount} label={t("library.statWeek")} />
        </div>
      </header>

      <Recents games={games} onOpen={handleOpen} />

      <section className={styles.librarySection}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>{t("nav.library")}</span>
          <span className={styles.sectionCount}>
            {games.length} {t("library.statTitles")} · {totalPlaytime} {t("library.statPlaytime")}
          </span>
        </div>
        <div className={styles.gridWrap}>
          {layout === "grid" ? (
            <GameGrid games={filtered} onOpen={handleOpen} />
          ) : (
            <GameTable games={filtered} onOpen={handleOpen} />
          )}
        </div>
      </section>
    </div>
  );
}
