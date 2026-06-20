"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminPaymentsList } from "@/components/admin/AdminPaymentsList";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import {
  CreditCard,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import {
  buildAdminQuery,
  coercePaginatedResponse,
  fetchAllPaginatedItems,
  toIsoDateRange,
  type PaginatedResponse,
  type AdminPaymentListItem,
} from "@/lib/admin-api";
import {
  defaultDateRange,
  trendPeriodLabel,
  prevRange,
  rangeToISO,
  type DateRange,
} from "@/components/admin/AdminDateRangePicker";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { useAdminShell } from "@/contexts/admin-shell-context";

// ---------- trend calc ----------

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

// ---------- KPI card ----------

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

// ---------- KPI data component ----------

interface PaymentCounts {
  total: number;
  captured: number;
  failed: number;
  capturedAmountPaise: number;
}

interface AdminPaymentsKpisProps {
  from: string;
  to: string;
  trendLabel: string;
}

function AdminPaymentsKpis({ from, to, trendLabel }: AdminPaymentsKpisProps) {
  const api = useAuthenticatedApi();
  const [counts, setCounts] = useState<PaymentCounts | null>(null);
  const [prevCounts, setPrevCounts] = useState<PaymentCounts | null>(null);
  const [loading, setLoading] = useState(true);

  const sumCapturedAmount = useCallback(
    async (fromISO: string, toISO: string) => {
      const items = await fetchAllPaginatedItems<AdminPaymentListItem>(
        (page, limit) =>
          api<PaginatedResponse<AdminPaymentListItem>>(
            `/admin/payments${buildAdminQuery({
              page,
              limit,
              status: "CAPTURED",
              from: fromISO,
              to: toISO,
            })}`,
          ),
      );
      return items.reduce((sum, item) => sum + item.amount, 0);
    },
    [api],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { fromISO, toISO } = rangeToISO(from, to);
      const prev = prevRange(from, to);

      const [
        allRes,
        capturedRes,
        failedRes,
        prevAllRes,
        prevCapturedRes,
        prevFailedRes,
        capturedAmountPaise,
        prevCapturedAmountPaise,
      ] = await Promise.all([
        api<PaginatedResponse<AdminPaymentListItem>>(
          `/admin/payments${buildAdminQuery({
            page: 1,
            limit: 1,
            from: fromISO,
            to: toISO,
          })}`,
        ),
        api<PaginatedResponse<AdminPaymentListItem>>(
          `/admin/payments${buildAdminQuery({
            page: 1,
            limit: 1,
            status: "CAPTURED",
            from: fromISO,
            to: toISO,
          })}`,
        ),
        api<PaginatedResponse<AdminPaymentListItem>>(
          `/admin/payments${buildAdminQuery({
            page: 1,
            limit: 1,
            status: "FAILED",
            from: fromISO,
            to: toISO,
          })}`,
        ),
        api<PaginatedResponse<AdminPaymentListItem>>(
          `/admin/payments${buildAdminQuery({
            page: 1,
            limit: 1,
            from: toIsoDateRange(prev.from),
            to: toIsoDateRange(prev.to, true),
          })}`,
        ),
        api<PaginatedResponse<AdminPaymentListItem>>(
          `/admin/payments${buildAdminQuery({
            page: 1,
            limit: 1,
            status: "CAPTURED",
            from: toIsoDateRange(prev.from),
            to: toIsoDateRange(prev.to, true),
          })}`,
        ),
        api<PaginatedResponse<AdminPaymentListItem>>(
          `/admin/payments${buildAdminQuery({
            page: 1,
            limit: 1,
            status: "FAILED",
            from: toIsoDateRange(prev.from),
            to: toIsoDateRange(prev.to, true),
          })}`,
        ),
        sumCapturedAmount(fromISO, toISO),
        sumCapturedAmount(toIsoDateRange(prev.from), toIsoDateRange(prev.to, true)),
      ]);

      const cur: PaymentCounts = {
        total: coercePaginatedResponse(allRes).meta.total,
        captured: coercePaginatedResponse(capturedRes).meta.total,
        failed: coercePaginatedResponse(failedRes).meta.total,
        capturedAmountPaise,
      };
      const prv: PaymentCounts = {
        total: coercePaginatedResponse(prevAllRes).meta.total,
        captured: coercePaginatedResponse(prevCapturedRes).meta.total,
        failed: coercePaginatedResponse(prevFailedRes).meta.total,
        capturedAmountPaise: prevCapturedAmountPaise,
      };

      setCounts(cur);
      setPrevCounts(prv);
    } catch {
      // Non-fatal — the list below still loads independently
    } finally {
      setLoading(false);
    }
  }, [api, from, to, sumCapturedAmount]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["payments", "dashboard", "orders"]);

  const fmt = (n: number | undefined) =>
    n !== undefined ? n.toLocaleString("en-IN") : "—";

  const trend = (key: keyof PaymentCounts) =>
    counts && prevCounts
      ? calcTrend(counts[key], prevCounts[key])?.value
      : undefined;

  const trendUp = (key: keyof PaymentCounts) =>
    counts && prevCounts
      ? calcTrend(counts[key], prevCounts[key])?.up
      : undefined;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <KpiCard
        label="Total Transactions"
        value={fmt(counts?.total)}
        icon={<CreditCard className="h-5 w-5 text-emerald-600" />}
        iconBg="bg-emerald-100"
        loading={loading}
        trend={trend("total")}
        trendUp={trendUp("total")}
        trendLabel={trendLabel}
      />
      <KpiCard
        label="Captured Amount"
        value={
          counts
            ? `₹${(counts.capturedAmountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "—"
        }
        icon={<DollarSign className="h-5 w-5 text-blue-600" />}
        iconBg="bg-blue-100"
        loading={loading}
        trend={
          counts && prevCounts
            ? calcTrend(counts.capturedAmountPaise, prevCounts.capturedAmountPaise)
                ?.value
            : undefined
        }
        trendUp={
          counts && prevCounts
            ? calcTrend(counts.capturedAmountPaise, prevCounts.capturedAmountPaise)
                ?.up
            : undefined
        }
        trendLabel={trendLabel}
      />
      <KpiCard
        label="Successful Payments"
        value={fmt(counts?.captured)}
        icon={<CheckCircle2 className="h-5 w-5 text-purple-600" />}
        iconBg="bg-purple-100"
        loading={loading}
        trend={trend("captured")}
        trendUp={trendUp("captured")}
        trendLabel={trendLabel}
      />
      <KpiCard
        label="Failed Payments"
        value={fmt(counts?.failed)}
        icon={<AlertTriangle className="h-5 w-5 text-rose-600" />}
        iconBg="bg-rose-100"
        loading={loading}
        trend={trend("failed")}
        trendUp={trendUp("failed")}
        trendLabel={trendLabel}
      />
    </div>
  );
}

// ---------- Page ----------

export default function AdminPaymentsPage() {
  const [range, setRange] = useState<DateRange>(defaultDateRange);
  const trendLabel = trendPeriodLabel(range.from, range.to);
  const { registerExportHandler } = useAdminShell();
  const [exporting, setExporting] = useState(false);

  const api = useAuthenticatedApi();

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { fromISO, toISO } = rangeToISO(range.from, range.to);
      const items = await fetchAllPaginatedItems<AdminPaymentListItem>(
        (page, limit) =>
          api<PaginatedResponse<AdminPaymentListItem>>(
            `/admin/payments${buildAdminQuery({
              page,
              limit,
              from: fromISO,
              to: toISO,
            })}`,
          ),
      );

      const header =
        "id,orderNumber,customerName,method,status,amount,createdAt";
      const rows = items.map((p) =>
        [
          p.id,
          p.orderNumber,
          `"${p.customerName.replace(/"/g, '""')}"`,
          p.method ?? "",
          p.status,
          (p.amount / 100).toFixed(2),
          p.createdAt,
        ].join(","),
      );
      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `payments-${range.from}-to-${range.to}.csv`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // silently fail — user can retry
    } finally {
      setExporting(false);
    }
  }, [exporting, range, api]);

  useEffect(() => {
    return registerExportHandler(() => void handleExport());
  }, [registerExportHandler, handleExport]);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Payments"
        range={range}
        onRangeChange={setRange}
      />

      <AdminPaymentsKpis
        from={range.from}
        to={range.to}
        trendLabel={trendLabel}
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1">
          <AdminPaymentsList from={range.from} to={range.to} />
        </div>
      </div>
    </div>
  );
}
