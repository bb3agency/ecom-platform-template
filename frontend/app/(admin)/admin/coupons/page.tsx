"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminCouponsPageContent } from "@/components/admin/AdminCouponsList";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import {
  Tag,
  CheckCircle2,
  Clock,
  DollarSign,
  ClipboardList,
} from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import {
  buildAdminQuery,
  coercePaginatedResponse,
  fetchAllPaginatedItems,
  type PaginatedResponse,
  type AdminCouponListItem,
  type AdminCouponAnalyticsItem,
} from "@/lib/admin-api";
import {
  defaultDateRange,
  rangeToISO,
  type DateRange,
} from "@/components/admin/AdminDateRangePicker";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { useAdminShell } from "@/contexts/admin-shell-context";
import { formatPaise } from "@/lib/admin-format";

// ---------- KPI card ----------

function KpiCard({
  label,
  value,
  icon,
  iconBg,
  loading,
  description,
  trend,
  trendUp,
  trendLabel,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
  loading: boolean;
  description?: string;
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
      ) : !loading && description ? (
        <p className="mt-3 text-[9px] sm:text-[11px] text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

// ---------- KPI data component ----------

interface CouponCounts {
  total: number;
  active: number;
  expired: number;
  totalUses: number;
  totalDiscountPaise: number;
}

interface AdminCouponsKpisProps {
  from: string;
  to: string;
}

function AdminCouponsKpis({ from, to }: AdminCouponsKpisProps) {
  const api = useAuthenticatedApi();
  const [counts, setCounts] = useState<CouponCounts | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { fromISO, toISO } = rangeToISO(from, to);

      const analyticsQuery = buildAdminQuery({
        from: fromISO,
        to: toISO,
      });

      // Total/Active/Expired are POINT-IN-TIME counts — never date-filtered.
      // The backend's from/to filters coupons by createdAt, so scoping these
      // to the page range made every coupon created before the window (still
      // active!) disappear from the KPIs. Only usage analytics are range-scoped.
      const [allRes, activeRes, expiredRes, analyticsItems] = await Promise.all([
        api<PaginatedResponse<AdminCouponListItem>>(`/admin/coupons?page=1&limit=1`),
        api<PaginatedResponse<AdminCouponListItem>>(`/admin/coupons?page=1&limit=1&status=active`),
        api<PaginatedResponse<AdminCouponListItem>>(`/admin/coupons?page=1&limit=1&status=expired`),
        fetchAllPaginatedItems<AdminCouponAnalyticsItem>(async (page, limit) =>
          coercePaginatedResponse<AdminCouponAnalyticsItem>(
            await api<PaginatedResponse<AdminCouponAnalyticsItem>>(
              `/admin/coupons/analytics${analyticsQuery}&page=${page}&limit=${limit}`,
            ),
          ),
        ),
      ]);

      const totalUses = analyticsItems.reduce((sum, row) => sum + row.usesCount, 0);
      const totalDiscountPaise = analyticsItems.reduce(
        (sum, row) => sum + row.totalDiscountPaise,
        0,
      );

      setCounts({
        total: coercePaginatedResponse(allRes).meta.total,
        active: coercePaginatedResponse(activeRes).meta.total,
        expired: coercePaginatedResponse(expiredRes).meta.total,
        totalUses,
        totalDiscountPaise,
      });
    } catch {
      // Non-fatal — the list below still loads independently
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["coupons", "dashboard"]);

  const fmt = (n: number | undefined) =>
    n !== undefined ? n.toLocaleString("en-IN") : "—";

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
      <KpiCard
        label="Total Coupons"
        value={fmt(counts?.total)}
        icon={<Tag className="h-5 w-5 text-emerald-600" />}
        iconBg="bg-emerald-100"
        loading={loading}
        description="All time"
      />
      <KpiCard
        label="Active Coupons"
        value={fmt(counts?.active)}
        icon={<CheckCircle2 className="h-5 w-5 text-blue-600" />}
        iconBg="bg-blue-100"
        loading={loading}
        description="Currently live"
      />
      <KpiCard
        label="Total Uses"
        value={fmt(counts?.totalUses)}
        icon={<Clock className="h-5 w-5 text-purple-600" />}
        iconBg="bg-purple-100"
        loading={loading}
        description="In selected period"
      />
      <KpiCard
        label="Total Discounts"
        value={
          counts ? formatPaise(counts.totalDiscountPaise) : "—"
        }
        icon={<DollarSign className="h-5 w-5 text-amber-600" />}
        iconBg="bg-amber-100"
        loading={loading}
        description="In selected period"
      />
      <KpiCard
        label="Avg. Discount / Use"
        value={
          counts && counts.totalUses > 0
            ? formatPaise(Math.round(counts.totalDiscountPaise / counts.totalUses))
            : "—"
        }
        icon={<ClipboardList className="h-5 w-5 text-rose-600" />}
        iconBg="bg-rose-100"
        loading={loading}
        description="In selected period"
      />
    </div>
  );
}

// ---------- Page ----------

export default function AdminCouponsPage() {
  const [range, setRange] = useState<DateRange>(defaultDateRange);
  const { registerExportHandler } = useAdminShell();
  const [exporting, setExporting] = useState(false);
  const api = useAuthenticatedApi();

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Export ALL coupons — the backend from/to filter is on createdAt, so a
      // range-scoped export silently dropped every older (still active) coupon.
      const items = await fetchAllPaginatedItems<AdminCouponListItem>(
        (page, limit) =>
          api<PaginatedResponse<AdminCouponListItem>>(
            `/admin/coupons${buildAdminQuery({ page, limit })}`,
          ),
      );

      const header = "code,type,value,usesCount,status,validFrom,validUntil";
      const rows = items.map((c) =>
        [
          `"${c.code.replace(/"/g, '""')}"`,
          c.type,
          c.value,
          c.usesCount,
          c.status,
          c.validFrom,
          c.validUntil ?? "",
        ].join(","),
      );
      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `coupons-all-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // silently fail — user can retry
    } finally {
      setExporting(false);
    }
  }, [exporting, api]);

  useEffect(() => {
    return registerExportHandler(() => void handleExport());
  }, [registerExportHandler, handleExport]);

  return (
    <div className="flex flex-col gap-6 min-w-0">
      <AdminPageHeader
        title="Coupons"
        range={range}
        onRangeChange={setRange}
      />

      <AdminCouponsKpis from={range.from} to={range.to} />

      <AdminCouponsPageContent from={range.from} to={range.to} />
    </div>
  );
}
