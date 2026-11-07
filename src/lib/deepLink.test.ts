import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { useDeepLinkNavigation } from "./deepLink";
import { setupMockApp } from "../test/harness";
import { useShellStore } from "../store/shell";
import type { NavigateEvent } from "./types";

type Handler = (event: NavigateEvent) => void;

/** Captures the handler the hook registers instead of driving a real bus. */
function captureHandler(): () => Handler {
  let handler: Handler | undefined;
  vi.spyOn(api, "on").mockImplementation(((
    _event: string,
    callback: Handler,
  ) => {
    handler = callback;
    return Promise.resolve(() => {});
  }) as typeof api.on);
  return () => {
    if (!handler) throw new Error("the hook did not subscribe");
    return handler;
  };
}

describe("useDeepLinkNavigation", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await setupMockApp();
  });

  it("navigates to the marketplace for the marketplace page", () => {
    const handler = captureHandler();
    renderHook(() => useDeepLinkNavigation());

    act(() => handler()({ page: "marketplace" }));

    expect(useShellStore.getState().view).toBe("marketplace");
  });

  it("ignores unknown page names", () => {
    const handler = captureHandler();
    renderHook(() => useDeepLinkNavigation());

    act(() => handler()({ page: "settings" }));

    expect(useShellStore.getState().view).toBe("library");
  });
});
