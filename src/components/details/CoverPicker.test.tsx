import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import type { Game } from "../../lib/types";
import { useLibraryStore } from "../../store/library";
import { useToastStore } from "../../store/toasts";
import { setupMockApp, mockApi } from "../../test/harness";
import { Toaster } from "../ui/Toaster";
import { CoverPicker } from "./CoverPicker";

const CELESTE = 2;

function gameById(id: number): Game {
  const game = useLibraryStore.getState().games.find((entry) => entry.id === id);
  if (game === undefined) throw new Error(`No game ${id} in the seed`);
  return game;
}

function renderPicker(): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  render(
    <>
      <CoverPicker game={gameById(CELESTE)} open onClose={onClose} />
      <Toaster />
    </>,
  );
  return { onClose };
}

const toastTitles = () => useToastStore.getState().toasts.map((toast) => toast.title);

describe("CoverPicker", () => {
  it("searches for the game's own title and stores the poster that is picked", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    const { onClose } = renderPicker();

    // The title is the query, and the search has already run.
    expect(screen.getByDisplayValue("Celeste")).toBeInTheDocument();
    expect(await screen.findByText("Steam")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Celeste" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(mockApi().downloadedCoverUrls).toHaveLength(1);
    expect(
      useLibraryStore.getState().games.find((game) => game.id === CELESTE)?.coverPath,
    ).toMatch(/^data:image\//);
    expect(toastTitles()).toContain("Cover updated");
  });

  it("warns about a failed search without emptying the dialog", async () => {
    await setupMockApp();
    vi.spyOn(api, "fetchCoverCandidates").mockRejectedValue({
      code: "IO",
      message: "cover search failed: connection refused",
    });

    renderPicker();

    expect(await screen.findByText("Could not reach the store")).toBeInTheDocument();
    expect(screen.getByText(/connection refused/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("offers the file dialog when the store has nothing to show", async () => {
    await setupMockApp();
    vi.spyOn(api, "fetchCoverCandidates").mockResolvedValue([]);
    const user = userEvent.setup();

    renderPicker();

    expect(await screen.findByText("No store entry found")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose a file…" }));

    await waitFor(() => {
      expect(mockApi().coverSources).toEqual([
        "/home/oliwier/Pictures/covers/hollow-knight-alt.png",
      ]);
    });
    expect(toastTitles()).toContain("Cover updated");
  });

  it("will not send an empty query", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    renderPicker();

    const input = screen.getByLabelText("Search the Steam store");
    await user.clear(input);

    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  });
});
