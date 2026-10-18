import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Toaster } from "../components/ui/Toaster";
import { api } from "../lib/api";
import type { GamepadEvent, GamepadKind } from "../lib/types";
import { useLibraryStore } from "../store/library";
import { useShellStore } from "../store/shell";
import { useToastStore } from "../store/toasts";
import { mockApi, setupMockApp } from "../test/harness";
import { BigPictureView, railMetrics, railOffset } from "./BigPictureView";

/**
 * Big Picture is driven by two input devices and one piece of state: the focus.
 * Everything here asserts what a couch would see and feel — which poster holds
 * the focus, what the buttons do, and which letters are printed on them.
 *
 * The seed sorts to: AM2R, Brotato, Celeste, Dwarf Fortress, … so the first tile
 * is a `mod` entry (nothing can launch it) and the second one is a plain native
 * game. The tests lean on that on purpose: the panel has to be honest about both.
 */
function renderBigPicture() {
  return render(
    <>
      <BigPictureView />
      <Toaster />
    </>,
  );
}

const tile = (title: string) => screen.getByRole("option", { name: `Open ${title}` });
const tiles = () => screen.getAllByRole("option");
const glyph = (button: string) => document.querySelector(`[data-button="${button}"]`);

/** One press, as the core's `gilrs` thread would report it. */
async function press(code: string, kind: GamepadEvent["kind"] = "button-press") {
  await act(async () => {
    mockApi().sendGamepadEvent({ kind, pad: 0, name: code, code });
  });
}

const toastTitles = () => useToastStore.getState().toasts.map((toast) => toast.title);

describe("BigPictureView", () => {
  it("shows the whole library as one focused row of posters", async () => {
    await setupMockApp();
    renderBigPicture();

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(13);
    expect(screen.getByRole("listbox", { name: "Games" })).toBeInTheDocument();
    expect(tile("AM2R")).toHaveFocus();
    // The row is the only thing that holds the tab stop, so a stray Tab cannot
    // walk into a poster nobody is looking at.
    expect(tiles().filter((entry) => entry.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("moves the focus with the arrow keys and stops at both ends", async () => {
    await setupMockApp();
    renderBigPicture();

    await screen.findAllByRole("option");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(tile("Brotato")).toHaveFocus());

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() => expect(tile("AM2R")).toHaveFocus());

    // The ends clamp instead of wrapping: a row that jumps from the last poster
    // to the first is a row that lost someone in the dark.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(tile("AM2R")).toHaveFocus();
  });

  it("ignores the presses a one-row rail has nothing to do with", async () => {
    await setupMockApp();
    renderBigPicture();

    await screen.findAllByRole("option");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    await press("DPadUp");
    await press("DPadDown");
    await press("North");
    // A release is the tail of a press that was already acted on.
    await press("DPadRight", "button-release");

    expect(tile("AM2R")).toHaveFocus();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the panel for the focused game and lands the focus on Play", async () => {
    await setupMockApp();
    renderBigPicture();

    await screen.findAllByRole("option");

    fireEvent.keyDown(window, { key: "Enter" });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("AM2R");

    // AM2R is a `mod` entry: the panel says so and its Play cannot start it.
    expect(within(dialog).getByRole("button", { name: "Play" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(tile("Brotato")).toHaveFocus());

    fireEvent.keyDown(window, { key: "Enter" });
    const playable = await screen.findByRole("dialog");
    expect(playable).toHaveAccessibleName("Brotato");
    // Focus on the one action a couch came here to take.
    expect(within(playable).getByRole("button", { name: "Play" })).toHaveFocus();
  });

  it("starts the game from the panel and gets out of its way", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    renderBigPicture();

    await screen.findAllByRole("option");
    await user.click(tile("Brotato"));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Play" }));

    await waitFor(() => expect(toastTitles()).toContain("Session started"));
    // The panel closes itself: nothing covers the game that just took the screen.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes the panel on Escape, and leaves Big Picture on the second one", async () => {
    await setupMockApp();
    useShellStore.getState().goToBigPicture();
    renderBigPicture();

    await screen.findAllByRole("option");

    fireEvent.keyDown(window, { key: "Enter" });
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useShellStore.getState().view).toBe("bigPicture");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useShellStore.getState().view).toBe("library");
  });

  it("walks out through the corner button", async () => {
    await setupMockApp();
    useShellStore.getState().goToBigPicture();
    const user = userEvent.setup();
    renderBigPicture();

    await screen.findAllByRole("option");
    await user.click(screen.getByRole("button", { name: "Back to the library" }));

    expect(useShellStore.getState().view).toBe("library");
  });

  it("runs the whole rail from a controller", async () => {
    await setupMockApp();
    useShellStore.getState().goToBigPicture();
    renderBigPicture();

    await screen.findAllByRole("option");
    expect(tile("AM2R")).toHaveFocus();

    await press("DPadRight");
    await waitFor(() => expect(tile("Brotato")).toHaveFocus());

    // The stick is the same intent as the d-pad — the core repeats it while held.
    await press("AxisLeft", "axis");
    await waitFor(() => expect(tile("AM2R")).toHaveFocus());

    await press("South");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("AM2R");

    // East is what the ✕/B prompt promises: out of the panel, then out of the view.
    await press("East");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useShellStore.getState().view).toBe("bigPicture");

    await press("East");
    expect(useShellStore.getState().view).toBe("library");
  });

  it("leaves through Start, the way the prompt bar says", async () => {
    await setupMockApp();
    useShellStore.getState().goToBigPicture();
    renderBigPicture();

    await screen.findAllByRole("option");

    // Start is not a second Escape: the prompt bar promises "Library", so it
    // leaves even when the panel is open.
    await press("South");
    await screen.findByRole("dialog");

    await press("Start");

    expect(useShellStore.getState().view).toBe("library");
  });

  it("prints the glyphs of the family the pad asks for", async () => {
    await setupMockApp();
    // The seed is an Xbox controller, so `auto` has something to go on.
    renderBigPicture();
    await screen.findAllByRole("option");

    await waitFor(() => expect(glyph("south")).toHaveTextContent("A"));
    expect(glyph("south")).toHaveAttribute("data-theme", "xbox");
    expect(glyph("east")).toHaveTextContent("B");
    // Start is the same hamburger on both families.
    expect(glyph("start")).toHaveTextContent("≡");
  });

  it("follows a PlayStation pad under auto", async () => {
    await setupMockApp();
    const spy = vi.spyOn(api, "listGamepads").mockResolvedValue({
      pads: [
        { id: 1, name: "DualSense Wireless Controller", kind: "playstation" as GamepadKind },
      ],
    });
    renderBigPicture();
    await screen.findAllByRole("option");

    await waitFor(() => expect(glyph("south")).toHaveTextContent("✕"));
    expect(glyph("east")).toHaveTextContent("○");
    spy.mockRestore();
  });

  it("lets the stored family win over the connected pad", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    await useLibraryStore.getState().updateSettings({ bigPictureLayout: "playstation" });
    renderBigPicture();

    await screen.findAllByRole("option");
    await waitFor(() => expect(glyph("south")).toHaveTextContent("✕"));

    // …and the setting is live: picking Xbox redraws the same discs.
    await user.click(screen.getByRole("option", { name: "Open AM2R" }));
    await user.click(await screen.findByRole("button", { name: "Back" }));

    await act(async () => {
      await useLibraryStore.getState().updateSettings({ bigPictureLayout: "xbox" });
    });
    expect(glyph("south")).toHaveTextContent("A");
  });

  it("says nothing about a controller when there is none to hold", async () => {
    await setupMockApp();
    const spy = vi.spyOn(api, "listGamepads").mockResolvedValue({ pads: [] });
    renderBigPicture();

    await screen.findAllByRole("option");
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    // No gamepad half of the prompt bar, and no glyphs to explain. The keyboard
    // half stays, because a keyboard is always there.
    expect(screen.queryByText("Gamepad")).toBeNull();
    expect(screen.getByText("Keyboard")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-button]")).toHaveLength(0);
    spy.mockRestore();
  });

  it("explains an empty library instead of an empty row", async () => {
    await setupMockApp();
    useShellStore.getState().setSearch("zzz-nothing");
    renderBigPicture();

    expect(await screen.findByText("Nothing to launch")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

/**
 * The follow-the-focus maths, without a layout engine. jsdom measures nothing,
 * and "does the rail slide to the right place" is not something the browser
 * should be the only witness of.
 */
describe("rail geometry", () => {
  it("sizes posters to the window, but never taller than the screen", () => {
    expect(railMetrics(1024, 768)).toEqual({ tile: 195, gap: 20, edge: 61 });

    // A wide, short window: the height is what caps the poster.
    expect(railMetrics(1600, 700).tile).toBe(238);
    // A very large one: the ceiling keeps a poster from becoming a poster wall.
    expect(railMetrics(3840, 2160).tile).toBe(290);
    // And a small one keeps a floor, so the row is still readable.
    expect(railMetrics(600, 400).tile).toBe(180);
  });

  it("centres the focused poster and clamps at both ends", () => {
    const metrics = { tile: 200, gap: 20, edge: 60 };

    // The first poster keeps its edge padding instead of sliding under the fade.
    expect(railOffset(0, 10, 1000, metrics)).toBe(0);
    // Nothing to centre against yet.
    expect(railOffset(1, 10, 1000, metrics)).toBe(0);
    // The third one sits in the middle: 60 + 2·220 + 100 − 500.
    expect(railOffset(2, 10, 1000, metrics)).toBe(100);
    // The last one stops rather than leaving a void behind it.
    expect(railOffset(9, 10, 1000, metrics)).toBe(1300);
  });

  it("has nothing to say about an empty row or an unmeasured viewport", () => {
    expect(railOffset(0, 0, 1000, { tile: 200, gap: 20, edge: 60 })).toBe(0);
    expect(railOffset(3, 10, 0, { tile: 200, gap: 20, edge: 60 })).toBe(0);
  });
});
