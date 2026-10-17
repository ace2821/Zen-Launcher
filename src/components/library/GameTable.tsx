import { useVirtualizer } from "@tanstack/react-virtual";
import { FolderOpen, Play, Star, Trash2, TriangleAlert } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { isMock } from "../../lib/api";
import { useFormatters, useGameLabels, useLaunchAvailability } from "../../lib/hooks";
import type { Game } from "../../lib/types";
import { useLibraryStore } from "../../store/library";
import { Chip } from "../ui/Badge";
import { IconButton } from "../ui/Button";
import { GameCover } from "./GameCover";
import styles from "./library.module.css";

const ROW_HEIGHT = 52;

export interface GameTableProps {
  games: Game[];
  onOpen(game: Game): void;
}

function GameTableRow({
  game,
  onOpen,
}: {
  game: Game;
  onOpen(game: Game): void;
}) {
  const { t } = useTranslation();
  const labels = useGameLabels();
  const { playtime, relativeDate } = useFormatters();
  const launch = useLaunchAvailability(game);
  const launchGame = useLibraryStore((state) => state.launchGame);
  const removeGame = useLibraryStore((state) => state.removeGame);
  const revealGame = useLibraryStore((state) => state.revealGame);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);

  return (
    <div className={[styles.tableRow, styles.tableBodyRow].join(" ")} role="row">
      <span className={styles.tableTitleCell} role="cell">
        <span className={styles.tableCover}>
          <GameCover
            title={game.title}
            coverPath={game.coverPath}
            variant="compact"
          />
        </span>
        <button
          type="button"
          className={styles.tableTitle}
          title={game.title}
          onClick={() => onOpen(game)}
        >
          {game.title}
        </button>
      </span>
      <span className={styles.tableCell} role="cell">
        <Chip>{labels.type(game.type)}</Chip>
      </span>
      <span className={styles.tableCell} role="cell">
        {playtime(game.totalSeconds)}
      </span>
      <span className={styles.tableCell} role="cell">
        {relativeDate(game.lastPlayedAt)}
      </span>
      <span className={styles.tableCell} role="cell">
        {game.status === "missing" ? (
          <Chip>
            <TriangleAlert size={11} aria-hidden />
            {labels.status(game.status)}
          </Chip>
        ) : (
          labels.status(game.status)
        )}
      </span>
      <span className={styles.tableTags} role="cell">
        {game.tags.slice(0, 2).map((tag) => (
          <Chip key={tag}>{tag}</Chip>
        ))}
      </span>
      <span className={styles.tableActions} role="cell">
        <IconButton
          icon={Star}
          label={
            game.favorite ? t("library.favoriteRemove") : t("library.favoriteAdd")
          }
          active={game.favorite}
          onClick={() => void toggleFavorite(game)}
        />
        <IconButton
          icon={Play}
          label={t("common.play")}
          disabled={!launch.available}
          title={launch.hint ?? t("common.play")}
          onClick={() => void launchGame(game.id)}
        />
        {isMock ? null : (
          <IconButton
            icon={FolderOpen}
            label={t("library.reveal")}
            onClick={() => void revealGame(game)}
          />
        )}
        <IconButton
          icon={Trash2}
          label={t("library.remove")}
          tone="danger"
          onClick={() => void removeGame(game.id)}
        />
      </span>
    </div>
  );
}

export function GameTable({ games, onOpen }: GameTableProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: games.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    initialRect: { width: 1180, height: 900 },
  });

  return (
    <div className={styles.tableScroll} ref={scrollRef}>
      <div className={styles.table} role="table" aria-label={t("nav.library")}>
        <div
          className={[styles.tableRow, styles.tableHead].join(" ")}
          role="row"
        >
          <span role="columnheader">{t("library.table.title")}</span>
          <span role="columnheader">{t("library.table.type")}</span>
          <span role="columnheader">{t("library.table.playtime")}</span>
          <span role="columnheader">{t("library.table.lastPlayed")}</span>
          <span role="columnheader">{t("library.table.status")}</span>
          <span role="columnheader">{t("library.table.tags")}</span>
          <span role="columnheader" style={{ textAlign: "right" }}>
            {t("library.table.actions")}
          </span>
        </div>

        <div
          className={styles.tableVirtual}
          style={{ height: virtualizer.getTotalSize() }}
          role="rowgroup"
        >
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              className={styles.tableVirtualRow}
              style={{ height: ROW_HEIGHT, transform: `translateY(${row.start}px)` }}
            >
              <GameTableRow game={games[row.index]} onOpen={onOpen} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
