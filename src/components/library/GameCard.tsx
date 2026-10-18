import { FolderOpen, Play, Star, Trash2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isMock } from "../../lib/api";
import { useFormatters, useGameLabels, useLaunchAvailability } from "../../lib/hooks";
import type { Game } from "../../lib/types";
import { useLibraryStore } from "../../store/library";
import { Chip } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { GameCover } from "./GameCover";
import styles from "./library.module.css";

export const CARD_TEXT_HEIGHT = 64;

export interface GameCardProps {
  game: Game;
  coverHeight: number;
  onOpen(game: Game): void;
}

export function GameCard({ game, coverHeight, onOpen }: GameCardProps) {
  const { t } = useTranslation();
  const labels = useGameLabels();
  const { playtime, relativeDate } = useFormatters();
  const launch = useLaunchAvailability(game);
  const launchGame = useLibraryStore((state) => state.launchGame);
  const removeGame = useLibraryStore((state) => state.removeGame);
  const revealGame = useLibraryStore((state) => state.revealGame);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const busy = useLibraryStore((state) => state.busy);
  const activeSessions = useLibraryStore((state) => state.activeSessions);

  const isPlaying = activeSessions.includes(game.id) && game.status !== "missing";

  const favoriteLabel = game.favorite
    ? t("library.favoriteRemove")
    : t("library.favoriteAdd");

  return (
    <article
      className={styles.card}
      style={{ height: coverHeight + CARD_TEXT_HEIGHT }}
      aria-label={game.title}
    >
      <div
        className={[styles.cardCoverWrap, isPlaying ? styles.cardPlayingWrap : ""]
          .filter(Boolean)
          .join(" ")}
        style={{ height: coverHeight }}
      >
        <button
          type="button"
          className={styles.cardCoverButton}
          onClick={() => onOpen(game)}
          aria-label={`${game.title} — ${t("library.openDetails")}`}
        >
          <GameCover title={game.title} coverPath={game.coverPath} />
        </button>
        <span className={styles.cardScrim} />

        {game.status === "missing" ? (
          <span className={styles.cardFlag}>
            <TriangleAlert size={11} aria-hidden />
            {labels.status(game.status)}
          </span>
        ) : null}

        <span className={styles.cardEnvironment}>
          <Chip>{labels.type(game.type)}</Chip>
        </span>

        <button
          type="button"
          className={[styles.star, game.favorite ? styles.starOn : ""]
            .filter(Boolean)
            .join(" ")}
          aria-pressed={game.favorite}
          aria-label={favoriteLabel}
          title={favoriteLabel}
          onClick={() => void toggleFavorite(game)}
        >
          <Star size={14} fill={game.favorite ? "currentColor" : "none"} aria-hidden />
        </button>

        <span className={styles.cardPlaytime}>
          {playtime(game.totalSeconds)}
        </span>

        {isPlaying ? (
          <span className={styles.cardPlayingNow} aria-hidden />
        ) : null}

        <div className={styles.cardActions}>
          <Button
            variant="primary"
            size="sm"
            icon={Play}
            className={[styles.cardActionsGrow, isPlaying ? styles.cardActionPlaying : ""]
              .filter(Boolean)
              .join(" ")}
            disabled={!launch.available}
            aria-label={
              isPlaying
                ? t("library.playingNow")
                : launch.hint ?? t("common.play")
            }
            title={
              isPlaying
                ? t("library.playingNow")
                : launch.hint ?? t("common.play")
            }
            loading={busy[`game:launch:${game.id}`] === true}
            onClick={() => void launchGame(game.id)}
          >
            <>
              {isPlaying ? t("library.playingNow") : t("common.play")}
              <span className={styles.cardDot} aria-hidden />
            </>
          </Button>
          {isMock ? null : (
            <IconButton
              icon={FolderOpen}
              label={t("library.reveal")}
              className={styles.cardActionGhost}
              onClick={() => void revealGame(game)}
            />
          )}
          <IconButton
            icon={Trash2}
            label={t("library.remove")}
            tone="danger"
            className={styles.cardActionGhost}
            onClick={() => void removeGame(game.id)}
          />
        </div>
      </div>

      <div className={styles.cardCoverTitle} title={game.title}>
        {game.title}
      </div>

      <div className={styles.cardText}>
        <div className={styles.cardMeta}>
          <span>{relativeDate(game.lastPlayedAt)}</span>
        </div>
        <div className={styles.cardTags}>
          {game.tags.slice(0, 2).map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
      </div>
    </article>
  );
}
