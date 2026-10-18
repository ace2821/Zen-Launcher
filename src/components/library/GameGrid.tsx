import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type CSSProperties } from "react";
import { useContainerWidth, columnCount } from "../../lib/hooks";
import type { Game } from "../../lib/types";
import { CARD_TEXT_HEIGHT, GameCard } from "./GameCard";
import styles from "./library.module.css";

const GAP = 16;
const PAD = 20;
const MIN_CARD_WIDTH = 200;
/** Used when nothing has been measured yet (first paint, jsdom). */
const FALLBACK_WIDTH = 1180;

export interface GameGridProps {
  games: Game[];
  onOpen(game: Game): void;
}

/**
 * Virtualized cover grid. Only whole rows are mounted, and row height is derived
 * from the measured column width so cards never overlap or leave gaps.
 */
export function GameGrid({ games, onOpen }: GameGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(scrollRef, FALLBACK_WIDTH);

  const inner = Math.max(0, width - PAD * 2);
  const columns = columnCount(inner, MIN_CARD_WIDTH, GAP);
  const cardWidth = Math.max(
    MIN_CARD_WIDTH,
    (inner - GAP * (columns - 1)) / columns,
  );
  const coverHeight = Math.round(cardWidth * (4 / 3));
  const rowHeight = coverHeight + CARD_TEXT_HEIGHT + GAP;
  const rowCount = Math.ceil(games.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
    initialRect: { width, height: 900 },
  });

  return (
    <div className={styles.gridScroll} ref={scrollRef}>
      <div
        className={styles.gridInner}
        style={
          {
            height: virtualizer.getTotalSize(),
            "--grid-gap": `${GAP}px`,
            "--grid-pad": `${PAD}px`,
          } as CSSProperties
        }
      >
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className={styles.gridRow}
            style={{
              height: rowHeight,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              transform: `translateY(${row.start}px)`,
            }}
          >
            {games
              .slice(row.index * columns, row.index * columns + columns)
              .map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  coverHeight={coverHeight}
                  onOpen={onOpen}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
