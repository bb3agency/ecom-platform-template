"use client";

/**
 * Ops-only building blocks. Layout, tables, status and notices come from the
 * shared console kit (`@/components/ui/console`); this file only holds what the
 * ops screens need on top of it: a labelled form field, a code block, error and
 * read-only notices, and a countdown hook for OTP/maintenance timers.
 */

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Lock, RefreshCw } from "lucide-react";
import { Notice } from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Portalled surfaces ──────────────────────────────────────────────────────

/**
 * Dialogs, sheets and menus portal to <body>, outside the shell's token scope,
 * so they re-apply it. Width utilities on them need `!`: older client
 * globals.css files carry an unlayered `.ops-console { max-width: 100% }`
 * that otherwise beats Tailwind's (layered) max-width classes.
 */
export const OPS_POPUP_CLASS = "console-theme ops-console";
export const OPS_SIDE_SHEET_CLASS = "console-theme ops-console max-w-md!";

// ─── Form field ──────────────────────────────────────────────────────────────

interface OpsFieldProps {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  /** Marks the field optional in its label (most ops fields are required). */
  optional?: boolean;
  children: ReactNode;
  className?: string;
}

/** Top-aligned label, helper text under the label, error under the control. */
export function OpsField({ label, htmlFor, hint, error, optional, children, className }: OpsFieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** ids to pass as `aria-describedby` on the control inside an OpsField. */
export function opsFieldDescribedBy(htmlFor: string, hasHint: boolean, hasError: boolean): string | undefined {
  const ids = [hasHint ? `${htmlFor}-hint` : null, hasError ? `${htmlFor}-error` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

// ─── Feedback ────────────────────────────────────────────────────────────────

/** A failed load, with a way to try again. */
export function OpsLoadError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Notice
      tone="danger"
      icon={AlertTriangle}
      title="Couldn't load this"
      className={className}
      action={
        onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
            <RefreshCw aria-hidden />
            Try again
          </Button>
        ) : undefined
      }
    >
      {message}
    </Notice>
  );
}

/** Shown in place of write controls for an `ops:read`-only session. */
export function OpsReadOnlyNotice({ children }: { children: ReactNode }) {
  return (
    <Notice tone="info" icon={Lock} title="View only">
      {children}
    </Notice>
  );
}

/** Generic placeholder lines while a panel loads (matches text rhythm, no spinner). */
export function OpsLinesSkeleton({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          className={cn("h-3.5 animate-pulse rounded bg-muted", i % 3 === 0 ? "w-2/5" : i % 3 === 1 ? "w-4/5" : "w-3/5")}
        />
      ))}
    </div>
  );
}

// ─── Code ────────────────────────────────────────────────────────────────────

/** Monospace block that scrolls inside itself — never widens the page. */
export function OpsCodeBlock({ children, className }: { children: string; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-96 min-w-0 overflow-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground",
        className,
      )}
    >
      {children}
    </pre>
  );
}

// ─── Time ────────────────────────────────────────────────────────────────────

/** Whole seconds until `iso`, ticking once a second. 0 once it has passed; null without a target. */
export function useSecondsUntil(iso: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [iso]);
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

/** 75 → "1:15". */
export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** "3 min ago", "just now", "2 h ago", or a date for older values. */
export function formatRelativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 45) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
