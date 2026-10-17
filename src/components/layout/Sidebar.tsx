import { FolderInput, Library, Settings, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isMock } from "../../lib/api";
import { useLibraryStore } from "../../store/library";
import { useShellStore } from "../../store/shell";
import { Badge, CountBadge } from "../ui/Badge";
import styles from "./layout.module.css";
import { ZenMark } from "./ZenMark";

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: ReactNode;
  badgeLabel?: string;
  onClick(): void;
}

function NavItem({ icon: Icon, label, active, badge, badgeLabel, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={[styles.navItem, active ? styles.navItemActive : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon size={16} className={styles.navItemIcon} aria-hidden />
      <span className={styles.navItemLabel}>{label}</span>
      {badge ? (
        <span title={badgeLabel} aria-label={badgeLabel}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const view = useShellStore((state) => state.view);
  const goToLibrary = useShellStore((state) => state.goToLibrary);
  const goToImport = useShellStore((state) => state.goToImport);
  const goToSettings = useShellStore((state) => state.goToSettings);
  const pendingCount = useLibraryStore((state) =>
    state.candidates.reduce(
      (total, candidate) => (candidate.status === "pending" ? total + 1 : total),
      0,
    ),
  );

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <ZenMark className={styles.brandMark} />
        <span className={styles.brandText}>
          <span className={styles.brandName}>{t("app.name")}</span>
          <span className={styles.brandMeta}>{t("app.subtitle")}</span>
        </span>
      </div>

      <nav className={styles.nav} aria-label={t("app.name")}>
        <NavItem
          icon={Library}
          label={t("nav.library")}
          active={view === "library" || view === "game"}
          onClick={goToLibrary}
        />
        <NavItem
          icon={FolderInput}
          label={t("nav.sources")}
          active={view === "import"}
          badge={
            pendingCount > 0 ? <CountBadge>{pendingCount}</CountBadge> : undefined
          }
          badgeLabel={t("nav.pendingBadge")}
          onClick={goToImport}
        />
        <NavItem
          icon={Settings}
          label={t("nav.settings")}
          active={view === "settings"}
          onClick={goToSettings}
        />
      </nav>

      <div className={styles.sidebarFoot}>
        <div className={styles.sidebarFootRow}>
          <Badge tone={isMock ? "warn" : "quiet"}>
            {isMock ? t("settings.modeMock") : t("settings.modeTauri")}
          </Badge>
        </div>
        <div className={styles.sidebarFootRow}>
          <span className={styles.sidebarFootText}>
            {t("settings.version")} {__APP_VERSION__}
          </span>
        </div>
      </div>
    </aside>
  );
}
