import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { api } from "../../lib/api";
import { toUiError } from "../../lib/errors";
import { toastError } from "../../store/toasts";
import type { Conflict } from "../../lib/types";
import styles from "./conflicts.module.css";

export function ConflictsPanel({ gameId }: { gameId: number }) {
  const { t } = useTranslation();
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api
      .detect_conflicts(gameId)
      .then((result) => {
        if (live) setConflicts(result.conflicts);
      })
      .catch((error) => {
        if (!live) return;
        setError(toUiError(error).message);
        toastError(t("conflicts.resolving"), toUiError(error));
      });
    return () => {
      live = false;
    };
  }, [api, gameId, t]);

  if (conflicts === null) {
    return null;
  }

  if (conflicts.length === 0 && error === null) {
    return (
      <div className={styles.conflictsNone}>
        <AlertTriangle size={14} aria-hidden />
        <span>{t("conflicts.none")}</span>
      </div>
    );
  }

  return (
    <div className={styles.conflicts}>
      {error ? (
        <div className={styles.conflictRow}>
          <span className={styles.conflictPair}>{t("conflicts.resolving")}</span>
          <span className={styles.conflictVs}>{error}</span>
        </div>
      ) : null}
      {conflicts.map((conflict, index) => (
        <div key={index} className={styles.conflictRow}>
          <div className={styles.conflictHead}>
            <span className={styles.conflictPair}>
              {conflict.addonOrModA}
            </span>
            <span className={styles.conflictVs}>
              {t("conflicts.vs")}
            </span>
            <span className={styles.conflictPair}>
              {conflict.addonOrModB}
            </span>
          </div>
          <span className={styles.conflictFilesLabel}>
            {t("conflicts.fileList")}
          </span>
          <span className={styles.conflictFiles}>
            {conflict.files.join(", ")}
          </span>
        </div>
      ))}
      {conflicts.length > 0 && (
        <p className={styles.conflictInfo}>
          {t("conflicts.info")}
        </p>
      )}
    </div>
  );
}
