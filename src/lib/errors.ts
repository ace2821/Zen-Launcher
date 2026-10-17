import type { AppError, AppErrorCode } from "./types";

/**
 * Client-side error code.
 *
 * The M1 contract only defines the codes the Rust core returns. The UI also has
 * to describe failures that never cross the IPC boundary (plugin calls such as
 * the directory dialog, JS exceptions, unserializable rejections), so `UNKNOWN`
 * exists purely as a UI fallback. It is never sent to the core.
 * Contract gap — recorded in `docs/reports/M1-frontend.md` (§ Różnice).
 */
export type UiErrorCode = AppErrorCode | "UNKNOWN";

export interface UiAppError {
  code: UiErrorCode;
  message: string;
}

export const APP_ERROR_CODES: readonly AppErrorCode[] = [
  "NOT_FOUND",
  "IO",
  "DB",
  "VALIDATION",
  "LAUNCH_FAILED",
  "UNSUPPORTED",
];

const ALL_CODES = new Set<string>([...APP_ERROR_CODES, "UNKNOWN"]);

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === "string" &&
    (APP_ERROR_CODES as readonly string[]).includes(candidate.code) &&
    typeof candidate.message === "string"
  );
}

export function isUiAppError(value: unknown): value is UiAppError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === "string" &&
    ALL_CODES.has(candidate.code) &&
    typeof candidate.message === "string"
  );
}

/** Normalizes anything a rejected promise can carry into a `UiAppError`. */
export function toUiError(
  value: unknown,
  fallbackMessage = "Unexpected error",
): UiAppError {
  if (isAppError(value)) return value;
  if (isUiAppError(value)) return value;
  if (value instanceof Error) {
    return { code: "UNKNOWN", message: value.message || fallbackMessage };
  }
  if (typeof value === "string" && value.length > 0) {
    return { code: "UNKNOWN", message: value };
  }
  if (typeof value === "object" && value !== null) {
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") {
        return { code: "UNKNOWN", message: serialized };
      }
    } catch {
      // Circular or otherwise unserializable — fall through to the default.
    }
  }
  return { code: "UNKNOWN", message: fallbackMessage };
}

/** Factory for the mock adapter and for UI-side validation failures. */
export function uiError(code: UiErrorCode, message: string): UiAppError {
  return { code, message };
}
