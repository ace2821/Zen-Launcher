import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import page from "../components/page/page.module.css";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Segmented, SwitchField, type SegmentedOption } from "../components/ui/Field";
import { Skeleton } from "../components/ui/Feedback";
import { isMock } from "../lib/api";
import { STORAGE_PATHS } from "../lib/paths";
import type { Language } from "../lib/types";
import { useLibraryStore } from "../store/library";
import { useOnboardingStore } from "../store/onboarding";

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
 * Settings. Holds the persisted values that have a control here — language and
 * the two window-behaviour switches — plus read-only facts, and a way back into
 * the setup tour.
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
