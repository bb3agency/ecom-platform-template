"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  FileDown,
  Loader2,
  MapPin,
  Package,
  Receipt,
  Truck,
  ExternalLink,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import {
  getMyOrder,
  cancelMyOrder,
  createReturnRequest,
  downloadCustomerInvoicePdf,
  type OrderSummary,
  type OrderLineItem,
} from "@/lib/orders-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { formatPrice } from "@/lib/format-price";
import { formatPaymentModeLabel } from "@/lib/format-payment-mode";
import { shippingProviderLabel } from "@/lib/shipping-provider-labels";
import { formatOrderDate, orderStatusChipClass, orderStatusLabel } from "@/lib/order-status-ui";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { OrderReviewPrompt } from "@/components/product/OrderReviewPrompt";
import { useStoreConfig } from "@/components/providers/StoreConfigProvider";

const PLACEHOLDER_IMAGE = "/images/product-placeholder.svg";

/** Card shell shared by every section on this page. */
function DetailCard({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#efe8e4] bg-white p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eff5ee] text-[#23403d]">
            {icon}
          </div>
          <h2 className="font-heading text-base font-bold text-[#23403d] sm:text-lg">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** One order line — thumbnail + names + qty; deep-links to the PDP when still purchasable. */
function OrderItemRow({ item }: { item: OrderLineItem }) {
  const canLink = Boolean(item.productSlug) && item.isPurchasable !== false;
  const href = item.productSlug
    ? `/products/${item.productSlug}?variant=${encodeURIComponent(item.variantId)}`
    : null;

  const content = (
    <>
      <div className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-[#efe8e4] bg-[#faf3ef] sm:size-16">
        <Image
          src={item.imageUrl || PLACEHOLDER_IMAGE}
          alt={item.productName}
          fill
          sizes="64px"
          className="object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[#23403d]">
          {item.productName}
          {canLink && (
            <ExternalLink className="ml-1.5 inline size-3 text-[#767676] opacity-0 transition-opacity group-hover/item:opacity-100" aria-hidden />
          )}
        </p>
        <p className="truncate text-xs text-[#767676]">{item.variantName}</p>
        <p className="mt-0.5 text-xs text-[#767676]">
          {item.quantity} × {formatPrice(item.unitPrice)}
        </p>
      </div>
      <p className="shrink-0 text-sm font-bold text-[#23403d]">{formatPrice(item.totalPrice)}</p>
    </>
  );

  if (canLink && href) {
    return (
      <Link
        href={href}
        className="group/item flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-[#faf3ef]/70 sm:gap-4"
        aria-label={`View ${item.productName} (${item.variantName}) on the store`}
      >
        {content}
      </Link>
    );
  }
  return <div className="flex items-center gap-3 p-2 sm:gap-4">{content}</div>;
}

export default function AccountOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { returnsEnabled } = useStoreConfig();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);

  // Return request states
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [returnItems, setReturnItems] = useState<
    Record<string, { quantity: number; reason: string; selected: boolean }>
  >({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!accessToken || !params.id) {
        return;
      }
      try {
        const result = await getMyOrder(params.id, accessToken);
        if (!cancelled) {
          setOrder(result);
          // Initialize return items configuration
          const initialReturnConfig: Record<string, { quantity: number; reason: string; selected: boolean }> = {};
          result.items?.forEach((item) => {
            initialReturnConfig[item.id] = {
              quantity: item.quantity,
              reason: "",
              selected: false,
            };
          });
          setReturnItems(initialReturnConfig);
        }
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accessToken, params.id]);

  const handleCancel = async () => {
    if (!accessToken || !order) return;
    if (!confirm("Are you sure you want to cancel this order?")) return;
    setBusyAction("cancel");
    try {
      await cancelMyOrder(order.id, accessToken, "Cancelled by customer");
      const result = await getMyOrder(order.id, accessToken);
      setOrder(result);
      toast.success("Order cancelled");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRetryPayment = () => {
    if (!order) return;
    router.push(`/checkout/payment?orderId=${order.id}`);
  };

  const handleDownloadInvoice = async () => {
    if (!accessToken || !order?.invoice?.hasPdf) return;
    setDownloadingInvoice(true);
    try {
      await downloadCustomerInvoicePdf(order.id, accessToken, `${order.invoice.invoiceNumber}.pdf`);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setDownloadingInvoice(false);
    }
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !order) return;

    const selectedItems = Object.entries(returnItems)
      .filter(([, config]) => config.selected)
      .map(([orderItemId, config]) => ({
        orderItemId,
        quantity: config.quantity,
        reason: config.reason || undefined,
      }));

    if (selectedItems.length === 0) {
      toast.error("Please select at least one item to return.");
      return;
    }

    if (!returnReason.trim()) {
      toast.error("Please provide an overall reason for the return.");
      return;
    }

    setBusyAction("return");
    try {
      await createReturnRequest(
        order.id,
        {
          items: selectedItems,
          reason: returnReason,
        },
        accessToken,
      );
      setShowReturnForm(false);
      setReturnReason("");
      setReturnItems({});
      const result = await getMyOrder(order.id, accessToken);
      setOrder(result);
      // Re-initialise return item config from refreshed order
      const refreshed: Record<string, { quantity: number; reason: string; selected: boolean }> = {};
      result.items?.forEach((item) => {
        refreshed[item.id] = { quantity: item.quantity, reason: "", selected: false };
      });
      setReturnItems(refreshed);
      toast.success("Return request submitted");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusyAction(null);
    }
  };

  if (error && !order) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!order) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-24 animate-pulse rounded-2xl border border-[#efe8e4] bg-[#eff5ee]" />
        <div className="h-48 animate-pulse rounded-2xl border border-[#efe8e4] bg-[#eff5ee]" />
        <div className="h-64 animate-pulse rounded-2xl border border-[#efe8e4] bg-[#eff5ee]" />
      </div>
    );
  }

  const canCancel = ["CONFIRMED", "PROCESSING"].includes(order.status);
  const canRetry =
    order.paymentMode !== "COD" &&
    (order.status === "PENDING_PAYMENT" || order.status === "PAYMENT_FAILED");
  const addr = order.shippingAddress;
  const items = order.items ?? [];
  // Return flow: latest request (if any) + whether a new one may be filed. The merchant toggle
  // (returnsEnabled) and any in-flight request both hide the CTA; the backend enforces the same.
  const returnRequests = order.returnRequests ?? [];
  const latestReturn = returnRequests[0] ?? null;
  const hasOpenReturn =
    latestReturn !== null && ["REQUESTED", "APPROVED", "PICKED_UP"].includes(latestReturn.status);
  const canRequestReturn =
    returnsEnabled && order.status === "DELIVERED" && !hasOpenReturn;

  return (
    <section className="flex flex-col gap-4 sm:gap-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[#efe8e4] bg-white p-4 sm:p-6">
        <Link
          href="/orders"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#767676] transition-colors hover:text-[#ec6e55]"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to orders
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-heading text-xl font-bold text-[#23403d] sm:text-2xl">
                {order.orderNumber}
              </h1>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${orderStatusChipClass(order.status)}`}
              >
                {orderStatusLabel(order.status)}
              </span>
            </div>
            <p className="mt-1 text-sm text-[#767676]">
              Placed {formatOrderDate(order.createdAt ?? "")} · {formatPaymentModeLabel(order.paymentMode)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {order.invoice?.hasPdf ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={downloadingInvoice || busyAction !== null}
                onClick={() => void handleDownloadInvoice()}
              >
                {downloadingInvoice ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <FileDown className="size-3.5" aria-hidden />
                )}
                Invoice PDF
              </Button>
            ) : null}
            {canRetry && (
              <Button
                variant="default"
                size="sm"
                className="bg-[#23403d] hover:bg-[#1a302e]"
                disabled={busyAction !== null}
                onClick={() => handleRetryPayment()}
              >
                Retry Payment
              </Button>
            )}
            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                disabled={busyAction !== null}
                onClick={handleCancel}
              >
                {busyAction === "cancel" ? "Cancelling…" : "Cancel Order"}
              </Button>
            )}
          </div>
        </div>

        {canRetry && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            {order.status === "PAYMENT_FAILED"
              ? "Payment failed for this order. Please retry to complete your purchase."
              : 'Payment is pending for this order. Click "Retry Payment" to complete your purchase.'}
          </div>
        )}
      </div>

      {/* ── Items ──────────────────────────────────────────────────────── */}
      <DetailCard icon={<Package className="size-4" aria-hidden />} title={`Items (${items.length})`}>
        <div className="flex flex-col divide-y divide-[#f5efe9]">
          {items.map((item) => (
            <OrderItemRow key={item.id} item={item} />
          ))}
        </div>
      </DetailCard>

      {/* ── Invoice ────────────────────────────────────────────────────── */}
      <DetailCard
        icon={<Receipt className="size-4" aria-hidden />}
        title="Invoice"
        action={
          order.invoice?.hasPdf ? (
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#efe8e4] px-3 text-xs font-bold text-[#23403d] transition-colors hover:bg-[#faf3ef] disabled:opacity-50"
              disabled={downloadingInvoice}
              onClick={() => void handleDownloadInvoice()}
            >
              {downloadingInvoice ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <FileDown className="size-3.5" aria-hidden />
              )}
              Download PDF
            </button>
          ) : undefined
        }
      >
        {order.invoice ? (
          <p className="mb-3 text-xs text-[#767676]">
            Invoice <span className="font-mono font-bold text-[#23403d]">{order.invoice.invoiceNumber}</span>
            {" · "}issued {formatOrderDate(order.invoice.issuedAt)}
          </p>
        ) : null}

        {/* Line items — scrollable on narrow screens. Totals live OUTSIDE the scroll container
            so Subtotal/Shipping/Total are always fully visible on mobile. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[340px] text-sm">
            <thead>
              <tr className="border-b border-[#efe8e4] text-left text-[11px] font-bold uppercase tracking-wider text-[#767676]">
                <th scope="col" className="py-2.5 pr-2 font-bold">Item</th>
                <th scope="col" className="px-2 py-2.5 text-center font-bold">Qty</th>
                <th scope="col" className="hidden px-2 py-2.5 text-right font-bold sm:table-cell">Unit Price</th>
                <th scope="col" className="py-2.5 pl-2 text-right font-bold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f5efe9]">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="py-3 pr-2">
                    <p className="font-medium text-[#23403d]">{item.productName}</p>
                    <p className="text-xs text-[#767676]">
                      {item.variantName} · SKU {item.sku}
                      {/* Unit price folds into the item cell on mobile (hidden column). */}
                      <span className="sm:hidden"> · {formatPrice(item.unitPrice)} each</span>
                    </p>
                  </td>
                  <td className="px-2 py-3 text-center text-[#23403d]">{item.quantity}</td>
                  <td className="hidden px-2 py-3 text-right text-[#23403d] sm:table-cell">
                    {formatPrice(item.unitPrice)}
                  </td>
                  <td className="py-3 pl-2 text-right font-medium text-[#23403d]">
                    {formatPrice(item.totalPrice)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals — static block, never horizontally clipped. */}
        <div className="mt-3 flex flex-col gap-1.5 border-t border-[#efe8e4] pt-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#767676]">Subtotal</span>
            <span className="font-medium text-[#23403d]">{formatPrice(order.subtotal)}</span>
          </div>
          {order.discountAmount > 0 && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#767676]">
                Discount
                {order.couponCode ? (
                  <span className="ml-1.5 rounded-full bg-[#eff5ee] px-2 py-0.5 font-mono text-[10px] font-bold text-[#23403d]">
                    {order.couponCode}
                  </span>
                ) : null}
              </span>
              <span className="font-medium text-[#00aa63]">-{formatPrice(order.discountAmount)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#767676]">Shipping</span>
            <span className="font-medium text-[#23403d]">
              {order.shippingCharge > 0 ? formatPrice(order.shippingCharge) : "Free"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-[#efe8e4] pt-2.5">
            <span className="font-heading text-base font-bold text-[#23403d]">Total</span>
            <span className="font-heading text-base font-bold text-[#ec6e55]">
              {formatPrice(order.total)}
            </span>
          </div>
        </div>
      </DetailCard>

      {/* ── Shipping address ───────────────────────────────────────────── */}
      {addr ? (
        <DetailCard icon={<MapPin className="size-4" aria-hidden />} title="Shipping Address">
          <address className="text-sm not-italic leading-relaxed text-[#767676]">
            <p className="font-bold text-[#23403d]">{addr.fullName}</p>
            <p>{addr.phone}</p>
            <p>
              {addr.line1}
              {addr.line2 ? `, ${addr.line2}` : ""}
            </p>
            <p>
              {addr.city}, {addr.state} {addr.pincode}
            </p>
          </address>
        </DetailCard>
      ) : null}

      <OrderReviewPrompt orderId={order.id} orderStatus={order.status} />

      {/* Existing return request status — visible whatever the toggle says. */}
      {latestReturn ? (
        <div className="rounded-2xl border border-[#efe8e4] bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-base font-bold text-[#23403d]">Return Request</h2>
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${
                latestReturn.status === "REJECTED"
                  ? "bg-red-50 text-red-700 ring-red-200"
                  : latestReturn.status === "REFUNDED"
                    ? "bg-green-50 text-green-700 ring-green-200"
                    : "bg-sky-50 text-sky-700 ring-sky-200"
              }`}
            >
              {orderStatusLabel(latestReturn.status)}
            </span>
          </div>
          <p className="mt-2 text-sm text-[#767676]">
            Filed {formatOrderDate(latestReturn.createdAt)} — “{latestReturn.reason}”
          </p>
          {latestReturn.adminNote ? (
            <p className="mt-2 rounded-lg bg-[#faf3ef]/70 px-3 py-2 text-xs text-[#767676]">
              <span className="font-bold text-[#23403d]">Store note:</span> {latestReturn.adminNote}
            </p>
          ) : null}
        </div>
      ) : null}

      {canRequestReturn && !showReturnForm && (
        <div className="rounded-2xl border border-[#efe8e4] bg-white p-4 text-center sm:p-5">
          <p className="mb-3 text-sm text-[#767676]">Is there an issue with your items?</p>
          <Button variant="outline" size="sm" onClick={() => setShowReturnForm(true)}>
            Request a Return / Replacement
          </Button>
        </div>
      )}

      {canRequestReturn && showReturnForm && (
        <form
          onSubmit={handleReturnSubmit}
          className="grid gap-4 rounded-2xl border border-[#ec6e55]/30 bg-[#faf3ef]/40 p-4 sm:p-5"
        >
          <h2 className="font-heading text-lg font-bold text-[#23403d]">Request a Return</h2>
          <p className="mb-2 text-xs text-[#767676]">
            Select the items you would like to return and specify the details.
          </p>

          <div className="grid gap-4">
            {order.items?.map((item) => {
              const config = returnItems[item.id] || { selected: false, quantity: item.quantity, reason: "" };
              return (
                <div key={item.id} className="grid gap-2 rounded-xl border border-[#efe8e4] bg-white p-3 text-sm">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id={`check-${item.id}`}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-[#ec6e55] focus:ring-[#ec6e55]"
                      checked={config.selected}
                      onChange={(e) =>
                        setReturnItems({
                          ...returnItems,
                          [item.id]: { ...config, selected: e.target.checked },
                        })
                      }
                    />
                    <label htmlFor={`check-${item.id}`} className="flex-1 cursor-pointer font-medium">
                      {item.productName} ({item.variantName})
                    </label>
                  </div>
                  {config.selected && (
                    <div className="mt-2 grid gap-3 pl-7">
                      <div>
                        <label className="mb-1 block text-xs font-medium">Quantity</label>
                        <input
                          type="number"
                          min={1}
                          max={item.quantity}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={config.quantity}
                          onChange={(e) =>
                            setReturnItems({
                              ...returnItems,
                              [item.id]: {
                                ...config,
                                quantity: Math.min(item.quantity, Math.max(1, parseInt(e.target.value) || 1)),
                              },
                            })
                          }
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs font-medium">Reason for this item (Optional)</label>
                        <input
                          type="text"
                          placeholder="e.g. damaged, wrong size"
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={config.reason}
                          onChange={(e) =>
                            setReturnItems({
                              ...returnItems,
                              [item.id]: { ...config, reason: e.target.value },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-2 grid gap-1.5">
            <label className="block text-xs font-bold">Overall return reason</label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Please specify why you are raising this return request..."
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              required
            />
          </div>

          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busyAction === "return"}
              onClick={() => setShowReturnForm(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="default" size="sm" disabled={busyAction === "return"}>
              {busyAction === "return" ? "Submitting…" : "Submit Return"}
            </Button>
          </div>
        </form>
      )}

      {/* ── Local delivery (no courier/AWB ever exists for these orders) ── */}
      {order.isLocalDelivery && !order.shipment?.awb && (
        <DetailCard icon={<Truck className="size-4" aria-hidden />} title="Delivery">
          <p className="text-sm text-[#767676]">
            This order is delivered directly by the store — no courier tracking number is
            issued. You&apos;ll be notified as it moves through packing, out for delivery,
            and delivered.
          </p>
        </DetailCard>
      )}

      {/* ── Tracking ───────────────────────────────────────────────────── */}
      {order.shipment?.awb && (
        <DetailCard icon={<Truck className="size-4" aria-hidden />} title="Tracking">
          <div className="text-sm">
            <p className="mb-1.5">
              <span className="font-bold text-[#23403d]">AWB:</span>{" "}
              <span className="font-mono text-[#767676]">{order.shipment.awb}</span>
            </p>
            <p className="mb-3">
              <span className="font-bold text-[#23403d]">Status:</span>{" "}
              <span className="text-[#767676]">{order.shipment.status}</span>
            </p>
            {order.shipment.trackingUrl && (
              <a
                href={order.shipment.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-bold text-[#ec6e55] hover:underline"
              >
                Track on {shippingProviderLabel(order.shipment?.provider ?? "")}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
          {order.shipment.events?.length > 0 && (
            <div className="mt-4 border-t border-[#efe8e4] pt-4">
              <h3 className="mb-3 text-sm font-bold text-[#23403d]">Tracking History</h3>
              <ol className="relative ml-1.5 flex flex-col gap-4 border-l border-[#efe8e4] pl-4">
                {order.shipment.events.map((event, i) => (
                  <li key={i} className="relative text-xs">
                    <span
                      className={`absolute -left-[21.5px] top-1 size-2.5 rounded-full ring-2 ring-white ${
                        i === 0 ? "bg-[#ec6e55]" : "bg-[#c5dac2]"
                      }`}
                      aria-hidden
                    />
                    <p className="font-bold text-[#23403d]">{event.status}</p>
                    <p className="text-[#767676]">{event.description}</p>
                    <p className="mt-0.5 text-[#767676]/80">
                      {new Date(event.occurredAt).toLocaleString()} {event.location ? `· ${event.location}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </DetailCard>
      )}
    </section>
  );
}
