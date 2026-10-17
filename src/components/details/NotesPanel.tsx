import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "../../lib/hooks";
import type { Game } from "../../lib/types";
import { useLibraryStore } from "../../store/library";
import { TextAreaField } from "../ui/Field";
import page from "../page/page.module.css";

const AUTOSAVE_MS = 700;

type SaveState = "idle" | "saving" | "saved" | "failed";

export interface NotesPanelProps {
  game: Game;
}

/**
 * Notes autosave. The debounce keeps one write per pause in typing, and the
 * indicator always says what actually happened — no silent truncation.
 */
export function NotesPanel({ game }: NotesPanelProps) {
  const { t } = useTranslation();
  const updateGame = useLibraryStore((state) => state.updateGame);

  const [notes, setNotes] = useState(game.notes ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const stored = useRef(game.notes ?? "");
  const debounced = useDebouncedValue(notes, AUTOSAVE_MS);

  // A different entry gets a fresh editor and a fresh baseline.
  useEffect(() => {
    const value = game.notes ?? "";
    stored.current = value;
    setNotes(value);
    setState("idle");
  }, [game.id]);

  useEffect(() => {
    if (debounced === stored.current) return;
    let cancelled = false;
    setState("saving");
    void (async () => {
      const value = debounced.trim() === "" ? null : debounced;
      const updated = await updateGame(
        game.id,
        { notes: value },
        { failureTitle: t("details.notesSaveFailed") },
      );
      if (cancelled) return;
      if (updated === null) {
        setState("failed");
        return;
      }
      stored.current = value ?? "";
      setState("saved");
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, game.id, t, updateGame]);

  const indicator =
    state === "saving"
      ? t("details.notesSaving")
      : state === "saved"
        ? t("details.notesSaved")
        : state === "failed"
          ? t("details.notesSaveFailed")
          : null;

  return (
    <section className={page.panel}>
      <div className={page.panelText}>
        <h2 className="sectionTitle">{t("details.notes")}</h2>
        <p className="sectionHint">{t("details.notesHint")}</p>
      </div>

      <TextAreaField
        label={t("details.notesField")}
        placeholder={t("details.notesPlaceholder")}
        rows={5}
        value={notes}
        action={
          indicator ? (
            <span
              className={[page.hint, state === "failed" ? page.hintWarn : ""]
                .filter(Boolean)
                .join(" ")}
            >
              {indicator}
            </span>
          ) : undefined
        }
        onChange={(event) => setNotes(event.target.value)}
      />
    </section>
  );
}
