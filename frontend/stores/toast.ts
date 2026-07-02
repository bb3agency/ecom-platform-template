"use client";

import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
  /** Optional short title shown above the message. */
  title?: string;
  /** Auto-dismiss delay in ms. */
  duration: number;
}

export interface ToastInput {
  variant?: ToastVariant;
  message: string;
  title?: string;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** Default auto-dismiss (~3s as requested). */
const DEFAULT_DURATION_MS = 3000;
/** Never stack more than this many at once — oldest is dropped. */
const MAX_VISIBLE = 4;

/** Per-toast timers, kept outside the store so they never trigger re-renders. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string): void {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function makeId(): string {
  return `toast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: ({ variant = "info", message, title, duration = DEFAULT_DURATION_MS }) => {
    const trimmed = message.trim();
    if (!trimmed) return "";

    // Collapse an identical message that's already visible (rapid double-clicks) —
    // refresh its timer instead of stacking a duplicate.
    const existing = get().toasts.find((t) => t.message === trimmed && t.variant === variant);
    if (existing) {
      get().dismiss(existing.id);
    }

    const id = makeId();
    const toast: Toast = { id, variant, message: trimmed, ...(title ? { title } : {}), duration };

    set((state) => {
      const next = [...state.toasts, toast];
      // Drop oldest beyond the cap.
      while (next.length > MAX_VISIBLE) {
        const removed = next.shift();
        if (removed) clearTimer(removed.id);
      }
      return { toasts: next };
    });

    // setTimeout exists in both the browser and Node; this store is "use client" so it only runs
    // on the client in practice. A non-positive duration means "sticky" (no auto-dismiss).
    if (duration > 0) {
      timers.set(
        id,
        setTimeout(() => get().dismiss(id), duration),
      );
    }
    return id;
  },
  dismiss: (id) => {
    clearTimer(id);
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
  clear: () => {
    for (const id of timers.keys()) clearTimer(id);
    set({ toasts: [] });
  },
}));
