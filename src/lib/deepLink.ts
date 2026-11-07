import { useEffect } from "react";
import { useShellStore } from "../store/shell";
import type { UnlistenFn } from "./types";
import { onNavigate } from "./api";

/**
 * Applies one deep-link navigation page name. Unknown pages are ignored so a
 * newer core can add routes without breaking an older UI.
 */
export function applyDeepLinkNavigation(page: string): void {
  if (page === "marketplace") {
    useShellStore.getState().goToMarketplace();
  }
}

/** Subscribes the UI to the core's `app://navigate` deep-link events once. */
export function useDeepLinkNavigation(): void {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    void onNavigate(({ page }) => {
      applyDeepLinkNavigation(page);
    }).then((fn) => {
      // The effect can unmount before `listen` resolves; tear down immediately.
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
