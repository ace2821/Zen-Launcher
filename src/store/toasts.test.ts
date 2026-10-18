import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UiAppError } from "../lib/errors";
import {
  resetToasts,
  toastError,
  toastInfo,
  toastSuccess,
  useToastStore,
} from "./toasts";

/**
 * The toast queue is where the core's failures become something a person can
 * read, so two things have to survive the trip: the contract's error code, and
 * the exact message the core sent. The view's own context is *appended* to that
 * message, never allowed to replace it.
 */

const toasts = () => useToastStore.getState().toasts;
const titles = () => toasts().map((toast) => toast.title);

beforeEach(() => {
  resetToasts();
  vi.useFakeTimers();
});

afterEach(() => {
  resetToasts();
  vi.useRealTimers();
});

describe("toast queue", () => {
  it("keeps a success for less time than an error", () => {
    toastSuccess("Settings saved");
    toastError("Could not save the settings");

    expect(titles()).toEqual(["Settings saved", "Could not save the settings"]);

    // Success is an acknowledgement; an error is something to read.
    vi.advanceTimersByTime(4_500);
    expect(titles()).toEqual(["Could not save the settings"]);

    vi.advanceTimersByTime(3_500);
    expect(titles()).toEqual([]);
  });

  it("carries the tone through", () => {
    toastSuccess("ok");
    toastInfo("fyi");
    toastError("bad");

    expect(toasts().map((toast) => toast.tone)).toEqual([
      "success",
      "info",
      "error",
    ]);
  });

  it("keeps the contract's code and the core's own wording", () => {
    const error: UiAppError = {
      code: "VALIDATION",
      message: "archive is larger than the configured limit",
    };
    toastError("Could not install the mod", error, "a description nobody should see");

    const [toast] = toasts();
    expect(toast.code).toBe("VALIDATION");
    // The core's message wins over the view's fallback description.
    expect(toast.description).toBe("archive is larger than the configured limit");
  });

  it("appends the view's note instead of replacing the message", () => {
    toastError(
      "Could not install the mod",
      { code: "VALIDATION", message: "archive refused" },
      undefined,
      "Validation in force: strict, max 2048 MB",
    );

    const [toast] = toasts();
    expect(toast.description).toBe(
      "archive refused — Validation in force: strict, max 2048 MB",
    );
    expect(toast.code).toBe("VALIDATION");
  });

  it("falls back to the description when there is no error object", () => {
    toastError("Could not open the file manager", undefined, "no handler for xdg-open");
    expect(toasts()[0].description).toBe("no handler for xdg-open");
  });

  it("leaves the description out rather than printing a dangling dash", () => {
    toastError("Could not launch the game", { code: "IO", message: "" }, undefined, "");
    expect(toasts()[0].description).toBeUndefined();

    toastError("Could not launch the game");
    expect(toasts()[1].description).toBeUndefined();
  });

  it("shows the newest four and drops the rest", () => {
    for (let index = 1; index <= 6; index += 1) toastInfo(`message ${index}`);

    expect(titles()).toEqual(["message 3", "message 4", "message 5", "message 6"]);
  });

  it("dismisses one toast without touching the others", () => {
    const first = useToastStore.getState().push({ tone: "info", title: "first" });
    useToastStore.getState().push({ tone: "info", title: "second" });

    useToastStore.getState().dismiss(first);

    expect(titles()).toEqual(["second"]);
    // A dismissed timer must not fire again and take a *new* toast with it.
    useToastStore.getState().push({ tone: "info", title: "third" });
    vi.advanceTimersByTime(20_000);
    expect(titles()).toEqual([]);
  });
});
