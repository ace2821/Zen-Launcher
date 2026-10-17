import { create } from "zustand";
import type { Settings } from "../lib/types";

/**
 * Small piece of shell state the wizard needs: Settings can ask for the tour
 * again, but "already seen" is a persisted `Settings` value, not UI state. So
 * the flag lives here and the rule that combines both lives in one predicate
 * below — no second copy of `onboardingCompleted` anywhere.
 */
interface OnboardingState {
  /** Set by Settings → "Run the tour again". */
  requested: boolean;
  requestRerun(): void;
  /** Cleared once the wizard commits (finish) or is skipped again. */
  endRerun(): void;
}

export const useOnboardingStore = create<OnboardingState>()((set) => ({
  requested: false,
  requestRerun: () => set({ requested: true }),
  endRerun: () => set({ requested: false }),
}));

/**
 * Should the takeover be on screen?
 *
 * `settings === null` means the core has not answered yet, and until it does we
 * do not know whether this is a first run — so we show nothing rather than
 * flashing a wizard at someone who finished it months ago.
 */
export function shouldShowOnboarding(
  settings: Settings | null,
  requested: boolean,
): boolean {
  if (settings === null) return false;
  return requested || !settings.onboardingCompleted;
}
