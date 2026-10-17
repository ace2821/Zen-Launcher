import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatClockDuration } from "../../lib/format";
import { useFormatters } from "../../lib/hooks";
import type { Session } from "../../lib/types";
import { EmptyState } from "../ui/Feedback";
import page from "../page/page.module.css";
import styles from "./details.module.css";

export interface SessionHistoryProps {
  sessions: Session[];
}

/** Last ten sessions, newest first (the query is limited at the api layer). */
export function SessionHistory({ sessions }: SessionHistoryProps) {
  const { t } = useTranslation();
  const { absoluteDate } = useFormatters();

  return (
    <section className={page.panel}>
      <div className={page.panelText}>
        <h2 className="sectionTitle">{t("details.sessions")}</h2>
        <p className="sectionHint">{t("details.sessionsDescription")}</p>
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={History}
          title={t("details.sessions")}
          body={t("details.sessionsEmpty")}
        />
      ) : (
        <div className={styles.sessions}>
          {sessions.map((session) => {
            const running = session.endedAt === null;
            const failed = session.exitCode !== null && session.exitCode !== 0;
            return (
              <div className={styles.sessionRow} key={session.id}>
                <span className={styles.sessionWhen}>
                  {absoluteDate(session.startedAt)}
                </span>
                <span className={styles.sessionDuration}>
                  {session.durationSeconds === null
                    ? t("details.sessionInProgress")
                    : formatClockDuration(session.durationSeconds)}
                </span>
                <span
                  className={[styles.sessionExit, failed ? styles.sessionExitWarn : ""]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {running
                    ? ""
                    : session.exitCode === 0
                      ? t("details.sessionExitOk")
                      : `${t("details.sessionExit")}: ${session.exitCode ?? "?"}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
