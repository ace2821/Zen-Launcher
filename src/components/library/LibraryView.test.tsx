import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LibraryView } from "../../views/LibraryView";
import { useLibraryStore } from "../../store/library";
import { setupMockApp, mockApi } from "../../test/harness";

describe("LibraryView hero", () => {
  it("renders welcome stats and the Recents section", async () => {
    await setupMockApp();
    render(<LibraryView />);

    expect(await screen.findByRole("heading", { name: "Your library" })).toBeInTheDocument();
    expect(screen.getByText("Your games, in one place.")).toBeInTheDocument();

    // Stats are computed from client data only.
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.getByText("titles")).toBeInTheDocument();
    expect(screen.getAllByText(/\d+ h/).length).toBeGreaterThan(0);
    expect(screen.getByText("played")).toBeInTheDocument();
    expect(screen.getByText("this week")).toBeInTheDocument();

    // Recents surface games that have been played, from `lastPlayedAt` alone.
    expect(await screen.findByRole("heading", { name: "Recently played" })).toBeInTheDocument();
    const hollowKnight = await screen.findAllByText("Hollow Knight");
    // Once in Recents, once on the grid card cover.
    expect(hollowKnight.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Nothing played yet")).toBeNull();
  });

  it("shows 'Playing now' on a card whose session is active", async () => {
    await setupMockApp();
    // Launching a game creates a session with no `endedAt` yet.
    await mockApi().launchGame(1);

    render(<LibraryView />);

    expect(await screen.findByText("Playing now")).toBeInTheDocument();
  });
});

describe("LibraryView empty states", () => {
  it("shows the empty library state with no games", async () => {
    await setupMockApp();
    useLibraryStore.setState({ games: [], sessions: [] });

    render(<LibraryView />);

    expect(
      await screen.findByRole("heading", { name: "Your library is empty" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Go to Sources & Import/)).toBeInTheDocument();
  });
});
