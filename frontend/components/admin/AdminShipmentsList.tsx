"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminDetailDrawer } from "@/components/admin/AdminDetailDrawer";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildAdminQuery,
  SHIPMENT_FILTER_STATUSES,
  coercePaginatedResponse,
  toIsoDateRange,
  type AdminShipmentDetail,
  type AdminShipmentListItem,
  readPaginatedItems,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { prevRange, rangeToISO, trendPeriodLabel } from "@/components/admin/AdminDateRangePicker";
import { formatAdminDate } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { shippingProviderLabel } from "@/lib/shipping-provider-labels";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import {
  Truck,
  CheckCircle2,
  Clock,
  MapPin,
  XCircle,
  Search,
  Eye,
  ExternalLink,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { AdminResponsiveContainer } from "@/components/admin/AdminResponsiveContainer";

const PAGE_SIZE = 8;
const COLORS = ["#10b981", "#f59e0b", "#3b82f6", "#ef4444", "#a1a1aa"];

// ── shared helpers ──────────────────────────────────────────────────────────

function calcTrend(
  cur: number,
  prev: number,
): { value: string; up: boolean } | null {
  if (!prev) return null;
  const pct = ((cur - prev) / prev) * 100;
  const abs = Math.round(Math.abs(pct) * 10) / 10;
  return { value: `${pct >= 0 ? "+" : "-"}${abs}%`, up: pct >= 0 };
}

interface ShipmentKpis {
  total: number;
  delivered: number;
  inTransit: number;
  outForDelivery: number;
  failed: number;
  cancelled: number;
  rtoDelivered: number;
  totalPrev: number;
  deliveredPrev: number;
  inTransitPrev: number;
  outForDeliveryPrev: number;
  failedPrev: number;
  cancelledPrev: number;
  rtoDeliveredPrev: number;
}

export function AdminShipmentsList({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const api = useAuthenticatedApi();
  const trendLabel = trendPeriodLabel(from, to);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] =
    useState<PaginatedResponse<AdminShipmentListItem> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminShipmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<PaginatedResponse<AdminShipmentListItem>>(
        `/admin/shipments${buildAdminQuery({
          page,
          limit: PAGE_SIZE,
          status: status || undefined,
          search: search.trim() || undefined,
          from: toIsoDateRange(from),
          to: toIsoDateRange(to, true),
        })}`,
      );
      setData(coercePaginatedResponse(response));
    } catch (err) {
      setError(getApiErrorMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, page, status, search, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["shipments", "orders"]);

  useEffect(() => {
    setPage(1);
  }, [search, status, from, to]);

  async function openDetail(shipmentId: string) {
    setSelectedId(shipmentId);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await api<AdminShipmentDetail>(
        `/admin/shipments/${shipmentId}`,
      );
      setDetail(response);
    } catch (err) {
      setDetailError(getApiErrorMessage(err));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  // ── KPI state ────────────────────────────────────────────────────────────
  const [shipmentKpis, setShipmentKpis] = useState<ShipmentKpis | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);

  const loadKpis = useCallback(async () => {
    setKpisLoading(true);
    try {
      const { fromISO, toISO } = rangeToISO(from, to);
      const prev = prevRange(from, to);
      const cur = (extra: Record<string, string | undefined>) =>
        `/admin/shipments${buildAdminQuery({
          limit: 1,
          from: fromISO,
          to: toISO,
          ...extra,
        })}`;
      const prv = (extra: Record<string, string | undefined>) =>
        `/admin/shipments${buildAdminQuery({
          limit: 1,
          from: prev.from,
          to: prev.to,
          ...extra,
        })}`;

      const [
        totalRes,
        deliveredRes,
        inTransitRes,
        outRes,
        failedRes,
        cancelledRes,
        rtoRes,
        totalPrevRes,
        deliveredPrevRes,
        inTransitPrevRes,
        outPrevRes,
        failedPrevRes,
        cancelledPrevRes,
        rtoPrevRes,
      ] = await Promise.all([
        api<PaginatedResponse<AdminShipmentListItem>>(cur({})),
        api<PaginatedResponse<AdminShipmentListItem>>(
          cur({ status: "DELIVERED" }),
        ),
        api<PaginatedResponse<AdminShipmentListItem>>(
          cur({ status: "IN_TRANSIT" }),
        ),
        api<PaginatedResponse<AdminShipmentListItem>>(
          cur({ status: "OUT_FOR_DELIVERY" }),
        ),
        api<PaginatedResponse<AdminShipmentListItem>>(
          cur({ status: "FAILED_DELIVERY" }),
        ),
        api<PaginatedResponse<AdminShipmentListItem>>(
          cur({ status: "CANCELLED" }),
        ),
        api<PaginatedResponse<AdminShipmentListItem>>(
          cur({ status: "RTO_DELIVERED" }),
        ),
        api<PaginatedResponse<AdminShipmentListItem>>(prv({})),
        api<PaginatedResponse<AdminShipmentListItem>>(
          prv({ status: "DELIVERED" }),
        ),
        api<PaginatedResponse<AdminShipmentListItem>>(
          prv({ status: "IN_TRANSIT" }),
        ),
        api<PaginatedResponse<AdminShipmentListItem>>(
          prv({ status: "OUT_FOR_DELIVERY" }),
        ),
        api<PaginatedResponse<AdminShipmentListItem>>(
          prv({ status: "FAILED_DELIVERY" }),
        ),
        api<PaginatedResponse<AdminShipmentListItem>>(
          prv({ status: "CANCELLED" }),
        ),
        api<PaginatedResponse<AdminShipmentListItem>>(
          prv({ status: "RTO_DELIVERED" }),
        ),
      ]);
      const g = (r: PaginatedResponse<AdminShipmentListItem>) =>
        coercePaginatedResponse(r).meta.total;
      setShipmentKpis({
        total: g(totalRes),
        delivered: g(deliveredRes),
        inTransit: g(inTransitRes),
        outForDelivery: g(outRes),
        failed: g(failedRes),
        cancelled: g(cancelledRes),
        rtoDelivered: g(rtoRes),
        totalPrev: g(totalPrevRes),
        deliveredPrev: g(deliveredPrevRes),
        inTransitPrev: g(inTransitPrevRes),
        outForDeliveryPrev: g(outPrevRes),
        failedPrev: g(failedPrevRes),
        cancelledPrev: g(cancelledPrevRes),
        rtoDeliveredPrev: g(rtoPrevRes),
      });
    } catch {
      // keep null
    } finally {
      setKpisLoading(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  useAdminDataRefreshEffect(loadKpis, ["shipments", "orders", "dashboard"]);

  const kTotalTrend = shipmentKpis
    ? calcTrend(shipmentKpis.total, shipmentKpis.totalPrev)
    : null;
  const kDeliveredTrend = shipmentKpis
    ? calcTrend(shipmentKpis.delivered, shipmentKpis.deliveredPrev)
    : null;
  const kInTransitTrend = shipmentKpis
    ? calcTrend(shipmentKpis.inTransit, shipmentKpis.inTransitPrev)
    : null;
  const kOutTrend = shipmentKpis
    ? calcTrend(shipmentKpis.outForDelivery, shipmentKpis.outForDeliveryPrev)
    : null;
  const kFailedTrend = shipmentKpis
    ? calcTrend(shipmentKpis.failed, shipmentKpis.failedPrev)
    : null;

  const items = readPaginatedItems(data);

  // Poll every 60 s while there are active shipments that could change status.
  // Shiprocket webhook → worker → DB update has no push mechanism to the frontend,
  // so polling is the only way to reflect pickup / in-transit / delivered changes.
  useEffect(() => {
    const hasActiveShipments = items.some(
      (s) =>
        !["DELIVERED", "CANCELLED", "RTO_DELIVERED"].includes(s.status),
    );
    if (!hasActiveShipments) return;
    const id = setInterval(() => {
      void load();
    }, 60_000);
    return () => clearInterval(id);
  }, [items, load]);

  const deliveredCount = shipmentKpis?.delivered ?? 0;
  const inTransitCount =
    (shipmentKpis?.inTransit ?? 0) + (shipmentKpis?.outForDelivery ?? 0);
  const failedCount = shipmentKpis?.failed ?? 0;
  const cancelledCount = (shipmentKpis?.cancelled ?? 0) + (shipmentKpis?.rtoDelivered ?? 0);
  const pendingCount = Math.max(
    0,
    (shipmentKpis?.total ?? 0) - deliveredCount - inTransitCount - failedCount - cancelledCount,
  );
  const pieData = [
    { name: "Delivered", value: deliveredCount },
    { name: "In Transit", value: inTransitCount },
    { name: "Pending", value: pendingCount },
    { name: "Failed", value: failedCount },
    { name: "Cancelled", value: cancelledCount },
  ].filter((d) => d.value > 0);

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* KPI Cards Row */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
          <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
                <Truck className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                  Total Deliveries
                </p>
                <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                  {shipmentKpis ? shipmentKpis.total.toLocaleString() : "—"}
                </p>
              </div>
            </div>
            <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
              {kpisLoading ? (
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              ) : kTotalTrend ? (
                <span
                  className={
                    kTotalTrend.up ? "text-emerald-600" : "text-red-600"
                  }
                >
                  {kTotalTrend.up ? "↑" : "↓"} {kTotalTrend.value}{" "}
                  <span className="text-muted-foreground">{trendLabel}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">{trendLabel}</span>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                  Delivered
                </p>
                <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                  {shipmentKpis ? shipmentKpis.delivered.toLocaleString() : "—"}
                </p>
              </div>
            </div>
            <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
              {kpisLoading ? (
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              ) : kDeliveredTrend ? (
                <span
                  className={
                    kDeliveredTrend.up ? "text-emerald-600" : "text-red-600"
                  }
                >
                  {kDeliveredTrend.up ? "↑" : "↓"} {kDeliveredTrend.value}{" "}
                  <span className="text-muted-foreground">{trendLabel}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">{trendLabel}</span>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                  In Transit
                </p>
                <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                  {shipmentKpis ? shipmentKpis.inTransit.toLocaleString() : "—"}
                </p>
              </div>
            </div>
            <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
              {kpisLoading ? (
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              ) : kInTransitTrend ? (
                <span
                  className={
                    kInTransitTrend.up ? "text-emerald-600" : "text-red-600"
                  }
                >
                  {kInTransitTrend.up ? "↑" : "↓"} {kInTransitTrend.value}{" "}
                  <span className="text-muted-foreground">{trendLabel}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">{trendLabel}</span>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-sky-500/10">
                <MapPin className="h-5 w-5 text-sky-600" />
              </div>
              <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                  Out for Delivery
                </p>
                <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                  {shipmentKpis
                    ? shipmentKpis.outForDelivery.toLocaleString()
                    : "—"}
                </p>
              </div>
            </div>
            <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
              {kpisLoading ? (
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              ) : kOutTrend ? (
                <span
                  className={
                    kOutTrend.up ? "text-emerald-600" : "text-red-600"
                  }
                >
                  {kOutTrend.up ? "↑" : "↓"} {kOutTrend.value}{" "}
                  <span className="text-muted-foreground">{trendLabel}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">{trendLabel}</span>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm min-w-0">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-red-500/10">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
              <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">
                  Failed Deliveries
                </p>
                <p className="font-heading text-lg sm:text-2xl font-bold tracking-tight text-foreground truncate">
                  {shipmentKpis ? shipmentKpis.failed.toLocaleString() : "—"}
                </p>
              </div>
            </div>
            <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[11px] font-medium">
              {kpisLoading ? (
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              ) : kFailedTrend ? (
                <span
                  className={
                    kFailedTrend.up ? "text-red-600" : "text-emerald-600"
                  }
                >
                  {kFailedTrend.up ? "↑" : "↓"} {kFailedTrend.value}{" "}
                  <span className="text-muted-foreground">{trendLabel}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">{trendLabel}</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-3 xl:grid-cols-4">
          {/* Main Table Section */}
          <div className="flex flex-col rounded-xl border border-border/40 bg-card shadow-sm lg:col-span-2 xl:col-span-3">
            <div className="flex flex-col gap-4 border-b border-border/40 p-4 xl:flex-row xl:items-center xl:justify-between">
              <form
                className="relative w-full min-w-0 flex-1 sm:max-w-sm"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearch(searchInput.trim());
                }}
              >
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search by order ID, customer or phone..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/50 bg-background pl-9 pr-4 text-sm focus:border-primary focus:outline-none"
                />
              </form>

              <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                <select
                  className="h-9 shrink-0 rounded-md border border-border/50 bg-background px-3 text-sm text-muted-foreground focus:border-primary focus:outline-none"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  aria-label="Filter by shipment status"
                >
                  <option value="">All Status</option>
                  {SHIPMENT_FILTER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {loading ? (
              <div className="flex flex-col gap-3 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-4 w-32 flex-1" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="flex h-[400px] items-center justify-center p-4 text-sm text-destructive">
                {error}
              </div>
            ) : items.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Truck}
                  headline="No shipments found"
                  description="No deliveries match your current filters."
                />
              </div>
            ) : (
              <>
                <AdminTableScroll>
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="border-b border-border/40 text-xs font-medium text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Order ID</th>
                        <th className="px-4 py-3">Customer</th>
                        <th className="px-4 py-3">Delivery Partner</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">ETA / Time</th>
                        <th className="px-4 py-3">Location</th>
                        <th className="px-4 py-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {items.map((shipment) => {
                        const isDelivered = shipment.status === "DELIVERED";
                        const isFailed = [
                          "CANCELLED",
                          "FAILED_DELIVERY",
                          "RTO_INITIATED",
                          "RTO_DELIVERED",
                        ].includes(shipment.status);
                        const isTransit = [
                          "IN_TRANSIT",
                          "OUT_FOR_DELIVERY",
                        ].includes(shipment.status);

                        const badgeVariant = isDelivered
                          ? ("success" as const)
                          : isFailed
                            ? ("destructive" as const)
                            : isTransit
                              ? ("info" as const)
                              : ("default" as const);

                        return (
                          <tr
                            key={shipment.id}
                            className="group hover:bg-muted/30"
                          >
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-0.5">
                                <Link
                                  href={`/admin/orders/${shipment.orderId}`}
                                  className="font-semibold text-foreground hover:text-primary"
                                >
                                  {shipment.orderNumber}
                                </Link>
                                <span className="text-[11px] text-muted-foreground">
                                  {
                                    formatAdminDate(shipment.createdAt).split(
                                      ",",
                                    )[0]
                                  }
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground uppercase shrink-0">
                                  {shipment.customerName?.[0] ?? "#"}
                                </div>
                                <span className="font-medium text-foreground">
                                  {shipment.customerName ?? "—"}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/10 text-xs font-bold text-sky-700 uppercase shrink-0">
                                  {shipment.provider?.[0] ?? "P"}
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium text-foreground">
                                    {shippingProviderLabel(shipment.provider)}
                                  </span>
                                  {shipment.awbNumber && (
                                    <span className="font-mono text-xs text-muted-foreground">
                                      AWB: {shipment.awbNumber}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <Badge dot variant={badgeVariant}>
                                {shipment.status.replace(/_/g, " ")}
                              </Badge>
                            </td>
                            <td className="px-4 py-3">
                              {shipment.pickupScheduledDate ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium text-foreground">
                                    Pickup
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {
                                      formatAdminDate(
                                        shipment.pickupScheduledDate,
                                      ).split(",")[0]
                                    }
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {shipment.trackingUrl ? (
                                <a
                                  href={shipment.trackingUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:underline"
                                >
                                  Track <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 rounded-md"
                                  aria-label={`View shipment ${shipment.orderNumber}`}
                                  onClick={() => openDetail(shipment.id)}
                                >
                                  <Eye className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </AdminTableScroll>

                <div className="border-t border-border/40 p-4">
                  <AdminPagination
                    meta={
                      data?.meta || {
                        page: 1,
                        limit: PAGE_SIZE,
                        total: 0,
                        totalPages: 0,
                      }
                    }
                    onPageChange={setPage}
                  />
                </div>
              </>
            )}
          </div>

          {/* Right Sidebar Widgets */}
          <div className="flex flex-col gap-6 lg:col-span-1">
            {/* Donut Chart Widget */}
            <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm">
              <h3 className="font-heading text-sm font-semibold mb-4">
                Delivery Status Overview
              </h3>
              <div className="relative mb-6 h-[200px] min-w-0">
                <AdminResponsiveContainer height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={85}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: unknown) =>
                        Number(value).toLocaleString()
                      }
                      contentStyle={{
                        background: "#111827",
                        color: "#fff",
                        borderRadius: "8px",
                        border: "none",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </AdminResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                  <span className="text-[20px] font-bold text-foreground">
                    {(shipmentKpis?.total ?? 0).toLocaleString()}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    Total
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {pieData.map((item, i) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: COLORS[i] }}
                      />
                      <span className="text-muted-foreground">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{item.value}</span>
                      {(shipmentKpis?.total ?? 0) > 0 && (
                        <span className="text-muted-foreground w-10 text-right">
                          ({Math.round((item.value / (shipmentKpis?.total ?? 1)) * 100)}%)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Link
                href="/admin/shipments"
                className="mt-4 flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                View all shipments
                <span>→</span>
              </Link>
            </div>

            {/* Recent active shipments quick-view */}
            {items
              .filter((s) =>
                ["IN_TRANSIT", "OUT_FOR_DELIVERY", "PICKED_UP"].includes(
                  s.status,
                ),
              )
              .slice(0, 4).length > 0 && (
              <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-heading text-sm font-semibold">
                    Active Shipments
                  </h3>
                  <Link
                    href="/admin/shipments"
                    className="text-[11px] font-medium text-foreground bg-muted px-2 py-0.5 rounded-full hover:bg-muted/70"
                  >
                    View All
                  </Link>
                </div>
                <div className="flex flex-col gap-3">
                  {items
                    .filter((s) =>
                      ["IN_TRANSIT", "OUT_FOR_DELIVERY", "PICKED_UP"].includes(
                        s.status,
                      ),
                    )
                    .slice(0, 4)
                    .map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between"
                      >
                        <div className="flex flex-col gap-0.5">
                          <Link
                            href={`/admin/orders/${s.orderId}`}
                            className="text-xs font-semibold text-foreground hover:text-primary"
                          >
                            {s.orderNumber}
                          </Link>
                          <span className="text-[10px] text-muted-foreground">
                            {s.provider}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium text-sky-700 bg-sky-500/10 px-2 py-0.5 rounded-full">
                            {s.status.replace(/_/g, " ")}
                          </span>
                          {s.trackingUrl && (
                            <a
                              href={s.trackingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <AdminDetailDrawer
        open={Boolean(selectedId)}
        title={detail ? `Shipment · ${detail.orderNumber}` : "Shipment detail"}
        onClose={() => {
          setSelectedId(null);
          setDetail(null);
          setDetailError(null);
        }}
      >
        {detailLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : detailError ? (
          <p className="text-sm text-destructive">{detailError}</p>
        ) : detail ? (
          <dl className="grid min-w-0 grid-cols-1 gap-2 text-sm">
            <Row label="Provider" value={detail.provider} />
            <Row label="Status" value={detail.status} />
            <Row label="AWB" value={detail.awbNumber ?? "—"} />
            <Row
              label="Pickup scheduled"
              value={
                detail.pickupScheduledDate
                  ? formatAdminDate(detail.pickupScheduledDate)
                  : "—"
              }
            />
            <Row
              label="Shiprocket ID"
              value={detail.shiprocketShipmentId ?? "—"}
            />
            <Row label="Created" value={formatAdminDate(detail.createdAt)} />
            <Row label="Updated" value={formatAdminDate(detail.updatedAt)} />
            {detail.trackingUrl ? (
              <a
                href={detail.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline flex items-center gap-1 mt-2"
              >
                <MapPin className="h-3 w-3" /> Open tracking
              </a>
            ) : null}
            {detail.labelUrl ? (
              <a
                href={detail.labelUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline flex items-center gap-1"
              >
                <MapPin className="h-3 w-3" /> Open label
              </a>
            ) : null}
            <Link
              href={`/admin/orders/${detail.orderId}`}
              className="mt-2 inline-flex items-center gap-1 text-primary hover:underline"
            >
              <Eye className="h-3 w-3" /> View order
            </Link>
          </dl>
        ) : null}
      </AdminDetailDrawer>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 border-b border-border/50 py-1 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words font-medium">{value}</dd>
    </div>
  );
}
