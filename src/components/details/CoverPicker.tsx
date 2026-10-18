import { Images, LoaderCircle, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { toUiError, type UiAppError } from "../../lib/errors";
import type { CoverCandidate, Game } from "../../lib/types";
import { useLibraryStore } from "../../store/library";
import { toastError } from "../../store/toasts";
import page from "../page/page.module.css";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { TextField } from "../ui/Field";
import { Modal } from "../ui/Modal";
import styles from "./details.module.css";

type SearchStatus = "idle" | "loading" | "ready" | "error";

/** How many placeholder tiles stand in for results while the store is asked. */
const SKELETON_TILES = 6;

/**
 * The file half of the cover flow.
 *
 * Shared by the poster overlay and the picker dialog: both offer the same escape
 * hatch for artwork the store search will not find. The dialog is the *native*
 * one — this layer only supplies the filter, so the wording lives in i18n rather
 * than in the IPC layer.
 */
export function useCoverFilePicker(game: Game): {
  picking: boolean;
  pick(): Promise<void>;
} {
  const { t } = useTranslation();
  const updateCover = useLibraryStore((state) => state.updateCover);
  const picking = useLibraryStore(
    (state) => state.busy[`cover:file:${game.id}`] === true,
  );

  const pick = useCallback(async () => {
    let path: string | null = null;
    try {
      path = await api.pickFile({
        title: t("covers.fileDialogTitle"),
        filters: [
          {
            name: t("covers.fileFilter"),
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });
    } catch (failure) {
      toastError(t("covers.fileFailed"), toUiError(failure));
      return;
    }
    // `null` is the user closing the dialog — not a failure worth a toast.
    if (path === null) return;
    await updateCover(game.id, { kind: "file", path });
  }, [game.id, t, updateCover]);

  return { picking, pick };
}

export interface CoverPickerProps {
  game: Game;
  open: boolean;
  onClose(): void;
}

/**
 * Cover artwork for one game.
 *
 * Opening it searches the provider for the game's own title, so the wall is
 * never empty on arrival — the common case is "the first hit is the right one".
 * Picking a poster stores it and closes; the game's own row is what changes, and
 * it comes back through the library already carrying the new cover.
 */
export function CoverPicker({ game, open, onClose }: CoverPickerProps) {
  const { t } = useTranslation();
  const updateCover = useLibraryStore((state) => state.updateCover);
  const file = useCoverFilePicker(game);
  const [query, setQuery] = useState(game.title);
  const [candidates, setCandidates] = useState<CoverCandidate[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [error, setError] = useState<UiAppError | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const downloading = useLibraryStore(
    (state) => state.busy[`cover:url:${game.id}`] === true,
  );
  // Last-write-wins: a slow first search must not overwrite a newer one.
  const request = useRef(0);

  const search = useCallback(async (term: string) => {
    const trimmed = term.trim();
    // The core rejects an empty query outright; the button is disabled for it,
    // so this is only the Enter-key guard.
    if (trimmed.length === 0) return;
    const token = (request.current += 1);
    setStatus("loading");
    setError(null);
    try {
      const found = await api.fetchCoverCandidates(trimmed);
      if (token !== request.current) return;
      setCandidates(found);
      setStatus("ready");
    } catch (failure) {
      if (token !== request.current) return;
      setError(toUiError(failure));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    request.current += 1;
    setQuery(game.title);
    setChosen(null);
    setCandidates([]);
    void search(game.title);
  }, [open, game.id, game.title, search]);

  const pick = async (candidate: CoverCandidate) => {
    const url = candidate.portraitUrl ?? candidate.thumbUrl;
    setChosen(url);
    const updated = await updateCover(game.id, { kind: "url", url });
    // The dialog closes on success; a refusal keeps it open with the toast to
    // read, and the tile goes back to normal.
    if (updated !== null) onClose();
    else setChosen(null);
  };

  const canSearch = query.trim().length > 0 && status !== "loading" && !downloading;

  return (
    <Modal
      open={open}
      size="lg"
      title={t("covers.dialogTitle")}
      closeLabel={t("common.close")}
      onClose={onClose}
      footer={
        <>
          <span className={styles.footerNote}>{t("covers.fileNote")}</span>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        </>
      }
    >
      <form
        className={styles.coverSearch}
        onSubmit={(event) => {
          event.preventDefault();
          void search(query);
        }}
      >
        <TextField
          label={t("covers.searchLabel")}
          hint={t("covers.searchHint")}
          value={query}
          placeholder={t("covers.searchPlaceholder")}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          icon={Search}
          disabled={!canSearch}
          loading={status === "loading"}
        >
          {t("covers.search")}
        </Button>
      </form>

      {status === "ready" && candidates.length > 0 ? (
        <div className={styles.coverResults}>
          <div className={styles.coverResultsHead} role="status">
            <Badge tone="quiet" icon={Images}>
              {t("covers.provider")}
            </Badge>
            <span className={page.hint}>
              {t("covers.matchCount", { count: candidates.length })}
            </span>
          </div>

          <ul className={styles.candidateGrid}>
            {candidates.map((candidate) => {
              const url = candidate.portraitUrl ?? candidate.thumbUrl;
              const busy = downloading && chosen === url;
              return (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className={styles.candidate}
                    title={candidate.name}
                    disabled={downloading}
                    onClick={() => void pick(candidate)}
                  >
                    <span className={styles.candidateArt}>
                      <img
                        // Capsule art is wide and short: contained on the tile's
                        // own gradient reads as artwork, stretched would not.
                        className={
                          candidate.portraitUrl === null
                            ? styles.candidateThumb
                            : styles.candidateImage
                        }
                        src={url}
                        alt=""
                        loading="lazy"
                        draggable={false}
                      />
                      {busy ? (
                        <span className={styles.candidateBusy}>
                          <LoaderCircle
                            size={20}
                            className={styles.spinner}
                            aria-hidden
                          />
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.candidateName}>{candidate.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {status === "loading" && candidates.length === 0 ? (
        <ul className={styles.candidateGrid} aria-hidden>
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <li key={index}>
              <Skeleton className={styles.candidateSkeleton} radius="var(--r-md)" />
            </li>
          ))}
        </ul>
      ) : null}

      {status === "error" && error !== null ? (
        <EmptyState
          icon={Images}
          title={t("covers.searchFailed")}
          body={error.message}
          action={
            <Button variant="secondary" onClick={() => void search(query)}>
              {t("covers.retry")}
            </Button>
          }
        />
      ) : null}

      {status === "ready" && candidates.length === 0 ? (
        <EmptyState
          icon={Images}
          title={t("covers.emptyTitle")}
          body={t("covers.emptyBody", { query: query.trim() })}
          action={
            <Button
              variant="secondary"
              icon={Images}
              loading={file.picking}
              onClick={() => void file.pick()}
            >
              {t("covers.chooseFile")}
            </Button>
          }
        />
      ) : null}
    </Modal>
  );
}
