import { FACE_GLYPHS, type GlyphTheme } from "../../lib/gamepad";
import type { PromptButton } from "../../lib/types";
import styles from "./bigpicture.module.css";

/**
 * Face-button prompts.
 *
 * The letters are *not* written here: `FACE_GLYPHS` (lib/gamepad.ts) already maps
 * a theme to its four glyphs, and that mapping is what the input layer's intents
 * are reasoned about with. A second table would be one more thing to keep in
 * step. Colours, on the other hand, are pure presentation and live in the
 * stylesheet, keyed off the `data-theme` / `data-button` attributes below.
 */

/**
 * Start is the same hamburger on both families — neither vendor prints anything
 * else on it, so it does not belong in the themed table.
 */
const START_GLYPH = "≡";

/** The shoulder triggers don't have a vendor letter, so they wear a short label
   that reads the same on either glyph family. */
const SHOULDER_GLYPH: Record<"leftTrigger" | "rightTrigger", string> = {
  leftTrigger: "L1",
  rightTrigger: "R1",
};

/** The character shown on a prompt button. */
export function glyphFor(theme: GlyphTheme, button: PromptButton): string {
  if (button === "start") return START_GLYPH;
  if (button === "leftTrigger" || button === "rightTrigger")
    return SHOULDER_GLYPH[button];
  return FACE_GLYPHS[theme][button];
}

export interface GlyphProps {
  theme: GlyphTheme;
  button: PromptButton;
  /** Diameter of the disc, in pixels. */
  size?: number;
}

/**
 * One painted button as it appears on a controller.
 *
 * `aria-hidden` on purpose: a glyph is a picture of a key, and the label beside
 * it is what a screen reader should read — printing "A" into the accessibility
 * tree would only add noise to "A Details".
 */
export function Glyph({ theme, button, size = 22 }: GlyphProps) {
  return (
    <span
      className={styles.glyph}
      data-theme={theme}
      data-button={button}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.52) }}
      aria-hidden
    >
      {glyphFor(theme, button)}
    </span>
  );
}

/**
 * A keyboard key, drawn as a keycap rather than as a gamepad button: the two
 * hints sit side by side at the bottom of Big Picture, and they have to be
 * told apart at a glance.
 */
export function Keycap({ children }: { children: string }) {
  return (
    <span className={styles.keycap} aria-hidden>
      {children}
    </span>
  );
}

/** A row of bare discs, for a legend that needs no wording under each one. */
export function GlyphRow({
  theme,
  buttons,
  className,
}: {
  theme: GlyphTheme;
  buttons: readonly PromptButton[];
  className?: string;
}) {
  return (
    <span className={[styles.glyphRow, className ?? ""].filter(Boolean).join(" ")}>
      {buttons.map((button) => (
        <Glyph key={button} theme={theme} button={button} />
      ))}
    </span>
  );
}

export interface GlyphHint {
  button: PromptButton;
  label: string;
}

/** A row of `[A] Details` pairs — the gamepad half of the hint bar. */
export function GlyphLegend({
  theme,
  hints,
  className,
}: {
  theme: GlyphTheme;
  hints: readonly GlyphHint[];
  className?: string;
}) {
  return (
    <span className={[styles.legend, className ?? ""].filter(Boolean).join(" ")}>
      {hints.map((hint) => (
        <span className={styles.legendItem} key={hint.button}>
          <Glyph theme={theme} button={hint.button} />
          <span className={styles.legendLabel}>{hint.label}</span>
        </span>
      ))}
    </span>
  );
}
