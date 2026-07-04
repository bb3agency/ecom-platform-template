"use client";

import Link from "next/link";

import { useCallback, useEffect, useState } from "react";

import { AdminPagination } from "@/components/admin/AdminPagination";

import { AdminSection } from "@/components/admin/AdminSection";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";

import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";

import { Button } from "@/components/ui/button";

import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";

import {
  buildAdminQuery,
  buildOrdersExportQuery,
  coercePaginatedResponse,
  ORDER_FILTER_STATUSES,
  type AdminOrderListItem,
  readPaginatedItems,
  type PaginatedResponse,
} from "@/lib/admin-api";

import {
  formatAdminDate,
  formatPaise,
  orderStatusTone,
} from "@/lib/admin-format";

import { resolveApiBaseUrl } from "@/lib/api-base";

import { getApiErrorMessage } from "@/lib/error-messages";

import { useAuthStore } from "@/stores/auth";
import { useAdminShell } from "@/contexts/admin-shell-context";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";

const PAGE_SIZE = 20;

const inputClass =
  "h-9 rounded-md border border-border bg-background px-2 text-sm";

function defaultExportDates() {
  const to = new Date();

  const from = new Date();

  from.setDate(from.getDate() - 30);

  return {
    from: from.toISOString().slice(0, 10),

    to: to.toISOString().slice(0, 10),
  };
}

interface AdminOrdersListProps {
  from?: string;
  to?: string;
}

export function AdminOrdersList({ from, to }: AdminOrdersListProps = {}) {
  const api = useAuthenticatedApi();
  const { registerExportHandler } = useAdminShell();
  const { adminUser } = useAdminAuth();
  const canExport = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.ordersExport);

  const accessToken = useAuthStore((s) => s.accessToken);

  const [page, setPage] = useState(1);

  const [status, setStatus] = useState("");

  const [search, setSearch] = useState("");

  const [fromDate, setFromDate] = useState(from ?? "");

  const [toDate, setToDate] = useState(to ?? "");

  const [loading, setLoading] = useState(true);

  const [exporting, setExporting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [data, setData] =
    useState<PaginatedResponse<AdminOrderListItem> | null>(null);

  // Sync filter and export dates when page-level range changes
  const [exportFrom, setExportFrom] = useState(
    from ?? defaultExportDates().from,
  );
  const [exportTo, setExportTo] = useState(to ?? defaultExportDates().to);

  const [paymentFilter, setPaymentFilter] = useState("");

  const [sortOrder, setSortOrder] = useState("newest");

  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (from !== undefined) {
      setFromDate(from);
      setExportFrom(from);
      setPage(1);
    }
  }, [from]);

  useEffect(() => {
    if (to !== undefined) {
      setToDate(to);
      setExportTo(to);
    }
  }, [to]);

  const load = useCallback(async () => {
    setLoading(true);

    setError(null);

    try {
      const response = await api<PaginatedResponse<AdminOrderListItem>>(
        `/admin/orders${buildAdminQuery({
          page,

          limit: PAGE_SIZE,

          status: status || undefined,

          search: search.trim() || undefined,

          paymentMode: paymentFilter === "Paid"
            ? "PREPAID"
            : paymentFilter === "COD"
              ? "COD"
              : undefined,

          sort: sortOrder === "oldest" ? "oldest" : "newest",

          from: fromDate ? `${fromDate}T00:00:00.000Z` : undefined,

          to: toDate ? `${toDate}T23:59:59.999Z` : undefined,
        })}`,
      );

      setData(coercePaginatedResponse(response));
    } catch (err) {
      setError(getApiErrorMessage(err));

      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, page, status, search, paymentFilter, sortOrder, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["orders", "dashboard"]);

  async function exportCsv() {
    if (!canExport) return;
    setExporting(true);
    setError(null);
    try {
      const base = resolveApiBaseUrl();
      if (!base) throw new Error("API base URL not configured");
      const query = buildOrdersExportQuery({
        from: exportFrom,
        to: exportTo,
        status: status || undefined,
        search: search.trim() || undefined,
        paymentMode:
          paymentFilter === "Paid"
            ? "PREPAID"
            : paymentFilter === "COD"
              ? "COD"
              : undefined,
      });
      const response = await fetch(`${base}/admin/orders/export${query}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: "include",
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `orders-${exportFrom}-to-${exportTo}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  // Register this component's export function with the shell Export button
  useEffect(() => {
    if (!canExport) return;
    return registerExportHandler(() => void exportCsv());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    registerExportHandler,
    exportFrom,
    exportTo,
    status,
    search,
    paymentFilter,
    accessToken,
    canExport,
  ]);

  const rawItems = readPaginatedItems(data);
  const items = rawItems;

  return (
    <AdminSection
      title="Orders"
      description="Recent orders with payment and shipment summary."
      loading={loading}
      error={error}
      empty={!loading && !error && items.length === 0}
      emptyMessage="No orders found."
    >
      <div className="mb-4 grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-border/40 bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
          <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-1 sm:flex-row sm:flex-wrap">
            <div className="relative w-full min-w-0 sm:max-w-sm sm:flex-1">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <svg
                  className="w-4 h-4 text-muted-foreground"
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 20 20"
                >
                  <path
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z"
                  />
                </svg>
              </div>
              <input
                className={`${inputClass} w-full pl-9 bg-muted/20 border-border/50`}
                placeholder="Search orders by ID, customer..."
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>

            <select
              className={`${inputClass} w-full bg-muted/20 border-border/50 text-foreground font-medium sm:w-auto`}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All Status</option>
              {ORDER_FILTER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <select
              className={`${inputClass} w-full bg-muted/20 border-border/50 text-foreground font-medium sm:w-auto`}
              value={paymentFilter}
              onChange={(e) => { setPaymentFilter(e.target.value); setPage(1); }}
            >
              <option value="">All Payment</option>
              <option value="Paid">Paid (Prepaid)</option>
              <option value="COD">Cash on Delivery</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-2 font-medium"
              onClick={() => {
                setSearch("");
                setStatus("");
                setPaymentFilter("");
                setSortOrder("newest");
                setFromDate("");
                setToDate("");
                setPage(1);
              }}
            >
              <svg
                className="w-4 h-4"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 20 20"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 12.25V1m0 11.25a2.25 2.25 0 0 0 0 4.5m0-4.5a2.25 2.25 0 0 1 0 4.5M4 19v-2.25m6-13.5V1m0 2.25a2.25 2.25 0 0 0 0 4.5m0-4.5a2.25 2.25 0 0 1 0 4.5M10 19V7.75m6 4.5V1m0 11.25a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5ZM16 19v-2"
                />
              </svg>
              Filter
            </Button>

            <select
              className={`${inputClass} bg-muted/20 border-border/50 text-foreground font-medium`}
              value={sortOrder}
              onChange={(e) => { setSortOrder(e.target.value); setPage(1); }}
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border/40 pt-4 mt-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
            <label className="grid min-w-0 grid-cols-1 gap-1 text-xs text-muted-foreground font-medium">
              From Date
              <input
                type="date"
                className={`${inputClass} w-full min-w-0 bg-muted/20 border-border/50 text-foreground`}
                value={fromDate}
                onChange={(event) => {
                  setFromDate(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="grid min-w-0 grid-cols-1 gap-1 text-xs text-muted-foreground font-medium">
              To Date
              <input
                type="date"
                className={`${inputClass} w-full min-w-0 bg-muted/20 border-border/50 text-foreground`}
                value={toDate}
                onChange={(event) => {
                  setToDate(event.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>

          <div className="grid w-full grid-cols-2 items-end gap-3 sm:w-auto">
            <label className="grid min-w-0 grid-cols-1 gap-1 text-xs text-muted-foreground font-medium">
              Export From
              <input
                type="date"
                className={`${inputClass} w-full min-w-0 bg-muted/20 border-border/50 text-foreground`}
                value={exportFrom}
                onChange={(event) => setExportFrom(event.target.value)}
              />
            </label>
            <label className="grid min-w-0 grid-cols-1 gap-1 text-xs text-muted-foreground font-medium">
              Export To
              <input
                type="date"
                className={`${inputClass} w-full min-w-0 bg-muted/20 border-border/50 text-foreground`}
                value={exportTo}
                onChange={(event) => setExportTo(event.target.value)}
              />
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="col-span-2 h-9 gap-2 sm:col-span-1 sm:self-end"
              disabled={exporting || !exportFrom || !exportTo}
              onClick={() => void exportCsv()}
            >
              <svg
                className="w-4 h-4"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 16 18"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M8 1v11m0 0 4-4m-4 4L4 8m11 4v3a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-3"
                />
              </svg>
              {exporting ? "Exporting…" : "Export"}
            </Button>
          </div>
        </div>
      </div>

      {data ? (
        <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm">
          <AdminTableScroll>
            <table className="w-full min-w-[500px] md:min-w-[900px] text-left text-sm">
              <thead className="border-b border-border/40 text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-3 py-4 w-10">
                    <input
                      type="checkbox"
                      className="rounded border-border text-zinc-900 focus:ring-zinc-900"
                      checked={
                        items.length > 0 &&
                        items.every((o) => selectedIds[o.id])
                      }
                      onChange={(e) => {
                        const next: Record<string, boolean> = {};
                        items.forEach((o) => {
                          next[o.id] = e.target.checked;
                        });
                        setSelectedIds(next);
                      }}
                    />
                  </th>
                  <th className="px-3 py-4">Order ID</th>
                  <th className="px-3 py-4">Customer</th>
                  <th className="px-3 py-4 hidden sm:table-cell">Date</th>
                  <th className="px-3 py-4">Amount</th>
                  <th className="px-3 py-4 hidden md:table-cell">Payment</th>
                  <th className="px-3 py-4 hidden md:table-cell">Delivery</th>
                  <th className="px-3 py-4">Order Status</th>
                  <th className="px-3 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {items.map((order) => (
                  <tr key={order.id} className="group hover:bg-muted/20">
                    <td className="px-3 py-4">
                      <input
                        type="checkbox"
                        className="rounded border-border text-zinc-900 focus:ring-zinc-900"
                        checked={Boolean(selectedIds[order.id])}
                        onChange={(e) =>
                          setSelectedIds((prev) => ({
                            ...prev,
                            [order.id]: e.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-4">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="font-semibold text-foreground hover:text-zinc-900"
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-4">
                      <p className="font-medium text-foreground">
                        {order.customerName}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {order.customerEmail}
                      </p>
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground whitespace-pre-wrap hidden sm:table-cell">
                      {formatAdminDate(order.createdAt).replace(", ", "\n")}
                    </td>
                    <td className="px-3 py-4 font-semibold text-foreground">
                      {formatPaise(order.total)}
                    </td>
                    <td className="px-3 py-4 hidden md:table-cell">
                      {order.paymentMode === "COD" ? (
                        <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-600">
                          {order.paymentStatus === "CAPTURED" ? "COD Collected" : "COD"}
                        </span>
                      ) : order.paymentStatus === "CAPTURED" ? (
                        <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-100">
                          Paid
                        </span>
                      ) : order.paymentStatus === "FAILED" ? (
                        <span className="inline-flex rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 border border-rose-100">
                          Failed
                        </span>
                      ) : order.paymentStatus === "REFUNDED" || order.paymentStatus === "PARTIALLY_REFUNDED" ? (
                        <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600">
                          {order.paymentStatus === "PARTIALLY_REFUNDED" ? "Part. Refunded" : "Refunded"}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-100">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-4 hidden md:table-cell">
                      {order.shipmentStatus ? (
                        <span
                          className={[
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                            order.shipmentStatus === "DELIVERED"
                              ? "bg-emerald-50 text-emerald-700"
                              : [
                                    "CANCELLED",
                                    "FAILED_DELIVERY",
                                    "RTO_INITIATED",
                                  ].includes(order.shipmentStatus)
                                ? "bg-rose-50 text-rose-700"
                                : ["IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(
                                      order.shipmentStatus,
                                    )
                                  ? "bg-blue-50 text-blue-700"
                                  : "bg-gray-50 text-gray-600",
                          ].join(" ")}
                        >
                          {order.shipmentStatus.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      <AdminStatusBadge
                        label={
                          order.status === "DELIVERED"
                            ? "Completed"
                            : order.status
                        }
                        tone={orderStatusTone(order.status)}
                      />
                    </td>
                    <td className="px-3 py-4 text-right">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                        title="View order"
                      >
                        <svg
                          className="w-4 h-4"
                          aria-hidden="true"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 20 14"
                        >
                          <path
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                          />
                          <path
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M10 13c-4.97 0-9-2.686-9-6s4.03-6 9-6 9 2.686 9 6-4.03 6-9 6Z"
                          />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-4">
            <p className="text-xs text-muted-foreground">
              Showing{" "}
              {Math.min(
                (data.meta.page - 1) * data.meta.limit + 1,
                data.meta.total,
              )}
              –{Math.min(data.meta.page * data.meta.limit, data.meta.total)} of{" "}
              {data.meta.total.toLocaleString("en-IN")} orders
            </p>
            <AdminPagination meta={data.meta} onPageChange={setPage} />
          </div>
        </div>
      ) : null}
    </AdminSection>
  );
}
