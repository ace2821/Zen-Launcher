import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { ProgressBar } from "./Feedback";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { toastSuccess } from "../../store/toasts";
import styles from "./ui.module.css";

interface DownloadProgress {
  kind: string;
  downloaded_bytes: number;
  total_bytes: number;
  eta_seconds: number | null;
}

interface DownloadFinished {
  kind: string;
  ok: boolean;
  error?: string;
}

interface RuntimeDownloadDialogProps {
  kind: string;
  name: string;
  open: boolean;
  onClose: () => void;
  onFinished: () => void;
}

/** `bytes` → human `MB` / `GB`. */
function formatSize(bytes: number): string {
  const mb = bytes / 1_048_576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** `eta_seconds` → `~2 min 15 s`, or `calculating…` when unknown. */
function formatEta(t: { t: (key: string) => string }, seconds: number | null): string {
  if (seconds === null) return t.t("settings.runtimeDownloadEtaCalculating");
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `~${minutes} ${t.t("units.minute")} ${secs} s`;
  }
  return `~${secs} s`;
}

const downloadApi = api as {
  runtimeDownload(kind: string): Promise<void>;
  runtimeCancelDownload(kind: string): Promise<void>;
  on<K extends string>(
    event: K,
    handler: (payload: unknown) => void,
  ): Promise<() => void>;
};

export function RuntimeDownloadDialog({
  kind,
  name,
  open,
  onClose,
  onFinished,
}: RuntimeDownloadDialogProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const unlistenRef = useRef<(() => void)[]>([]);

  const clearListeners = useCallback(() => {
    for (const off of unlistenRef.current) off();
    unlistenRef.current = [];
  }, []);

  // Subscribe to download events while the dialog is open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      const offProgress = await downloadApi.on("runtime-download-progress", (payload) => {
        const p = payload as DownloadProgress;
        if (p.kind !== kind) return;
        setProgress(p);
      });
      const offFinished = await downloadApi.on("runtime-download-finished", (payload) => {
        const f = payload as DownloadFinished;
        if (f.kind !== kind) return;
        setFinished(true);
        if (f.ok) {
          clearListeners();
          if (!cancelled) {
            void toastSuccess(t("settings.runtimeDownloadFinished"), t("settings.runtimeDownloadSuccess", { name }));
            onFinished();
            onClose();
          }
        } else {
          setError(f.error ?? t("settings.runtimeDownloadFailed"));
        }
      });
      if (cancelled) {
        offProgress();
        offFinished();
        return;
      }
      unlistenRef.current = [offProgress, offFinished];
    })();

    return () => {
      cancelled = true;
      clearListeners();
    };
  }, [open, kind, t, clearListeners, onFinished, onClose]);

  // Kick off the download when the dialog opens.
  useEffect(() => {
    if (!open || finished || error) return;
    void downloadApi.runtimeDownload(kind);
  }, [open, kind, finished, error]);

  const downloadedMB = progress ? formatSize(progress.downloaded_bytes) : "0 MB";
  const totalMB = progress ? formatSize(progress.total_bytes) : "0 MB";
  const eta = progress ? formatEta({ t }, progress.eta_seconds) : t("settings.runtimeDownloadEtaCalculating");
  const percent =
    progress && progress.total_bytes > 0
      ? Math.round(Math.min(1, progress.downloaded_bytes / progress.total_bytes) * 100)
      : null;

  const handleCancel = () => {
    void downloadApi.runtimeCancelDownload(kind);
    clearListeners();
    onClose();
  };

  const handleRetry = () => {
    setError(null);
    setFinished(false);
    setProgress(null);
    void downloadApi.runtimeDownload(kind);
  };

  const title = error
    ? t("settings.runtimeDownloadFailedTitle", { name })
    : t("settings.runtimeDownloadTitle", { name });

  return (
    <Modal
      open={open}
      title={title}
      onClose={handleCancel}
      closeLabel={t("common.close")}
    >
      <div className={styles.stack} style={{ gap: "var(--s-4)" }}>
        {!error && !finished ? (
          <>
            <ProgressBar
              value={percent}
              label={t("settings.runtimeDownloadProgressLabel", { name })}
              meta={
                <span>
                  {t("settings.runtimeDownloadProgress", {
                    eta,
                    downloaded: downloadedMB,
                    total: totalMB,
                  })}
                </span>
              }
            />
            <Button
              variant="ghost"
              onClick={handleCancel}
              disabled={!progress}
            >
              {t("common.cancel")}
            </Button>
          </>
        ) : error ? (
          <>
            <p className={styles.dialogHint} style={{ color: "var(--danger)" }}>
              {error}
            </p>
            <div style={{ display: "flex", gap: "var(--s-2)", justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={handleCancel}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={handleRetry}>
                {t("common.retry")}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
