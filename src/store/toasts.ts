import { create } from "zustand";
import type { UiAppError } from "../lib/errors";

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Contract error code, shown as a quiet tag so reports stay traceable. */
  code?: string;
}

const MAX_VISIBLE = 4;
const SUCCESS_MS = 4_500;
const ERROR_MS = 8_000;

const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

interface ToastState {
  toasts: Toast[];
  push(input: Omit<Toast, "id">, durationMs?: number): number;
  dismiss(id: number): void;
  clear(): void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push(input, durationMs) {
    const id = nextId++;
    const lifetime = durationMs ?? (input.tone === "error" ? ERROR_MS : SUCCESS_MS);
    set((state) => ({ toasts: [...state.toasts, { ...input, id }].slice(-MAX_VISIBLE) }));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        get().dismiss(id);
      }, lifetime),
    );
    return id;
  },

  dismiss(id) {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  clear() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    set({ toasts: [] });
  },
}));

export function toastSuccess(title: string, description?: string): void {
  useToastStore.getState().push({ tone: "success", title, description });
}

export function toastInfo(title: string, description?: string): void {
  useToastStore.getState().push({ tone: "info", title, description });
}

/**
 * Surfaces an `AppError` from the core: localized title from the view, verbatim
 * message from the core, plus the contract code as a tag.
 *
 * `note` is the view's own context for a failure the core cannot know about —
 * e.g. which validation rules were in force when a mod archive was refused. It is
 * appended, so the core's message is never replaced or reworded.
 */
export function toastError(
  title: string,
  error?: UiAppError,
  description?: string,
  note?: string,
): void {
  const body = [error?.message ?? description, note]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" — ");
  useToastStore.getState().push({
    tone: "error",
    title,
    description: body.length > 0 ? body : undefined,
    code: error?.code,
  });
}

/** Test helper — also usable if the app ever needs a hard reset. */
export function resetToasts(): void {
  useToastStore.getState().clear();
}
