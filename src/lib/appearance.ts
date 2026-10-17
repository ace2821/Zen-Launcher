import type { Settings } from "./types";

/**
 * Appearance is derived, never stored twice: `Settings.font` / `Settings.accent`
 * are the source of truth, and this module is the only thing that turns them
 * into DOM (`html[data-font]` / `html[data-accent]`, consumed by tokens.css and
 * fonts.css).
 *
 * Both values arrive as free-form strings from the core, so every read goes
 * through a normaliser: an id this build does not know falls back to the
 * shipped default instead of leaving the UI half-styled.
 *
 * No font stack or accent colour is written down here on purpose — the same
 * `data-*` attributes work on any element, so a component that needs to preview
 * a face or an accent it does not currently use just sets the attribute and lets
 * tokens.css resolve `--font-ui` / `--accent` locally.
 */

export const FONT_IDS = ["maple-mono", "instrument-sans", "system"] as const;
export type FontId = (typeof FONT_IDS)[number];
export const DEFAULT_FONT: FontId = "maple-mono";

export const ACCENT_IDS = [
  "jade",
  "plum",
  "azure",
  "ember",
  "rose",
  "neutral",
] as const;
export type AccentId = (typeof ACCENT_IDS)[number];
export const DEFAULT_ACCENT: AccentId = "jade";

function isFontId(value: string): value is FontId {
  return (FONT_IDS as readonly string[]).includes(value);
}

function isAccentId(value: string): value is AccentId {
  return (ACCENT_IDS as readonly string[]).includes(value);
}

/** Unknown or empty → `maple-mono`. */
export function normalizeFont(value: string | null | undefined): FontId {
  return value != null && isFontId(value) ? value : DEFAULT_FONT;
}

/** Unknown or empty → `jade`. */
export function normalizeAccent(value: string | null | undefined): AccentId {
  return value != null && isAccentId(value) ? value : DEFAULT_ACCENT;
}

/**
 * Writes the appearance onto `<html>`.
 *
 * Called at boot (the moment the core answers `get_settings`) and after every
 * `update_settings`, from `store/library.ts` — there is no component that could
 * forget to call it, and no second copy of the state to keep in sync.
 *
 * Until then the CSS defaults already are Maple Mono + jade, so the pre-load
 * frame is correct rather than a flash of something else.
 */
export function applyAppearance(
  settings: Pick<Settings, "font" | "accent">,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.font = normalizeFont(settings.font);
  root.dataset.accent = normalizeAccent(settings.accent);
}
