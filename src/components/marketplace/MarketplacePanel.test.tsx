import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MarketplacePanel } from "./MarketplacePanel";
import { setupMockApp, mockApi } from "../../test/harness";
import { useMarketplaceStore } from "../../store/marketplace";

function cardFor(title: string): HTMLElement {
  return screen.getAllByText(title)[0].closest("li") as HTMLElement;
}

describe("MarketplacePanel", () => {
  beforeEach(async () => {
    await setupMockApp();
  });

  it("renders the catalog split into themes and add-ons", async () => {
    render(<MarketplacePanel />);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Themes" })).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Add-ons" })).toBeInTheDocument();

    // Seed carries 3 themes + 3 add-ons.
    expect(screen.getByText("Nordic Night")).toBeInTheDocument();
    // Add-ons are hidden on the themes tab.
    expect(screen.queryByText("HD Texture Pack")).toBeNull();
  });

  it("filters items when switching tabs", async () => {
    render(<MarketplacePanel />);

    await waitFor(() => {
      expect(screen.getByText("Nordic Night")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: /Add-ons/i }));

    expect(screen.getByText("HD Texture Pack")).toBeInTheDocument();
    expect(screen.queryByText("Nordic Night")).toBeNull();
  });

  it("installs an item and shows the installed state", async () => {
    const api = mockApi();
    const installSpy = vi.spyOn(api, "marketplace_install");

    render(<MarketplacePanel />);

    await waitFor(() => {
      expect(screen.getByText("Nordic Night")).toBeInTheDocument();
    });

    // The first "Install" button belongs to "Nordic Night" (id 1).
    fireEvent.click(cardFor("Nordic Night").getElementsByTagName("button")[0]);

    expect(installSpy).toHaveBeenCalledWith(1);

    await waitFor(() => {
      expect(useMarketplaceStore.getState().isInstalled(1)).toBe(true);
    });
  });

  it("shows the stale banner when the catalog is offline", async () => {
    useMarketplaceStore.setState({ stale: true });

    render(<MarketplacePanel />);

    await waitFor(() => {
      expect(screen.getByText("Catalog outdated (offline)")).toBeInTheDocument();
    });
  });

  it("activates a theme and marks it active", async () => {
    const api = mockApi();
    const setActiveSpy = vi.spyOn(api, "marketplace_set_active_theme");

    render(<MarketplacePanel />);

    await waitFor(() => {
      expect(screen.getByText("Solarized Ember")).toBeInTheDocument();
    });

    // Install the theme first.
    fireEvent.click(cardFor("Solarized Ember").querySelector("button")!);
    await waitFor(() => {
      expect(useMarketplaceStore.getState().isInstalled(2)).toBe(true);
    });

    // "Set as active theme" appears on the card (replaces Install).
    fireEvent.click(
      within(cardFor("Solarized Ember")).getByRole("button", {
        name: /Set as active theme/i,
      }),
    );

    expect(setActiveSpy).toHaveBeenCalledWith(2);
    await waitFor(() => {
      expect(useMarketplaceStore.getState().activeThemeId).toBe(2);
    });
  });

  it("falls back to initials when an item has no preview", async () => {
    render(<MarketplacePanel />);

    await waitFor(() => {
      expect(screen.getByText("Nordic Night")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: /Add-ons/i }));

    await waitFor(() => {
      expect(screen.getByText("HD Texture Pack")).toBeInTheDocument();
    });

    // "HD Texture Pack" (id 4) has previewUrl: null. Open its detail modal.
    fireEvent.click(cardFor("HD Texture Pack"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        within(screen.getByRole("dialog")).getByText("HT"),
      ).toBeInTheDocument();
    });
  });

  it("opens the detail view on card click", async () => {
    render(<MarketplacePanel />);

    await waitFor(() => {
      expect(screen.getByText("Nordic Night")).toBeInTheDocument();
    });

    fireEvent.click(cardFor("Solarized Ember"));

    await waitFor(() => {
      expect(screen.getByText("Zen Studio")).toBeInTheDocument();
      expect(screen.getByText("1.1.0")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Set as active theme")[0]).toBeInTheDocument();
  });
});
