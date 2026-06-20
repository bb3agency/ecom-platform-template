"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { getMyOrders, type UserOrder } from "@/lib/users-api";
import { downloadCustomerInvoicePdf } from "@/lib/orders-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { formatPrice } from "@/lib/format-price";
import { formatPaymentModeLabel } from "@/lib/format-payment-mode";
import { EmptyState } from "@/components/shared/EmptyState";

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
      await downloadCustomerInvoicePdf(
        order.id,
        accessToken,
        `${order.orderNumber}-invoice.pdf`,
      );
    } catch (err) {
      setError(getApiErrorMessage(err));
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
        if (!cancelled) {
          setOrders(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err));
        }
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
      <div className="grid gap-3 rounded-lg border border-border p-4">
        <h1 className="font-heading text-xl font-semibold sm:text-2xl">Order history</h1>
        <div className="grid gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!orders.length && !error) {
    return (
      <EmptyState
        title="No orders yet"
        description="Your placed orders will appear here."
      />
    );
  }

  return (
    <section className="grid gap-3 rounded-lg border border-border p-4">
      <h1 className="font-heading text-xl font-semibold sm:text-2xl">Order history</h1>
      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {orders.map((order) => (
        <article
          key={order.id}
          className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_auto]"
        >
          <div>
            <p className="font-medium">{order.orderNumber}</p>
            <p className="text-sm text-muted-foreground">
              {order.status}
              {order.paymentMode ? ` · ${formatPaymentModeLabel(order.paymentMode)}` : ""}
            </p>
            <p className="text-sm">{formatPrice(order.total)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/orders/${order.id}`} className="text-sm underline">
              View
            </Link>
            {order.invoice?.hasPdf ? (
              <button
                type="button"
                className="text-sm underline disabled:opacity-50"
                disabled={invoiceBusyId === order.id}
                onClick={() => void handleDownloadInvoice(order)}
              >
                {invoiceBusyId === order.id ? "Downloading…" : "Invoice"}
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}
