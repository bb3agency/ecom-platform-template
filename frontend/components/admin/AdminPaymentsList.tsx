"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminDetailDrawer } from "@/components/admin/AdminDetailDrawer";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import {
  buildAdminQuery,
  PAYMENT_FILTER_STATUSES,
  coercePaginatedResponse,
  type AdminPaymentDetail,
  type AdminPaymentListItem,
  readPaginatedItems,
  type PaginatedResponse,
} from "@/lib/admin-api";
import {
  formatAdminDate,
  formatPaise,
  paymentStatusTone,
} from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
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

interface AdminPaymentsListProps {
  from?: string;
  to?: string;
}

export function AdminPaymentsList({ from, to }: AdminPaymentsListProps = {}) {
  const api = useAuthenticatedApi();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [method, setMethod] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState(from ?? "");
  const [toDate, setToDate] = useState(to ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PaginatedResponse<AdminPaymentListItem> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminPaymentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    setFromDate(from ?? "");
    setToDate(to ?? "");
    setPage(1);
  }, [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<PaginatedResponse<AdminPaymentListItem>>(
        `/admin/payments${buildAdminQuery({
          page,
          limit: PAGE_SIZE,
          status: status || undefined,
          method: method.trim() || undefined,
          search: search.trim() || undefined,
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
  }, [api, page, status, method, search, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminDataRefreshEffect(load, ["payments", "orders", "dashboard"]);

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
    setStatus("");
    setMethod("");
    setSearch("");
    setFromDate("");
    setToDate("");
    setPage(1);
  }

  const hasFilters = Boolean(status || method || search || fromDate || toDate);
  const items = readPaginatedItems(data);

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
                className="h-9 w-full rounded-md border border-border/50 bg-muted/20 pl-9 pr-3 text-sm focus:border-zinc-900 focus:outline-none"
                placeholder="Search by transaction ID, order ID…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            {/* Status filter */}
            <select
              className="h-9 rounded-md border border-border/50 bg-muted/20 px-3 text-sm font-medium text-foreground focus:border-zinc-900 focus:outline-none sm:min-w-36"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Statuses</option>
              {PAYMENT_FILTER_STATUSES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>

            {/* Method filter */}
            <select
              className="h-9 rounded-md border border-border/50 bg-muted/20 px-3 text-sm font-medium text-foreground focus:border-zinc-900 focus:outline-none sm:min-w-44"
              value={method}
              onChange={(e) => {
                setMethod(e.target.value);
                setPage(1);
              }}
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
                  className="h-9 rounded-md border border-border/50 bg-muted/20 px-3 text-sm text-foreground focus:border-zinc-900 focus:outline-none"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                To
                <input
                  type="date"
                  className="h-9 rounded-md border border-border/50 bg-muted/20 px-3 text-sm text-foreground focus:border-zinc-900 focus:outline-none"
                  value={toDate}
                  min={fromDate || undefined}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setPage(1);
                  }}
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
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50">
                <CreditCard className="h-6 w-6" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">No payments found</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {hasFilters ? "Try adjusting your filters" : "Payment records will appear here once orders are placed"}
                </p>
              </div>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border/50 px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Clear filters
                </button>
              )}
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
                            className="font-medium text-foreground hover:text-zinc-900 hover:underline"
                          >
                            {payment.orderNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-bold text-zinc-800 uppercase">
                              {payment.customerName?.charAt(0) || "?"}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {payment.customerName || "—"}
                              </p>
                              {payment.customerEmail && (
                                <p className="truncate text-[10px] text-muted-foreground">
                                  {payment.customerEmail}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded border border-border/50 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-800 shadow-sm">
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
          <dl className="grid gap-2 text-sm">
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
