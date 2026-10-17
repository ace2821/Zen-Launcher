import {
  Clock,
  FolderOpen,
  Play,
  Star,
  Timer,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { FactsPanel } from "../components/details/FactsPanel";
import { LaunchOptionsPanel } from "../components/details/LaunchOptionsPanel";
import { NotesPanel } from "../components/details/NotesPanel";
import { SessionHistory } from "../components/details/SessionHistory";
import styles from "../components/details/details.module.css";
import page from "../components/page/page.module.css";
import { GameCover } from "../components/library/GameCover";
import { Badge } from "../components/ui/Badge";
import { Button, IconButton } from "../components/ui/Button";
import { EmptyState, Skeleton } from "../components/ui/Feedback";
import { isMock } from "../lib/api";
import { useFormatters, useGameLabels, useLaunchAvailability } from "../lib/hooks";
import type { Game } from "../lib/types";
import { useLibraryStore } from "../store/library";
import { useShellStore } from "../store/shell";

function DetailsSkeleton() {
  return (
    <div className={[page.page, page.wide].join(" ")} aria-hidden>
      <div className={styles.hero}>
        <Skeleton className={styles.skeletonArt} />
        <div className={styles.heroBody}>
          <Skeleton height={20} width="32%" />
          <Skeleton height={38} width="68%" />
          <Skeleton height={14} width="45%" />
          <Skeleton height={32} width={240} radius="var(--r-sm)" />
        </div>
      </div>
      <Skeleton height={280} radius="var(--r-lg)" />
    </div>
  );
}

function DetailsHero({ game }: { game: Game }) {
  const { t } = useTranslation();
  const labels = useGameLabels();
  const { playtime, relativeDate } = useFormatters();
  const launch = useLaunchAvailability(game);
  const launchGame = useLibraryStore((state) => state.launchGame);
  const removeGame = useLibraryStore((state) => state.removeGame);
  const revealGame = useLibraryStore((state) => state.revealGame);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const launching = useLibraryStore(
    (state) => state.busy[`game:launch:${game.id}`] === true,
  );

  const favoriteLabel = game.favorite
    ? t("library.favoriteRemove")
    : t("library.favoriteAdd");

  return (
    <div className={styles.hero}>
      <div className={styles.heroArt}>
        <GameCover title={game.title} coverPath={game.coverPath} />
      </div>

      <div className={styles.heroBody}>
        <div className={styles.heroFlags}>
          <Badge tone="info">{labels.type(game.type)}</Badge>
          <Badge tone={game.status === "missing" ? "warn" : "quiet"}>
            {labels.status(game.status)}
          </Badge>
        </div>

        <h2 className={styles.heroTitle}>{game.title}</h2>

        <div className={styles.heroMeta}>
          <span className={styles.heroMetaItem}>
            <Timer size={13} aria-hidden />
            {playtime(game.totalSeconds)}
          </span>
          <span className={styles.heroMetaItem}>
            <Clock size={13} aria-hidden />
            {relativeDate(game.lastPlayedAt)}
          </span>
        </div>

        <div className={styles.heroActions}>
          <Button
            variant="primary"
            icon={Play}
            loading={launching}
            disabled={!launch.available}
            title={launch.hint ?? t("details.play")}
            onClick={() => void launchGame(game.id)}
          >
            {t("details.play")}
          </Button>

          <IconButton
            icon={Star}
            label={favoriteLabel}
            active={game.favorite}
            onClick={() => void toggleFavorite(game)}
          />

          {isMock ? null : (
            <Button
              variant="ghost"
              icon={FolderOpen}
              onClick={() => void revealGame(game)}
            >
              {t("details.reveal")}
            </Button>
          )}

          <Button
            variant="ghost"
            icon={Trash2}
            onClick={() => void removeGame(game.id)}
          >
            {t("details.remove")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Game details. The hero is identity, the left column is everything writable in
 * M1 (launch options, notes), the right column is what the core knows about the
 * entry (facts, session history).
 */
export function GameDetailsView() {
  const { t } = useTranslation();
  const selectedGameId = useShellStore((state) => state.selectedGameId);
  const goToLibrary = useShellStore((state) => state.goToLibrary);
  const game = useLibraryStore((state) =>
    state.currentGame !== null && state.currentGame.id === selectedGameId
      ? state.currentGame
      : null,
  );
  const sessions = useLibraryStore((state) => state.sessions);
  const loading = useLibraryStore(
    (state) =>
      selectedGameId !== null &&
      state.busy[`game:load:${selectedGameId}`] === true,
  );

  if (game === null) {
    return (
      <div className={page.scroll}>
        {loading ? (
          <DetailsSkeleton />
        ) : (
          <div className={[page.page, page.wide].join(" ")}>
            <EmptyState
              icon={TriangleAlert}
              title={t("details.notFoundTitle")}
              body={t("details.notFoundBody")}
              action={
                <Button variant="primary" onClick={goToLibrary}>
                  {t("details.backToLibrary")}
                </Button>
              }
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={page.scroll}>
      <div className={[page.page, page.wide].join(" ")}>
        <DetailsHero game={game} />

        <div className={styles.columns}>
          <div className={styles.col}>
            <LaunchOptionsPanel game={game} />
            <NotesPanel game={game} />
          </div>

          <div className={styles.col}>
            <FactsPanel game={game} />
            <SessionHistory sessions={sessions} />
          </div>
        </div>
      </div>
    </div>
  );
}
