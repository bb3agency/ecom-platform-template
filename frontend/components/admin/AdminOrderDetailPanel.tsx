"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { KeyValueList, Notice, PageHeader, Panel, StatusDot } from "@/components/ui/console";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import type { AdminOrderDetailFull } from "@/lib/admin-api";
import { getBrowserApiBaseUrl } from "@/lib/api-base";
import { resolveDownloadFilename } from "@/lib/download-filename";
import { parseApiErrorFromResponse } from "@/lib/api";
import {
  formatAdminDate,
  formatPaise,
  orderStatusDisplay,
  paymentStatusDisplay,
  sentenceCaseEnum,
} from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { isInvoiceEligibleOrderStatus } from "@/lib/order-status-ui";
import { toast } from "@/lib/toast";
import { useAuthStore } from "@/stores/auth";

/** One fetch for the whole detail page; panels below receive the order as a prop. */
export function useAdminOrderDetail(orderId: string) {
  const api = useAuthenticatedApi();
  const [order, setOrder] = useState<AdminOrderDetailFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setOrder(await api<AdminOrderDetailFull>(`/admin/orders/${orderId}`));
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, orderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { order, loading, error, reload };
}

function useInvoiceDownload(order: AdminOrderDetailFull | null, onGenerated: () => void) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [busy, setBusy] = useState(false);

  async function download() {
    if (!order || !accessToken) return;
    setBusy(true);
    try {
      const response = await fetch(`${getBrowserApiBaseUrl()}/admin/orders/${order.id}/invoice.pdf`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include",
      });
      if (!response.ok) throw await parseApiErrorFromResponse(response, "Unable to download invoice.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = resolveDownloadFilename(
        response,
        order.invoice?.invoiceNumber ? `${order.invoice.invoiceNumber}.pdf` : `${order.orderNumber}-invoice.pdf`,
      );
      anchor.click();
      // Deferred: revoking synchronously can abort the save in Firefox/Safari.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      // The first download may have generated the invoice — refresh to show its number.
      if (!order.invoice?.hasPdf) onGenerated();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return { download, busy };
}

export function AdminOrderDetailHeader({
  order,
  onChanged,
}: {
  order: AdminOrderDetailFull;
  onChanged: () => void;
}) {
  const status = orderStatusDisplay(order.status);
  const invoice = useInvoiceDownload(order, onChanged);
  const canInvoice = Boolean(order.invoice?.hasPdf) || isInvoiceEligibleOrderStatus(order.status);

  return (
    <PageHeader
      breadcrumbs={[{ label: "Orders", href: "/admin/orders" }, { label: order.orderNumber }]}
      title={<span className="tabular">{order.orderNumber}</span>}
      meta={<StatusDot tone={status.tone}>{status.label}</StatusDot>}
      description={
        <>
          {formatAdminDate(order.createdAt)} · {order.paymentMode === "COD" ? "Cash on delivery" : "Prepaid"} ·{" "}
          <span className="font-medium text-foreground tabular">{formatPaise(order.total)}</span>
        </>
      }
      actions={
        canInvoice ? (
          <Button type="button" variant="outline" size="lg" onClick={() => void invoice.download()} disabled={invoice.busy}>
            {invoice.busy ? <Loader2 className="animate-spin" aria-hidden /> : <FileDown aria-hidden />}
            {order.invoice?.invoiceNumber ? `Invoice ${order.invoice.invoiceNumber}` : "Download invoice"}
          </Button>
        ) : null
      }
    />
  );
}

/** Context column: who, where, how they paid, how it ships. */
export function AdminOrderContextColumn({ order }: { order: AdminOrderDetailFull }) {
  const address = order.shippingAddress;
  const payment = order.payment ? paymentStatusDisplay(order.payment.status) : null;

  return (
    <>
      <Panel
        title="Customer"
        actions={
          <Link href={`/admin/customers/${order.userId}`} className="text-sm font-medium text-primary hover:underline">
            View profile
          </Link>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="min-w-0">
            <p className="font-medium text-foreground">{order.customer.name}</p>
            {order.customer.email ? (
              <a href={`mailto:${order.customer.email}`} className="block break-all text-sm text-muted-foreground hover:text-foreground">
                {order.customer.email}
              </a>
            ) : null}
            {order.customer.phone ? (
              <a href={`tel:${order.customer.phone}`} className="block text-sm text-muted-foreground tabular hover:text-foreground">
                {order.customer.phone}
              </a>
            ) : null}
          </div>
          <div className="min-w-0 border-t border-border pt-4">
            <p className="mb-1 text-xs text-muted-foreground">Ship to</p>
            {address ? (
              <address className="text-sm not-italic leading-relaxed text-foreground">
                {address.fullName}
                <br />
                {address.line1}
                {address.line2 ? (
                  <>
                    <br />
                    {address.line2}
                  </>
                ) : null}
                <br />
                {address.city}, {address.state} <span className="tabular">{address.pincode}</span>
              </address>
            ) : (
              <p className="text-sm text-muted-foreground">No address on file</p>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Payment">
        {order.payment && payment ? (
          <KeyValueList
            className="sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
            items={[
              { label: "Status", value: <StatusDot tone={payment.tone}>{payment.label}</StatusDot> },
              { label: "Amount", value: <span className="tabular">{formatPaise(order.payment.amount)}</span> },
              { label: "Method", value: order.payment.method ? sentenceCaseEnum(order.payment.method) : "—" },
              { label: "Provider", value: sentenceCaseEnum(order.payment.provider) },
              ...(order.payment.refundedAmountPaise > 0
                ? [{ label: "Refunded", value: <span className="tabular">{formatPaise(order.payment.refundedAmountPaise)}</span> }]
                : []),
              ...(order.coupon
                ? [{ label: "Coupon", value: <span className="font-medium">{order.coupon.code}</span> }]
                : []),
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No payment recorded yet.</p>
        )}
      </Panel>

      <Panel title="Shipping">
        {order.shipment ? (
          <KeyValueList
            className="sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
            items={[
              { label: "Status", value: sentenceCaseEnum(order.shipment.status) },
              { label: "AWB", value: <span className="break-all tabular">{order.shipment.awb ?? "Not booked"}</span> },
              ...(order.shipment.trackingUrl
                ? [
                    {
                      label: "Tracking",
                      wide: true,
                      value: (
                        <a
                          href={order.shipment.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          Open tracking page <ExternalLink className="size-3.5" aria-hidden />
                        </a>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {order.isLocalDelivery ? "Local delivery — your team delivers this order." : "Not shipped yet."}
          </p>
        )}
        {order.packingBox && !order.isLocalDelivery ? (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">Pack in a box at least</p>
            <p className="mt-0.5 text-sm text-foreground tabular">
              {order.packingBox.lengthCm} × {order.packingBox.widthCm} × {order.packingBox.heightCm} cm ·{" "}
              {(order.packingBox.weightGrams / 1000).toFixed(2)} kg sealed
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {packingBoxSourceLabel(order.packingBox)} · includes {order.packingBox.packagingWeightGrams} g packaging.
              These are the dimensions declared to the courier.
            </p>
          </div>
        ) : null}
      </Panel>

      {order.notes ? (
        <Panel title="Customer note">
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{order.notes}</p>
        </Panel>
      ) : null}
    </>
  );
}

export function AdminOrderDetailError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice
      tone="danger"
      title="Couldn't load this order"
      action={
        <Button type="button" variant="outline" size="lg" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {message}
    </Notice>
  );
}

function packingBoxSourceLabel(box: {
  source: "catalog" | "computed" | "single-item" | "default-fallback";
  boxName: string | null;
}): string {
  if (box.source === "catalog") return box.boxName ?? "Catalog box";
  if (box.source === "single-item") return "Single item";
  if (box.source === "default-fallback") return "Default box (set variant dimensions for accuracy)";
  return "Best-fit box";
}
