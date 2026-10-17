import { FolderOpen, LoaderCircle, RefreshCw, ScanSearch, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFormatters } from "../../lib/hooks";
import type { Source } from "../../lib/types";
import { useLibraryStore } from "../../store/library";
import { IconButton, Button } from "../ui/Button";
import { ProgressBar } from "../ui/Feedback";
import styles from "./import.module.css";

export function SourceRow({ source }: { source: Source }) {
  const { t } = useTranslation();
  const { relativeDate } = useFormatters();
  const scan = useLibraryStore((state) => state.scan);
  const scanSource = useLibraryStore((state) => state.scanSource);
  const removeSource = useLibraryStore((state) => state.removeSource);
  const scanning = useLibraryStore(
    (state) => state.busy[`source:scan:${source.id}`] === true,
  );
  const removing = useLibraryStore(
    (state) => state.busy[`source:remove:${source.id}`] === true,
  );

  const activeScan = scan?.sourceId === source.id ? scan : null;

  return (
    <li className={styles.sourceRow}>
      <div className={styles.sourceMain}>
        <FolderOpen size={18} className={styles.sourceIcon} aria-hidden />
        <span className={styles.sourceText}>
          <span className={`${styles.sourcePath} mono`} title={source.path}>
            {source.path}
          </span>
          <span className={styles.sourceMeta}>
            {source.lastScanAt === null
              ? t("import.neverScanned")
              : t("import.lastScan", {
                  value: relativeDate(source.lastScanAt),
                })}
          </span>
        </span>
        <span className={styles.sourceActions}>
          <Button
            size="sm"
            icon={source.lastScanAt === null ? ScanSearch : RefreshCw}
            loading={scanning}
            disabled={scan !== null}
            onClick={() => void scanSource(source.id)}
          >
            {source.lastScanAt === null ? t("import.scan") : t("import.rescan")}
          </Button>
          <IconButton
            icon={Trash2}
            label={t("import.removeSource")}
            tone="danger"
            disabled={removing}
            onClick={() => void removeSource(source.id)}
          />
        </span>
      </div>

      {activeScan ? (
        <div className={styles.progressWrap}>
          <div className={styles.progressHead}>
            <LoaderCircle size={14} className={styles.spinner} aria-hidden />
            <span>{t("import.scanning")}</span>
          </div>
          <ProgressBar
            value={null}
            label={t("import.scanning")}
            meta={
              <>
                <span title={activeScan.current ?? undefined}>
                  {activeScan.current === null
                    ? t("import.scanProgressWaiting")
                    : t("import.scanProgressCurrent", { path: activeScan.current })}
                </span>
                <span className="tabular">
                  {t("import.progressFound", {
                    count: activeScan.candidatesSoFar,
                  })}
                </span>
              </>
            }
          />
        </div>
      ) : null}
    </li>
  );
}
