"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  PackageX,
  CheckCircle2,
  XCircle,
  Truck,
  RefreshCcw,
  Clock,
  ChevronRight,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import { AdminPagination } from "@/components/admin/AdminPagination";
import {
  buildAdminQuery,
  normalizePagination,
  type AdminReturnRequestListItem,
  readPaginatedItems,
  type FlatPaginatedResponse,
} from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAdminDate } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

// ── Status config ─────────────────────────────────────────────────────────────

interface StatusMeta {
  label: string;
  icon: React.ElementType;
  variant: "warning" | "info" | "destructive" | "success";
  /** Active filter-pill classes (token accents matching the badge variant). */
  pill: string;
}

const STATUS_META: Record<string, StatusMeta> = {
  REQUESTED: {
    label: "Requested",
    icon: Clock,
    variant: "warning",
    pill: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  },
  APPROVED: {
    label: "Approved",
    icon: CheckCircle2,
    variant: "info",
    pill: "border-sky-500/30 bg-sky-500/10 text-sky-700",
  },
  REJECTED: {
    label: "Rejected",
    icon: XCircle,
    variant: "destructive",
    pill: "border-red-500/30 bg-red-500/10 text-red-700",
  },
  PICKED_UP: {
    label: "Picked Up",
    icon: Truck,
    variant: "info",
    pill: "border-sky-500/30 bg-sky-500/10 text-sky-700",
  },
  REFUNDED: {
    label: "Refunded",
    icon: RefreshCcw,
    variant: "success",
    pill: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  },
};

const ALL_STATUSES = ["", "REQUESTED", "APPROVED", "REJECTED", "PICKED_UP", "REFUNDED"];

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status];
  if (!meta) return <span className="text-xs text-muted-foreground">{status}</span>;
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

// ── KPI summary strip ────────────────────────────────────────────────────────

interface KpiStripProps {
  items: AdminReturnRequestListItem[];
  total: number;
}

function KpiStrip({ items, total }: KpiStripProps) {
  const counts = items.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const kpis = [
    { label: "Total", value: total, color: "text-foreground" },
    { label: "Requested", value: counts["REQUESTED"] ?? 0, color: "text-amber-600" },
    { label: "Approved", value: counts["APPROVED"] ?? 0, color: "text-sky-600" },
    { label: "Rejected", value: counts["REJECTED"] ?? 0, color: "text-red-600" },
    { label: "Refunded", value: counts["REFUNDED"] ?? 0, color: "text-emerald-600" },
  ];

  return (
    <div className="grid grid-cols-5 divide-x divide-border/40 rounded-xl border border-border/40 bg-card shadow-sm overflow-hidden">
      {kpis.map((k) => (
        <div key={k.label} className="flex flex-col items-center gap-0.5 py-3 px-2">
          <span className={cn("text-lg font-bold leading-none", k.color)}>{k.value}</span>
          <span className="text-[10px] text-muted-foreground font-medium truncate">{k.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Mobile card ───────────────────────────────────────────────────────────────

function ReturnCard({ item }: { item: AdminReturnRequestListItem }) {
  return (
    <Link
      href={`/admin/returns/${item.id}`}
      className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm hover:border-border hover:shadow-md transition-all active:scale-[0.98] group"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-foreground group-hover:text-primary transition-colors">
            {item.orderNumber}
          </span>
          <StatusBadge status={item.status} />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground truncate">{item.customerName}</p>
          <p className="text-xs text-muted-foreground truncate">{item.customerEmail}</p>
        </div>
        {item.reason && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            &ldquo;{item.reason}&rdquo;
          </p>
        )}
        <p className="text-[10px] text-muted-foreground/60">
          {formatAdminDate(item.createdAt)}
        </p>
      </div>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
    </Link>
  );
}

// ── Main list ─────────────────────────────────────────────────────────────────

export function AdminReturnsList() {
  const api = useAuthenticatedApi();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FlatPaginatedResponse<AdminReturnRequestListItem> | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await api<FlatPaginatedResponse<AdminReturnRequestListItem>>(
          `/admin/return-requests${buildAdminQuery({
            page,
            limit: PAGE_SIZE,
            status: statusFilter || undefined,
          })}`,
        );
        setData(response);
      } catch (err) {
        setError(getApiErrorMessage(err));
        setData(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api, page, statusFilter],
  );

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [statusFilter]);

  const items = readPaginatedItems(data);
  const meta = data ? normalizePagination(data) : null;
  const total = meta?.total ?? 0;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Return Requests</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Customer return and refund workflow
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading || refreshing}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 sm:h-9 sm:w-9"
          aria-label="Refresh"
        >
          <RotateCcw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </button>
      </div>

      {/* KPI strip (only when data loaded) */}
      {data && !loading && (
        <KpiStrip items={items} total={total} />
      )}

      {/* Filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {ALL_STATUSES.map((status) => {
          const meta = status ? STATUS_META[status] : null;
          const active = statusFilter === status;
          return (
            <button
              key={status || "all"}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
                active
                  ? meta
                    ? meta.pill
                    : "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/50",
              )}
            >
              {meta && <meta.icon className="h-3 w-3" />}
              {status ? STATUS_META[status]?.label : "All"}
            </button>
          );
        })}
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <EmptyState
          icon={PackageX}
          headline="No return requests"
          description={
            statusFilter
              ? `No requests with status "${STATUS_META[statusFilter]?.label}"`
              : "No return requests have been submitted yet."
          }
          action={
            statusFilter ? (
              <button
                type="button"
                onClick={() => setStatusFilter("")}
                className="text-sm font-medium text-primary hover:underline"
              >
                Clear filter
              </button>
            ) : undefined
          }
        />
      )}

      {/* Mobile: card list */}
      {!loading && items.length > 0 && (
        <>
          {/* Mobile cards */}
          <div className="flex flex-col gap-3 lg:hidden">
            {items.map((item) => (
              <ReturnCard key={item.id} item={item} />
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block rounded-xl border border-border/40 bg-card shadow-sm overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border/40 bg-muted/30">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Order</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reason</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Requested</th>
                  <th className="px-4 py-3 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {items.map((item) => (
                  <tr key={item.id} className="group hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/returns/${item.id}`}
                        className="font-mono text-sm font-bold text-foreground group-hover:text-primary transition-colors"
                      >
                        {item.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{item.customerName}</p>
                      <p className="text-xs text-muted-foreground">{item.customerEmail}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="truncate text-xs text-muted-foreground">{item.reason || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatAdminDate(item.createdAt).split(",")[0]}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/returns/${item.id}`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        aria-label="View details"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {meta && (
            <AdminPagination meta={meta} onPageChange={setPage} />
          )}
        </>
      )}
    </div>
  );
}
