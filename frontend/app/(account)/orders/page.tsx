"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Package, FileDown, ChevronRight, Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { getMyOrders, type UserOrder } from "@/lib/users-api";
import { downloadCustomerInvoicePdf } from "@/lib/orders-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { formatPrice } from "@/lib/format-price";
import { formatPaymentModeLabel } from "@/lib/format-payment-mode";
import { toast } from "@/lib/toast";
import { EmptyState } from "@/components/shared/EmptyState";

/** Status → chip styling (brand-neutral status colours, same convention as the toaster). */
const STATUS_CHIP: Record<string, string> = {
  CONFIRMED: "bg-sky-50 text-sky-700 ring-sky-200",
  PROCESSING: "bg-amber-50 text-amber-700 ring-amber-200",
  SHIPPED: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  OUT_FOR_DELIVERY: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  DELIVERED: "bg-green-50 text-green-700 ring-green-200",
  CANCELLED: "bg-red-50 text-red-700 ring-red-200",
  REFUNDED: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  PENDING_PAYMENT: "bg-amber-50 text-amber-700 ring-amber-200",
};

function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatOrderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function AccountOrdersPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [orders, setOrders] = useState<UserOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [invoiceBusyId, setInvoiceBusyId] = useState<string | null>(null);

  async function handleDownloadInvoice(order: UserOrder) {
    if (!accessToken || !order.invoice?.hasPdf) return;
    setInvoiceBusyId(order.id);
    try {
      await downloadCustomerInvoicePdf(order.id, accessToken, `${order.orderNumber}-invoice.pdf`);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setInvoiceBusyId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!accessToken) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const data = await getMyOrders(accessToken);
        if (!cancelled) setOrders(data);
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-heading text-xl font-bold text-[#23403d] sm:text-2xl">Order History</h1>
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-[#efe8e4] bg-[#eff5ee]" />
          ))}
        </div>
      </div>
    );
  }

  if (!orders.length && !error) {
    return (
      <EmptyState title="No orders yet" description="Your placed orders will appear here." />
    );
  }

  return (
    <section className="flex flex-col gap-4 sm:gap-5">
      <div>
        <h1 className="font-heading text-xl font-bold text-[#23403d] sm:text-2xl">Order History</h1>
        <p className="mt-1 text-sm text-[#767676]">
          {orders.length} order{orders.length === 1 ? "" : "s"} placed
        </p>
      </div>

      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      <div className="grid gap-3">
        {orders.map((order) => {
          const chip = STATUS_CHIP[order.status] ?? "bg-zinc-100 text-zinc-700 ring-zinc-200";
          return (
            <article
              key={order.id}
              className="group rounded-2xl border border-[#efe8e4] bg-white p-4 transition-colors hover:border-[#23403d]/25 sm:p-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-[#eff5ee] text-[#23403d] sm:flex">
                    <Package className="size-5" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-[#23403d]">{order.orderNumber}</p>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${chip}`}
                      >
                        {statusLabel(order.status)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[#767676] sm:text-sm">
                      {formatOrderDate(order.createdAt)}
                      {order.paymentMode ? ` · ${formatPaymentModeLabel(order.paymentMode)}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <p className="font-heading text-base font-bold text-[#23403d]">
                    {formatPrice(order.total)}
                  </p>
                  <div className="flex items-center gap-2">
                    {order.invoice?.hasPdf ? (
                      <button
                        type="button"
                        aria-label={`Download invoice for order ${order.orderNumber}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#efe8e4] px-3 text-xs font-bold text-[#23403d] transition-colors hover:bg-[#faf3ef] disabled:opacity-50"
                        disabled={invoiceBusyId === order.id}
                        onClick={() => void handleDownloadInvoice(order)}
                      >
                        {invoiceBusyId === order.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <FileDown className="size-3.5" aria-hidden />
                        )}
                        Invoice
                      </button>
                    ) : null}
                    <Link
                      href={`/orders/${order.id}`}
                      aria-label={`View order ${order.orderNumber}`}
                      className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#23403d] px-3.5 text-xs font-bold text-white transition-colors hover:bg-[#1a302e]"
                    >
                      View
                      <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
