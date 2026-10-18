import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFormatters } from "../../lib/hooks";
import type { Game } from "../../lib/types";
import { GameCover } from "./GameCover";
import styles from "./library.module.css";

export interface RecentsProps {
  games: Game[];
  onOpen(game: Game): void;
}

/**
 * Recently played games — built purely from client data (`lastPlayedAt`), so no
 * new API surface is needed. Shows the most recently played titles first.
 */
export function Recents({ games, onOpen }: RecentsProps) {
  const { t } = useTranslation();
  const { playtime, relativeDate } = useFormatters();

  const recents = [...games]
    .filter((game) => game.lastPlayedAt !== null)
    .sort(
      (a, b) =>
        Date.parse(b.lastPlayedAt!) - Date.parse(a.lastPlayedAt!),
    )
    .slice(0, 4);

  if (recents.length === 0) {
    return (
      <section className={styles.recents}>
        <h2 className={styles.recentsTitle}>{t("library.recents")}</h2>
        <p className={styles.recentsNone}>{t("library.recentsNone")}</p>
      </section>
    );
  }

  return (
    <section className={styles.recents}>
      <h2 className={styles.recentsTitle}>{t("library.recents")}</h2>
      <div className={styles.recentsList}>
        {recents.map((game) => (
          <button
            type="button"
            key={game.id}
            className={styles.recentsItem}
            onClick={() => void onOpen(game)}
          >
            <span className={styles.recentsCover}>
              <GameCover title={game.title} coverPath={game.coverPath} />
            </span>
            <span className={styles.recentsTitleText}>{game.title}</span>
            <span className={styles.recentsMeta}>
              <span className="tabular">{playtime(game.totalSeconds)}</span>
              <span aria-hidden>·</span>
              <Clock size={12} aria-hidden />
              <span>{relativeDate(game.lastPlayedAt)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
