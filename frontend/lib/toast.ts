"use client";

import { useToastStore, type ToastVariant } from "@/stores/toast";

interface ToastOptions {
  title?: string;
  duration?: number;
}

function show(variant: ToastVariant, message: string, options?: ToastOptions): string {
  return useToastStore.getState().push({
    variant,
    message,
    ...(options?.title ? { title: options.title } : {}),
    ...(options?.duration !== undefined ? { duration: options.duration } : {}),
  });
}

/**
 * Fire-and-forget toast helpers usable from anywhere (event handlers, catch blocks,
 * server-action callers). Renders via the globally-mounted <Toaster/> — a small,
 * viewport-aware popup on the left that auto-dismisses in ~3s.
 *
 * Prefer these over the big top-of-page inline banners for transient feedback:
 *   toast.success("Product saved");
 *   toast.error(getApiErrorMessage(err));
 */
export const toast = {
  success: (message: string, options?: ToastOptions) => show("success", message, options),
  error: (message: string, options?: ToastOptions) => show("error", message, options),
  info: (message: string, options?: ToastOptions) => show("info", message, options),
  warning: (message: string, options?: ToastOptions) => show("warning", message, options),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};
