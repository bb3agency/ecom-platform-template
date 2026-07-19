"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import {
  AdminDateRangePicker,
  type DateRange,
} from "@/components/admin/AdminDateRangePicker";
import { useAdminShell } from "@/contexts/admin-shell-context";
import { Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  breadcrumb?: ReactNode;
  range?: DateRange;
  onRangeChange?: (range: DateRange) => void;
  /** Extra actions (board link, etc.) — shown below the date bar */
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard admin page header.
 *
 * Mobile:  date picker (left) + Export button (right) — single row
 * Desktop: title (left) + date picker + Export (right)
 */
export function AdminPageHeader({
  title,
  description,
  breadcrumb,
  range,
  onRangeChange,
  actions,
  className,
}: AdminPageHeaderProps) {
  const { triggerExport } = useAdminShell();
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      triggerExport();
    } finally {
      setTimeout(() => setExporting(false), 800);
    }
  }

  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {/* Title block: page title above, breadcrumb below — identical on every page. */}
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {/* Breadcrumb: Home / Page, muted with the current page slightly darker. */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {breadcrumb ? (
            breadcrumb
          ) : title !== "Dashboard" ? (
            <>
              <Link href="/admin" className="transition-colors hover:text-foreground">
                Home
              </Link>
              <span className="text-muted-foreground/50">/</span>
              <span className="font-medium text-foreground/80">{title}</span>
            </>
          ) : (
            <>
              <span>Home</span>
              <span className="text-muted-foreground/50">/</span>
              <span className="font-medium text-foreground/80">Dashboard</span>
            </>
          )}
        </div>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {/* Action bar: date range + Export on the left, page actions on the right.
          Positions are fixed so controls never move between pages. */}
      {(range && onRangeChange) || actions ? (
        <div className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-row items-center gap-2">
            {range && onRangeChange ? (
              <>
                <div className="min-w-0">
                  <AdminDateRangePicker
                    from={range.from}
                    to={range.to}
                    onChange={onRangeChange}
                    menuAlign="start"
                  />
                </div>
                <button
                  type="button"
                  className="flex h-[38px] shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/50 disabled:opacity-50"
                  disabled={exporting}
                  onClick={() => void handleExport()}
                  aria-label={exporting ? "Exporting" : "Export data"}
                >
                  {exporting ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Download className="size-4 text-muted-foreground" />
                  )}
                  <span className="hidden sm:inline">{exporting ? "Exporting…" : "Export"}</span>
                  <span className="inline sm:hidden">{exporting ? "..." : "Export"}</span>
                </button>
              </>
            ) : null}
          </div>

          {actions ? (
            <div className="flex flex-row items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
