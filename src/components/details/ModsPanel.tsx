import { CircleSlash, FolderOpen, LoaderCircle, PackagePlus, RefreshCw } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
} from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { ARCHIVE_EXTENSIONS, isArchivePath, useWindowDragDrop } from "../../lib/dnd";
import { toUiError, type UiAppError } from "../../lib/errors";
import { useModLabels } from "../../lib/hooks";
import type { Game, LoaderUpdate, ModLoader, ModLoaderInfo, ModsStatus } from "../../lib/types";
import { confirmDialog } from "../../store/confirm";
import { useLibraryStore } from "../../store/library";
import { toastError, toastInfo, toastSuccess } from "../../store/toasts";
import page from "../page/page.module.css";
import { Badge, Chip, CountBadge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { Skeleton } from "../ui/Feedback";
import styles from "./details.module.css";

/** Entries are capped at 50 by the contract; the panel shows the first few. */
const INSTALLED_SHOWN = 12;

/**
 * What the contract's defaults say when the settings have not arrived yet.
 *
 * The core ships lenient at 1024 MB, so a panel that renders in the instant
 * before `get_settings` resolves is describing the rules that are actually in
 * force rather than guessing at them.
 */
const DEFAULT_VALIDATION = { lenient: true, maxMb: 1024 } as const;

function fileName(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

/** Imperative handle exposed to Big Picture so the couch can cycle focus
   between the panel's action buttons with the d-pad and fire the focused one
   with South. */
export interface ModsPanelHandle {
  focusFirst(): void;
  focusNext(): void;
  focusPrevious(): void;
  activateFocused(): void;
}

export interface ModsPanelProps {
  game: Game;
  /** Tighter layout, taller touch targets and a stronger focus ring: the
     console take-over has less breathing room than the details page. */
  compact?: boolean;
  /** Whether d-pad left/right should cycle focus between the panel's buttons.
     Big Picture sets this so the console can reach every action. */
  gamepad?: boolean;
}

/** The loader situation, and the ways to change it — for the engines that have one. */
export const ModsPanel = forwardRef<ModsPanelHandle, ModsPanelProps>(
  function ModsPanel(
    { game, compact = false, gamepad = false }: ModsPanelProps,
    forwardedRef: ForwardedRef<ModsPanelHandle>,
  ) {
  const { t } = useTranslation();
  const labels = useModLabels();
  const settings = useLibraryStore((state) => state.settings);
  const [status, setStatus] = useState<ModsStatus | null>(null);
  const [error, setError] = useState<UiAppError | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  /** Catalog id whose loader is being downloaded right now, or `null`. */
  const [installingLoader, setInstallingLoader] = useState<string | null>(null);
  /** Name of the archive being extracted right now. */
  const [current, setCurrent] = useState<string | null>(null);
  /** Update check for the loader Zen installed itself; `null` when there is
     nothing to update or no Zen-installed loader at all. */
  const [loaderUpdate, setLoaderUpdate] = useState<LoaderUpdate | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [htmlDrag, setHtmlDrag] = useState(false);

  /** The archive rules the core is currently holding this install to. */
  const validation = {
    lenient: settings?.modsLenient ?? DEFAULT_VALIDATION.lenient,
    maxMb: settings?.modsMaxMb ?? DEFAULT_VALIDATION.maxMb,
  };
  const mode = validation.lenient
    ? {
        name: t("mods.validationLenient"),
        detail: t("mods.validationLenientDetail"),
      }
    : {
        name: t("mods.validationStrict"),
        detail: t("mods.validationStrictDetail"),
      };

  /**
   * Whether there is anywhere for an archive to go. Both the drop tray and the
   * file dialog need a real mods folder: without one the core refuses every
   * archive, so neither is offered as if it could work.
   */
  const canInstall = status !== null && status.modsDir !== null;

  /** Docs URL for the externally-managed loader (tModLoader), if the catalog lists one. */
  const externalDocsUrl = status?.loaders.find((l) => l.id === "tmodloader")?.docs ?? null;

  /* ------------------------------------------------------------ focus --- */

  /** The section root: Big Picture uses it to find every action button and
     cycle focus between them with the d-pad. */
  const sectionRef = useRef<HTMLDivElement>(null);

  /** Every action button in DOM order — refreshed after each render so the
     list stays honest when loaders appear/disappear or the drop zone shows up. */
  const orderedButtons = useCallback(
    () =>
      Array.from(
        sectionRef.current?.querySelectorAll<HTMLButtonElement>("button") ??
          [],
      ),
    [],
  );

  const focusFirst = useCallback(() => {
    orderedButtons()[0]?.focus({ preventScroll: true });
  }, [orderedButtons]);

  const focusNext = useCallback(() => {
    const buttons = orderedButtons();
    if (buttons.length === 0) return;
    const current = document.activeElement;
    const idx = buttons.indexOf(current as HTMLButtonElement);
    buttons[idx >= 0 ? (idx + 1) % buttons.length : 0]?.focus({
      preventScroll: true,
    });
  }, [orderedButtons]);

  const focusPrevious = useCallback(() => {
    const buttons = orderedButtons();
    if (buttons.length === 0) return;
    const current = document.activeElement;
    const idx = buttons.indexOf(current as HTMLButtonElement);
    buttons[idx >= 0 ? (idx - 1 + buttons.length) % buttons.length : 0]?.focus({
      preventScroll: true,
    });
  }, [orderedButtons]);

  const activateFocused = useCallback(() => {
    (document.activeElement as HTMLButtonElement | null)?.click();
  }, []);

  useImperativeHandle(
    forwardedRef,
    () => ({
      focusFirst,
      focusNext,
      focusPrevious,
      activateFocused,
    }),
    [focusFirst, focusNext, focusPrevious, activateFocused],
  );

  const handlePanelKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!gamepad) return;
      const buttons = orderedButtons();
      if (buttons.length === 0) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void focusPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void focusNext();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void activateFocused();
      }
    },
    [gamepad, orderedButtons, focusNext, focusPrevious, activateFocused],
  );

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

  /** Whether the loader Zen installed itself has an update waiting. Only
     checked for Zen-installed loaders — detected/manual loaders stay quiet. */
  useEffect(() => {
    if (status?.installLoader === null) {
      setLoaderUpdate(null);
      setCheckingUpdate(false);
      return;
    }
    setCheckingUpdate(true);
    void api
      .checkLoaderUpdates(game.id)
      .then((update) => {
        setLoaderUpdate(update !== null && update.updatable ? update : null);
      })
      .catch(() => {
        // Informational only: never block the panel on an update check.
        setLoaderUpdate(null);
      })
      .finally(() => setCheckingUpdate(false));
  }, [status?.installLoader, game.id]);

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
          /*
           * A refusal names the rules it was refused under: "unsupported
           * archive type" only means something next to the mode and the size
           * limit that were in force when it happened. The core's own message
           * is kept verbatim and the note is appended to it.
           */
          toastError(
            t("mods.archiveFailed", { name: fileName(archive) }),
            toUiError(failure),
            undefined,
            t("mods.validationNoteToast", {
              mode: mode.name,
              detail: mode.detail,
              mb: validation.maxMb,
            }),
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
    [game.id, mode.detail, mode.name, refresh, t, validation.maxMb],
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

  /**
   * Installs one loader from the catalog.
   *
   * Two things here are deliberately *not* optimistic: the loader button asks
   * for confirmation first, because it writes into the game folder, and the drop
   * zone reports per file before summing up, because a drop of ten archives must
   * not hide which one failed. Both are the same principle — the user is told
   * what touched their disk.
   */
  const installLoader = async (loader: ModLoaderInfo) => {
    const confirmed = await confirmDialog({
      title: t("mods.installTitle", { loader: loader.name }),
      body: t("mods.installBody", { loader: loader.name, path: game.installPath }),
      confirmLabel: t("mods.installConfirm", { loader: loader.name }),
      cancelLabel: t("common.cancel"),
      note: t("mods.installNote"),
    });
    if (!confirmed) return;

    setInstallingLoader(loader.id);
    try {
      // The id is sent explicitly: the panel offers the whole catalog, and the
      // core's own idea of "the suggestion" is not necessarily the row clicked.
      setStatus(await api.installModLoader(game.id, loader.id));
      toastSuccess(t("mods.installedToast", { loader: loader.name }), game.installPath);
    } catch (failure) {
      toastError(t("mods.installFailed"), toUiError(failure));
    } finally {
      setInstallingLoader(null);
    }
  };

  const reinstallLoader = async () => {
    const loader = status?.installLoader;
    if (!loader) return;
    setInstallingLoader(loader.id);
    try {
      // Reinstalling the same loader pulls the newest release and records it.
      setStatus(await api.installModLoader(game.id, loader.id));
      toastSuccess(
        t("mods.installedToast", { loader: labels.loader(loader.id as ModLoader) }),
        game.installPath,
      );
    } catch (failure) {
      toastError(t("mods.installFailed"), toUiError(failure));
    } finally {
      setInstallingLoader(null);
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

  /** Reveals the game's mods folder in the file manager — the console equivalent
     of "browse your mods", and the natural companion to the drop tray. */
  const openFolder = async () => {
    const modsDir = status?.modsDir;
    if (modsDir === null || modsDir === undefined) return;
    try {
      await api.revealItemInDir(modsDir);
    } catch (failure) {
      toastError(t("mods.revealFailed"), toUiError(failure));
    }
  };

  return (
    <section
      ref={sectionRef}
      className={[page.panel, compact ? styles.compact : ""]
        .filter(Boolean)
        .join(" ")}
      onKeyDown={handlePanelKeyDown}
    >
      <div className={page.panelHead}>
        <div className={page.panelText}>
          <h2 className="sectionTitle">{t("mods.title")}</h2>
          <span className="sectionHint">{t("mods.hint")}</span>
        </div>
        <div className={page.panelActions}>
          <IconButton
            
            icon={RefreshCw}
            label={t("mods.refresh")}
            disabled={loading || installing || installingLoader !== null}
            onClick={() => void refresh()}
          />
          {compact ? null : (
            <IconButton
              
              icon={FolderOpen}
              label={t("mods.openFolder")}
              disabled={
                status?.modsDir === null ||
                installing ||
                installingLoader !== null
              }
              onClick={() => void openFolder()}
            />
          )}
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

          {/*
           * A loader Zen installed itself can go stale. When a newer release
           * exists, say so and offer a reinstall — the same install path as a
           * first install, so the core validates and records it identically.
           */}
          {status.supported &&
            status.installLoader !== null &&
            loaderUpdate !== null && (
              <div className={styles.loaderUpdate}>
                <span>{t("mods.updateAvailable", { latest: loaderUpdate.latest })}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={
                    installingLoader === loaderUpdate.loaderId || checkingUpdate
                  }
                  disabled={installingLoader !== null || installing}
                  onClick={() => void reinstallLoader()}
                >
                  {t("mods.reinstallLoader")}
                </Button>
              </div>
            )}

          {/*
           * The engine is the gate the whole panel turns on. When the catalog
           * knows nothing about it there is no loader to offer and nothing
           * honest for this panel to write, so it says exactly that and stops:
           * no install button, no drop tray, no promise it cannot keep.
           */}
          {!status.supported ? (
            <div className={styles.unsupported} role="status">
              <span className={styles.unsupportedIcon} aria-hidden>
                <CircleSlash size={18} />
              </span>
              <div className={styles.unsupportedText}>
                <span className={styles.unsupportedTitle}>
                  {t("mods.unsupportedTitle")}
                </span>
                <span className={styles.unsupportedBody}>
                  {t("mods.unsupportedBody")}
                </span>
              </div>
            </div>
          ) : null}

          {status.supported && status.loader === "none" ? (
            <div className={styles.loaders}>
              <div className={page.panelText}>
                <h3 className={styles.subTitle}>{t("mods.loadersTitle")}</h3>
                <span className={page.hint}>{t("mods.loadersHint")}</span>
              </div>

              <ul className={styles.loaderList}>
                {status.loaders.map((loader) => {
                  const recommended = loader.id === status.suggestedLoader;
                  return (
                    <li className={styles.loaderRow} key={loader.id}>
                      <span className={styles.loaderRowText}>
                        <span className={styles.loaderName}>
                          {loader.name}
                          {recommended ? (
                            <Badge tone="accent">{t("mods.recommended")}</Badge>
                          ) : null}
                        </span>
                        {loader.install === "manual" ? (
                          <>
                            {loader.docs ? (
                              <a
                                href={loader.docs}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.loaderManualLink}
                              >
                                {t("mods.officialDownload")}
                              </a>
                            ) : null}
                            <span className={styles.loaderManualText}>
                              {t("mods.manualLoader")}
                            </span>
                          </>
                        ) : null}
                      </span>
                      {loader.install === "download" ? (
                        <Button
                          
                          size={compact ? "md" : "sm"}
                          variant={recommended ? "secondary" : "ghost"}
                          icon={PackagePlus}
                          loading={installingLoader === loader.id}
                          disabled={installingLoader !== null || installing}
                          onClick={() => void installLoader(loader)}
                        >
                          {t("mods.installLoader", { loader: loader.name })}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {/* Said once, under the whole list: every row writes the same place. */}
              <p className={styles.loadersNote}>
                {t("mods.loadersWriteNote", { path: game.installPath })}
              </p>
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

          {/* The tray is a promise about what the core will accept — where there
              is no core support there is nothing to promise, so it is gone. */}
          {status.supported ? (
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
              {/*
               * The rules in force, on the thing they govern. A mode that only
               * lived in Settings would have to be remembered at the exact
               * moment a drop is refused.
               */}
              <span className={styles.validation}>
                <span className={styles.validationLabel}>
                  {t("mods.validationLabel")}
                </span>
                <Badge tone={validation.lenient ? "info" : "warn"}>
                  {mode.name}
                </Badge>
                <span className={styles.validationDetail}>{mode.detail}</span>
                <span className={styles.validationLimit}>
                  {t("mods.validationLimit", { mb: validation.maxMb })}
                </span>
              </span>

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
              <span className={styles.dropzoneHint}>
                {validation.lenient
                  ? t("mods.dropHintLenient")
                  : t("mods.dropHintStrict")}
              </span>

              {status.modsDirKind === "asi-root" ? (
                <span className={styles.dropzoneHint}>
                  {t("mods.asiRootNote")}
                </span>
              ) : null}

              {status.modsDir === null ? (
                status.modsDirKind === "external" ? (
                  <div className={styles.dropzoneExternal}>
                    {t("mods.externalMods")}
                    {externalDocsUrl ? (
                      <a
                        href={externalDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.dropzoneExternalLink}
                      >
                        {t("mods.externalDocs")}
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <span className={`${styles.dropzoneHint} ${styles.dropzoneWarn}`}>
                    {t("mods.dropNeedsDir")}
                  </span>
                )
              ) : null}

              <Button
                
                size={compact ? "md" : "sm"}
                variant="ghost"
                disabled={installing || installingLoader !== null || !canInstall}
                onClick={() => void chooseArchive()}
              >
                {t("mods.chooseArchive")}
              </Button>
              {compact && status?.modsDir !== null ? (
                <Button
                  
                  size="md"
                  variant="ghost"
                  icon={FolderOpen}
                  disabled={installing || installingLoader !== null}
                  onClick={() => void openFolder()}
                >
                  {t("mods.openFolder")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
});
