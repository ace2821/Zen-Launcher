import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  Download,
  Layout,
  Package,
  Play,
} from "lucide-react";
import { api } from "../../lib/api";
import { useMarketplaceStore } from "../../store/marketplace";
import type { MarketplaceItem } from "../../lib/types";
import type { BadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Modal } from "../ui/Modal";
import { EmptyState } from "../ui/Feedback";
import styles from "./marketplace.module.css";

type Tab = "theme" | "addon";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
}

function toneFor(type: "theme" | "addon"): BadgeTone {
  return type === "theme" ? "accent" : "info";
}

function typeLabel(t: { t: (key: string) => string }, type: "theme" | "addon") {
  return type === "theme"
    ? t.t("marketplace.tabThemes")
    : t.t("marketplace.tabAddons");
}

export function MarketplacePanel() {
  const { t } = useTranslation();
  const items = useMarketplaceStore((s) => s.items);
  const stale = useMarketplaceStore((s) => s.stale);
  const installing = useMarketplaceStore((s) => s.installing);
  const activeThemeId = useMarketplaceStore((s) => s.activeThemeId);
  const isInstalled = useMarketplaceStore((s) => s.isInstalled);
  const fetchItems = useMarketplaceStore((s) => s.fetchItems);
  const installItem = useMarketplaceStore((s) => s.installItem);
  const setActiveTheme = useMarketplaceStore((s) => s.setActiveTheme);
  const setInstalling = useMarketplaceStore((s) => s.setInstalling);

  const [tab, setTab] = useState<Tab>("theme");
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MarketplaceItem | null>(null);

  /*
   * Deep link: `zinclaucher://install?id=<itemId>` → the core emits
   * `marketplace://install-started`. We mirror the install request so the
   * spinner shows on the card and the install actually runs.
   */
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await api.on("marketplace://install-started", ({ itemId }) => {
        setInstalling(itemId);
        void installItem(itemId);
      });
    })();
    return () => {
      unlisten?.();
    };
  }, [api, setInstalling, installItem]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const filtered = items.filter((item) => item.type === tab);

  const handleInstall = useCallback(
    (item: MarketplaceItem) => {
      if (installing === item.id || isInstalled(item.id)) return;
      void installItem(item.id);
    },
    [installing, isInstalled, installItem],
  );

  const handleSetActive = useCallback(
    async (item: MarketplaceItem) => {
      if (item.type !== "theme") return;
      if (activeThemeId === item.id) return;
      await setActiveTheme(item.id);
      setDetailOpen(false);
    },
    [activeThemeId, setActiveTheme],
  );

  const handleOpenDetail = (item: MarketplaceItem) => {
    setSelectedItem(item);
    setDetailOpen(true);
  };

  const isActiveTheme = (item: MarketplaceItem) =>
    item.type === "theme" && activeThemeId === item.id;

  const externalUrl = (item: MarketplaceItem): string | null => {
    try {
      const url = new URL(item.installUrl);
      return url.protocol === "http:" || url.protocol === "https:"
        ? item.installUrl
        : null;
    } catch {
      return null;
    }
  };

  return (
    <div className={styles.root}>
      {stale ? (
        <div className={styles.banner}>
          <span className={styles.bannerIcon}>
            <AlertTriangle size={14} aria-hidden />
          </span>
          {t("marketplace.stale")}
        </div>
      ) : null}

      <div className={styles.tabs}>
        <button
          type="button"
          role="tab"
          aria-pressed={tab === "theme"}
          onClick={() => setTab("theme")}
          className={[
            styles.tab,
            tab === "theme" ? styles.tabActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {t("marketplace.tabThemes")}
        </button>
        <button
          type="button"
          role="tab"
          aria-pressed={tab === "addon"}
          onClick={() => setTab("addon")}
          className={[
            styles.tab,
            tab === "addon" ? styles.tabActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {t("marketplace.tabAddons")}
        </button>
      </div>

      <ul className={styles.list}>
        {filtered.length === 0 ? (
          <li>
            <EmptyState
              icon={Package}
              title={t("marketplace.noItems")}
              body={t("marketplace.noItemsBody")}
            />
          </li>
        ) : (
          filtered.map((item) => {
            const busy = installing === item.id;
            const active = isActiveTheme(item);
            const installed = isInstalled(item.id);
            const url = externalUrl(item);
            const itemTone = toneFor(item.type);
            const itemTypeLabel = typeLabel({ t }, item.type);

            return (
              <li
                key={item.id}
                className={styles.card}
                onClick={() => handleOpenDetail(item)}
              >
                <div
                  className={[
                    styles.cardPreview,
                    busy ? styles.cardBusyVisible : styles.cardBusyHidden,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {busy ? (
                    <div className={styles.cardBusy}>
                      <Package size={18} className={styles.spinner} />
                    </div>
                  ) : null}
                  {item.previewUrl ? (
                    <img
                      className={styles.cardPreviewImage}
                      src={item.previewUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className={styles.cardPreviewFallback}>
                      <span className={styles.cardPreviewFallbackIcon}>
                        <Layout size={32} aria-hidden />
                      </span>
                      <span>{initials(item.name)}</span>
                    </div>
                  )}
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.cardMeta}>
                    <Badge tone={itemTone}>
                      {itemTypeLabel}
                    </Badge>
                    <Badge tone="quiet">
                      {t("marketplace.version")}: {item.version}
                    </Badge>
                  </div>
                  <h3 className={styles.cardName}>{item.name}</h3>
                  <p className={styles.cardDesc}>{item.description}</p>

                  <div className={styles.cardActions}>
                    {!installed ? (
                      <Button
                        variant="primary"
                        icon={Download}
                        loading={busy}
                        disabled={busy}
                        onClick={() => handleInstall(item)}
                      >
                        {t("marketplace.install")}
                      </Button>
                    ) : active ? (
                      <Button variant="ghost" icon={Check} disabled>
                        {t("marketplace.active")}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        icon={Play}
                        onClick={() => handleSetActive(item)}
                      >
                        {t("marketplace.setActive")}
                      </Button>
                    )}

                    {url && !installed ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.downloadLink}
                      >
                        <Button variant="ghost" icon={Download} size="sm">
                          {t("common.retry")}
                        </Button>
                      </a>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>

      <Modal
        open={detailOpen}
        title={selectedItem ? selectedItem.name : t("marketplace.details")}
        onClose={() => setDetailOpen(false)}
        closeLabel={t("common.close")}
        size="md"
      >
        {selectedItem ? (
          <div className={styles.detail}>
            <div className={styles.detailPreview}>
              {selectedItem.previewUrl ? (
                <img
                  className={styles.detailPreviewImage}
                  src={selectedItem.previewUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className={styles.cardPreviewFallback}>
                  <span className={styles.cardPreviewFallbackIcon}>
                    <Layout size={32} aria-hidden />
                  </span>
                  <span>{initials(selectedItem.name)}</span>
                </div>
              )}
            </div>

            <div className={styles.detailHead}>
              <h2 className={styles.detailName}>{selectedItem.name}</h2>
              <div className={styles.detailMeta}>
                <span className={styles.detailMetaItem}>
                  <span>{t("marketplace.author")}:</span>{" "}
                  {selectedItem.author}
                </span>
                <span className={styles.detailMetaItem}>
                  <span>{t("marketplace.version")}:</span>{" "}
                  {selectedItem.version}
                </span>
                <span className={styles.detailMetaItem}>
                  <span>{t("marketplace.minLauncherVersion")}:</span>{" "}
                  {selectedItem.minLauncherVersion}
                </span>
                <span className={styles.detailMetaItem}>
                  <Badge tone={toneFor(selectedItem.type)}>
                    {typeLabel({ t }, selectedItem.type)}
                  </Badge>
                </span>
              </div>
            </div>

            <p className={styles.detailDesc}>{selectedItem.description}</p>

            <div className={styles.detailDivided}>
              <div className={styles.detailSection}>
                <span className={styles.detailSectionTitle}>
                  {t("marketplace.description")}
                </span>
                <span className={styles.detailSectionTitle}>SHA-256:</span>
                <span className={styles.detailMetaItem}>
                  {selectedItem.sha256}
                </span>
              </div>

              {selectedItem.games && selectedItem.games.length > 0 ? (
                <div className={styles.detailSection}>
                  <span className={styles.detailSectionTitle}>
                    {t("details.factsTitle")}
                  </span>
                  <div className={styles.detailGames}>
                    {selectedItem.games.map((gameId) => (
                      <span key={gameId} className={styles.detailGamesItem}>
                        #{gameId}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className={styles.detailActions}>
              {(!isInstalled(selectedItem.id) ||
                !isActiveTheme(selectedItem)) && (
                <>
                  {!isInstalled(selectedItem.id) ? (
                    <Button
                      variant="primary"
                      icon={Download}
                      loading={installing === selectedItem.id}
                      disabled={installing === selectedItem.id}
                      onClick={() => handleInstall(selectedItem)}
                    >
                      {t("marketplace.install")}
                    </Button>
                  ) : (
                    <Button variant="ghost" icon={Check} disabled>
                      {t("marketplace.installed")}
                    </Button>
                  )}

                  {selectedItem.type === "theme" && !isActiveTheme(selectedItem) ? (
                    <Button
                      variant="secondary"
                      icon={Play}
                      onClick={() => handleSetActive(selectedItem)}
                    >
                      {t("marketplace.setActive")}
                    </Button>
                  ) : null}
                </>
              )}

              {externalUrl(selectedItem) ? (
                <a
                  href={externalUrl(selectedItem) as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.downloadLink}
                >
                  <Button variant="ghost" icon={Download} size="sm">
                    {t("common.retry")}
                  </Button>
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

MarketplacePanel.displayName = "MarketplacePanel";
