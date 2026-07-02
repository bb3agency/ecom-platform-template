"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { useToastStore, type ToastVariant } from "@/stores/toast";
import { cn } from "@/lib/utils";

// Fixed status colours (intentionally brand-independent — success is always green, errors red, etc.,
// regardless of each client's theme). Kept minimal so the popup reads instantly at a glance.
const VARIANT_STYLES: Record<
  ToastVariant,
  { container: string; icon: string; Icon: typeof CheckCircle2 }
> = {
  success: {
    container: "border-green-200 bg-green-50 text-green-900",
    icon: "text-green-600",
    Icon: CheckCircle2,
  },
  error: {
    container: "border-red-200 bg-red-50 text-red-900",
    icon: "text-red-600",
    Icon: XCircle,
  },
  warning: {
    container: "border-amber-200 bg-amber-50 text-amber-900",
    icon: "text-amber-600",
    Icon: AlertTriangle,
  },
  info: {
    container: "border-sky-200 bg-sky-50 text-sky-900",
    icon: "text-sky-600",
    Icon: Info,
  },
};

/**
 * Global toast renderer. Mount ONCE in the root layout. Renders a viewport-aware popup stack
 * at the TOP-RIGHT of the screen that auto-dismisses (~3s, driven by the store):
 *  - mobile: spans the top with safe-area insets, compact text/padding for narrow screens;
 *  - desktop: a fixed ~440px column anchored top-right with slightly larger text/padding so
 *    it's clearly visible on big screens.
 * Announced to screen readers via an aria-live region; honours prefers-reduced-motion.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-[100] flex flex-col gap-2",
        // Top-right on every viewport; spans the top on mobile, fixed wider column on desktop.
        "top-[max(1rem,env(safe-area-inset-top))] left-4 right-4",
        "sm:top-6 sm:right-6 sm:left-auto sm:w-[440px]",
      )}
      role="region"
      aria-label="Notifications"
    >
      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {toasts.map((t) => (
          <span key={t.id}>{t.title ? `${t.title}: ${t.message}` : t.message}</span>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const styles = VARIANT_STYLES[t.variant];
          const Icon = styles.Icon;
          return (
            <motion.div
              key={t.id}
              layout={!reduceMotion}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.98 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.98 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-xl border p-3 shadow-lg backdrop-blur-sm sm:gap-3 sm:p-4",
                styles.container,
              )}
              role="status"
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0 sm:size-5", styles.icon)} aria-hidden />
              <div className="min-w-0 flex-1">
                {t.title ? (
                  <p className="text-[13px] font-bold leading-tight sm:text-[15px]">{t.title}</p>
                ) : null}
                <p
                  className={cn(
                    "break-words text-xs leading-snug sm:text-[15px] sm:leading-normal",
                    t.title ? "mt-0.5 opacity-90" : "font-medium",
                  )}
                >
                  {t.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="-m-1 shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                <X className="size-3.5 sm:size-4" aria-hidden />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
