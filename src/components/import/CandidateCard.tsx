import { Check, FileText, Target, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGameLabels } from "../../lib/hooks";
import type { Candidate } from "../../lib/types";
import { useLibraryStore } from "../../store/library";
import { Badge, Chip } from "../ui/Badge";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Meter } from "../ui/Feedback";
import { GameCover } from "../library/GameCover";
import styles from "./import.module.css";

export interface CandidateCardProps {
  candidate: Candidate;
}

/**
 * Review card for one scanner result. Title and executable are editable before
 * approval — the scanner's guess is a suggestion, not a decision.
 */
export function CandidateCard({ candidate }: CandidateCardProps) {
  const { t } = useTranslation();
  const labels = useGameLabels();
  const approve = useLibraryStore((state) => state.approveCandidate);
  const reject = useLibraryStore((state) => state.rejectCandidate);
  const approving = useLibraryStore(
    (state) => state.busy[`candidate:approve:${candidate.id}`] === true,
  );
  const rejecting = useLibraryStore(
    (state) => state.busy[`candidate:reject:${candidate.id}`] === true,
  );

  const [title, setTitle] = useState(candidate.suggestedTitle);
  const [executable, setExecutable] = useState(candidate.executable ?? "");

  // A re-scan or an external change replaces the row underneath the editor.
  useEffect(() => {
    setTitle(candidate.suggestedTitle);
    setExecutable(candidate.executable ?? "");
  }, [candidate.id, candidate.suggestedTitle, candidate.executable]);

  const pending = candidate.status === "pending";
  const executableMissing = executable.trim() === "";

  return (
    <article className={styles.candidate}>
      <div className={styles.candidateCover}>
        <GameCover
          title={title || candidate.suggestedTitle}
          coverPath={null}
          variant="compact"
        />
      </div>

      <div className={styles.candidateBody}>
        <div className={styles.candidateHead}>
          <Badge tone={pending ? "accent" : "quiet"}>
            {labels.candidateStatus(candidate.status)}
          </Badge>
          <Badge tone="info">{labels.engine(candidate.engine)}</Badge>
          <span className={styles.metaItem}>
            <Target size={12} aria-hidden />
            {t("import.confidence")}
            <Meter value={candidate.confidence} label={t("import.confidence")} />
          </span>
          <span className={styles.metaItem} title={candidate.path}>
            <FileText size={12} aria-hidden />
            {t("import.suggestedPath")}
            <span className={`${styles.path} mono`}>{candidate.path}</span>
          </span>
        </div>

        <div className={styles.candidateFields}>
          <TextField
            label={t("import.fieldTitle")}
            value={title}
            disabled={!pending}
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextField
            label={t("import.fieldExecutable")}
            value={executable}
            mono
            disabled={!pending}
            placeholder={t("import.missingExecutableHint")}
            error={pending && executableMissing ? t("import.missingExecutableHint") : null}
            onChange={(event) => setExecutable(event.target.value)}
          />
        </div>

        <div className={styles.candidateMeta}>
          <span className={styles.metaItem}>{t("import.evidence")}</span>
          <span className={styles.evidence}>
            {candidate.evidence.map((item) => (
              <Chip key={item}>{item}</Chip>
            ))}
          </span>
        </div>

        {pending ? (
          <div className={styles.candidateFoot}>
            {executableMissing ? (
              <span className={styles.footWarn}>
                <TriangleAlert size={12} aria-hidden />
                {t("import.missingExecutableHint")}
              </span>
            ) : null}
            <span className={styles.candidateActions}>
              <Button
                size="sm"
                variant="ghost"
                icon={X}
                disabled={rejecting}
                onClick={() => void reject(candidate.id)}
              >
                {t("import.reject")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={Check}
                loading={approving}
                disabled={executableMissing}
                title={executableMissing ? t("import.missingExecutableHint") : undefined}
                onClick={() => {
                  const patch: {
                    title?: string;
                    executable?: string;
                  } = {};
                  if (title.trim() !== candidate.suggestedTitle) {
                    patch.title = title.trim();
                  }
                  if (executable.trim() !== (candidate.executable ?? "")) {
                    patch.executable = executable.trim();
                  }
                  void approve(
                    candidate.id,
                    Object.keys(patch).length > 0 ? patch : undefined,
                  );
                }}
              >
                {t("import.approve")}
              </Button>
            </span>
          </div>
        ) : null}
      </div>
    </article>
  );
}
