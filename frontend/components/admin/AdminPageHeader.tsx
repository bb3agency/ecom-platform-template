"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { AdminDateRangePicker, type DateRange } from "@/components/admin/AdminDateRangePicker";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/console";
import { useAdminShell } from "@/contexts/admin-shell-context";

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  /** Parent trail for detail pages. Top-level pages have none — the nav shows where you are. */
  breadcrumb?: ReactNode;
  range?: DateRange;
  onRangeChange?: (range: DateRange) => void;
  /** Page actions (board view, create…). Sit beside the date range. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Admin page header on the console kit. Title + one-line description on the left;
 * date range, export and page actions on the right (a wrapping row under the title
 * on phones). Kept as a thin adapter so every existing admin page picks up the
 * console design without call-site changes.
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

  function handleExport() {
    setExporting(true);
    try {
      triggerExport();
    } finally {
      window.setTimeout(() => setExporting(false), 800);
    }
  }

  const hasRange = Boolean(range && onRangeChange);

  return (
    <div className={className}>
      {breadcrumb ? <div className="mb-1 text-sm text-muted-foreground">{breadcrumb}</div> : null}
      <PageHeader
        title={title}
        description={description}
        actions={
          hasRange || actions ? (
            <>
              {range && onRangeChange ? (
                <AdminDateRangePicker from={range.from} to={range.to} onChange={onRangeChange} menuAlign="end" />
              ) : null}
              {hasRange ? (
                <Button type="button" variant="outline" size="lg" onClick={handleExport} disabled={exporting} aria-label="Export CSV">
                  {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
                  <span className="sr-only sm:not-sr-only">Export</span>
                </Button>
              ) : null}
              {actions}
            </>
          ) : undefined
        }
      />
    </div>
  );
}
