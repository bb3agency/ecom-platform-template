"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminOrdersList } from "@/components/admin/AdminOrdersList";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import {
  coercePaginatedResponse,
  type AdminOrderListItem,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { ShoppingBag, Box, Clock, XCircle } from "lucide-react";
import {
  defaultDateRange,
  trendPeriodLabel,
  prevRange,
  rangeToISO,
  type DateRange,
} from "@/components/admin/AdminDateRangePicker";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

interface OrderCounts {
  total: number;
  delivered: number;
  processing: number;
  cancelled: number;
}

interface TrendInfo {
  value: string;
  up: boolean;
}

function calcTrend(current: number, previous: number): TrendInfo | null {
  if (!previous) return null;
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(pct) * 10) / 10;
  return { value: `${pct >= 0 ? "+" : "-"}${rounded}%`, up: pct >= 0 };
}

function KpiCard({
  label,
  value,
  icon,
  iconBg,
  loading,
  trend,
  trendUp,
  trendLabel,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
  loading: boolean;
  trend?: string;
  trendUp?: boolean;
  trendLabel?: string;
}) {
  return (
    <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
      <div className="flex items-center gap-3 sm:gap-4">
        <div
          className={`flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl ${iconBg}`}
        >
          {icon}
        </div>
        <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
          <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">{label}</p>
          {loading ? (
            <div className="h-6 sm:h-7 w-16 sm:w-24 animate-pulse rounded bg-muted" />
          ) : (
            <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
              {value}
            </p>
          )}
        </div>
      </div>
      {!loading && trend !== undefined ? (
        <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
          {trendUp ? (
            <svg
              className="h-3 w-3 text-emerald-500"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              className="h-3 w-3 text-rose-500"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          )}
          <span className={trendUp ? "text-emerald-600" : "text-rose-600"}>
            {trend}
          </span>
          <span className="text-muted-foreground">
            {trendLabel ?? "vs prev period"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

interface AdminOrdersKpisProps {
  from: string;
  to: string;
  trendLabel: string;
}

function AdminOrdersKpis({ from, to, trendLabel }: AdminOrdersKpisProps) {
  const api = useAuthenticatedApi();
  const [counts, setCounts] = useState<OrderCounts | null>(null);
  const [prevCounts, setPrevCounts] = useState<OrderCounts | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { fromISO, toISO } = rangeToISO(from, to);
      const prev = prevRange(from, to);

      const [
        allRes,
        deliveredRes,
        processingRes,
        cancelledRes,
        prevAllRes,
        prevDeliveredRes,
        prevProcessingRes,
        prevCancelledRes,
      ] = await Promise.all([
        api<PaginatedResponse<AdminOrderListItem>>(
          `/admin/orders?page=1&limit=1&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
        ),
        api<PaginatedResponse<AdminOrderListItem>>(
          `/admin/orders?page=1&limit=1&status=DELIVERED&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
        ),
        api<PaginatedResponse<AdminOrderListItem>>(
          `/admin/orders?page=1&limit=1&status=PROCESSING&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
        ),
        api<PaginatedResponse<AdminOrderListItem>>(
          `/admin/orders?page=1&limit=1&status=CANCELLED&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
        ),
        api<PaginatedResponse<AdminOrderListItem>>(
          `/admin/orders?page=1&limit=1&from=${encodeURIComponent(prev.from)}&to=${encodeURIComponent(prev.to)}`,
        ),
        api<PaginatedResponse<AdminOrderListItem>>(
          `/admin/orders?page=1&limit=1&status=DELIVERED&from=${encodeURIComponent(prev.from)}&to=${encodeURIComponent(prev.to)}`,
        ),
        api<PaginatedResponse<AdminOrderListItem>>(
          `/admin/orders?page=1&limit=1&status=PROCESSING&from=${encodeURIComponent(prev.from)}&to=${encodeURIComponent(prev.to)}`,
        ),
        api<PaginatedResponse<AdminOrderListItem>>(
          `/admin/orders?page=1&limit=1&status=CANCELLED&from=${encodeURIComponent(prev.from)}&to=${encodeURIComponent(prev.to)}`,
        ),
      ]);

      const cur: OrderCounts = {
        total: coercePaginatedResponse(allRes).meta.total,
        delivered: coercePaginatedResponse(deliveredRes).meta.total,
        processing: coercePaginatedResponse(processingRes).meta.total,
        cancelled: coercePaginatedResponse(cancelledRes).meta.total,
      };
      const prv: OrderCounts = {
        total: coercePaginatedResponse(prevAllRes).meta.total,
        delivered: coercePaginatedResponse(prevDeliveredRes).meta.total,
        processing: coercePaginatedResponse(prevProcessingRes).meta.total,
        cancelled: coercePaginatedResponse(prevCancelledRes).meta.total,
      };

      setCounts(cur);
      setPrevCounts(prv);
    } catch {
      // Non-fatal — the list below still loads independently
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["orders", "dashboard"]);

  const fmt = (n: number | undefined) =>
    n !== undefined ? n.toLocaleString("en-IN") : "—";

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <KpiCard
        label="Total Orders"
        value={fmt(counts?.total)}
        icon={<ShoppingBag className="h-5 w-5 text-emerald-600" />}
        iconBg="bg-emerald-100"
        loading={loading}
        trend={
          counts && prevCounts
            ? calcTrend(counts.total, prevCounts.total)?.value
            : undefined
        }
        trendUp={
          counts && prevCounts
            ? calcTrend(counts.total, prevCounts.total)?.up
            : undefined
        }
        trendLabel={trendLabel}
      />
      <KpiCard
        label="Completed Orders"
        value={fmt(counts?.delivered)}
        icon={<Box className="h-5 w-5 text-blue-600" />}
        iconBg="bg-blue-100"
        loading={loading}
        trend={
          counts && prevCounts
            ? calcTrend(counts.delivered, prevCounts.delivered)?.value
            : undefined
        }
        trendUp={
          counts && prevCounts
            ? calcTrend(counts.delivered, prevCounts.delivered)?.up
            : undefined
        }
        trendLabel={trendLabel}
      />
      <KpiCard
        label="Processing Orders"
        value={fmt(counts?.processing)}
        icon={<Clock className="h-5 w-5 text-purple-600" />}
        iconBg="bg-purple-100"
        loading={loading}
        trend={
          counts && prevCounts
            ? calcTrend(counts.processing, prevCounts.processing)?.value
            : undefined
        }
        trendUp={
          counts && prevCounts
            ? calcTrend(counts.processing, prevCounts.processing)?.up
            : undefined
        }
        trendLabel={trendLabel}
      />
      <KpiCard
        label="Cancelled Orders"
        value={fmt(counts?.cancelled)}
        icon={<XCircle className="h-5 w-5 text-amber-600" />}
        iconBg="bg-amber-100"
        loading={loading}
        trend={
          counts && prevCounts
            ? calcTrend(counts.cancelled, prevCounts.cancelled)?.value
            : undefined
        }
        trendUp={
          counts && prevCounts
            ? calcTrend(counts.cancelled, prevCounts.cancelled)?.up
            : undefined
        }
        trendLabel={trendLabel}
      />
    </div>
  );
}

export default function AdminOrdersPage() {
  const [range, setRange] = useState<DateRange>(defaultDateRange);
  const trendLabel = trendPeriodLabel(range.from, range.to);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Orders"
        range={range}
        onRangeChange={setRange}
        actions={
          <Link href="/admin/orders/board" className="inline-block">
            <button
              type="button"
              className="h-9 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              Open Board View
            </button>
          </Link>
        }
      />

      <AdminOrdersKpis
        from={range.from}
        to={range.to}
        trendLabel={trendLabel}
      />

      <AdminOrdersList from={range.from} to={range.to} />
    </div>
  );
}
