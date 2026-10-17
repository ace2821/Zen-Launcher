import { create } from "zustand";

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: "default" | "danger";
  /** Extra reassurance line, e.g. the "files stay on disk" guarantee. */
  note?: string;
}

interface PendingConfirm extends ConfirmRequest {
  id: number;
  resolve(value: boolean): void;
}

interface ConfirmState {
  current: PendingConfirm | null;
  ask(request: ConfirmRequest): Promise<boolean>;
  settle(value: boolean): void;
}

let nextId = 1;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  current: null,

  ask(request) {
    return new Promise<boolean>((resolve) => {
      set({ current: { ...request, id: nextId++, resolve } });
    });
  },

  settle(value) {
    const { current } = get();
    if (!current) return;
    set({ current: null });
    current.resolve(value);
  },
}));

/** Imperative confirmation: `if (await confirmDialog({...})) { … }`. */
export function confirmDialog(request: ConfirmRequest): Promise<boolean> {
  return useConfirmStore.getState().ask(request);
}

export function resetConfirm(): void {
  useConfirmStore.setState({ current: null });
}
