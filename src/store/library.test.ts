import { describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { uiError } from "../lib/errors";
import type { Settings, SettingsPatch } from "../lib/types";
import { setupMockApp } from "../test/harness";
import { useLibraryStore } from "./library";
import { useToastStore } from "./toasts";

/**
 * Settings are the one place where the UI writes first and asks afterwards: a
 * switch that only moves once the core has answered feels broken, so the store
 * applies the patch optimistically, reconciles it with the core's answer, and
 * rolls the whole frame back if the core refuses.
 *
 * These tests go through the real store and the real mock adapter — the seam
 * being where the answer comes from, not the shape of the settings.
 */

const settings = (): Settings => {
  const value = useLibraryStore.getState().settings;
  if (value === null) throw new Error("Settings are not loaded");
  return value;
};

const toasts = () => useToastStore.getState().toasts;

describe("updateSettings", () => {
  it("applies the patch before the core answers, then defers to the core", async () => {
    await setupMockApp();
    let answer: (value: Settings) => void = () => {};
    const gated = new Promise<Settings>((resolve) => {
      answer = resolve;
    });
    const spy = vi.spyOn(api, "updateSettings").mockReturnValue(gated);

    const pending = useLibraryStore.getState().updateSettings({ modsLenient: false });
    await Promise.resolve();
    // On screen already: the switch does not wait for a round trip.
    expect(settings().modsLenient).toBe(false);

    // …but the core is still the authority, and what it returns is what sticks.
    answer({ ...settings(), modsLenient: false, modsMaxMb: 4096 });
    await pending;
    expect(settings().modsMaxMb).toBe(4096);

    expect(toasts().map((toast) => toast.title)).toContain("Settings saved");
    expect(useLibraryStore.getState().busy["settings:update"]).toBeUndefined();
    spy.mockRestore();
  });

  it("rolls the frame back when the core refuses the patch", async () => {
    await setupMockApp();
    const before = settings();
    let refuse: (error: unknown) => void = () => {};
    const gated = new Promise<Settings>((_resolve, reject) => {
      refuse = reject;
    });
    const spy = vi.spyOn(api, "updateSettings").mockReturnValue(gated);

    const pending = useLibraryStore.getState().updateSettings({ modsMaxMb: 9000 });
    await Promise.resolve();
    expect(settings().modsMaxMb).toBe(9000);

    refuse(uiError("VALIDATION", "modsMaxMb must be between 1 and 8192"));
    await pending;

    // Everything back where it was — not just the field that was refused.
    expect(settings()).toEqual(before);
    const [toast] = toasts();
    expect(toast.tone).toBe("error");
    expect(toast.title).toBe("Could not save the settings");
    expect(toast.code).toBe("VALIDATION");
    expect(toast.description).toBe("modsMaxMb must be between 1 and 8192");
    spy.mockRestore();
  });

  it("survives a refusal from the real adapter, code and all", async () => {
    await setupMockApp();
    const before = settings();

    // A value the UI has no control for can still reach the core — from a newer
    // build, or a hand-edited config. It is refused, and nothing moves.
    const exotic = { bigPictureLayout: "atari" } as unknown as SettingsPatch;
    await useLibraryStore.getState().updateSettings(exotic);

    expect(settings()).toEqual(before);
    expect(toasts()[0]?.code).toBe("VALIDATION");
  });

  it("never lets an undefined field erase a stored value", async () => {
    await setupMockApp();
    await useLibraryStore.getState().updateSettings({
      modsMaxMb: undefined,
      bigPictureLayout: undefined,
    });

    expect(settings().modsMaxMb).toBe(1024);
    expect(settings().bigPictureLayout).toBe("auto");
  });

  it("round-trips the whole set of session, mods, cover and console settings", async () => {
    await setupMockApp();

    await useLibraryStore.getState().updateSettings({
      useGameMode: false,
      useMangoHud: true,
      modsLenient: false,
      modsMaxMb: 2048,
      autoCovers: false,
      bigPictureLayout: "playstation",
    });

    expect(settings()).toMatchObject({
      useGameMode: false,
      useMangoHud: true,
      modsLenient: false,
      modsMaxMb: 2048,
      autoCovers: false,
      bigPictureLayout: "playstation",
    });
    // Nothing else moved with them.
    expect(settings().language).toBe("en");
    expect(settings().closeToTray).toBe(true);
  });

  it("stays quiet when the caller asks it to", async () => {
    await setupMockApp();
    const before = toasts().length;

    await useLibraryStore
      .getState()
      .updateSettings({ modsLenient: false }, { silent: true });

    expect(settings().modsLenient).toBe(false);
    expect(toasts()).toHaveLength(before);
  });
});
