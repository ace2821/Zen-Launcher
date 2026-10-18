import { initI18n, setLanguage } from "../i18n";
import { api, isMockApi } from "../lib/api";
import type { MockApi } from "../lib/mock";
import type { Language } from "../lib/types";
import { resetConfirm } from "../store/confirm";
import { useLibraryStore } from "../store/library";
import { useOnboardingStore } from "../store/onboarding";
import { useShellStore } from "../store/shell";
import { resetToasts } from "../store/toasts";

export const INITIAL_SHELL = {
  view: "library" as const,
  selectedGameId: null,
  search: "",
  sort: "title" as const,
  layout: "grid" as const,
};

export interface SetupOptions {
  /**
   * Whether the setup tour counts as already finished. Default `true`, because
   * every other suite is about a screen *behind* the tour and should not have to
   * dismiss a takeover overlay first. The tour's own suite passes `false` to
   * reproduce a first run.
   */
  onboarding?: boolean;
}

/**
 * Puts the whole app back to a known state: a fresh in-memory adapter, an empty
 * store that has re-subscribed to it, and empty toast/confirm queues.
 *
 * Always call this *before* rendering — tests that share the module-level
 * `api` singleton would otherwise leak sessions, candidates and listeners into
 * each other.
 */
export async function setupMockApp(
  language: Language = "en",
  options: SetupOptions = {},
): Promise<void> {
  initI18n(language);
  await setLanguage(language);

  resetToasts();
  resetConfirm();

  if (isMockApi(api)) api.reset();
  useLibraryStore.getState().reset();
  useShellStore.setState({ ...INITIAL_SHELL });
  useOnboardingStore.setState({ requested: false });

  if (options.onboarding !== false) {
    // The seed is a first run (`onboardingCompleted: false`); a suite that is not
    // about the tour marks it finished the same way the app would.
    await api.updateSettings({ onboardingCompleted: true });
  }

  await useLibraryStore.getState().init();
}

/** For tests that render before bootstrapping the store. */
export function resetStores(): void {
  resetToasts();
  resetConfirm();
  if (isMockApi(api)) api.reset();
  useLibraryStore.getState().reset();
  useShellStore.setState({ ...INITIAL_SHELL });
  useOnboardingStore.setState({ requested: false });
}

/**
 * The adapter's harness-only observables (`downloadedCoverUrls`, `trashFails`
 * effects, …). They exist to make "what did the UI actually ask for?" assertable,
 * and they are deliberately *not* part of `LauncherApi` — nothing in `src/`
 * outside tests may depend on them.
 */
export function mockApi(): MockApi {
  if (!isMockApi(api)) {
    throw new Error("This suite needs the mock adapter, not the Tauri bridge.");
  }
  return api;
}
