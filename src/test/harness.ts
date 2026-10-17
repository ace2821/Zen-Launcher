import { initI18n, setLanguage } from "../i18n";
import { api, isMockApi } from "../lib/api";
import type { Language } from "../lib/types";
import { resetConfirm } from "../store/confirm";
import { useLibraryStore } from "../store/library";
import { useShellStore } from "../store/shell";
import { resetToasts } from "../store/toasts";

export const INITIAL_SHELL = {
  view: "library" as const,
  selectedGameId: null,
  search: "",
  sort: "title" as const,
  layout: "grid" as const,
};

/**
 * Puts the whole app back to a known state: a fresh in-memory adapter, an empty
 * store that has re-subscribed to it, and empty toast/confirm queues.
 *
 * Always call this *before* rendering — tests that share the module-level
 * `api` singleton would otherwise leak sessions, candidates and listeners into
 * each other.
 */
export async function setupMockApp(language: Language = "en"): Promise<void> {
  initI18n(language);
  await setLanguage(language);

  resetToasts();
  resetConfirm();

  if (isMockApi(api)) api.reset();
  useLibraryStore.getState().reset();
  useShellStore.setState({ ...INITIAL_SHELL });

  await useLibraryStore.getState().init();
}

/** For tests that render before bootstrapping the store. */
export function resetStores(): void {
  resetToasts();
  resetConfirm();
  if (isMockApi(api)) api.reset();
  useLibraryStore.getState().reset();
  useShellStore.setState({ ...INITIAL_SHELL });
}
