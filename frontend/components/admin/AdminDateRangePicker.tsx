"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

interface AdminDateRangePickerProps {
  from: string;
  to: string;
  onChange: (range: DateRange) => void;
  className?: string;
  /** Stretch trigger to container width (mobile page header). */
  fullWidth?: boolean;
  /** Desktop dropdown alignment (mobile always uses bottom sheet). */
  menuAlign?: "start" | "end";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Start of the "All time" range. Earlier than any store on the platform. */
export const ALL_TIME_FROM = "2020-01-01";

const QUICK = [
  { label: "Today",       days: 0  },
  { label: "Last 7 days", days: 6  },
  { label: "Last 30 days",days: 29 },
  { label: "Last 90 days",days: 89 },
  { label: "All time",    days: -1 },
] as const;

function buildRange(days: number): DateRange {
  if (days < 0) return allTimeRange();
  const to   = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
}

/** Everything up to today — used by "needs attention" links so counts match the list. */
export function allTimeRange(): DateRange {
  return { from: ALL_TIME_FROM, to: localISODate(new Date()) };
}

export function isAllTimeRange(from: string): boolean {
  return from === ALL_TIME_FROM;
}

function localISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Human label for the current range, e.g. "29 May 2026 – 4 Jun 2026" */
export function rangeLabel(from: string, to: string): string {
  if (isAllTimeRange(from)) return "All time";
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

/** How many days the range spans */
export function spanDays(from: string, to: string): number {
  return (
    Math.round(
      (new Date(to + "T00:00:00").getTime() -
        new Date(from + "T00:00:00").getTime()) /
        86_400_000,
    ) + 1
  );
}

/** Dynamic label for KPI trend footer, e.g. "vs prev 7 days" */
export function trendPeriodLabel(from: string, to: string): string {
  if (isAllTimeRange(from)) return "";
  const n = spanDays(from, to);
  if (n === 1) return "vs yesterday";
  return `vs prev ${n} days`;
}

/** Build the ISO date range for the *previous* window of the same length */
export function prevRange(from: string, to: string): { from: string; to: string } {
  const n    = spanDays(from, to);
  const prevTo   = new Date(from + "T00:00:00");
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (n - 1));
  return {
    from: prevFrom.toISOString(),
    to:   prevTo.toISOString(),
  };
}

/** ISO datetime strings for the selected range (for API calls) */
export function rangeToISO(from: string, to: string) {
  return {
    fromISO: new Date(from + "T00:00:00").toISOString(),
    toISO:   new Date(to   + "T23:59:59").toISOString(),
  };
}

/** Default — last 7 days */
export function defaultDateRange(): DateRange {
  return buildRange(6);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdminDateRangePicker({
  from,
  to,
  onChange,
  className,
  fullWidth = false,
  menuAlign = "end",
}: AdminDateRangePickerProps) {
  const [open,    setOpen]    = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo,   setDraftTo]   = useState(to);

  function applyQuick(days: number) {
    const r = buildRange(days);
    onChange(r);
    setOpen(false);
  }

  function applyCustom() {
    if (!draftFrom || !draftTo || draftFrom > draftTo) return;
    onChange({ from: draftFrom, to: draftTo });
    setOpen(false);
  }

  function handleOpen() {
    setDraftFrom(from);
    setDraftTo(to);
    setOpen((v) => !v);
  }

  return (
    <div
      className={cn(
        "relative max-w-full",
        fullWidth ? "w-full" : "w-auto",
        className,
      )}
    >
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          "flex h-9 min-w-0 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50",
          fullWidth ? "w-full" : "w-auto max-w-xs",
        )}
      >
        <Calendar className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span
          className={cn(
            "min-w-0 truncate text-left",
            fullWidth && "flex-1",
          )}
        >
          {rangeLabel(from, to)}
        </span>
        <svg
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-foreground/20 sm:bg-transparent"
            onClick={() => setOpen(false)}
          />
          {/* Dropdown — anchored dropdown on all screen sizes */}
          <div
            className={cn(
              // Phones: bottom sheet (an anchored menu can run off-screen). sm+: anchored dropdown.
              "fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-2xl border border-border bg-popover console-tabbar shadow-xl",
              "sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:w-72 sm:rounded-xl",
              menuAlign === "start" ? "sm:left-0" : "sm:right-0",
            )}
          >
            {/* Quick ranges */}
            <div className="border-b border-border p-4 sm:p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Quick ranges
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {QUICK.map((q) => {
                  const r       = buildRange(q.days);
                  const isActive = r.from === from && r.to === to;
                  return (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => applyQuick(q.days)}
                      className={cn(
                        "min-h-9 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground hover:bg-muted/70",
                      )}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom range */}
            <div className="p-4 sm:p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Custom range
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">From</span>
                  <input
                    type="date"
                    value={draftFrom}
                    max={draftTo}
                    onChange={(e) => setDraftFrom(e.target.value)}
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">To</span>
                  <input
                    type="date"
                    value={draftTo}
                    min={draftFrom}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDraftTo(e.target.value)}
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  />
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="lg"
                  className="flex-1"
                  disabled={!draftFrom || !draftTo || draftFrom > draftTo}
                  onClick={applyCustom}
                >
                  Apply
                </Button>
                <Button size="lg" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
