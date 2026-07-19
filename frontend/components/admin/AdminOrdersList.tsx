"use client";

import Link from "next/link";

import { useCallback, useEffect, useState } from "react";

import { Eye, Search, SlidersHorizontal } from "lucide-react";

import { AdminPagination } from "@/components/admin/AdminPagination";

import { AdminSection } from "@/components/admin/AdminSection";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";

import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";

import { Badge } from "@/components/ui/badge";

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
  "h-9 rounded-lg border border-border bg-background px-2 text-sm";

function defaultExportDates() {
  const to = new Date();

  const from = new Date();

  from.setDate(from.getDate() - 30);

  return {
    from: from.toISOString().slice(0, 10),

    to: to.toISOString().slice(0, 10),
  };
}

function paymentBadge(order: AdminOrderListItem) {
  if (order.paymentMode === "COD") {
    return (
      <Badge variant="info">
        {order.paymentStatus === "CAPTURED" ? "COD Collected" : "COD"}
      </Badge>
    );
  }
  if (order.paymentStatus === "CAPTURED") {
    return <Badge variant="success">Paid</Badge>;
  }
  if (order.paymentStatus === "FAILED") {
    return <Badge variant="destructive">Failed</Badge>;
  }
  if (
    order.paymentStatus === "REFUNDED" ||
    order.paymentStatus === "PARTIALLY_REFUNDED"
  ) {
    return (
      <Badge variant="default">
        {order.paymentStatus === "PARTIALLY_REFUNDED"
          ? "Part. Refunded"
          : "Refunded"}
      </Badge>
    );
  }
  return <Badge variant="warning">Pending</Badge>;
}

function deliveryBadge(order: AdminOrderListItem) {
  if (order.isLocalDelivery) {
    return <Badge variant="success">LOCAL</Badge>;
  }
  if (!order.shipmentStatus) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const variant =
    order.shipmentStatus === "DELIVERED"
      ? "success"
      : ["CANCELLED", "FAILED_DELIVERY", "RTO_INITIATED"].includes(
            order.shipmentStatus,
          )
        ? "destructive"
        : ["IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(order.shipmentStatus)
          ? "info"
          : "default";
  return (
    <Badge variant={variant}>{order.shipmentStatus.replace(/_/g, " ")}</Badge>
  );
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

  // `searchInput` is the live text field; `search` is the committed query used by the
  // fetch. Decoupling them means typing does NOT refetch on every keystroke (which blanked
  // the table and read as a full-page refresh) — the search runs on submit, like Shipments.
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [fromDate, setFromDate] = useState(from ?? "");

  const [toDate, setToDate] = useState(to ?? "");

  const [loading, setLoading] = useState(true);


  const [error, setError] = useState<string | null>(null);

  const [data, setData] =
    useState<PaginatedResponse<AdminOrderListItem> | null>(null);

  // Export follows the SAME committed range as the list (page-level date picker /
  // pills). Falls back to the default window when no range is set.
  const exportFrom = fromDate || defaultExportDates().from;
  const exportTo = toDate || defaultExportDates().to;

  const [paymentFilter, setPaymentFilter] = useState("");

  const [sortOrder, setSortOrder] = useState("newest");

  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (from !== undefined) {
      setFromDate(from);
      setPage(1);
    }
  }, [from]);

  useEffect(() => {
    if (to !== undefined) {
      setToDate(to);
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
      <div className="mb-4 grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
          <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-1 sm:flex-row sm:flex-wrap">
            <div className="relative w-full min-w-0 sm:max-w-sm sm:flex-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Search
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <input
                className={`${inputClass} w-full pl-9`}
                placeholder="Search orders by ID, customer..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    setSearch(searchInput.trim());
                    setPage(1);
                  }
                }}
                onBlur={() => {
                  if (searchInput.trim() !== search) {
                    setSearch(searchInput.trim());
                    setPage(1);
                  }
                }}
              />
            </div>

            <select
              className={`${inputClass} w-full font-medium text-foreground sm:w-auto`}
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
              className={`${inputClass} w-full font-medium text-foreground sm:w-auto`}
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
                setSearchInput("");
                setStatus("");
                setPaymentFilter("");
                setSortOrder("newest");
                setFromDate("");
                setToDate("");
                setPage(1);
              }}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Clear filters
            </Button>

            <select
              className={`${inputClass} font-medium text-foreground`}
              value={sortOrder}
              onChange={(e) => { setSortOrder(e.target.value); setPage(1); }}
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
            </select>
          </div>
        </div>

        {(search || status || paymentFilter || fromDate || toDate) && (
          <div className="flex flex-wrap items-center gap-2">
            {search && (
              <FilterPill
                label={`Search: ${search}`}
                onRemove={() => {
                  setSearch("");
                  setSearchInput("");
                  setPage(1);
                }}
              />
            )}
            {status && (
              <FilterPill
                label={status}
                onRemove={() => {
                  setStatus("");
                  setPage(1);
                }}
              />
            )}
            {paymentFilter && (
              <FilterPill
                label={paymentFilter === "Paid" ? "Paid (Prepaid)" : "COD"}
                onRemove={() => {
                  setPaymentFilter("");
                  setPage(1);
                }}
              />
            )}
            {fromDate && (
              <FilterPill
                label={`From ${fromDate}`}
                onRemove={() => {
                  setFromDate("");
                  setPage(1);
                }}
              />
            )}
            {toDate && (
              <FilterPill
                label={`To ${toDate}`}
                onRemove={() => {
                  setToDate("");
                  setPage(1);
                }}
              />
            )}
          </div>
        )}

      </div>

      {data ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <AdminTableScroll>
            <table className="w-full min-w-[500px] text-left text-sm md:min-w-[900px]">
              <thead className="sticky top-0 z-10 border-b border-border bg-card text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-border accent-primary"
                      aria-label="Select all orders"
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
                  <th className="px-3 py-3">Order ID</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Date</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                  <th className="hidden px-3 py-3 md:table-cell">Payment</th>
                  <th className="hidden px-3 py-3 md:table-cell">Delivery</th>
                  <th className="px-3 py-3">Order Status</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((order) => (
                  <tr
                    key={order.id}
                    className="group border-b border-border transition-colors duration-150 hover:bg-muted/50"
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        className="rounded border-border accent-primary"
                        aria-label={`Select order ${order.orderNumber}`}
                        checked={Boolean(selectedIds[order.id])}
                        onChange={(e) =>
                          setSelectedIds((prev) => ({
                            ...prev,
                            [order.id]: e.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="font-semibold text-foreground transition-colors hover:text-primary"
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                        >
                          {(order.customerName || "?").charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {order.customerName}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {order.customerEmail}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden whitespace-pre-wrap px-3 py-3 text-xs text-muted-foreground sm:table-cell">
                      {formatAdminDate(order.createdAt).replace(", ", "\n")}
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-foreground">
                      {formatPaise(order.total)}
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      {paymentBadge(order)}
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      {deliveryBadge(order)}
                    </td>
                    <td className="px-3 py-3">
                      <AdminStatusBadge
                        label={
                          order.status === "DELIVERED"
                            ? "Completed"
                            : order.status
                        }
                        tone={orderStatusTone(order.status)}
                      />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                        title="View order"
                        aria-label={`View order ${order.orderNumber}`}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
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

interface FilterPillProps {
  label: string;
  onRemove: () => void;
}

function FilterPill({ label, onRemove }: FilterPillProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter ${label}`}
        className="rounded-full text-muted-foreground transition-colors hover:text-foreground"
      >
        ×
      </button>
    </span>
  );
}
