import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlyphRow } from "../components/bigpicture/Glyph";
import page from "../components/page/page.module.css";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import {
  Segmented,
  SwitchField,
  TextField,
  type SegmentedOption,
} from "../components/ui/Field";
import { Skeleton } from "../components/ui/Feedback";
import { isMock } from "../lib/api";
import { useGlyphTheme } from "../lib/hooks";
import { STORAGE_PATHS } from "../lib/paths";
import type { BigPictureLayout, Language } from "../lib/types";
import { useLibraryStore } from "../store/library";
import { useOnboardingStore } from "../store/onboarding";

/** The four face buttons, in the order a poster's controller paints them. */
const GLYPH_PREVIEW = ["north", "west", "south", "east"] as const;

/** Bounds the core enforces on `modsMaxMb` (`Settings::normalize_mods_max_mb`). */
const MODS_MAX_MB = { min: 1, max: 8192 } as const;

function SettingsSkeleton() {
  return (
    <div className={[page.page, page.narrow].join(" ")} aria-hidden>
      <Skeleton height={92} radius="var(--r-lg)" />
      <Skeleton height={148} radius="var(--r-lg)" />
      <Skeleton height={120} radius="var(--r-lg)" />
    </div>
  );
}

/**
 * The archive size limit.
 *
 * Held as text while it is being typed, and only sent when it is a whole number
 * in range: a half-typed "819" must not be written to the core, and an empty
 * field must not become `0` — which is the one thing the core would refuse
 * outright. It commits on blur or Enter, so the field is never fighting the
 * keyboard.
 */
function ModsMaxMbField() {
  const { t } = useTranslation();
  const stored = useLibraryStore((state) => state.settings?.modsMaxMb ?? 1024);
  const updateSettings = useLibraryStore((state) => state.updateSettings);
  const [draft, setDraft] = useState(String(stored));
  const [error, setError] = useState<string | null>(null);

  // A value that arrives from elsewhere (a rollback after a refused write) wins
  // over whatever is in the field.
  useEffect(() => {
    setDraft(String(stored));
    setError(null);
  }, [stored]);

  const commit = () => {
    const parsed = Number(draft.trim());
    if (
      !Number.isInteger(parsed) ||
      parsed < MODS_MAX_MB.min ||
      parsed > MODS_MAX_MB.max
    ) {
      setError(t("settings.modsMaxMbInvalid"));
      return;
    }
    setError(null);
    if (parsed !== stored) void updateSettings({ modsMaxMb: parsed });
  };

  return (
    <TextField
      label={t("settings.modsMaxMb")}
      hint={t("settings.modsMaxMbHint")}
      error={error}
      type="number"
      inputMode="numeric"
      min={MODS_MAX_MB.min}
      max={MODS_MAX_MB.max}
      step={1}
      className={page.numberField}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        if (error !== null) setError(null);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

/**
 * Settings. Holds the persisted values that have a control here — language, the
 * window-behaviour switches, what a launch is wrapped with, the archive rules,
 * the cover lookup and the console-mode glyphs — plus read-only facts, and a way
 * back into the setup tour.
 *
 * Font and accent are settings too, but their controls live in the tour (the
 * only place a choice can be previewed against real type and a real accent), so
 * this screen points at it rather than growing a second, worse editor for the
 * same two values.
 */
export function SettingsView() {
  const { t } = useTranslation();
  const settings = useLibraryStore((state) => state.settings);
  const updateSettings = useLibraryStore((state) => state.updateSettings);
  const saving = useLibraryStore((state) => state.busy["settings:update"] === true);
  const requestRerun = useOnboardingStore((state) => state.requestRerun);
  const layout = settings?.bigPictureLayout ?? "auto";
  const { theme, pads } = useGlyphTheme(layout);

  if (settings === null) {
    return (
      <div className={page.scroll}>
        <SettingsSkeleton />
      </div>
    );
  }

  const languageOptions: readonly SegmentedOption<Language>[] = [
    { value: "en", label: t("settings.languageEn") },
    { value: "pl", label: t("settings.languagePl") },
  ];

  const layoutOptions: readonly SegmentedOption<BigPictureLayout>[] = [
    { value: "auto", label: t("settings.layoutAuto") },
    { value: "xbox", label: t("settings.layoutXbox") },
    { value: "playstation", label: t("settings.layoutPlaystation") },
  ];

  // What `auto` actually resolved to, said in the settings rather than left to
  // be discovered on the couch.
  const glyphNote =
    layout !== "auto"
      ? null
      : pads.length > 0
        ? t("settings.glyphDetectedPad", { pad: pads[0].name })
        : t("settings.glyphNoPad");

  return (
    <div className={page.scroll}>
      <div className={[page.page, page.narrow].join(" ")}>
        {/* --------------------------------------------------- language --- */}
        <section className={page.panel}>
          <div className={page.panelHead}>
            <div className={page.panelText}>
              <h2 className="sectionTitle">{t("settings.languageTitle")}</h2>
              <p className="sectionHint">{t("settings.languageDescription")}</p>
            </div>
            <Segmented
              label={t("settings.languageTitle")}
              value={settings.language}
              options={languageOptions}
              onChange={(language) => void updateSettings({ language })}
            />
          </div>
        </section>

        {/* -------------------------------------------------- behaviour --- */}
        <section className={page.panel}>
          <div className={page.panelText}>
            <h2 className="sectionTitle">{t("settings.behaviourTitle")}</h2>
            <p className="sectionHint">{t("settings.behaviourDescription")}</p>
          </div>
          <div className={page.fields}>
            <SwitchField
              label={t("settings.closeToTray")}
              hint={t("settings.closeToTrayHint")}
              checked={settings.closeToTray}
              disabled={saving}
              onChange={(checked) => void updateSettings({ closeToTray: checked })}
            />
            <SwitchField
              label={t("settings.hideOnLaunch")}
              hint={t("settings.hideOnLaunchHint")}
              checked={settings.hideOnLaunch}
              disabled={saving}
              onChange={(checked) => void updateSettings({ hideOnLaunch: checked })}
            />
          </div>
        </section>

        {/* ----------------------------------------------------- gaming --- */}
        <section className={page.panel}>
          <div className={page.panelText}>
            <h2 className="sectionTitle">{t("settings.gamingTitle")}</h2>
            <p className="sectionHint">{t("settings.gamingDescription")}</p>
          </div>
          <div className={page.fields}>
            <SwitchField
              label={t("settings.useGameMode")}
              hint={t("settings.useGameModeHint")}
              checked={settings.useGameMode}
              disabled={saving}
              onChange={(checked) => void updateSettings({ useGameMode: checked })}
            />
            <SwitchField
              label={t("settings.useMangoHud")}
              hint={t("settings.useMangoHudHint")}
              checked={settings.useMangoHud}
              disabled={saving}
              onChange={(checked) => void updateSettings({ useMangoHud: checked })}
            />
          </div>
        </section>

        {/* ------------------------------------------------------- mods --- */}
        <section className={page.panel}>
          <div className={page.panelHead}>
            <div className={page.panelText}>
              <h2 className="sectionTitle">{t("settings.modsTitle")}</h2>
              <p className="sectionHint">{t("settings.modsDescription")}</p>
            </div>
            {/* The mode at a glance, in the same wording the Mods panel of a
                game uses when it refuses an archive. */}
            <Badge tone={settings.modsLenient ? "info" : "warn"}>
              {settings.modsLenient
                ? t("settings.modsModeLenient")
                : t("settings.modsModeStrict")}
            </Badge>
          </div>
          <div className={page.fields}>
            <SwitchField
              label={t("settings.modsLenient")}
              hint={t("settings.modsLenientHint")}
              checked={settings.modsLenient}
              disabled={saving}
              onChange={(checked) => void updateSettings({ modsLenient: checked })}
            />
            <ModsMaxMbField />
          </div>
          <p className="sectionHint">{t("settings.modsScopeNote")}</p>
        </section>

        {/* ----------------------------------------------------- covers --- */}
        <section className={page.panel}>
          <div className={page.panelText}>
            <h2 className="sectionTitle">{t("settings.coversTitle")}</h2>
            <p className="sectionHint">{t("settings.coversDescription")}</p>
          </div>
          <div className={page.fields}>
            <SwitchField
              label={t("settings.autoCovers")}
              hint={t("settings.autoCoversHint")}
              checked={settings.autoCovers}
              disabled={saving}
              onChange={(checked) => void updateSettings({ autoCovers: checked })}
            />
          </div>
        </section>

        {/* ----------------------------------------------- console mode --- */}
        <section className={page.panel}>
          <div className={page.panelHead}>
            <div className={page.panelText}>
              <h2 className="sectionTitle">{t("settings.bigPictureTitle")}</h2>
              <p className="sectionHint">{t("settings.bigPictureDescription")}</p>
            </div>
            <Segmented
              label={t("settings.bigPictureLayout")}
              value={layout}
              options={layoutOptions}
              onChange={(next) => void updateSettings({ bigPictureLayout: next })}
            />
          </div>

          {/* The letters, drawn where the choice is made: picking a family from
              a list of three words is guesswork without seeing them. */}
          <div className={page.preview}>
            <span className={page.factKey}>{t("settings.glyphPreview")}</span>
            <GlyphRow theme={theme} buttons={GLYPH_PREVIEW} />
          </div>

          <div className={page.panelText}>
            <p className="sectionHint">{t("settings.bigPictureLayoutHint")}</p>
            {glyphNote !== null ? (
              <span className={page.hint}>{glyphNote}</span>
            ) : null}
          </div>
        </section>

        {/* ------------------------------------------------- setup tour --- */}
        <section className={page.panel}>
          <div className={page.panelHead}>
            <div className={page.panelText}>
              <h2 className="sectionTitle">{t("settings.onboardingTitle")}</h2>
              <p className="sectionHint">{t("settings.onboardingDescription")}</p>
            </div>
            <div className={page.panelActions}>
              <Button icon={RotateCcw} onClick={requestRerun}>
                {t("settings.onboardingRun")}
              </Button>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- storage --- */}
        <section className={page.panel}>
          <div className={page.panelText}>
            <h2 className="sectionTitle">{t("settings.storageTitle")}</h2>
            <p className="sectionHint">{t("settings.storageDescription")}</p>
          </div>
          <div className={page.facts}>
            <span className={page.factKey}>{t("settings.configPath")}</span>
            <span className={`${page.factValue} mono`}>{STORAGE_PATHS.config}</span>
            <span className={page.factKey}>{t("settings.dataPath")}</span>
            <span className={`${page.factValue} mono`}>{STORAGE_PATHS.data}</span>
          </div>
          <p className="sectionHint">{t("settings.storageNote")}</p>
        </section>

        {/* ------------------------------------------------------ about --- */}
        <section className={page.panel}>
          <div className={page.panelText}>
            <h2 className="sectionTitle">{t("settings.aboutTitle")}</h2>
            <p className="sectionHint">{t("settings.description")}</p>
          </div>
          <div className={page.facts}>
            <span className={page.factKey}>{t("settings.version")}</span>
            <span className={`${page.factValue} tabular`}>{__APP_VERSION__}</span>
            <span className={page.factKey}>{t("settings.license")}</span>
            <span className={page.factValue}>{t("settings.licenseName")}</span>
            <span className={page.factKey}>{t("settings.mode")}</span>
            <span className={page.factValue}>
              <Badge tone={isMock ? "warn" : "quiet"}>
                {isMock ? t("settings.modeMock") : t("settings.modeTauri")}
              </Badge>
            </span>
          </div>
          {isMock ? (
            <p className="sectionHint">{t("settings.modeMockHint")}</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
