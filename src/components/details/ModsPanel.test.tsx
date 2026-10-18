import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Game } from "../../lib/types";
import { useLibraryStore } from "../../store/library";
import { useToastStore } from "../../store/toasts";
import { setupMockApp, mockApi } from "../../test/harness";
import { ConfirmHost } from "../ui/ConfirmHost";
import { Toaster } from "../ui/Toaster";
import { ModsPanel } from "./ModsPanel";

const BEPINEX_GAME = 13; // ULTRAKILL — loader already installed
const SUGGESTED_GAME = 12; // Vampire Survivors — IL2CPP, nothing installed yet
const UNKNOWN_ENGINE_GAME = 9; // Morrowind — the catalog knows nothing about it
const NATIVE_GAME = 1; // Hollow Knight — mods do not apply

function gameById(id: number): Game {
  const game = useLibraryStore.getState().games.find((entry) => entry.id === id);
  if (game === undefined) throw new Error(`No game ${id} in the seed`);
  return game;
}

/** The panel plus the two hosts that its toasts and confirmations need. */
function renderPanel(id: number) {
  return render(
    <>
      <ModsPanel game={gameById(id)} />
      <ConfirmHost />
      <Toaster />
    </>,
  );
}

const toastTitles = () => useToastStore.getState().toasts.map((toast) => toast.title);
const toastBodies = () =>
  useToastStore.getState().toasts.map((toast) => toast.description ?? "");

const dropzone = () => screen.getByRole("group", { name: "Drop mod archives here" });

function dropFiles(...names: string[]) {
  const files = names.map((name) => new File(["x"], name));
  fireEvent.drop(dropzone(), { dataTransfer: { files } });
}

describe("ModsPanel", () => {
  it("shows the loader, the mods folder and what is installed", async () => {
    await setupMockApp();
    renderPanel(BEPINEX_GAME);

    expect(await screen.findByText("BepInEx")).toBeInTheDocument();
    expect(
      screen.getByText("/home/oliwier/Games/ULTRAKILL/BepInEx/plugins"),
    ).toBeInTheDocument();
    expect(screen.getByText("CustomWeapons.dll")).toBeInTheDocument();
    expect(screen.getByText("Unity · Mono")).toBeInTheDocument();

    // A loader is already in place, so there is nothing to offer.
    expect(screen.queryByRole("button", { name: /^install/i })).toBeNull();
  });

  it("lists the loaders the engine can run and marks the recommended one", async () => {
    await setupMockApp();
    renderPanel(SUGGESTED_GAME);

    expect(
      await screen.findByRole("heading", { name: "Installable loaders" }),
    ).toBeInTheDocument();

    // Ranked by the core, so MelonLoader leads — and only it carries the badge.
    const melon = screen.getByRole("button", { name: "Install MelonLoader" });
    const bepinex = screen.getByRole("button", {
      name: "Install BepInEx 6 (IL2CPP)",
    });
    expect(melon).toBeInTheDocument();
    expect(bepinex).toBeInTheDocument();
    expect(screen.getAllByText("Recommended")).toHaveLength(1);

    // Every row says it writes into the game folder before it is clicked.
    expect(
      screen.getByText(/unpacked into \/home\/oliwier\/Games\/Vampire Survivors/),
    ).toBeInTheDocument();
  });

  it("offers the loader the engine calls for, and asks before writing", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    renderPanel(SUGGESTED_GAME);

    const install = await screen.findByRole("button", { name: "Install MelonLoader" });
    // The consequence is on screen before anything is downloaded.
    expect(
      screen.getByText(/unpacked into \/home\/oliwier\/Games\/Vampire Survivors/),
    ).toBeInTheDocument();

    await user.click(install);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/into “\/home\/oliwier\/Games/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Install MelonLoader" }));

    await waitFor(() => {
      expect(screen.getByText("/home/oliwier/Games/Vampire Survivors/MelonLoader/Mods")).toBeInTheDocument();
    });
    expect(toastTitles()).toContain("MelonLoader installed");
    // The list is gone: the loader is installed now.
    expect(screen.queryByText("Installable loaders")).toBeNull();
  });

  it("installs the loader the clicked row names, not the suggestion", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    renderPanel(SUGGESTED_GAME);

    await user.click(
      await screen.findByRole("button", { name: "Install BepInEx 6 (IL2CPP)" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Install BepInEx 6 (IL2CPP)" }),
    );

    // BepInEx 6 for IL2CPP keeps its mods where BepInEx always keeps them —
    // which is the proof that the *id* travelled, not the suggestion.
    await waitFor(() => {
      expect(
        screen.getByText("/home/oliwier/Games/Vampire Survivors/BepInEx/plugins"),
      ).toBeInTheDocument();
    });
    expect(toastTitles()).toContain("BepInEx 6 (IL2CPP) installed");
  });

  it("says there is no known mod support, and offers nothing at all", async () => {
    await setupMockApp();
    renderPanel(UNKNOWN_ENGINE_GAME);

    expect(await screen.findByText("No known mod support")).toBeInTheDocument();
    expect(screen.getByText("Unknown engine")).toBeInTheDocument();

    // No install button, no drop tray, no file dialog: the panel has nothing it
    // could honestly do for this engine, so it does not pretend otherwise.
    expect(screen.queryByRole("button", { name: /^install/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose an archive…" })).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Drop mod archives here" }),
    ).toBeNull();
    // Re-reading the folder stays available: the answer can change on disk.
    expect(
      screen.getByRole("button", { name: "Re-read the game folder" }),
    ).toBeInTheDocument();
    // What is already installed is still reported, read-only.
    expect(screen.getByText("MWSE")).toBeInTheDocument();
  });

  it("states the validation rules in force on the tray itself", async () => {
    await setupMockApp();
    renderPanel(BEPINEX_GAME);

    // Lenient and 1024 MB are the contract defaults.
    expect(await screen.findByText("Lenient")).toBeInTheDocument();
    expect(screen.getByText("max 1024 MB")).toBeInTheDocument();

    await useLibraryStore.getState().updateSettings({
      modsLenient: false,
      modsMaxMb: 2048,
    });

    await waitFor(() => {
      expect(screen.getByText("Strict")).toBeInTheDocument();
    });
    expect(screen.getByText("max 2048 MB")).toBeInTheDocument();
    expect(screen.getByText(".zip, .7z, .rar only · symlinks refused")).toBeInTheDocument();
  });

  it("installs dropped archives one by one and sums them up", async () => {
    await setupMockApp();
    renderPanel(BEPINEX_GAME);

    await screen.findByText("BepInEx");
    dropFiles("CoolMod-2.1.zip", "TexturePack.7z", "notes.txt");

    // Each archive reports on its own, then the drop is summed up.
    await waitFor(() => {
      expect(toastTitles()).toContain("Installed TexturePack.7z");
    });
    expect(toastTitles()).toContain("Installed CoolMod-2.1.zip");
    expect(toastTitles()).toContain("2 installed, 0 failed, 1 skipped");

    // And the list is re-read from the core, not guessed.
    expect(await screen.findByText("CoolMod-2.1")).toBeInTheDocument();
    expect(screen.getByText("TexturePack")).toBeInTheDocument();
  });

  it("names the mode an archive was refused under", async () => {
    await setupMockApp();
    // A refusal only makes sense next to the rules it happened under, so the
    // note travels with the core's own message.
    await useLibraryStore.getState().updateSettings({ modsLenient: false });
    renderPanel(BEPINEX_GAME);

    await screen.findByText("BepInEx");
    dropFiles("CoolMod-2.1.zip");

    await waitFor(() => {
      expect(toastTitles()).toContain("Installed CoolMod-2.1.zip");
    });
    // Nothing was refused, so nothing carries a note.
    expect(toastBodies().some((body) => body.includes("Validation in force"))).toBe(
      false,
    );
  });

  it("reports a drop that carries nothing installable", async () => {
    await setupMockApp();
    renderPanel(BEPINEX_GAME);

    await screen.findByText("BepInEx");
    dropFiles("screenshot.png");

    expect(await screen.findByText("Nothing to install")).toBeInTheDocument();
    expect(toastTitles()).toContain("Nothing to install");
    expect(mockApi().trashedArchives).toEqual([]);
  });

  it("installs an archive chosen through the file dialog", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    renderPanel(BEPINEX_GAME);

    await user.click(await screen.findByRole("button", { name: "Choose an archive…" }));

    await waitFor(() => {
      expect(toastTitles()).toContain("Installed CoolMod-2.1.zip");
    });
    expect(mockApi().trashedArchives).toEqual([
      "/home/oliwier/Downloads/CoolMod-2.1.zip",
    ]);
  });

  it("stays mute while there is nowhere to extract to", async () => {
    await setupMockApp();
    renderPanel(SUGGESTED_GAME);

    // The tray says what is missing and offers no promise it cannot keep: with no
    // mods folder the core refuses every archive.
    expect(await screen.findByText(/install a loader first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose an archive…" })).toBeDisabled();

    dropFiles("CoolMod-2.1.zip");
    await Promise.resolve();
    expect(toastTitles()).toEqual([]);
    expect(mockApi().trashedArchives).toEqual([]);
  });

  it("opens the tray as soon as a loader gives it somewhere to extract to", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    renderPanel(SUGGESTED_GAME);

    await user.click(await screen.findByRole("button", { name: "Install MelonLoader" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Install MelonLoader",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Choose an archive…" }),
      ).toBeEnabled();
    });
    expect(screen.queryByText(/install a loader first/)).toBeNull();
  });

  it("shows a refused folder in place instead of toasting on mount", async () => {
    await setupMockApp();
    renderPanel(NATIVE_GAME);

    // The core refuses mods for non-Windows entries; that is an answer, and it
    // belongs in the panel — no toast, because the user did not ask for anything.
    expect(
      await screen.findByText("Could not read the game folder"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("mod loading is only supported for Windows games"),
    ).toBeInTheDocument();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
