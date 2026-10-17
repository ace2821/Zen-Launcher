import { describe, expect, it } from "vitest";
import {
  ACCENT_IDS,
  DEFAULT_ACCENT,
  DEFAULT_FONT,
  FONT_IDS,
  applyAppearance,
  normalizeAccent,
  normalizeFont,
} from "./appearance";

/**
 * Behaviour of the appearance ids. The pairing between these ids and the
 * stylesheets they select is checked in `appearance.styles.test.ts`, which reads
 * the CSS files — and therefore runs in the Node environment.
 */
describe("appearance ids", () => {
  it("normalises anything it does not know to the shipped default", () => {
    expect(normalizeFont("instrument-sans")).toBe("instrument-sans");
    expect(normalizeFont("system")).toBe("system");
    // A stored id from a build this one does not know, a blank value, or nothing
    // at all: the UI must still render, so it degrades instead of breaking.
    for (const value of ["comic-neue", "", "   ", "MAPLE-MONO", null, undefined]) {
      expect(normalizeFont(value)).toBe(DEFAULT_FONT);
    }

    expect(normalizeAccent("ember")).toBe("ember");
    for (const value of ["chartreuse", "", null, undefined]) {
      expect(normalizeAccent(value)).toBe(DEFAULT_ACCENT);
    }
  });

  it("lists the defaults and no duplicates", () => {
    expect(FONT_IDS).toContain(DEFAULT_FONT);
    expect(ACCENT_IDS).toContain(DEFAULT_ACCENT);
    expect(new Set(FONT_IDS).size).toBe(FONT_IDS.length);
    expect(new Set(ACCENT_IDS).size).toBe(ACCENT_IDS.length);
  });

  it("writes the choice onto <html>, normalised", () => {
    applyAppearance({ font: "system", accent: "rose" });
    expect(document.documentElement.dataset.font).toBe("system");
    expect(document.documentElement.dataset.accent).toBe("rose");

    applyAppearance({ font: "comic-neue", accent: "chartreuse" });
    expect(document.documentElement.dataset.font).toBe(DEFAULT_FONT);
    expect(document.documentElement.dataset.accent).toBe(DEFAULT_ACCENT);
  });
});
