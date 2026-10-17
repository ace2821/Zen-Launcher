import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../../App";
import { api } from "../../lib/api";
import { DEFAULT_SETTINGS } from "../../lib/mock/data";
import { useLibraryStore } from "../../store/library";
import { shouldShowOnboarding, useOnboardingStore } from "../../store/onboarding";
import { useShellStore } from "../../store/shell";
import { useToastStore } from "../../store/toasts";
import { setupMockApp } from "../../test/harness";
import { SettingsView } from "../../views/SettingsView";
import { OnboardingWizard } from "./OnboardingWizard";

/**
 * The first-run tour, driven through the real store and the real mock adapter: the
 * point of these tests is that a click lands in persisted settings (and nowhere
 * else), not that a component tree renders the right shape.
 *
 * `{ onboarding: false }` is what makes a run a first run — every other suite marks
 * the tour finished so it does not have to dismiss a takeover first.
 */
const firstRun = () => setupMockApp("en", { onboarding: false });

describe("OnboardingWizard", () => {
  it("stays out of the way once the tour has been finished", async () => {
    await setupMockApp();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Library" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("takes over the window on a first run", async () => {
    await firstRun();
    render(<App />);

    const dialog = await screen.findByRole("dialog");
    // A takeover, not a dismissible dialog: no Escape, no backdrop click. Skipping
    // is a decision the user has to make on purpose.
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      within(dialog).getByRole("heading", { name: "Choose your language" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Step 1 of 5")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Language$/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(within(dialog).getByRole("button", { name: "Skip" })).toBeInTheDocument();

    // The library is already there behind the overlay — the tour edits the app, it
    // does not replace it.
    expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
  });

  it("switches the interface language the moment it is chosen", async () => {
    await firstRun();
    const user = userEvent.setup();
    const update = vi.spyOn(api, "updateSettings");
    render(<OnboardingWizard />);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Polski" }));

    await waitFor(() => {
      expect(useLibraryStore.getState().settings?.language).toBe("pl");
    });
    // The tour itself is already Polish: nothing waits for a reload to prove it.
    expect(
      await within(dialog).findByRole("heading", { name: "Wybierz język" }),
    ).toBeInTheDocument();
    expect(update).toHaveBeenCalledWith({ language: "pl" });
  });

  it("writes every choice as it is made, then commits the whole set on finish", async () => {
    await firstRun();
    const user = userEvent.setup();
    const update = vi.spyOn(api, "updateSettings");
    render(<OnboardingWizard />);

    const dialog = await screen.findByRole("dialog");
    const next = () => within(dialog).getByRole("button", { name: "Next" });

    // ---------------------------------------------------------------- appearance
    await user.click(next());
    await user.click(await within(dialog).findByRole("radio", { name: /^System/ }));
    await waitFor(() => {
      expect(useLibraryStore.getState().settings?.font).toBe("system");
    });

    await user.click(within(dialog).getByRole("radio", { name: "Plum" }));
    await waitFor(() => {
      expect(useLibraryStore.getState().settings?.accent).toBe("plum");
    });

    // ------------------------------------------------------------------- library
    await user.click(next());
    await user.click(await within(dialog).findByRole("radio", { name: /^List/ }));
    // The landing view is shell state, not a setting: it has its own setter and is
    // already persisted by the store that owns it.
    expect(useShellStore.getState().layout).toBe("list");

    // -------------------------------------------------------------------- window
    await user.click(next());
    await user.click(await within(dialog).findByRole("switch", { name: /tray on close/i }));
    await user.click(within(dialog).getByRole("switch", { name: /hide the window/i }));
    await waitFor(() => {
      expect(useLibraryStore.getState().settings).toMatchObject({
        closeToTray: false,
        hideOnLaunch: false,
      });
    });

    // -------------------------------------------------------------------- finish
    await user.click(next());
    await within(dialog).findByText("Ready when you are");
    // The last step shows what was actually collected, before it is committed.
    expect(within(dialog).getByText("System")).toBeInTheDocument();
    expect(within(dialog).getByText("Plum")).toBeInTheDocument();
    expect(within(dialog).getByText("List")).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Start using Zen Launcher" }),
    );

    await waitFor(() => {
      expect(useLibraryStore.getState().settings?.onboardingCompleted).toBe(true);
    });
    // One authoritative patch, carrying the flag in the same write as the choices.
    expect(update).toHaveBeenLastCalledWith({
      language: "en",
      font: "system",
      accent: "plum",
      closeToTray: false,
      hideOnLaunch: false,
      onboardingCompleted: true,
    });
    expect(useOnboardingStore.getState().requested).toBe(false);

    // Every earlier write touched exactly one field, and none of them finished the
    // tour early — a half-configured install must not be able to record itself as
    // done.
    const patches = update.mock.calls.map(([patch]) => patch);
    expect(patches).toContainEqual({ font: "system" });
    expect(patches).toContainEqual({ accent: "plum" });
    expect(patches).toContainEqual({ closeToTray: false });
    expect(patches).toContainEqual({ hideOnLaunch: false });
    expect(patches.filter((patch) => patch.onboardingCompleted !== undefined)).toHaveLength(1);

    // The tour saves silently: a stack of "Settings saved" toasts behind a takeover
    // would be noise.
    expect(useToastStore.getState().toasts).toHaveLength(0);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the choices but only sets the flag when skipped", async () => {
    await firstRun();
    const user = userEvent.setup();
    const update = vi.spyOn(api, "updateSettings");
    render(<OnboardingWizard />);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Appearance$/ }));
    await user.click(await within(dialog).findByRole("radio", { name: "Ember" }));
    await waitFor(() => {
      expect(useLibraryStore.getState().settings?.accent).toBe("ember");
    });

    await user.click(within(dialog).getByRole("button", { name: "Skip" }));

    await waitFor(() => {
      expect(useLibraryStore.getState().settings?.onboardingCompleted).toBe(true);
    });
    // Skip means "I will decide later": it stops the tour from reappearing and
    // changes nothing else.
    expect(update).toHaveBeenLastCalledWith({ onboardingCompleted: true });
    expect(useLibraryStore.getState().settings).toMatchObject({
      language: "en",
      font: "maple-mono",
      accent: "ember",
      closeToTray: true,
      hideOnLaunch: true,
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("does not close on Escape", async () => {
    await firstRun();
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(useLibraryStore.getState().settings?.onboardingCompleted).toBe(false);
  });

  it("moves within the accent swatches with the arrow keys", async () => {
    await firstRun();
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Appearance$/ }));

    const jade = await within(dialog).findByRole("radio", { name: "Jade" });
    expect(jade).toHaveAttribute("aria-checked", "true");
    jade.focus();
    await user.keyboard("{ArrowRight}");

    await waitFor(() => {
      expect(useLibraryStore.getState().settings?.accent).toBe("plum");
    });
    expect(within(dialog).getByRole("radio", { name: "Plum" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // The choice reached the frame, not just the store.
    expect(document.documentElement.dataset.accent).toBe("plum");
  });

  it("comes back prefilled when Settings asks for the tour again", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    // Someone who has been here before: their stored look is not the default.
    await useLibraryStore
      .getState()
      .updateSettings({ font: "instrument-sans", accent: "ember" });
    useShellStore.getState().setLayout("list");

    render(
      <>
        <SettingsView />
        <OnboardingWizard />
      </>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run the setup tour again" }));
    expect(useOnboardingStore.getState().requested).toBe(true);

    const dialog = await screen.findByRole("dialog");
    // It opens at the beginning again...
    expect(within(dialog).getByText("Step 1 of 5")).toBeInTheDocument();

    // ...and it is an editor of the stored values, not a blank form.
    await user.click(within(dialog).getByRole("button", { name: /Appearance$/ }));
    expect(
      await within(dialog).findByRole("radio", { name: /^Instrument Sans/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("radio", { name: "Ember" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(within(dialog).getByRole("button", { name: /Library$/ }));
    expect(await within(dialog).findByRole("radio", { name: /^List/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(within(dialog).getByRole("button", { name: "Skip" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    // Done until asked for again.
    expect(useOnboardingStore.getState().requested).toBe(false);
  });
});

describe("shouldShowOnboarding", () => {
  it("shows nothing until the core has answered", () => {
    // Settings still loading means "we do not know yet" — flashing the tour at
    // someone who finished it months ago is worse than a beat of empty screen.
    expect(shouldShowOnboarding(null, false)).toBe(false);
    expect(shouldShowOnboarding(null, true)).toBe(false);
  });

  it("shows on a first run, or when Settings asks for it again", () => {
    const firstRunSettings = { ...DEFAULT_SETTINGS, onboardingCompleted: false };
    const done = { ...DEFAULT_SETTINGS, onboardingCompleted: true };

    expect(shouldShowOnboarding(firstRunSettings, false)).toBe(true);
    expect(shouldShowOnboarding(done, true)).toBe(true);
    expect(shouldShowOnboarding(done, false)).toBe(false);
  });
});
