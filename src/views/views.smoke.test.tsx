import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../App";
import { useLibraryStore } from "../store/library";
import { useShellStore } from "../store/shell";
import { setupMockApp } from "../test/harness";
import { GameDetailsView } from "./GameDetailsView";
import { ImportView } from "./ImportView";
import { LibraryView } from "./LibraryView";
import { SettingsView } from "./SettingsView";

/**
 * One smoke render per major view, plus the shell. The point is that each screen
 * mounts against real store data and shows the things it promises — not pixel
 * fidelity, which the browser and the screenshot pass cover.
 */
describe("app shell", () => {
  it("renders the sidebar, header and the library grid", async () => {
    await setupMockApp();
    render(<App />);

    const nav = await screen.findByRole("navigation");
    expect(nav).toHaveTextContent("Library");
    expect(nav).toHaveTextContent("Sources & Import");
    expect(nav).toHaveTextContent("Settings");

    expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
    expect(await screen.findByText("Hollow Knight")).toBeInTheDocument();
    expect(screen.getByText("Shown: 11 / 11")).toBeInTheDocument();
  });

  it("navigates to the pending candidates badge target", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /sources & import/i }));

    expect(
      await screen.findByRole("heading", { name: "Sources & Import" }),
    ).toBeInTheDocument();
    expect(useShellStore.getState().view).toBe("import");
  });
});

describe("LibraryView", () => {
  it("switches between the grid and the table", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Hollow Knight")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "List view" }));
    expect(useShellStore.getState().layout).toBe("list");
    // The table keeps showing the same library.
    expect(await screen.findByText("Hollow Knight")).toBeInTheDocument();
  });

  it("explains an empty search result instead of showing a blank page", async () => {
    await setupMockApp();
    useShellStore.getState().setSearch("zzz-nothing-matches");
    render(<LibraryView />);

    expect(await screen.findByText("Nothing matches")).toBeInTheDocument();
    expect(screen.getByText(/zzz-nothing-matches/)).toBeInTheDocument();
  });
});

describe("GameDetailsView", () => {
  it("shows the hero, launch options and session history", async () => {
    await setupMockApp();
    await useLibraryStore.getState().openGame(1);
    render(<GameDetailsView />);

    expect(
      await screen.findByRole("heading", { name: "Hollow Knight" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Launch options" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Session history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();

    // Ten sessions at most, newest first.
    const sessionLabels = await screen.findAllByText(/\d{4}/);
    expect(sessionLabels.length).toBeGreaterThan(0);
    expect(useLibraryStore.getState().sessions).toHaveLength(10);
  });

  it("disables Play for an entry whose files are missing", async () => {
    await setupMockApp();
    await useLibraryStore.getState().openGame(11);
    render(<GameDetailsView />);

    expect(
      await screen.findByRole("heading", { name: "Rogue Legacy" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  });

  it("saves edited launch options through the store", async () => {
    await setupMockApp();
    await useLibraryStore.getState().openGame(2);
    const user = userEvent.setup();
    render(<GameDetailsView />);

    await screen.findByRole("heading", { name: "Celeste" });
    const args = screen.getByLabelText("Arguments");
    await user.clear(args);
    await user.type(args, `-fullscreen --name "Player One"`);

    // The preview is the parsed array, not the raw text.
    expect(screen.getByText("-fullscreen")).toBeInTheDocument();
    expect(screen.getByText("--name")).toBeInTheDocument();
    expect(screen.getByText("Player One")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save options" }));

    await waitFor(() => {
      const game = useLibraryStore.getState().games.find((entry) => entry.id === 2);
      expect(game?.args).toEqual(["-fullscreen", "--name", "Player One"]);
    });
  });

  it("reports an unterminated quote instead of saving garbage", async () => {
    await setupMockApp();
    await useLibraryStore.getState().openGame(2);
    const user = userEvent.setup();
    render(<GameDetailsView />);

    const args = await screen.findByLabelText("Arguments");
    await user.clear(args);
    await user.type(args, `--name "Player`);

    expect(await screen.findByRole("alert")).toHaveTextContent(/quote/i);
    expect(screen.getByRole("button", { name: "Save options" })).toBeDisabled();
  });
});

describe("SettingsView", () => {
  it("shows a language choice that actually switches locale", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    render(<SettingsView />);

    expect(await screen.findByRole("heading", { name: "Language" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Polski" }));

    await waitFor(() => {
      expect(useLibraryStore.getState().settings?.language).toBe("pl");
    });
    expect(await screen.findByRole("heading", { name: "Język" })).toBeInTheDocument();
  });

  it("persists a window-behaviour switch", async () => {
    await setupMockApp();
    const user = userEvent.setup();
    render(<SettingsView />);

    const closeSwitch = await screen.findByRole("switch", {
      name: /tray on close/i,
    });
    expect(closeSwitch).toHaveAttribute("aria-checked", "true");
    await user.click(closeSwitch);

    await waitFor(() => {
      expect(useLibraryStore.getState().settings?.closeToTray).toBe(false);
    });
    expect(closeSwitch).toHaveAttribute("aria-checked", "false");
  });

  it("names the storage paths and the IPC mode", async () => {
    await setupMockApp();
    render(<SettingsView />);

    expect(await screen.findByText("~/.config/zen-launcher/config.toml")).toBeInTheDocument();
    expect(screen.getByText("~/.local/share/zen-launcher/")).toBeInTheDocument();
    expect(screen.getByText("Mock (in-memory)")).toBeInTheDocument();
  });
});

describe("ImportView", () => {
  it("renders the roots, the notes and the pending tab", async () => {
    await setupMockApp();
    render(<ImportView />);

    expect(await screen.findByRole("heading", { name: "Scan roots" })).toBeInTheDocument();
    expect(screen.getByText("/home/oliwier/Games/itch")).toBeInTheDocument();
    expect(screen.getByText(/M2 watcher/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Pending (8)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
