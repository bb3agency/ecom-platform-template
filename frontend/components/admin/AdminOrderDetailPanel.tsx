"use client";

import Link from "next/link";
import { FileDown, User, MapPin, CreditCard, Truck, Tag } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import type { AdminOrderDetailFull } from "@/lib/admin-api";
import { getBrowserApiBaseUrl } from "@/lib/api-base";
import {
  formatAdminDate,
  formatPaise,
  orderStatusTone,
  paymentStatusTone,
} from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthStore } from "@/stores/auth";

interface AdminOrderDetailPanelProps {
  orderId: string;
}

export function AdminOrderDetailPanel({ orderId }: AdminOrderDetailPanelProps) {
  const api = useAuthenticatedApi();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [loading, setLoading] = useState(true);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<AdminOrderDetailFull | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await api<AdminOrderDetailFull>(`/admin/orders/${orderId}`);
      setOrder(detail);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [api, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const address = order?.shippingAddress;

  async function downloadInvoice() {
    if (!order?.invoice?.hasPdf || !accessToken) return;
    setDownloadingInvoice(true);
    try {
      const url = `${getBrowserApiBaseUrl()}/admin/orders/${orderId}/invoice.pdf`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Unable to download invoice.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${order.invoice.invoiceNumber}.pdf`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invoice download failed.");
    } finally {
      setDownloadingInvoice(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="h-6 w-40 animate-pulse rounded-md bg-muted" />
        <div className="mt-2 h-4 w-24 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!order) return null;

  const shipmentStatusTone = (s: string) => {
    if (s === "DELIVERED") return "success";
    if (s === "CANCELLED") return "destructive";
    if (["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(s)) return "warning";
    return "default";
  };

  return (
    <div className="grid gap-4">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-card px-6 py-5">
        <div className="grid gap-1">
          <h1 className="font-heading text-xl font-semibold">{order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {formatAdminDate(order.createdAt)} · {order.paymentMode}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminStatusBadge
            label={order.status}
            tone={orderStatusTone(order.status)}
          />
          {order.invoice?.hasPdf ? (
            <button
              type="button"
              disabled={downloadingInvoice}
              onClick={() => void downloadInvoice()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/50 disabled:opacity-60"
            >
              <FileDown className="h-3.5 w-3.5" />
              {downloadingInvoice ? "Downloading…" : "Invoice PDF"}
            </button>
          ) : null}
        </div>
      </div>

      {/* Summary grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <InfoCard icon={<User className="h-4 w-4" />} title="Customer">
          <p className="font-medium leading-tight">{order.customer.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {order.customer.email ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            {order.customer.phone ?? "—"}
          </p>
          <Link
            href={`/admin/customers/${order.userId}`}
            className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
          >
            View customer →
          </Link>
        </InfoCard>

        <InfoCard icon={<MapPin className="h-4 w-4" />} title="Ship to">
          {address ? (
            <>
              <p className="font-medium leading-tight">{address.fullName}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{address.line1}</p>
              {address.line2 ? (
                <p className="text-xs text-muted-foreground">{address.line2}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {address.city}, {address.state} {address.pincode}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </InfoCard>

        <InfoCard icon={<CreditCard className="h-4 w-4" />} title="Payment">
          {order.payment ? (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Status</span>
                <AdminStatusBadge
                  label={order.payment.status}
                  tone={paymentStatusTone(order.payment.status)}
                />
              </div>
              <Row label="Provider" value={order.payment.provider} />
              <Row label="Method" value={order.payment.method ?? "—"} />
              <Row label="Amount" value={formatPaise(order.payment.amount)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No payment record</p>
          )}
        </InfoCard>

        <InfoCard icon={<Truck className="h-4 w-4" />} title="Shipment">
          {order.shipment ? (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Status</span>
                <AdminStatusBadge
                  label={order.shipment.status}
                  tone={shipmentStatusTone(order.shipment.status)}
                />
              </div>
              <Row label="AWB" value={order.shipment.awb ?? "—"} />
              {order.shipment.trackingUrl ? (
                <a
                  href={order.shipment.trackingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 text-xs font-medium text-primary hover:underline"
                >
                  Track shipment →
                </a>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not shipped yet</p>
          )}
        </InfoCard>

        <InfoCard icon={<Tag className="h-4 w-4" />} title="Coupon">
          {order.coupon ? (
            <div className="grid gap-1.5">
              <Row label="Code" value={order.coupon.code} />
              <Row label="Discount" value={getCouponDiscountDisplay(order.coupon)} />
              <Row label="Min. Order" value={formatPaise(order.coupon.minOrderPaise)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No coupon applied</p>
          )}
        </InfoCard>
      </div>

      {/* Order totals */}
      <div className="rounded-xl border border-border bg-card px-6 py-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <TotalItem label="Subtotal" value={formatPaise(order.subtotal)} />
          <span className="hidden text-border sm:block">|</span>
          <TotalItem label="Shipping" value={formatPaise(order.shippingCharge)} />
          <span className="hidden text-border sm:block">|</span>
          <TotalItem label="Discount" value={formatPaise(order.discountAmount)} />
          <span className="hidden text-border sm:block">|</span>
          <TotalItem label="Total" value={formatPaise(order.total)} bold />
        </div>
      </div>

      {order.notes ? (
        <div className="rounded-xl border border-border bg-card px-6 py-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Order notes
          </p>
          <p className="text-sm">{order.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

function InfoCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function TotalItem({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={bold ? "text-base font-semibold" : "text-sm font-medium"}>
        {value}
      </span>
    </div>
  );
}

function getCouponDiscountDisplay(coupon: {
  type: string;
  value: number;
}): string {
  if (coupon.type === "PERCENTAGE_OFF") {
    return `${coupon.value}%`;
  }
  if (coupon.type === "FREE_SHIPPING") {
    return "Free Shipping";
  }
  return formatPaise(coupon.value);
}
