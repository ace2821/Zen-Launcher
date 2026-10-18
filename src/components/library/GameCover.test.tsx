import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GameCover } from "./GameCover";

/** A one-pixel inline poster, standing in for a file the core stored. */
const POSTER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";

describe("GameCover", () => {
  it("shows the stored artwork once the path resolves", async () => {
    const { container } = render(<GameCover title="Hollow Knight" coverPath={POSTER} />);

    const image = await waitFor(() => {
      const found = container.querySelector("img");
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });

    expect(image.getAttribute("src")).toBe(POSTER);
    // Decorative: the title sits right next to the cover.
    expect(image).toHaveAttribute("alt", "");
    expect(screen.queryByText("HK")).toBeNull();
  });

  it("keeps the initials tile for an entry without a cover", async () => {
    const { container } = render(<GameCover title="Hollow Knight" coverPath={null} />);

    expect(screen.getByText("HK")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("falls back to the initials when the artwork cannot be loaded", async () => {
    const { container } = render(<GameCover title="Hollow Knight" coverPath={POSTER} />);

    const image = await waitFor(() => {
      const found = container.querySelector("img");
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });

    fireEvent.error(image);

    expect(await screen.findByText("HK")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
