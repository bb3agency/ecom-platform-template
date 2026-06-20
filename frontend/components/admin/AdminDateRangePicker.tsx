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

const QUICK = [
  { label: "Today",       days: 0  },
  { label: "Last 7 days", days: 6  },
  { label: "Last 30 days",days: 29 },
  { label: "Last 90 days",days: 89 },
] as const;

function buildRange(days: number): DateRange {
  const to   = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
}

/** Human label for the current range, e.g. "29 May 2026 – 4 Jun 2026" */
export function rangeLabel(from: string, to: string): string {
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
          "flex min-w-0 items-center gap-2 rounded-md border border-border/50 bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/50",
          fullWidth ? "w-full" : "w-auto max-w-[min(100vw-1.5rem,20rem)]",
        )}
      >
        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "min-w-0 truncate text-left",
            fullWidth && "flex-1",
          )}
        >
          {rangeLabel(from, to)}
        </span>
        <svg
          className="h-3.5 w-3.5 text-muted-foreground"
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
            className="fixed inset-0 z-[55]"
            onClick={() => setOpen(false)}
          />
          {/* Dropdown — anchored dropdown on all screen sizes */}
          <div
            className={cn(
              "absolute top-full mt-2 z-[60] max-h-[min(70vh,22rem)] overflow-y-auto rounded-xl border border-border/50 bg-card shadow-xl w-72 sm:max-h-none",
              menuAlign === "start"
                ? "left-0 right-auto"
                : "right-0 left-auto",
            )}
          >
            {/* Quick ranges */}
            <div className="border-b border-border/30 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                        "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                        isActive
                          ? "bg-zinc-900 text-white"
                          : "bg-muted/50 text-foreground hover:bg-muted",
                      )}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom range */}
            <div className="p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Custom range
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium text-muted-foreground">From</span>
                  <input
                    type="date"
                    value={draftFrom}
                    max={draftTo}
                    onChange={(e) => setDraftFrom(e.target.value)}
                    className="h-8 rounded-md border border-border/50 bg-background px-2 text-xs focus:border-zinc-900 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium text-muted-foreground">To</span>
                  <input
                    type="date"
                    value={draftTo}
                    min={draftFrom}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDraftTo(e.target.value)}
                    className="h-8 rounded-md border border-border/50 bg-background px-2 text-xs focus:border-zinc-900 focus:outline-none"
                  />
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 h-8 bg-zinc-900 hover:bg-zinc-800 text-white text-xs"
                  disabled={!draftFrom || !draftTo || draftFrom > draftTo}
                  onClick={applyCustom}
                >
                  Apply
                </Button>
                <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => setOpen(false)}>
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
