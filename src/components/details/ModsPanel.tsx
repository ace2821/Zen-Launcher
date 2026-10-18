import { LoaderCircle, PackagePlus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { ARCHIVE_EXTENSIONS, isArchivePath, useWindowDragDrop } from "../../lib/dnd";
import { toUiError, type UiAppError } from "../../lib/errors";
import { useModLabels } from "../../lib/hooks";
import type { Game, ModsStatus } from "../../lib/types";
import { confirmDialog } from "../../store/confirm";
import { toastError, toastInfo, toastSuccess } from "../../store/toasts";
import page from "../page/page.module.css";
import { Badge, Chip, CountBadge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { Skeleton } from "../ui/Feedback";
import styles from "./details.module.css";

/** Entries are capped at 50 by the contract; the panel shows the first few. */
const INSTALLED_SHOWN = 12;

function fileName(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

export interface ModsPanelProps {
  game: Game;
}

/**
 * What the loader situation is, and the two ways to change it.
 *
 * Two things here are deliberately *not* optimistic: the loader button asks for
 * confirmation first, because it writes into the game folder, and the drop zone
 * reports per file before summing up, because a drop of ten archives must not
 * hide which one failed. Both are the same principle — the user is told what
 * touched their disk.
 */
export function ModsPanel({ game }: ModsPanelProps) {
  const { t } = useTranslation();
  const labels = useModLabels();
  const [status, setStatus] = useState<ModsStatus | null>(null);
  const [error, setError] = useState<UiAppError | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [installingLoader, setInstallingLoader] = useState(false);
  /** Name of the archive being extracted right now. */
  const [current, setCurrent] = useState<string | null>(null);
  const [htmlDrag, setHtmlDrag] = useState(false);

  /**
   * Whether there is anywhere for an archive to go. Both the drop tray and the
   * file dialog need a real mods folder: without one the core refuses every
   * archive, so neither is offered as if it could work.
   */
  const canInstall = status !== null && status.modsDir !== null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await api.modsStatus(game.id));
      setError(null);
    } catch (failure) {
      // A missing folder or a non-Windows entry is an answer, not a crash: show
      // it in place instead of toasting on mount.
      setError(toUiError(failure));
    } finally {
      setLoading(false);
    }
  }, [game.id]);

  useEffect(() => {
    setStatus(null);
    setError(null);
    void refresh();
  }, [refresh]);

  const installArchives = useCallback(
    async (paths: string[]) => {
      const archives = paths.filter(isArchivePath);
      const skipped = paths.length - archives.length;

      if (archives.length === 0) {
        // Screenshots dropped on a mod tray must say what they were, not look
        // like nothing happened.
        toastInfo(
          t("mods.dropIgnored"),
          t("mods.dropIgnoredBody", { count: skipped }),
        );
        return;
      }

      setInstalling(true);
      let ok = 0;
      let failed = 0;

      for (const archive of archives) {
        setCurrent(fileName(archive));
        try {
          const result = await api.installModArchive(game.id, archive);
          ok += 1;
          toastSuccess(
            t("mods.archiveInstalled", { name: fileName(archive) }),
            t("mods.archiveInstalledBody", {
              count: result.installed.length,
              dir: result.modsDir,
            }),
          );
          // The archive is moved, not deleted — and if the move failed it is
          // still exactly where it was, which is worth saying out loud.
          if (!result.trashed) toastInfo(t("mods.trashKept"), archive);
        } catch (failure) {
          failed += 1;
          toastError(
            t("mods.archiveFailed", { name: fileName(archive) }),
            toUiError(failure),
          );
        }
      }

      setCurrent(null);
      setInstalling(false);

      const summary = t("mods.dropSummary", { ok, failed, skipped });
      if (failed === 0) toastSuccess(summary);
      else toastInfo(summary);

      await refresh();
    },
    [game.id, refresh, t],
  );

  // Native drops only exist inside Tauri; a plain browser goes through the
  // HTML5 handlers on the drop zone below (which is enough for the mock).
  const windowDrag = useWindowDragDrop((paths) => {
    if (installing || !canInstall) return;
    void installArchives(paths);
  });

  // Without a mods folder there is nowhere for an archive to go: the core would
  // refuse every one of them, so the tray does not present itself as a target —
  // it looks inert and says what is missing, rather than promising and failing.
  const dragActive =
    canInstall &&
    ((windowDrag.dragging !== null && windowDrag.dragging.length > 0) || htmlDrag);

  const installLoader = async () => {
    if (status === null || status.suggestedLoader === null) return;
    const loader = labels.suggested(status.suggestedLoader);
    const confirmed = await confirmDialog({
      title: t("mods.installTitle", { loader }),
      body: t("mods.installBody", { loader, path: game.installPath }),
      confirmLabel: t("mods.installConfirm", { loader }),
      cancelLabel: t("common.cancel"),
      note: t("mods.installNote"),
    });
    if (!confirmed) return;

    setInstallingLoader(true);
    try {
      setStatus(await api.installModLoader(game.id));
      toastSuccess(t("mods.installedToast", { loader }), game.installPath);
    } catch (failure) {
      toastError(t("mods.installFailed"), toUiError(failure));
    } finally {
      setInstallingLoader(false);
    }
  };

  const chooseArchive = async () => {
    let path: string | null = null;
    try {
      path = await api.pickFile({
        title: t("mods.archiveDialogTitle"),
        filters: [
          {
            name: t("mods.archiveFilter"),
            extensions: [...ARCHIVE_EXTENSIONS],
          },
        ],
      });
    } catch (failure) {
      toastError(t("mods.pickFailed"), toUiError(failure));
      return;
    }
    if (path === null) return;
    await installArchives([path]);
  };

  const suggested =
    status !== null && status.loader === "none" && status.suggestedLoader !== null
      ? labels.suggested(status.suggestedLoader)
      : null;

  return (
    <section className={page.panel}>
      <div className={page.panelHead}>
        <div className={page.panelText}>
          <h2 className="sectionTitle">{t("mods.title")}</h2>
          <span className="sectionHint">{t("mods.hint")}</span>
        </div>
        <div className={page.panelActions}>
          <IconButton
            icon={RefreshCw}
            label={t("mods.refresh")}
            disabled={loading || installing}
            onClick={() => void refresh()}
          />
        </div>
      </div>

      {error !== null ? (
        <div className={styles.panelError} role="alert">
          <div className={styles.panelErrorText}>
            <span className={styles.panelErrorTitle}>{t("mods.statusFailed")}</span>
            <span className={styles.panelErrorBody}>{error.message}</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : loading && status === null ? (
        <Skeleton height={104} radius="var(--r-md)" />
      ) : status !== null ? (
        <>
          <div className={page.facts}>
            <span className={page.factKey}>{t("mods.factLoader")}</span>
            <span className={styles.factBadges}>
              <Badge tone={status.loader === "none" ? "quiet" : "accent"}>
                {labels.loader(status.loader)}
              </Badge>
              {suggested !== null ? (
                <span className={page.hint}>
                  {t("mods.suggested", { loader: suggested })}
                </span>
              ) : null}
            </span>

            <span className={page.factKey}>{t("mods.factEngine")}</span>
            <span className={styles.factBadges}>
              <Badge tone="info">{labels.engine(status.engine)}</Badge>
            </span>

            <span className={page.factKey}>{t("mods.factModsDir")}</span>
            <span className={`${page.factValue} mono`}>
              {status.modsDir ?? (
                <span className={page.hint}>{t("mods.noModsDir")}</span>
              )}
            </span>
          </div>

          {suggested !== null ? (
            <div className={styles.loaderOffer}>
              <div className={styles.loaderOfferText}>
                <span>{t("mods.installIntro", { loader: suggested })}</span>
                <span className={styles.loaderOfferWarn}>
                  {t("mods.installWarn", {
                    loader: suggested,
                    path: game.installPath,
                  })}
                </span>
              </div>
              <Button
                variant="secondary"
                icon={PackagePlus}
                loading={installingLoader}
                onClick={() => void installLoader()}
              >
                {t("mods.install", { loader: suggested })}
              </Button>
            </div>
          ) : null}

          <div className={page.panelText}>
            <h3 className={styles.subTitle}>
              <span>{t("mods.installed")}</span>
              {status.installed.length > 0 ? (
                <CountBadge>{status.installed.length}</CountBadge>
              ) : null}
            </h3>
            {status.installed.length === 0 ? (
              <span className={page.hint}>{t("mods.installedEmpty")}</span>
            ) : (
              <span className={styles.installedList}>
                {status.installed.slice(0, INSTALLED_SHOWN).map((name) => (
                  <Chip key={name}>{name}</Chip>
                ))}
                {status.installed.length > INSTALLED_SHOWN ? (
                  <Chip overflow>
                    {t("mods.installedMore", {
                      count: status.installed.length - INSTALLED_SHOWN,
                    })}
                  </Chip>
                ) : null}
              </span>
            )}
          </div>

          <div
            className={[
              styles.dropzone,
              dragActive ? styles.dropzoneActive : "",
              installing ? styles.dropzoneBusy : "",
              canInstall ? "" : styles.dropzoneDisabled,
            ]
              .filter(Boolean)
              .join(" ")}
            role="group"
            aria-label={t("mods.dropLabel")}
            onDragOver={(event) => {
              if (!canInstall) return;
              event.preventDefault();
              setHtmlDrag(true);
            }}
            onDragLeave={() => setHtmlDrag(false)}
            onDrop={(event) => {
              event.preventDefault();
              setHtmlDrag(false);
              if (installing || !canInstall) return;
              // A browser hands over `File`s without paths, and Tauri never
              // forwards an HTML5 drop at all — the name is what is left.
              const files = Array.from(event.dataTransfer?.files ?? []);
              void installArchives(files.map((file) => file.name));
            }}
          >
            <span className={styles.dropzoneIcon} aria-hidden>
              {installing ? (
                <LoaderCircle size={22} className={styles.spinner} />
              ) : (
                <PackagePlus size={22} />
              )}
            </span>

            <span className={styles.dropzoneTitle}>
              {installing && current !== null
                ? t("mods.dropBusy", { name: current })
                : dragActive
                  ? t("mods.dropActive")
                  : t("mods.dropLabel")}
            </span>
            <span className={styles.dropzoneHint}>{t("mods.dropHint")}</span>

            {status.modsDir === null ? (
              <span className={`${styles.dropzoneHint} ${styles.dropzoneWarn}`}>
                {t("mods.dropNeedsDir")}
              </span>
            ) : null}

            <Button
              size="sm"
              variant="ghost"
              disabled={installing || installingLoader || !canInstall}
              onClick={() => void chooseArchive()}
            >
              {t("mods.chooseArchive")}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
