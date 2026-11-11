import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Timer } from "lucide-react";
import { useFormatters } from "../lib/hooks";
import { useLibraryStore } from "../store/library";
import { EmptyState } from "../components/ui/Feedback";
import styles from "../components/library/library.module.css";

export function StatisticsView() {
  const { t } = useTranslation();
  const { playtime } = useFormatters();
  const games = useLibraryStore((state) => state.games);

  // Sort by playtime descending, then by title.
  const ranked = useMemo(
    () =>
      [...games].sort(
        (a, b) => b.totalSeconds - a.totalSeconds || a.title.localeCompare(b.title),
      ),
    [games],
  );

  const totalSeconds = ranked.reduce((sum, g) => sum + g.totalSeconds, 0);
  const totalPlaytime = playtime(totalSeconds);
  const playedCount = ranked.filter((g) => g.totalSeconds > 0).length;

  if (games.length === 0) {
    return (
      <div className={styles.emptyWrap}>
        <EmptyState
          icon={Timer}
          title={t("statystyki.emptyTitle")}
          body={t("statystyki.emptyBody")}
        />
      </div>
    );
  }

  return (
    <div className={styles.libraryWrap}>
      <header className={styles.libraryHero}>
        <h1 className={styles.heroTitle}>{t("statystyki.title")}</h1>
        <p className={styles.heroBody}>
          {t("statystyki.subtitle", { count: playedCount, total: totalPlaytime })}
        </p>
      </header>

      <section className={styles.librarySection}>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>
            {t("statystyki.totalPlaytime")}
          </span>
          <span className={styles.statValue}>{totalPlaytime}</span>
        </div>

        <div className={styles.gridWrap}>
          {ranked.length === 0 ? (
            <div className={styles.emptyWrap}>
              <EmptyState
                icon={Timer}
                title={t("statystyki.noDataTitle")}
                body={t("statystyki.noDataBody")}
              />
            </div>
          ) : (
            <ul className={styles.statList}>
              {ranked.map((game) => (
                <li key={game.id} className={styles.statListItem}>
                  <span className={styles.statListTitle}>{game.title}</span>
                  <span className={styles.statListValue}>
                    {playtime(game.totalSeconds)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

      </section>
    </div>
  );
}
