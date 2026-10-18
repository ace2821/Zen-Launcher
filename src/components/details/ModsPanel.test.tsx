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
    expect(screen.queryByText(/is the loader for this engine/)).toBeNull();
  });

  it("offers the loader the engine calls for, and asks before writing", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    renderPanel(SUGGESTED_GAME);

    const install = await screen.findByRole("button", { name: "Install MelonLoader" });
    // The consequence is on screen before anything is downloaded.
    expect(
      screen.getByText(/unpack it into \/home\/oliwier\/Games\/Vampire Survivors/),
    ).toBeInTheDocument();

    await user.click(install);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/into “\/home\/oliwier\/Games/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Install MelonLoader" }));

    await waitFor(() => {
      expect(screen.getByText("/home/oliwier/Games/Vampire Survivors/MelonLoader/Mods")).toBeInTheDocument();
    });
    expect(toastTitles()).toContain("MelonLoader installed");
    // The offer is gone: the loader is installed now.
    expect(screen.queryByText("This game has no loader yet.")).toBeNull();
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
