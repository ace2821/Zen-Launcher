import { useTranslation } from "react-i18next";
import { useFormatters } from "../../lib/hooks";
import type { Game } from "../../lib/types";
import { Chip } from "../ui/Badge";
import page from "../page/page.module.css";
import styles from "./details.module.css";

export interface FactsPanelProps {
  game: Game;
}

/** Read-only entry facts. Tags are displayed, not editable (M3 owns that). */
export function FactsPanel({ game }: FactsPanelProps) {
  const { t } = useTranslation();
  const { absoluteDate } = useFormatters();

  return (
    <section className={page.panel}>
      <div className={page.panelText}>
        <h2 className="sectionTitle">{t("details.factsTitle")}</h2>
      </div>

      <div className={page.facts}>
        <span className={page.factKey}>{t("details.installPath")}</span>
        <span className={`${page.factValue} mono`}>{game.installPath}</span>

        <span className={page.factKey}>{t("details.entryId")}</span>
        <span className={`${page.factValue} tabular`}>{game.id}</span>

        <span className={page.factKey}>{t("details.createdAt")}</span>
        <span className={page.factValue}>{absoluteDate(game.createdAt)}</span>

        <span className={page.factKey}>{t("details.updatedAt")}</span>
        <span className={page.factValue}>{absoluteDate(game.updatedAt)}</span>
      </div>

      <div className={page.panelText}>
        <h3 className={styles.previewLabel}>{t("details.tagsTitle")}</h3>
        {game.tags.length === 0 ? (
          <span className={styles.previewEmpty}>{t("details.tagsEmpty")}</span>
        ) : (
          <span className={styles.tags}>
            {game.tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
          </span>
        )}
        <span className="sectionHint">{t("details.tagsNote")}</span>
      </div>
    </section>
  );
}
