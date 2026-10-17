import { FolderInput, Info, ListChecks, Plus, ScanSearch } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CandidateCard } from "../components/import/CandidateCard";
import { SourceRow } from "../components/import/SourceRow";
import styles from "../components/import/import.module.css";
import { Button } from "../components/ui/Button";
import { EmptyState, Skeleton } from "../components/ui/Feedback";
import { api } from "../lib/api";
import { toUiError } from "../lib/errors";
import type { Candidate, CandidateStatus } from "../lib/types";
import { confirmDialog } from "../store/confirm";
import { useLibraryStore } from "../store/library";
import { toastError } from "../store/toasts";

type CandidateTab = CandidateStatus;

const TABS: readonly CandidateTab[] = ["pending", "approved", "rejected"];

const TAB_LABEL: Record<CandidateTab, string> = {
  pending: "import.tabPending",
  approved: "import.tabApproved",
  rejected: "import.tabRejected",
};

function countByStatus(candidates: readonly Candidate[], status: CandidateStatus) {
  return candidates.reduce(
    (total, candidate) => (candidate.status === status ? total + 1 : total),
    0,
  );
}

function ImportSkeleton() {
  return (
    <div className={styles.narrow} aria-hidden>
      <Skeleton height={64} radius="var(--r-md)" />
      <Skeleton height={64} radius="var(--r-md)" />
      <Skeleton height={148} radius="var(--r-lg)" />
    </div>
  );
}

/**
 * Sources & Import — the same two-step contract the core implements: roots are
 * scanned, then every discovery is reviewed by hand. Nothing reaches the library
 * without an explicit approval.
 */
export function ImportView() {
  const { t } = useTranslation();
  const status = useLibraryStore((state) => state.status);
  const sources = useLibraryStore((state) => state.sources);
  const candidates = useLibraryStore((state) => state.candidates);
  const lastScan = useLibraryStore((state) => state.lastScan);
  const addSource = useLibraryStore((state) => state.addSource);
  const approveAll = useLibraryStore((state) => state.approveAllPending);
  const rejectAll = useLibraryStore((state) => state.rejectAllPending);
  const adding = useLibraryStore((state) => state.busy["source:add"] === true);
  const approvingAll = useLibraryStore(
    (state) => state.busy["candidates:approve-all"] === true,
  );
  const rejectingAll = useLibraryStore(
    (state) => state.busy["candidates:reject-all"] === true,
  );
  const bulking = approvingAll || rejectingAll;
  const scanning = useLibraryStore((state) => state.scan !== null);

  const [tab, setTab] = useState<CandidateTab>("pending");

  const counts = useMemo(
    () => ({
      pending: countByStatus(candidates, "pending"),
      approved: countByStatus(candidates, "approved"),
      rejected: countByStatus(candidates, "rejected"),
    }),
    [candidates],
  );

  const visible = useMemo(
    () => candidates.filter((candidate) => candidate.status === tab),
    [candidates, tab],
  );

  const handleAddFolder = useCallback(async () => {
    try {
      const path = await api.pickDirectory({ title: t("import.addFolderDialog") });
      if (path === null || path.trim().length === 0) return;
      await addSource(path);
    } catch (error) {
      // The dialog plugin rejects outside a Tauri window; surface, never swallow.
      toastError(t("import.sourceAddFailed"), toUiError(error));
    }
  }, [addSource, t]);

  const handleApproveAll = useCallback(async () => {
    if (counts.pending === 0) return;
    const confirmed = await confirmDialog({
      title: t("import.approveAllTitle", { count: counts.pending }),
      body: t("import.approveAllBody"),
      confirmLabel: t("import.approveAll", { count: counts.pending }),
      cancelLabel: t("common.cancel"),
    });
    if (!confirmed) return;
    await approveAll();
  }, [approveAll, counts.pending, t]);

  if (status === "idle" || status === "loading") {
    return (
      <div className={styles.scroll}>
        <ImportSkeleton />
      </div>
    );
  }

  return (
    <div className={styles.scroll}>
      <div className={styles.narrow}>
        {/* ------------------------------------------------------- roots --- */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionText}>
              <h2 className="sectionTitle">{t("import.sourcesTitle")}</h2>
              <p className="sectionHint">{t("import.description")}</p>
            </div>
            <div className={styles.sectionActions}>
              {sources.length === 0 ? null : (
                <Button
                  variant="secondary"
                  icon={FolderInput}
                  loading={adding}
                  onClick={() => void handleAddFolder()}
                >
                  {t("import.addFolder")}
                </Button>
              )}
            </div>
          </div>

          {sources.length === 0 ? (
            <div className={styles.emptyPanel}>
              <EmptyState
                icon={ScanSearch}
                title={t("import.sourcesEmptyTitle")}
                body={t("import.sourcesEmpty")}
                action={
                  <Button
                    variant="primary"
                    icon={Plus}
                    loading={adding}
                    onClick={() => void handleAddFolder()}
                  >
                    {t("import.addFolder")}
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className={styles.sourceList}>
              {sources.map((source) => (
                <SourceRow key={source.id} source={source} />
              ))}
            </ul>
          )}

          {lastScan !== null ? (
            <p className={styles.note}>
              <Info size={14} aria-hidden className={styles.noteIcon} />
              {t("import.scanFinishedBody", { count: lastScan.candidatesFound })}
            </p>
          ) : null}

          {scanning ? null : (
            <p className={styles.note}>
              <Info size={14} aria-hidden className={styles.noteIcon} />
              {t("import.autoScanNote")}
            </p>
          )}
        </section>

        {/* -------------------------------------------------- candidates --- */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionText}>
              <h2 className="sectionTitle">{t("import.candidatesTitle")}</h2>
              <p className="sectionHint">{t("import.candidatesDescription")}</p>
            </div>
            <div className={styles.sectionActions}>
              <Button
                size="sm"
                variant="ghost"
                icon={ListChecks}
                disabled={counts.pending === 0 || bulking}
                loading={rejectingAll}
                onClick={() => void rejectAll()}
              >
                {t("import.rejectAll", { count: counts.pending })}
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={ListChecks}
                disabled={counts.pending === 0 || bulking}
                loading={approvingAll}
                onClick={() => void handleApproveAll()}
              >
                {t("import.approveAll", { count: counts.pending })}
              </Button>
            </div>
          </div>

          <div className={styles.tabs} role="tablist" aria-label={t("import.candidatesTitle")}>
            {TABS.map((entry) => {
              const active = entry === tab;
              return (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`candidates-${entry}`}
                  className={[styles.tab, active ? styles.tabActive : ""]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setTab(entry)}
                >
                  {t(TAB_LABEL[entry], { count: counts[entry] })}
                </button>
              );
            })}
          </div>

          <div
            id={`candidates-${tab}`}
            role="tabpanel"
            aria-label={t(TAB_LABEL[tab], { count: counts[tab] })}
          >
            {visible.length === 0 ? (
              <div className={styles.emptyNote}>
                {tab === "pending"
                  ? `${t("import.noPending")} — ${t("import.noPendingBody")}`
                  : tab === "approved"
                    ? `${t("import.noApproved")} — ${t("import.noApprovedBody")}`
                    : `${t("import.noRejected")} — ${t("import.noRejectedBody")}`}
              </div>
            ) : (
              <ul className={styles.candidateList}>
                {visible.map((candidate) => (
                  <li key={candidate.id}>
                    <CandidateCard candidate={candidate} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
