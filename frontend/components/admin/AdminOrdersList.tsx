"use client";

import { useCallback, useEffect, useState } from "react";
import { FileDown, Loader2, ShoppingCart } from "lucide-react";

import { AdminPagination } from "@/components/admin/AdminPagination";
import { rangeToISO } from "@/components/admin/AdminDateRangePicker";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DataTable,
  FilterBar,
  FilterSelect,
  Notice,
  Panel,
  StatusDot,
  type DataColumn,
} from "@/components/ui/console";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { useUrlFilterState } from "@/hooks/use-url-filter-state";
import {
  buildAdminQuery,
  buildOrdersExportQuery,
  coercePaginatedResponse,
  ORDER_FILTER_STATUSES,
  readPaginatedItems,
  type AdminOrderListItem,
  type AdminOrderStatusCounts,
  type AdminOrderStatusKey,
  type PaginatedResponse,
} from "@/lib/admin-api";
import {
  formatAdminDateCompact,
  formatPaise,
  orderStatusDisplay,
  sentenceCaseEnum,
  type AdminDotTone,
} from "@/lib/admin-format";
import { getBrowserApiBaseUrl, resolveApiBaseUrl } from "@/lib/api-base";
import { resolveDownloadFilename } from "@/lib/download-filename";
import { parseApiErrorFromResponse } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { isInvoiceEligibleOrderStatus } from "@/lib/order-status-ui";
import { toast } from "@/lib/toast";
import { useAuthStore } from "@/stores/auth";
import { useAdminShell } from "@/contexts/admin-shell-context";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

/** Tab order follows the merchant's workflow, not the enum order. */
const STATUS_TABS: { value: "" | AdminOrderStatusKey; label: string }[] = [
  { value: "", label: "All" },
  { value: "CONFIRMED", label: "To fulfil" },
  { value: "PROCESSING", label: "Processing" },
  { value: "SHIPPED", label: "Shipped" },
  { value: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "PENDING_PAYMENT", label: "Awaiting payment" },
  { value: "PAYMENT_FAILED", label: "Payment failed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REFUNDED", label: "Refunded" },
];

const PAYMENT_FILTERS = ["", "PREPAID", "COD"] as const;
/** "owed" = cancelled orders whose refund never went through (dashboard "Refunds to retry"). */
const REFUND_FILTERS = ["", "owed"] as const;
const SORTS = ["newest", "oldest"] as const;

function defaultExportDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function paymentDisplay(order: AdminOrderListItem): { label: string; tone: AdminDotTone } {
  if (order.paymentMode === "COD") {
    return order.paymentStatus === "CAPTURED"
      ? { label: "COD · collected", tone: "success" }
      : { label: "Cash on delivery", tone: "neutral" };
  }
  switch (order.paymentStatus) {
    case "CAPTURED":
      // A cancelled order that still holds the customer's money: the refund is
      // either with Razorpay or still owed (open the order to see which).
      return order.status === "CANCELLED"
        ? { label: "Not refunded yet", tone: "warning" }
        : { label: "Paid", tone: "success" };
    case "FAILED":
      return { label: "Failed", tone: "danger" };
    case "REFUNDED":
      return { label: "Refunded", tone: "neutral" };
    case "PARTIALLY_REFUNDED":
      return { label: "Partly refunded", tone: "warning" };
    default:
      return { label: "Pending", tone: "warning" };
  }
}

function deliveryDisplay(order: AdminOrderListItem): { label: string; tone: AdminDotTone } | null {
  if (order.isLocalDelivery) return { label: "Local delivery", tone: "brand" };
  if (!order.shipmentStatus) return null;
  const s = order.shipmentStatus;
  const tone: AdminDotTone =
    s === "DELIVERED"
      ? "success"
      : ["CANCELLED", "FAILED_DELIVERY", "RTO_INITIATED", "RTO_DELIVERED"].includes(s)
        ? "danger"
        : ["IN_TRANSIT", "OUT_FOR_DELIVERY", "PICKED_UP", "BOOKED"].includes(s)
          ? "info"
          : "neutral";
  return { label: sentenceCaseEnum(s), tone };
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

  const [status, setStatus] = useUrlFilterState("status", "", ORDER_FILTER_STATUSES);
  const [paymentFilter, setPaymentFilter] = useUrlFilterState("payment", "", PAYMENT_FILTERS);
  const [sortOrder, setSortOrder] = useUrlFilterState("sort", "newest", SORTS);
  const [refundFilter, setRefundFilter] = useUrlFilterState("refund", "", REFUND_FILTERS);
  const [page, setPage] = useState(1);

  // `searchInput` is the live field; `search` is what the fetch uses. It is committed
  // after a 400ms pause so typing doesn't refetch (and dim the table) on every keystroke.
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const next = searchInput.trim();
    if (next === search) return;
    const id = window.setTimeout(() => setSearch(next), 400);
    return () => window.clearTimeout(id);
  }, [searchInput, search]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PaginatedResponse<AdminOrderListItem> | null>(null);
  const [counts, setCounts] = useState<AdminOrderStatusCounts | null>(null);
  const [invoiceBusyId, setInvoiceBusyId] = useState<string | null>(null);

  const fromDate = from ?? "";
  const toDate = to ?? "";
  const exportFrom = fromDate || defaultExportDates().from;
  const exportTo = toDate || defaultExportDates().to;
  // Local-day boundaries, same as the dashboard (rangeToISO). UTC midnight split IST
  // days at 5:30 am, so the two screens disagreed about which day an order was on.
  const isoRange = fromDate && toDate ? rangeToISO(fromDate, toDate) : null;
  const fromISO = isoRange?.fromISO;
  const toISO = isoRange?.toISO;

  // Any filter change returns to the first page.
  useEffect(() => {
    setPage(1);
  }, [status, paymentFilter, refundFilter, sortOrder, search, fromDate, toDate]);

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
          paymentMode: paymentFilter || undefined,
          refund: refundFilter || undefined,
          sort: sortOrder,
          from: fromISO,
          to: toISO,
        })}`,
      );
      setData(coercePaginatedResponse(response));
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, page, status, search, paymentFilter, refundFilter, sortOrder, fromISO, toISO]);

  // Tab counts: one call for every status in the same window as the list.
  const loadCounts = useCallback(async () => {
    if (!fromISO || !toISO) {
      setCounts(null);
      return;
    }
    try {
      setCounts(
        await api<AdminOrderStatusCounts>(
          `/admin/dashboard/order-status-counts${buildAdminQuery({ from: fromISO, to: toISO })}`,
        ),
      );
    } catch {
      setCounts(null); // Counts are a convenience — the list still works without them.
    }
  }, [api, fromISO, toISO]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);
  useAdminDataRefreshEffect(load, ["orders", "dashboard"]);
  useAdminDataRefreshEffect(loadCounts, ["orders", "dashboard"]);

  async function downloadRowInvoice(order: AdminOrderListItem) {
    if (!accessToken || invoiceBusyId) return;
    setInvoiceBusyId(order.id);
    try {
      // Generated on demand by the backend when the PDF does not exist yet.
      const response = await fetch(`${getBrowserApiBaseUrl()}/admin/orders/${order.id}/invoice.pdf`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include",
      });
      if (!response.ok) {
        throw await parseApiErrorFromResponse(response, "Unable to download invoice.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = resolveDownloadFilename(response, `${order.orderNumber}-invoice.pdf`);
      anchor.click();
      // Deferred: revoking synchronously can abort the save in Firefox/Safari.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setInvoiceBusyId(null);
    }
  }

  async function exportCsv() {
    if (!canExport) return;
    try {
      const base = resolveApiBaseUrl();
      if (!base) throw new Error("API base URL not configured");
      const query = buildOrdersExportQuery({
        from: exportFrom,
        to: exportTo,
        status: status || undefined,
        search: search.trim() || undefined,
        paymentMode: paymentFilter || undefined,
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
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  }

  // Wire the page header's Export button to this list's current filters.
  useEffect(() => {
    if (!canExport) return;
    return registerExportHandler(() => void exportCsv());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerExportHandler, exportFrom, exportTo, status, search, paymentFilter, accessToken, canExport]);

  const items = readPaginatedItems(data);
  const filtersActive = Boolean(search || paymentFilter || refundFilter || sortOrder !== "newest");

  const columns: DataColumn<AdminOrderListItem>[] = [
    {
      key: "order",
      header: "Order",
      hideOnMobile: true,
      cell: (o) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap font-medium text-foreground tabular">{o.orderNumber}</p>
          <p className="whitespace-nowrap text-xs text-muted-foreground">{formatAdminDateCompact(o.createdAt)}</p>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      hideOnMobile: true,
      cell: (o) => (
        <div className="min-w-0 max-w-56">
          <p className="truncate text-foreground">{o.customerName?.trim() || "Guest"}</p>
          <p className="truncate text-xs text-muted-foreground" title={o.customerEmail}>
            {o.customerEmail}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      hideOnMobile: true,
      cell: (o) => {
        const d = orderStatusDisplay(o.status);
        return <StatusDot tone={d.tone}>{d.label}</StatusDot>;
      },
    },
    {
      key: "payment",
      header: "Payment",
      hideOnMobile: true,
      cell: (o) => {
        const d = paymentDisplay(o);
        return <StatusDot tone={d.tone}>{d.label}</StatusDot>;
      },
    },
    {
      key: "delivery",
      header: "Delivery",
      hideBelow: "lg",
      hideOnMobile: true,
      cell: (o) => {
        const d = deliveryDisplay(o);
        return d ? <StatusDot tone={d.tone}>{d.label}</StatusDot> : <span className="whitespace-nowrap text-muted-foreground">Not shipped</span>;
      },
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      hideOnMobile: true,
      cell: (o) => <span className="whitespace-nowrap font-medium text-foreground tabular">{formatPaise(o.total)}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Invoice</span>,
      mobileLabel: "Invoice",
      hideOnMobile: true,
      align: "right",
      className: "w-12",
      cell: (o) =>
        isInvoiceEligibleOrderStatus(o.status) ? (
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            title="Download invoice"
            aria-label={`Download invoice for order ${o.orderNumber}`}
            disabled={invoiceBusyId !== null}
            onClick={() => void downloadRowInvoice(o)}
          >
            {invoiceBusyId === o.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileDown className="size-4" aria-hidden />}
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <Panel flush>
      {/* Status tabs with live counts — scroll sideways on phones, never widen the page. */}
      <div role="tablist" aria-label="Order status" className="flex min-w-0 gap-1 overflow-x-auto border-b border-border px-2 scrollbar-hide sm:px-3">
        {STATUS_TABS.map((tab) => {
          const active = status === tab.value;
          const count = counts ? (tab.value ? counts.current.byStatus[tab.value] : counts.current.total) : null;
          return (
            <button
              key={tab.value || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStatus(tab.value)}
              className={cn(
                "relative flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-sm transition-colors",
                active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {count !== null ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    count === 0 && !active ? "opacity-60" : "",
                  )}
                >
                  {count}
                </span>
              ) : null}
              {active ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
            </button>
          );
        })}
      </div>

      <div className="border-b border-border p-3 sm:px-5">
        <FilterBar
          search={{
            value: searchInput,
            onChange: (v) => {
              setSearchInput(v);
              if (v === "") setSearch("");
            },
            placeholder: "Search orders",
            label: "Search orders by number, customer, phone or AWB",
          }}
          trailing={
            filtersActive ? (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={() => {
                  setSearch("");
                  setSearchInput("");
                  setPaymentFilter("");
                  setRefundFilter("");
                  setSortOrder("newest");
                }}
              >
                Clear
              </Button>
            ) : null
          }
        >
          <FilterSelect
            label="Payment"
            value={paymentFilter}
            onChange={setPaymentFilter}
            options={[
              { value: "", label: "Any payment" },
              { value: "PREPAID", label: "Prepaid" },
              { value: "COD", label: "Cash on delivery" },
            ]}
          />
          <FilterSelect
            label="Refund"
            value={refundFilter}
            onChange={setRefundFilter}
            options={[
              { value: "", label: "Any refund state" },
              { value: "owed", label: "Refund still owed" },
            ]}
          />
          <FilterSelect
            label="Sort"
            value={sortOrder}
            onChange={setSortOrder}
            options={[
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
            ]}
          />
        </FilterBar>
      </div>

      {refundFilter === "owed" && !error ? (
        <div className="border-b border-border p-3 sm:px-5">
          <Notice tone="warning" title="Cancelled orders whose refund hasn't gone through">
            A failed refund is retried automatically for up to 3 days. Open an order to see why it failed, or retry it now.
          </Notice>
        </div>
      ) : null}

      {error ? (
        <div className="p-4 sm:p-5">
          <Notice
            tone="danger"
            title="Couldn't load orders"
            action={
              <Button type="button" variant="outline" size="lg" onClick={() => void load()}>
                Try again
              </Button>
            }
          >
            {error}
          </Notice>
        </div>
      ) : (
      <DataTable
            rows={items}
            columns={columns}
            rowKey={(o) => o.id}
            rowHref={(o) => `/admin/orders/${o.id}`}
            loading={loading}
            caption="Orders"
            mobileTitle={(o) => {
              const d = orderStatusDisplay(o.status);
              const pay = paymentDisplay(o);
              return (
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{o.customerName?.trim() || "Guest"}</p>
                    <p className="text-xs text-muted-foreground tabular">
                      {o.orderNumber} · {formatAdminDateCompact(o.createdAt)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{pay.label}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="font-semibold text-foreground tabular">{formatPaise(o.total)}</span>
                    <StatusDot tone={d.tone} className="text-xs">
                      {d.label}
                    </StatusDot>
                  </div>
                </div>
              );
            }}
            empty={
              <EmptyState
                icon={ShoppingCart}
                headline={
                  refundFilter === "owed"
                    ? "No refunds owed"
                    : search || paymentFilter || status
                      ? "No orders match these filters"
                      : "No orders in this period"
                }
                description={
                  refundFilter === "owed"
                    ? "Every cancelled prepaid order has been refunded or is with Razorpay."
                    : search || paymentFilter || status
                    ? "Try another status tab, clear the search, or widen the date range."
                    : "Orders appear here as soon as customers check out."
                }
              />
            }
          />
      )}

      {data && data.meta.total > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
          <p className="text-sm text-muted-foreground tabular">
            {Math.min((data.meta.page - 1) * data.meta.limit + 1, data.meta.total)}–
            {Math.min(data.meta.page * data.meta.limit, data.meta.total)} of {data.meta.total.toLocaleString("en-IN")}
          </p>
          <AdminPagination meta={data.meta} onPageChange={setPage} />
        </div>
      ) : null}
    </Panel>
  );
}
