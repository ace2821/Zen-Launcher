import { create } from "zustand";
import { api } from "../lib/api";
import { toUiError } from "../lib/errors";
import { translate } from "../i18n";
import { toastError, toastInfo, toastSuccess } from "./toasts";
import type { MarketplaceItem } from "../lib/types";

/** id of the `<style>` element that holds the active theme's CSS. */
const ACTIVE_THEME_STYLE_ID = "zen-active-theme";

/** Injects a theme's CSS into `<head>`, replacing any previously active theme. */
export function injectThemeCss(css: string): void {
  if (typeof document === "undefined") return;
  const previous = document.getElementById(ACTIVE_THEME_STYLE_ID);
  if (previous) previous.remove();
  const style = document.createElement("style");
  style.id = ACTIVE_THEME_STYLE_ID;
  style.textContent = css;
  document.head.insertBefore(style, document.head.firstChild);
}

/** Removes the active theme's `<style>` from `<head>`. */
export function removeThemeCss(): void {
  if (typeof document === "undefined") return;
  const previous = document.getElementById(ACTIVE_THEME_STYLE_ID);
  if (previous) previous.remove();
}

interface MarketplaceState {
  items: MarketplaceItem[];
  stale: boolean;
  loading: boolean;
  installing: number | null;
  uninstalling: number | null;
  activeThemeId: number | null;
  setActiveThemeBusy: boolean;
  /** Item ids the mock/core reports as installed. */
  installedItemIds: Set<number>;

  fetchItems(): Promise<void>;
  installItem(itemId: number): Promise<void>;
  uninstallItem(itemId: number): Promise<void>;
  setActiveTheme(id: number | null): Promise<void>;
  setInstalling(itemId: number | null): void;
  isInstalled(itemId: number): boolean;
  /** Call once at boot: if a theme was previously active, inject its CSS. */
  bootstrapActiveTheme(): void;
  reset(): void;
}

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  items: [],
  stale: false,
  loading: false,
  installing: null,
  uninstalling: null,
  activeThemeId: null,
  setActiveThemeBusy: false,
  installedItemIds: new Set(),

  async fetchItems() {
    set({ loading: true });
    try {
      const { items, stale } = await api.marketplace_list();
      set({ items, stale, loading: false });
    } catch (error) {
      set({ loading: false });
      toastError(
        translate("marketplace.installFailed", { name: "" }),
        toUiError(error),
      );
    }
  },

  async installItem(itemId) {
    const item = get().items.find((entry) => entry.id === itemId);
    if (!item) return;
    set({ installing: itemId });
    try {
      const result = await api.marketplace_install(itemId);
      get().installedItemIds.add(itemId);
      toastSuccess(
        translate("marketplace.themeSet", { name: result.name }),
        translate("marketplace.themeSetBody", { name: result.name }),
      );
      void get().fetchItems();
    } catch (error) {
      toastError(
        translate("marketplace.installFailed", { name: item.name }),
        toUiError(error),
      );
    } finally {
      set({ installing: null });
    }
  },

  async uninstallItem(itemId) {
    const item = get().items.find((entry) => entry.id === itemId);
    if (!item) return;
    set({ uninstalling: itemId });
    try {
      await api.marketplace_uninstall(itemId);
      get().installedItemIds.delete(itemId);
      if (get().activeThemeId === itemId) {
        get().activeThemeId = null;
        removeThemeCss();
      }
      toastSuccess(
        translate("marketplace.themeReset"),
        translate("marketplace.themeResetBody"),
      );
      void get().fetchItems();
    } catch (error) {
      toastError(
        translate("marketplace.uninstallFailed", { name: item.name }),
        toUiError(error),
      );
    } finally {
      set({ uninstalling: null });
    }
  },

  setInstalling(itemId) {
    set({ installing: itemId });
  },

  isInstalled(itemId) {
    return get().installedItemIds.has(itemId);
  },

  async setActiveTheme(id) {
    const item =
      id === null ? null : get().items.find((entry) => entry.id === id);
    if (id !== null && (!item || item.type !== "theme")) {
      toastError(translate("marketplace.themeOnly"));
      return;
    }
    set({ setActiveThemeBusy: true });
    try {
      await api.marketplace_set_active_theme(id);
      set({ activeThemeId: id });
      if (id === null) {
        removeThemeCss();
        toastInfo(
          translate("marketplace.themeReset"),
          translate("marketplace.themeResetBody"),
        );
      } else if (item) {
        // Fetch the theme's CSS and inject it. The installUrl may be a data: URL.
        let css = "";
        try {
          const response = await fetch(item.installUrl);
          css = await response.text();
        } catch {
          css = "";
        }
        if (css.length > 0) {
          injectThemeCss(css);
          toastSuccess(
            translate("marketplace.themeSet", { name: item.name }),
            translate("marketplace.themeSetBody", { name: item.name }),
          );
        } else {
          toastError(translate("marketplace.setThemeFailed"));
        }
      }
    } catch (error) {
      toastError(translate("marketplace.setThemeFailed"), toUiError(error));
    } finally {
      set({ setActiveThemeBusy: false });
    }
  },

  bootstrapActiveTheme() {
    const { activeThemeId, items } = get();
    if (activeThemeId === null) return;
    const item = items.find((entry) => entry.id === activeThemeId);
    if (item?.type === "theme" && item.installUrl) {
      void fetch(item.installUrl)
        .then((response) => response.text())
        .then((css) => {
          if (css.length > 0) injectThemeCss(css);
        })
        .catch(() => {
          // Silent on bootstrap: the user can re-activate from the panel.
        });
    }
  },

  reset() {
    set({
      items: [],
      stale: false,
      loading: false,
      installing: null,
      uninstalling: null,
      activeThemeId: null,
      setActiveThemeBusy: false,
      installedItemIds: new Set(),
    });
    removeThemeCss();
  },
}));