"use client";

import * as React from "react";
import { ArrowDownRight, ArrowUpRight, MoveRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface KpiTrend {
  /** Percentage delta vs the comparison period, e.g. 12.5 or -4.2. */
  deltaPct: number;
  /** Comparison caption, e.g. "vs last 30 days". */
  caption?: string;
}

interface KpiCardProps extends React.ComponentProps<"div"> {
  label: string;
  /** Pre-formatted metric (₹, counts…). Rendered large. */
  value: React.ReactNode;
  trend?: KpiTrend | null;
  icon?: LucideIcon;
  /** Optional sparkline or mini-chart rendered under the metric. */
  chart?: React.ReactNode;
  loading?: boolean;
}

/**
 * Executive KPI card — small label, large semibold metric, compact trend
 * indicator with comparison caption. Color only on the trend arrow (emerald up,
 * red down, gray flat) — never large color blocks.
 */
export function KpiCard({
  label,
  value,
  trend,
  icon: Icon,
  chart,
  loading,
  className,
  ...props
}: KpiCardProps) {
  return (
    <div
      data-slot="kpi-card"
      className={cn(
        "flex min-w-0 flex-col justify-between rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-sm sm:p-5",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />}
      </div>

      {loading ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded-md bg-muted" />
      ) : (
        <p className="mt-1.5 truncate font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {value}
        </p>
      )}

      {trend && !loading ? <KpiTrendLine trend={trend} /> : null}
      {chart ? <div className="mt-2 -mb-1">{chart}</div> : null}
    </div>
  );
}

export function KpiTrendLine({ trend }: { trend: KpiTrend }) {
  const { deltaPct, caption } = trend;
  const flat = Math.abs(deltaPct) < 0.05;
  const up = deltaPct > 0;
  const Arrow = flat ? MoveRight : up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="mt-1.5 flex items-center gap-1 text-xs">
      <span
        className={cn(
          "flex items-center gap-0.5 font-medium",
          flat ? "text-muted-foreground" : up ? "text-emerald-600" : "text-red-600",
        )}
      >
        <Arrow className="size-3.5" aria-hidden />
        {flat ? "0%" : `${Math.abs(deltaPct).toFixed(1)}%`}
      </span>
      {caption && <span className="truncate text-muted-foreground">{caption}</span>}
    </p>
  );
}
