import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { initI18n } from "../i18n";

// i18n must exist before any component renders; EN is the reference language.
initI18n("en");

/**
 * jsdom implements neither of these, and both are load-bearing: the virtualized
 * library grid observes its scroll container, and `motion` asks for the
 * reduced-motion preference.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * jsdom has no layout engine: every box reports 0×0. The virtualized library
 * reads the scroll container's `clientHeight`, so with zeros it would believe
 * the viewport is empty and mount nothing. A single nominal viewport is enough
 * for every measurement the app performs.
 */
const VIEWPORT = { width: 1200, height: 900 };
for (const property of ["clientWidth", "clientHeight"] as const) {
  Object.defineProperty(Element.prototype, property, {
    configurable: true,
    get: () => VIEWPORT[property === "clientWidth" ? "width" : "height"],
  });
}

afterEach(() => {
  cleanup();
});
