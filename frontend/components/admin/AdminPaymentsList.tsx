"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminDetailDrawer } from "@/components/admin/AdminDetailDrawer";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildAdminQuery,
  PAYMENT_FILTER_STATUSES,
  toIsoDateRange,
  type AdminPaymentDetail,
  type AdminPaymentListItem,
  type PaginatedResponse,
} from "@/lib/admin-api";
import type { AdminListFilterSpecs, AdminListQuery } from "@/lib/admin-list";
import {
  formatAdminDate,
  formatPaise,
  paymentStatusTone,
} from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminList } from "@/hooks/use-admin-list";
import {
  AlertCircle,
  Eye,
  ExternalLink,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
  CreditCard,
} from "lucide-react";

const PAGE_SIZE = 50;

type PaymentListFilters = { status: string; method: string; search: string; from: string; to: string };

const PAYMENT_METHODS = ["upi", "card", "netbanking", "wallet"] as const;

/** Dates stay out of the URL: they follow the page range picker, which owns them. */
function paymentListFilters(from?: string, to?: string): AdminListFilterSpecs<PaymentListFilters> {
  return {
    status: { defaultValue: "", allowed: PAYMENT_FILTER_STATUSES },
    method: { defaultValue: "", allowed: PAYMENT_METHODS },
    search: { defaultValue: "", param: false },
    from: { defaultValue: from ?? "", param: false },
    to: { defaultValue: to ?? "", param: false },
  };
}

interface AdminPaymentsListProps {
  from?: string;
  to?: string;
}

export function AdminPaymentsList({ from, to }: AdminPaymentsListProps = {}) {
  const api = useAuthenticatedApi();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminPaymentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fetchPage = useCallback(
    ({ page, filters }: AdminListQuery<PaymentListFilters>) =>
      api<PaginatedResponse<AdminPaymentListItem>>(
        `/admin/payments${buildAdminQuery({
          page,
          limit: PAGE_SIZE,
          status: filters.status || undefined,
          method: filters.method.trim() || undefined,
          search: filters.search.trim() || undefined,
          from: filters.from ? toIsoDateRange(filters.from) : undefined,
          to: filters.to ? toIsoDateRange(filters.to, true) : undefined,
        })}`,
      ),
    [api],
  );
  const { filters, setFilter, setFilters, data, items, loading, error, setPage } = useAdminList<
    AdminPaymentListItem,
    PaymentListFilters
  >({
    filters: paymentListFilters(from, to),
    fetchPage,
    refreshScopes: ["payments", "orders", "dashboard"],
  });
  const { status, method, search, from: fromDate, to: toDate } = filters;

  // The page date range seeds the local From/To inputs (which can then be edited).
  useEffect(() => {
    setFilters({ from: from ?? "", to: to ?? "" });
  }, [from, to, setFilters]);

  async function openDetail(paymentId: string) {
    setSelectedId(paymentId);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await api<AdminPaymentDetail>(`/admin/payments/${paymentId}`);
      setDetail(response);
    } catch (err) {
      setDetailError(getApiErrorMessage(err));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function clearFilters() {
    setFilters({ status: "", method: "", search: "", from: "", to: "" });
  }

  const hasFilters = Boolean(status || method || search || fromDate || toDate);

  return (
    <>
      <div className="flex flex-col gap-4 min-w-0">
        {/* Filter bar */}
        <div className="flex flex-col gap-3 rounded-xl border border-border/40 bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4">
            {/* Search */}
            <div className="relative flex-1 min-w-0 sm:max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                className="h-9 w-full rounded-md border border-border/50 bg-muted/20 pl-9 pr-3 text-sm focus:border-primary focus:outline-none"
                placeholder="Search by transaction ID, order ID…"
                value={search}
                onChange={(e) => setFilter("search", e.target.value)}
              />
            </div>

            {/* Status filter */}
            <select
              className="h-9 rounded-md border border-border/50 bg-muted/20 px-3 text-sm font-medium text-foreground focus:border-primary focus:outline-none sm:min-w-36"
              value={status}
              onChange={(e) => setFilter("status", e.target.value)}
            >
              <option value="">All Statuses</option>
              {PAYMENT_FILTER_STATUSES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>

            {/* Method filter */}
            <select
              className="h-9 rounded-md border border-border/50 bg-muted/20 px-3 text-sm font-medium text-foreground focus:border-primary focus:outline-none sm:min-w-44"
              value={method}
              onChange={(e) => setFilter("method", e.target.value)}
            >
              <option value="">All Methods</option>
              <option value="upi">UPI</option>
              <option value="card">Cards</option>
              <option value="netbanking">Netbanking</option>
              <option value="wallet">Wallet</option>
            </select>

            {/* Date range */}
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                From
                <input
                  type="date"
                  className="h-9 rounded-md border border-border/50 bg-muted/20 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
                  value={fromDate}
                  onChange={(e) => setFilter("from", e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                To
                <input
                  type="date"
                  className="h-9 rounded-md border border-border/50 bg-muted/20 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
                  value={toDate}
                  min={fromDate || undefined}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setFilter("to", e.target.value)}
                />
              </label>

              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-border/50 px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Table card */}
        <div className="flex flex-col rounded-xl border border-border/40 bg-card shadow-sm min-w-0 overflow-hidden">
          {loading && items.length === 0 ? (
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-4 w-40 flex-1" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={CreditCard}
                headline="No payments found"
                description={
                  hasFilters
                    ? "Try adjusting your filters"
                    : "Payment records will appear here once orders are placed"
                }
                action={
                  hasFilters ? (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <AdminTableScroll>
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="border-b border-border/40 bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Transaction ID</th>
                      <th className="px-4 py-3 font-medium">Order</th>
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 font-medium">Method</th>
                      <th className="px-4 py-3 font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {items.map((payment) => (
                      <tr key={payment.id} className="group hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
                          {payment.providerPaymentId || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/orders/${payment.orderId}`}
                            className="font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {payment.orderNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground uppercase">
                              {payment.customerName?.charAt(0) || "?"}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {payment.customerName || "—"}
                              </p>
                              {payment.customerEmail && (
                                <p className="truncate text-xs text-muted-foreground">
                                  {payment.customerEmail}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded border border-border bg-background px-1.5 py-0.5 text-xs font-bold text-foreground shadow-sm">
                              {payment.provider === "razorpay" ? "RZP" : payment.provider.toUpperCase()}
                            </span>
                            <span className="text-xs text-muted-foreground">{payment.method || "—"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground">
                          {formatPaise(payment.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <AdminStatusBadge
                            label={
                              payment.status.toUpperCase() === "CAPTURED" || payment.status.toUpperCase() === "PAID"
                                ? "Successful"
                                : payment.status
                            }
                            tone={paymentStatusTone(payment.status)}
                          />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {payment.capturedAt
                            ? formatAdminDate(payment.capturedAt)
                            : formatAdminDate(payment.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              aria-label="View payment details"
                              onClick={() => void openDetail(payment.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <Link
                              href={`/admin/orders/${payment.orderId}`}
                              aria-label="View order"
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AdminTableScroll>

              <div className="border-t border-border/40 p-4">
                {data && <AdminPagination meta={data.meta} onPageChange={setPage} />}
              </div>
            </>
          )}
        </div>
      </div>

      <AdminDetailDrawer
        open={Boolean(selectedId)}
        title={detail ? `Payment · ${detail.orderNumber}` : "Payment detail"}
        onClose={() => {
          setSelectedId(null);
          setDetail(null);
          setDetailError(null);
        }}
      >
        {detailLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : detailError ? (
          <p className="text-sm text-destructive">{detailError}</p>
        ) : detail ? (
          <dl className="grid min-w-0 grid-cols-1 gap-2 text-sm">
            <DetailRow label="Provider" value={detail.provider} />
            <DetailRow label="Status" value={detail.status} />
            <DetailRow label="Method" value={detail.method ?? "—"} />
            <DetailRow label="Amount" value={formatPaise(detail.amount)} />
            <DetailRow label="Currency" value={detail.currency} />
            <DetailRow label="Provider payment ID" value={detail.providerPaymentId ?? "—"} />
            <DetailRow label="Provider order ID" value={detail.providerOrderId ?? "—"} />
            <DetailRow label="Captured" value={detail.capturedAt ? formatAdminDate(detail.capturedAt) : "—"} />
            <DetailRow label="Refunded" value={formatPaise(detail.refundedAmountPaise ?? 0)} />
            {(detail.refundPendingAmountPaise ?? 0) > 0 ? (
              <DetailRow label="Refund pending" value={formatPaise(detail.refundPendingAmountPaise ?? 0)} />
            ) : null}
            <DetailRow label="Created" value={formatAdminDate(detail.createdAt)} />
            <DetailRow label="Updated" value={formatAdminDate(detail.updatedAt)} />
            <Link
              href={`/admin/orders/${detail.orderId}`}
              className="mt-2 inline-block text-primary hover:underline"
            >
              View order →
            </Link>
          </dl>
        ) : null}
      </AdminDetailDrawer>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
