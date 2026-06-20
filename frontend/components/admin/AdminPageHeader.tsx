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
    <header className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-1">
        {/* Sitemap / Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {breadcrumb ? (
            breadcrumb
          ) : title !== "Dashboard" ? (
            <>
              <Link href="/admin" className="hover:text-foreground transition-colors">
                Dashboard
              </Link>
              <span className="text-muted-foreground/60">&gt;</span>
              <span className="font-medium text-foreground">{title}</span>
            </>
          ) : (
            <span className="font-medium text-foreground">Dashboard</span>
          )}
        </div>

        {/* Description */}
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {/* Date picker + Export bar or extra actions */}
      {(range && onRangeChange) || actions ? (
        <div className="flex flex-row flex-wrap items-center gap-3">
          {range && onRangeChange ? (
            <div className="flex flex-row items-center gap-2">
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
                className="flex h-[38px] shrink-0 items-center gap-2 rounded-md border border-border/50 bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/50 disabled:opacity-50"
                disabled={exporting}
                onClick={() => void handleExport()}
                aria-label={exporting ? "Exporting" : "Export data"}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Download className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="hidden sm:inline">{exporting ? "Exporting…" : "Export"}</span>
                <span className="inline sm:hidden">{exporting ? "..." : "Export"}</span>
              </button>
            </div>
          ) : null}

          {/* Extra actions row */}
          {actions ? (
            <div className="flex flex-row items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
