import { describe, expect, it } from "vitest";
import {
  FACE_GLYPHS,
  navIntent,
  normalizeGamepadList,
  resolveGlyphTheme,
} from "./gamepad";
import type { GamepadEvent, GamepadInfo } from "./types";

/**
 * The gamepad layer is what stands between raw `gilrs` codes and the rail's
 * focus, so it is tested as a translation table: every code the core can send,
 * and what a one-row menu does with it.
 */

const press = (code: string): GamepadEvent => ({
  kind: "button-press",
  pad: 0,
  name: code,
  code,
});

const axis = (code: string): GamepadEvent => ({
  kind: "axis",
  pad: 0,
  name: null,
  code,
});

describe("gamepad press → intent", () => {
  it("maps the presses a single-row rail acts on", () => {
    expect(navIntent(press("DPadLeft"))).toBe("left");
    expect(navIntent(press("DPadRight"))).toBe("right");
    expect(navIntent(press("South"))).toBe("confirm");
    expect(navIntent(press("East"))).toBe("back");
    expect(navIntent(press("Start"))).toBe("menu");
  });

  it("reads the stick the same way as the d-pad", () => {
    // The core repeats these while the stick is held; they are the same intent.
    expect(navIntent(axis("AxisLeft"))).toBe("left");
    expect(navIntent(axis("AxisRight"))).toBe("right");
  });

  it("ignores releases, unmapped buttons and every vertical direction", () => {
    expect(navIntent({ ...press("South"), kind: "button-release" })).toBeNull();

    // The rail is one row: a vertical press moves nothing rather than moving a
    // focus nobody can see. The shoulder triggers are the only "extra" presses
    // the rail now maps — they flip detail tabs in Big Picture.
    for (const code of [
      "DPadUp",
      "DPadDown",
      "AxisUp",
      "AxisDown",
      "North",
      "West",
      "Select",
      "Mode",
    ]) {
      expect(navIntent(press(code))).toBeNull();
    }
  });
});

describe("gamepad shoulder triggers", () => {
  it("maps the shoulder triggers to tab-flipping intents", () => {
    expect(navIntent(press("LeftTrigger"))).toBe("leftBumper");
    expect(navIntent(press("RightTrigger"))).toBe("rightBumper");
  });
});

describe("glyph theme", () => {
  const xbox: GamepadInfo = { id: 0, name: "Xbox Wireless Controller", kind: "xbox" };
  const playstation: GamepadInfo = { id: 1, name: "DualSense", kind: "playstation" };
  const generic: GamepadInfo = { id: 2, name: "Generic Pad", kind: "unknown" };

  it("lets an explicit setting win over whatever is plugged in", () => {
    expect(resolveGlyphTheme("playstation", [xbox])).toBe("playstation");
    expect(resolveGlyphTheme("xbox", [playstation])).toBe("xbox");
  });

  it("follows the first pad under auto", () => {
    expect(resolveGlyphTheme("auto", [playstation])).toBe("playstation");
    expect(resolveGlyphTheme("auto", [xbox, playstation])).toBe("xbox");
  });

  it("falls back to Xbox with no pad, or one it cannot tell apart", () => {
    expect(resolveGlyphTheme("auto", [])).toBe("xbox");
    expect(resolveGlyphTheme("auto", [generic])).toBe("xbox");
  });

  it("prints the four face buttons in both families", () => {
    expect(FACE_GLYPHS.xbox).toEqual({
      south: "A",
      east: "B",
      west: "X",
      north: "Y",
    });
    expect(FACE_GLYPHS.playstation).toEqual({
      south: "✕",
      east: "○",
      west: "□",
      north: "△",
    });
  });
});

describe("list_gamepads answer", () => {
  it("accepts the contract shape and the bare array the core returns today", () => {
    const pad = { id: 0, name: "Pad", kind: "playstation" };
    expect(normalizeGamepadList({ pads: [pad] })).toEqual({ pads: [pad] });
    expect(normalizeGamepadList([pad])).toEqual({ pads: [pad] });
  });

  it("normalises a kind it does not know", () => {
    expect(
      normalizeGamepadList({ pads: [{ id: 3, name: "Mystery", kind: "atari" }] }),
    ).toEqual({ pads: [{ id: 3, name: "Mystery", kind: "unknown" }] });
  });

  it("treats anything unusable as 'no pads' rather than crashing", () => {
    const junk: unknown[] = [
      null,
      undefined,
      7,
      "pads",
      {},
      { pads: "x" },
      { pads: [null, 1, "nope", { name: "no id" }, { id: "0", name: "bad id" }] },
    ];
    for (const value of junk) {
      expect(normalizeGamepadList(value)).toEqual({ pads: [] });
    }
  });
});
