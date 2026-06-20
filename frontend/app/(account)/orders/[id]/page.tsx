"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { getMyOrder, cancelMyOrder, createReturnRequest, downloadCustomerInvoicePdf, type OrderSummary } from "@/lib/orders-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { formatPrice } from "@/lib/format-price";
import { formatPaymentModeLabel } from "@/lib/format-payment-mode";
import { shippingProviderLabel } from "@/lib/shipping-provider-labels";
import { Button } from "@/components/ui/button";

export default function AccountOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  
  // Return request states
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [returnItems, setReturnItems] = useState<Record<string, { quantity: number; reason: string; selected: boolean }>>({});

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
    setError(null);
    try {
      await cancelMyOrder(order.id, accessToken, "Cancelled by customer");
      const result = await getMyOrder(order.id, accessToken);
      setOrder(result);
    } catch (err) {
      setError(getApiErrorMessage(err));
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
    setError(null);
    try {
      await downloadCustomerInvoicePdf(
        order.id,
        accessToken,
        `${order.invoice.invoiceNumber}.pdf`,
      );
    } catch (err) {
      setError(getApiErrorMessage(err));
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
      setError("Please select at least one item to return.");
      return;
    }

    if (!returnReason.trim()) {
      setError("Please provide an overall reason for the return.");
      return;
    }

    setBusyAction("return");
    setError(null);
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
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusyAction(null);
    }
  };

  if (error && !order) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!order) {
    return <p className="text-sm text-muted-foreground">Loading order...</p>;
  }

  const canCancel = ["CONFIRMED", "PROCESSING"].includes(order.status);
  const canRetry =
    order.paymentMode !== "COD" &&
    (order.status === "PENDING_PAYMENT" || order.status === "PAYMENT_FAILED");
  const addr = order.shippingAddress;

  return (
    <section className="grid gap-6">
      <div className="grid gap-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-lg font-semibold sm:text-2xl">{order.orderNumber}</h1>
            <p className="text-sm text-muted-foreground">
              {order.status} · {formatPaymentModeLabel(order.paymentMode)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
             {order.invoice?.hasPdf ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={downloadingInvoice || busyAction !== null}
                onClick={() => void handleDownloadInvoice()}
              >
                {downloadingInvoice ? "Downloading…" : "Invoice"}
              </Button>
            ) : null}
            {canRetry && (
              <Button
                variant="default"
                size="sm"
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
                {busyAction === "cancel" ? "Cancelling..." : "Cancel Order"}
              </Button>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {canRetry && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            {order.status === "PAYMENT_FAILED"
              ? "Payment failed for this order. Please retry to complete your purchase."
              : "Payment is pending for this order. Click \"Retry Payment\" to complete your purchase."}
          </div>
        )}

        <div className="mt-4 grid gap-2 border-t border-border pt-4">
          <p className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span>{formatPrice(order.subtotal)}</span>
          </p>
          <p className="flex justify-between text-sm">
            <span>Shipping</span>
            <span>{formatPrice(order.shippingCharge)}</span>
          </p>
          {order.discountAmount > 0 && (
            <>
              <p className="flex justify-between text-sm">
                <span>Discount</span>
                <span className="text-[#00aa63]">-{formatPrice(order.discountAmount)}</span>
              </p>
              {order.couponCode && (
                <p className="text-xs text-[#767676]">
                  Coupon: <span className="font-mono font-medium">{order.couponCode}</span>
                </p>
              )}
            </>
          )}
          <p className="flex justify-between border-t border-border pt-2 font-medium">
            <span>Total</span>
            <span className="text-[#ec6e55]">{formatPrice(order.total)}</span>
          </p>
        </div>
      </div>

      {addr ? (
        <div className="grid gap-3 rounded-lg border border-border p-4">
          <h2 className="font-heading text-lg font-semibold">Shipping address</h2>
          <address className="text-sm not-italic text-muted-foreground">
            <p className="font-medium text-foreground">{addr.fullName}</p>
            <p>{addr.phone}</p>
            <p>
              {addr.line1}
              {addr.line2 ? `, ${addr.line2}` : ""}
            </p>
            <p>
              {addr.city}, {addr.state} {addr.pincode}
            </p>
          </address>
        </div>
      ) : null}

      <div className="grid gap-3 rounded-lg border border-border p-4">
        <h2 className="font-heading text-lg font-semibold">Items</h2>
        <div className="grid gap-4">
          {order.items?.map((item) => (
            <div key={item.id} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{item.productName}</p>
                <p className="text-muted-foreground">{item.variantName}</p>
                <p className="text-muted-foreground">Qty: {item.quantity}</p>
              </div>
              <p className="font-medium">{formatPrice(item.totalPrice)}</p>
            </div>
          ))}
        </div>
      </div>

      {order.status === "DELIVERED" && !showReturnForm && (
        <div className="rounded-lg border border-border p-4 text-center">
          <p className="text-sm text-muted-foreground mb-3">Is there an issue with your items?</p>
          <Button variant="outline" size="sm" onClick={() => setShowReturnForm(true)}>
             Request a Return / Replacement
          </Button>
        </div>
      )}

      {order.status === "DELIVERED" && showReturnForm && (
        <form onSubmit={handleReturnSubmit} className="grid gap-4 rounded-lg border border-[#ec6e55]/30 bg-[#faf3ef]/20 p-4">
          <h2 className="font-heading text-lg font-bold text-[#23403d]">Request a Return</h2>
          <p className="text-xs text-[#767676] mb-2">Select the items you would like to return and specify the details.</p>

          <div className="grid gap-4">
            {order.items?.map((item) => {
              const config = returnItems[item.id] || { selected: false, quantity: item.quantity, reason: "" };
              return (
                <div key={item.id} className="grid gap-2 rounded border border-border p-3 text-sm bg-white">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id={`check-${item.id}`}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-[#ec6e55] focus:ring-[#ec6e55]"
                      checked={config.selected}
                      onChange={(e) => setReturnItems({
                        ...returnItems,
                        [item.id]: { ...config, selected: e.target.checked }
                      })}
                    />
                    <label htmlFor={`check-${item.id}`} className="font-medium flex-1 cursor-pointer">
                      {item.productName} ({item.variantName})
                    </label>
                  </div>
                  {config.selected && (
                    <div className="pl-7 grid gap-3 mt-2">
                      <div>
                        <label className="text-xs font-medium block mb-1">Quantity</label>
                        <input
                          type="number"
                          min={1}
                          max={item.quantity}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={config.quantity}
                          onChange={(e) => setReturnItems({
                            ...returnItems,
                            [item.id]: { ...config, quantity: Math.min(item.quantity, Math.max(1, parseInt(e.target.value) || 1)) }
                          })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-xs font-medium block mb-1">Reason for this item (Optional)</label>
                        <input
                          type="text"
                          placeholder="e.g. damaged, wrong size"
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={config.reason}
                          onChange={(e) => setReturnItems({
                            ...returnItems,
                            [item.id]: { ...config, reason: e.target.value }
                          })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid gap-1.5 mt-2">
             <label className="text-xs font-bold block">Overall return reason</label>
             <textarea
               className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
               placeholder="Please specify why you are raising this return request..."
               value={returnReason}
               onChange={(e) => setReturnReason(e.target.value)}
               required
             />
          </div>

          <div className="flex flex-col-reverse gap-2 mt-2 sm:flex-row sm:justify-end">
             <Button type="button" variant="outline" size="sm" disabled={busyAction === "return"} onClick={() => setShowReturnForm(false)}>
                Cancel
             </Button>
             <Button type="submit" variant="default" size="sm" disabled={busyAction === "return"}>
                {busyAction === "return" ? "Submitting..." : "Submit Return"}
             </Button>
          </div>
        </form>
      )}

      {order.shipment?.awb && (
        <div className="grid gap-3 rounded-lg border border-border p-4">
          <h2 className="font-heading text-lg font-semibold">Tracking</h2>
          <div className="text-sm">
            <p className="mb-2"><span className="font-medium">AWB:</span> {order.shipment.awb}</p>
            <p className="mb-4"><span className="font-medium">Status:</span> {order.shipment.status}</p>
            {order.shipment.trackingUrl && (
              <a
                href={order.shipment.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                Track on {shippingProviderLabel(order.shipment?.provider ?? "")}
              </a>
            )}
          </div>
          {order.shipment.events?.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <h3 className="mb-3 font-medium text-sm">Tracking History</h3>
              <div className="grid gap-3">
                 {order.shipment.events.map((event, i) => (
                    <div key={i} className="text-xs">
                      <p className="font-medium">{event.status}</p>
                      <p className="text-muted-foreground">{event.description}</p>
                      <p className="text-muted-foreground">
                        {new Date(event.occurredAt).toLocaleString()} {event.location ? `· ${event.location}` : ""}
                      </p>
                    </div>
                 ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
