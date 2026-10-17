import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ConfirmHost } from "../components/ui/ConfirmHost";
import { Toaster } from "../components/ui/Toaster";
import { useLibraryStore } from "../store/library";
import { setupMockApp } from "../test/harness";
import { ImportView } from "./ImportView";

/**
 * Candidate review is the one flow where a mistake is expensive, so it is tested
 * through the UI: the real store, the real mock adapter, the real confirm modal.
 */
function renderImport() {
  return render(
    <>
      <ImportView />
      <ConfirmHost />
      <Toaster />
    </>,
  );
}

function cardFor(title: string): HTMLElement {
  const field = screen.getByDisplayValue(title);
  const card = field.closest("article");
  if (card === null) throw new Error(`No candidate card for "${title}"`);
  return card;
}

const pendingCount = () =>
  useLibraryStore.getState().candidates.filter((entry) => entry.status === "pending")
    .length;

describe("ImportView", () => {
  it("lists the scan roots and the pending candidates", async () => {
    await setupMockApp();
    renderImport();

    expect(await screen.findByText("/home/oliwier/Games")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Death's Door")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kenney Bundle")).toBeInTheDocument();
    expect(pendingCount()).toBe(8);
  });

  it("approves a single candidate into the library", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    const gamesBefore = useLibraryStore.getState().games.length;
    renderImport();

    await screen.findByDisplayValue("Death's Door");
    await user.click(
      within(cardFor("Death's Door")).getByRole("button", { name: "Approve" }),
    );

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Death's Door")).not.toBeInTheDocument();
    });
    const games = useLibraryStore.getState().games;
    expect(games).toHaveLength(gamesBefore + 1);
    expect(games.some((game) => game.title === "Death's Door")).toBe(true);
    expect(pendingCount()).toBe(7);
  });

  it("keeps approval disabled for a candidate with no executable", async () => {
    await setupMockApp();
    renderImport();

    await screen.findByDisplayValue("Kenney Bundle");
    const card = cardFor("Kenney Bundle");

    expect(within(card).getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(within(card).getAllByText(/no executable/i).length).toBeGreaterThan(0);
  });

  it("approves every eligible candidate and skips the rest", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    const gamesBefore = useLibraryStore.getState().games.length;
    renderImport();

    await screen.findByDisplayValue("Death's Door");
    await user.click(screen.getByRole("button", { name: /^approve all/i }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^approve all/i }));

    await waitFor(() => {
      // Six of the eight pending candidates have a detected executable.
      expect(useLibraryStore.getState().games).toHaveLength(gamesBefore + 6);
    });
    expect(pendingCount()).toBe(2);
  });

  it("rejects everything only after the confirmation is accepted", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    renderImport();

    await screen.findByDisplayValue("Death's Door");
    await user.click(screen.getByRole("button", { name: /^reject all/i }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^reject all/i }));

    await waitFor(() => {
      expect(pendingCount()).toBe(0);
    });
    // Rejection never touches the library.
    expect(useLibraryStore.getState().games.length).toBeGreaterThan(0);
  });

  it("moves a rejected candidate to the rejected tab", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    renderImport();

    await screen.findByDisplayValue("Goodboy Galaxy");
    await user.click(
      within(cardFor("Goodboy Galaxy")).getByRole("button", { name: "Reject" }),
    );

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Goodboy Galaxy")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: /rejected/i }));
    expect(screen.getByDisplayValue("Goodboy Galaxy")).toBeInTheDocument();
  });
});
