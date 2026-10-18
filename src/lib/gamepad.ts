import type {
  BigPictureLayout,
  GamepadEvent,
  GamepadInfo,
  GamepadList,
} from "./types";

/**
 * Gamepad → UI translation.
 *
 * The core owns the hard part (reading `evdev` through `gilrs`, collapsing the
 * analog stick into 4-way repeats); everything here is the small, testable layer
 * that turns those codes into menu intents and picks the glyph theme. No DOM, no
 * React — Big Picture and the settings preview both read it.
 */

/** What a gamepad press means in a menu. */
export type NavIntent =
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "menu"
  | "leftBumper"
  | "rightBumper";

/** The four face buttons, named by position rather than by platform letter. */
export type FaceButton = "south" | "east" | "west" | "north";

/** Which glyph family the face buttons are drawn with. */
export type GlyphTheme = "xbox" | "playstation";

/**
 * gilrs button names → intent.
 *
 * Only the presses a one-row rail actually acts on are listed. Vertical presses
 * (`DPadUp`/`DPadDown`/`AxisUp`/`AxisDown`) deliberately map to nothing: the rail
 * is a single row, and swallowing them silently is better than a dead focus move.
 * Stick directions arrive as `axis` events; the core repeats them while held.
 */
const BUTTON_INTENTS: Record<string, NavIntent> = {
  South: "confirm",
  East: "back",
  Start: "menu",
  DPadLeft: "left",
  DPadRight: "right",
  AxisLeft: "left",
  AxisRight: "right",
  // Shoulder triggers flip the detail panel's tabs (Info ↔ Mods).
  LeftTrigger: "leftBumper",
  RightTrigger: "rightBumper",
};

/**
 * The intent a gamepad event carries, or `null` for anything the UI ignores
 * (button releases, unmapped buttons, vertical directions).
 */
export function navIntent(event: GamepadEvent): NavIntent | null {
  // Releases are the tail of a press we already acted on.
  if (event.kind === "button-release") return null;
  return BUTTON_INTENTS[event.code] ?? null;
}

/** The glyph printed on each face button, per theme. */
export const FACE_GLYPHS: Record<GlyphTheme, Record<FaceButton, string>> = {
  xbox: { south: "A", east: "B", west: "X", north: "Y" },
  playstation: { south: "✕", east: "○", west: "□", north: "△" },
};

/**
 * Which theme the buttons are drawn with.
 *
 * An explicit setting always wins. `auto` follows the first connected pad; a pad
 * whose family could not be told apart (`unknown`), or no pad at all, falls back
 * to Xbox — the layout every PC port labels its prompts with.
 */
export function resolveGlyphTheme(
  layout: BigPictureLayout,
  pads: readonly GamepadInfo[],
): GlyphTheme {
  if (layout === "xbox" || layout === "playstation") return layout;
  const first = pads[0];
  if (first !== undefined && first.kind !== "unknown") return first.kind;
  return "xbox";
}

/**
 * Reads a `list_gamepads` answer into the contract shape.
 *
 * `docs/INTERFACES.md` describes `{ pads: [...] }`, while the core currently
 * returns a bare `GamepadInfo[]`; the adapter accepts both so the UI cannot be
 * broken by which side of that is resolved first. Anything else is an empty list
 * rather than a crash — no pads is a normal state, not an error.
 */
export function normalizeGamepadList(value: unknown): GamepadList {
  const raw = Array.isArray(value)
    ? value
    : ((value as { pads?: unknown } | null)?.pads ?? null);
  if (!Array.isArray(raw)) return { pads: [] };

  const pads: GamepadInfo[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Partial<GamepadInfo>;
    if (typeof candidate.id !== "number" || typeof candidate.name !== "string") {
      continue;
    }
    pads.push({
      id: candidate.id,
      name: candidate.name,
      kind:
        candidate.kind === "xbox" || candidate.kind === "playstation"
          ? candidate.kind
          : "unknown",
    });
  }
  return { pads };
}
