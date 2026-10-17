import {
  Check,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ACCENT_IDS,
  FONT_IDS,
  normalizeAccent,
  normalizeFont,
  type AccentId,
  type FontId,
} from "../../lib/appearance";
import type { Language, SettingsPatch } from "../../lib/types";
import { useLibraryStore } from "../../store/library";
import { shouldShowOnboarding, useOnboardingStore } from "../../store/onboarding";
import { useShellStore, type LayoutMode } from "../../store/shell";
import { ZenMark } from "../layout/ZenMark";
import { Button } from "../ui/Button";
import { Segmented, SwitchField } from "../ui/Field";
import styles from "./onboarding.module.css";

const STEPS = ["language", "appearance", "library", "window", "finish"] as const;
type StepId = (typeof STEPS)[number];

const STEP_LABEL_KEYS: Record<StepId, string> = {
  language: "onboarding.stepLanguage",
  appearance: "onboarding.stepAppearance",
  library: "onboarding.stepLibrary",
  window: "onboarding.stepWindow",
  finish: "onboarding.stepFinish",
};

const STEP_TITLE_KEYS: Record<StepId, string> = {
  language: "onboarding.languageTitle",
  appearance: "onboarding.appearanceTitle",
  library: "onboarding.libraryTitle",
  window: "onboarding.windowTitle",
  finish: "onboarding.finishTitle",
};

const STEP_BODY_KEYS: Record<StepId, string> = {
  language: "onboarding.languageBody",
  appearance: "onboarding.appearanceBody",
  library: "onboarding.libraryBody",
  window: "onboarding.windowBody",
  finish: "onboarding.finishBody",
};

const FONT_LABEL_KEYS: Record<FontId, string> = {
  "maple-mono": "onboarding.fontMapleMono",
  "instrument-sans": "onboarding.fontInstrumentSans",
  system: "onboarding.fontSystem",
};

const FONT_HINT_KEYS: Record<FontId, string> = {
  "maple-mono": "onboarding.fontMapleMonoHint",
  "instrument-sans": "onboarding.fontInstrumentSansHint",
  system: "onboarding.fontSystemHint",
};

const ACCENT_LABEL_KEYS: Record<AccentId, string> = {
  jade: "onboarding.accentJade",
  plum: "onboarding.accentPlum",
  azure: "onboarding.accentAzure",
  ember: "onboarding.accentEmber",
  rose: "onboarding.accentRose",
  neutral: "onboarding.accentNeutral",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What the tour is allowed to change. Layout lives in the shell store. */
interface Draft {
  language: Language;
  font: FontId;
  accent: AccentId;
  closeToTray: boolean;
  hideOnLaunch: boolean;
}

/* --------------------------------------------------------------- controls --- */

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
  /** Specimen line shown inside the option, in the option's own type. */
  sample?: string;
  /** Marks the option as a font choice: the button carries `data-font`. */
  fontId?: FontId;
}

/**
 * A radiogroup laid out as cards. The wizard needs a hint and a sample line
 * inside each option, which the shared `Segmented` pill does not carry — this
 * stays local chrome instead of growing a primitive used by three other screens.
 */
function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = false,
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange(next: T): void;
  columns?: boolean;
}) {
  const move = (direction: 1 | -1) => {
    const index = options.findIndex((option) => option.value === value);
    if (index === -1) return;
    onChange(options[(index + direction + options.length) % options.length].value);
  };

  return (
    <div
      className={[styles.choices, columns ? styles.choicesColumns : ""]
        .filter(Boolean)
        .join(" ")}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-font={option.fontId}
            className={[styles.choice, active ? styles.choiceActive : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onChange(option.value)}
          >
            <span className={styles.choiceMark} aria-hidden>
              <Check size={12} strokeWidth={3} />
            </span>
            <span className={styles.choiceBody}>
              <span className={styles.choiceLabel}>{option.label}</span>
              {option.sample ? (
                <span className={styles.choiceSample}>{option.sample}</span>
              ) : null}
              {option.hint ? (
                <span className={styles.choiceHint}>{option.hint}</span>
              ) : null}
            </span>
            {option.icon ?? null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ view --- */

/**
 * First-run tour, also reachable again from Settings.
 *
 * It renders itself (`shouldShowOnboarding`) instead of taking an `open` prop,
 * so the rule "settings are loaded and the tour was never finished" exists in
 * exactly one place. Every choice is written through `update_settings` the
 * moment it is made — the tour is an editor of live settings, not a form with a
 * submit button at the end; the final step simply commits the whole set once
 * more and marks the tour done.
 */
export function OnboardingWizard() {
  const { t } = useTranslation();
  const settings = useLibraryStore((state) => state.settings);
  const updateSettings = useLibraryStore((state) => state.updateSettings);
  const requested = useOnboardingStore((state) => state.requested);
  const endRerun = useOnboardingStore((state) => state.endRerun);
  const layout = useShellStore((state) => state.layout);
  const setLayout = useShellStore((state) => state.setLayout);

  const visible = shouldShowOnboarding(settings, requested);

  const [stepIndex, setStepIndex] = useState(0);  /**
   * Optimistic layer over the stored settings: a click must move the control
   * now, not after the round trip. It is dropped as soon as the stored settings
   * move, so a write that fails falls back to the truth instead of leaving the
   * tour claiming a value the core refused.
   */
  const [pending, setPending] = useState<Partial<Draft>>({});

  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  useEffect(() => {
    setPending((previous) => (Object.keys(previous).length === 0 ? previous : {}));
  }, [settings]);

  useEffect(() => {
    setStepIndex(0);
  }, [visible]);

  // `Escape` is deliberately swallowed: this is the only screen on which the
  // user is deciding where their own defaults come from, and it is left with
  // "Skip" — an explicit choice — rather than a key that half-commits.
  useEffect(() => {
    if (!visible) return;
    const panel = panelRef.current;
    panel?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [visible]);

  const persist = useCallback(
    (patch: SettingsPatch) => {
      // Silent: the tour saves on every click, and a stack of "Settings saved"
      // toasts behind a takeover is noise. Failures still toast.
      void updateSettings(patch, { silent: true });
    },
    [updateSettings],
  );

  const stored: Draft | null =
    settings === null
      ? null
      : {
          language: settings.language,
          font: normalizeFont(settings.font),
          accent: normalizeAccent(settings.accent),
          closeToTray: settings.closeToTray,
          hideOnLaunch: settings.hideOnLaunch,
        };
  const draft: Draft | null = stored === null ? null : { ...stored, ...pending };

  const choose = <K extends keyof Draft>(key: K, value: Draft[K], patch: SettingsPatch) => {
    setPending((previous) => ({ ...previous, [key]: value }));
    persist(patch);
  };

  const step: StepId = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const finish = async () => {
    if (draft !== null) {
      // One authoritative patch with everything the tour collected. The
      // per-choice writes above have already landed, so this is idempotent — and
      // it keeps the "tour finished" flag in the same write as the choices it
      // was finished with.
      await updateSettings(
        {
          language: draft.language,
          font: draft.font,
          accent: draft.accent,
          closeToTray: draft.closeToTray,
          hideOnLaunch: draft.hideOnLaunch,
          onboardingCompleted: true,
        },
        { silent: true },
      );
    }
    endRerun();
  };

  const skip = () => {
    // Skip means "I will decide later": it changes nothing and only stops the
    // tour from reappearing. Whatever was already picked stays picked.
    persist({ onboardingCompleted: true });
    endRerun();
  };

  const fontOptions: readonly ChoiceOption<FontId>[] = FONT_IDS.map((id) => ({
    value: id,
    label: t(FONT_LABEL_KEYS[id]),
    hint: t(FONT_HINT_KEYS[id]),
    sample: t("onboarding.fontSample"),
    fontId: id,
  }));

  const accentOptions: readonly ChoiceOption<AccentId>[] = ACCENT_IDS.map((id) => ({
    value: id,
    label: t(ACCENT_LABEL_KEYS[id]),
  }));

  const layoutOptions: readonly ChoiceOption<LayoutMode>[] = [
    {
      value: "grid",
      label: t("onboarding.libraryGrid"),
      hint: t("onboarding.libraryGridHint"),
      icon: <LayoutGrid size={18} className={styles.choiceIcon} aria-hidden />,
    },
    {
      value: "list",
      label: t("onboarding.libraryList"),
      hint: t("onboarding.libraryListHint"),
      icon: <List size={18} className={styles.choiceIcon} aria-hidden />,
    },
  ];

  return createPortal(
    <AnimatePresence>
      {visible && draft !== null ? (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            tabIndex={-1}
            className={styles.frame}
            initial={{ opacity: 0, y: 14, scale: 0.992 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.996 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <header className={styles.top}>
              <span className={styles.brand}>
                <ZenMark className={styles.brandMark} />
                <span className={styles.brandText}>
                  <span className={styles.brandName}>{t("app.name")}</span>
                  <span className={styles.brandKicker}>{t("onboarding.kicker")}</span>
                </span>
              </span>
              <span className={styles.progress}>
                {t("onboarding.stepCounter", {
                  current: stepIndex + 1,
                  total: STEPS.length,
                })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className={styles.skip}
                title={t("onboarding.skipHint")}
                onClick={skip}
              >
                {t("onboarding.skip")}
              </Button>
            </header>

            <div className={styles.body}>
              <nav className={styles.rail} aria-label={t("onboarding.railLabel")}>
                <ol className={styles.railList}>
                  {STEPS.map((id, index) => {
                    const active = index === stepIndex;
                    const visited = index < stepIndex;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          aria-current={active ? "step" : undefined}
                          className={[
                            styles.railItem,
                            active ? styles.railItemActive : "",
                            visited ? styles.railItemVisited : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={() => setStepIndex(index)}
                        >
                          <span className={styles.railIndex}>
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className={styles.railLabel}>{t(STEP_LABEL_KEYS[id])}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </nav>

              <div className={styles.content}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={step}
                    className={styles.step}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <h1 className={styles.title} id={headingId}>
                      {t(STEP_TITLE_KEYS[step])}
                    </h1>
                    <p className={styles.lead}>{t(STEP_BODY_KEYS[step])}</p>

                    {step === "language" ? (
                      <Segmented
                        label={t("onboarding.languageTitle")}
                        value={draft.language}
                        options={[
                          { value: "en", label: t("settings.languageEn") },
                          { value: "pl", label: t("settings.languagePl") },
                        ]}
                        onChange={(language) => choose("language", language, { language })}
                      />
                    ) : null}

                    {step === "appearance" ? (
                      <>
                        <ChoiceGroup
                          label={t("onboarding.fontTitle")}
                          value={draft.font}
                          options={fontOptions}
                          onChange={(font) => choose("font", font, { font })}
                        />

                        <div
                          className={styles.accents}
                          role="radiogroup"
                          aria-label={t("onboarding.accentTitle")}
                          onKeyDown={(event) => {
                            if (
                              event.key !== "ArrowRight" &&
                              event.key !== "ArrowLeft" &&
                              event.key !== "ArrowDown" &&
                              event.key !== "ArrowUp"
                            ) {
                              return;
                            }
                            event.preventDefault();
                            const direction =
                              event.key === "ArrowRight" || event.key === "ArrowDown"
                                ? 1
                                : -1;
                            const index = ACCENT_IDS.indexOf(draft.accent);
                            const next =
                              ACCENT_IDS[
                                (index + direction + ACCENT_IDS.length) % ACCENT_IDS.length
                              ];
                            choose("accent", next, { accent: next });
                          }}
                        >
                          {accentOptions.map((option) => {
                            const active = option.value === draft.accent;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                aria-label={option.label}
                                tabIndex={active ? 0 : -1}
                                className={[
                                  styles.swatch,
                                  active ? styles.swatchActive : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                onClick={() =>
                                  choose("accent", option.value, { accent: option.value })
                                }
                              >
                                <span
                                  className={styles.swatchDot}
                                  data-accent={option.value}
                                  aria-hidden
                                >
                                  {active ? <Check size={14} strokeWidth={3} /> : null}
                                </span>
                                <span className={styles.swatchName}>{option.label}</span>
                              </button>
                            );
                          })}
                        </div>

                        <div className={styles.preview}>
                          <p className={styles.previewHead}>
                            {t("onboarding.previewTitle")}
                            <span className={styles.previewRule} />
                          </p>
                          <p className={styles.previewDisplay}>
                            {t("onboarding.previewDisplay")}
                          </p>
                          <p
                            className={styles.previewBody}
                            data-font={draft.font}
                          >
                            {t("onboarding.previewSample")}
                          </p>
                          <p className={styles.previewMeta}>{t("onboarding.previewMeta")}</p>
                          <p className={styles.previewActions}>
                            <span className={styles.previewButton}>
                              {t("onboarding.previewButton")}
                            </span>
                            <span className={styles.previewBadge}>
                              {t(ACCENT_LABEL_KEYS[draft.accent])}
                            </span>
                          </p>
                        </div>
                      </>
                    ) : null}

                    {step === "library" ? (
                      <ChoiceGroup
                        label={t("onboarding.libraryTitle")}
                        value={layout}
                        options={layoutOptions}
                        columns
                        onChange={(next) => setLayout(next)}
                      />
                    ) : null}

                    {step === "window" ? (
                      <div className={styles.choices}>
                        <SwitchField
                          label={t("settings.closeToTray")}
                          hint={t("settings.closeToTrayHint")}
                          checked={draft.closeToTray}
                          onChange={(checked) =>
                            choose("closeToTray", checked, { closeToTray: checked })
                          }
                        />
                        <SwitchField
                          label={t("settings.hideOnLaunch")}
                          hint={t("settings.hideOnLaunchHint")}
                          checked={draft.hideOnLaunch}
                          onChange={(checked) =>
                            choose("hideOnLaunch", checked, { hideOnLaunch: checked })
                          }
                        />
                      </div>
                    ) : null}

                    {step === "finish" ? (
                      <>
                        <p className={styles.finishMark}>
                          <Sparkles size={16} aria-hidden />
                          <span className={styles.summaryNote}>
                            {t("onboarding.finishNote")}
                          </span>
                        </p>
                        <dl className={styles.summary}>
                          <dt className={styles.summaryKey}>
                            {t("onboarding.summaryLanguage")}
                          </dt>
                          <dd className={styles.summaryValue}>
                            {draft.language === "pl"
                              ? t("settings.languagePl")
                              : t("settings.languageEn")}
                          </dd>
                          <dt className={styles.summaryKey}>{t("onboarding.summaryFont")}</dt>
                          <dd className={styles.summaryValue}>
                            {t(FONT_LABEL_KEYS[draft.font])}
                          </dd>
                          <dt className={styles.summaryKey}>{t("onboarding.summaryAccent")}</dt>
                          <dd className={styles.summaryValue}>
                            {t(ACCENT_LABEL_KEYS[draft.accent])}
                          </dd>
                          <dt className={styles.summaryKey}>{t("onboarding.summaryLibrary")}</dt>
                          <dd className={styles.summaryValue}>
                            {layout === "grid"
                              ? t("onboarding.libraryGrid")
                              : t("onboarding.libraryList")}
                          </dd>
                          <dt className={styles.summaryKey}>{t("onboarding.summaryTray")}</dt>
                          <dd className={styles.summaryValue}>
                            {draft.closeToTray ? t("common.yes") : t("common.no")}
                          </dd>
                          <dt className={styles.summaryKey}>
                            {t("onboarding.summaryHideOnLaunch")}
                          </dt>
                          <dd className={styles.summaryValue}>
                            {draft.hideOnLaunch ? t("common.yes") : t("common.no")}
                          </dd>
                        </dl>
                      </>
                    ) : null}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            <footer className={styles.foot}>
              <Button
                variant="ghost"
                icon={ChevronLeft}
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
              >
                {t("onboarding.back")}
              </Button>
              <span className={styles.footHint}>{t("onboarding.footHint")}</span>
              {isLast ? (
                <Button
                  variant="primary"
                  icon={Sparkles}
                  onClick={() => void finish()}
                >
                  {t("onboarding.finish")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))}
                >
                  {t("onboarding.next")}
                  <ChevronRight size={14} aria-hidden />
                </Button>
              )}
            </footer>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
