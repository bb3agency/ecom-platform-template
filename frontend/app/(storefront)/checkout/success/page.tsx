"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle, Package, ArrowRight, ShoppingBag } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { getMyOrder, type OrderSummary } from "@/lib/orders-api";
import { formatPrice } from "@/lib/format-price";
import { trackEventOnce } from "@/lib/analytics";
import { formatPaymentModeLabel } from "@/lib/format-payment-mode";
import {
  CHECKOUT_OUTCOME_PARAM,
  getNotCompletedCopy,
  getOrderRefundNotice,
  resolveCheckoutOutcome,
  shouldTrackPurchase,
  type OrderLoadState,
} from "@/lib/checkout-outcome";

interface OrderNotCompletedProps {
  orderId: string | null;
  order: OrderSummary | null;
}

/**
 * Paid, but the order could not be completed (coupon or stock ran out after
 * payment). The backend cancelled it and started a full refund automatically.
 */
function OrderNotCompleted({ orderId, order }: OrderNotCompletedProps) {
  const refundAmount = order
    ? (getOrderRefundNotice(order)?.amountPaise ?? order.payment?.amount ?? order.total)
    : null;
  const copy = getNotCompletedCopy(refundAmount);
  return (
    <>
      <div className="mb-6 flex justify-center">
        <div className="flex size-20 items-center justify-center rounded-full bg-secondary">
          <AlertCircle className="size-10 text-destructive" aria-hidden />
        </div>
      </div>

      <h1 className="mb-3 font-heading text-3xl font-bold text-primary">{copy.title}</h1>
      <div className="mb-6 grid gap-3 text-left text-sm text-muted-foreground" role="status">
        <p>{copy.reason}</p>
        <p className="font-medium text-foreground">{copy.refund}</p>
        <p>{copy.reassurance}</p>
      </div>

      {order ? (
        <div className="mb-8 grid gap-2 rounded-2xl border border-border bg-muted p-5 text-left text-sm">
          <div className="flex justify-between gap-4">
            <span className="font-bold text-primary">Order number</span>
            <span className="font-mono font-bold text-accent">{order.orderNumber}</span>
          </div>
          {refundAmount !== null && refundAmount > 0 ? (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Refund</span>
              <span className="font-medium text-primary">{formatPrice(refundAmount)}</span>
            </div>
          ) : null}
        </div>
      ) : orderId ? (
        <div className="mb-8 rounded-2xl border border-border bg-muted p-5">
          <p className="text-sm text-muted-foreground">Loading order details…</p>
        </div>
      ) : null}
    </>
  );
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const outcomeParam = searchParams.get(CHECKOUT_OUTCOME_PARAM);
  const accessToken = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.user?.id);
  const sessionStatus = useAuthStore((s) => s.storefrontSessionStatus);
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [orderLoad, setOrderLoad] = useState<OrderLoadState>("loading");
  const outcome = resolveCheckoutOutcome({
    outcomeParam,
    orderStatus: order?.status,
    orderLoad,
  });

  // Once per order, after the session check settles (userId undefined → set
  // on a hard load used to send PURCHASE twice) and only once the order is
  // known to be live — a cancelled-and-refunded order is not a purchase.
  useEffect(() => {
    if (!shouldTrackPurchase({ orderId, sessionStatus, outcome })) return;
    trackEventOnce(`purchase:${orderId}`, "PURCHASE", { orderId }, userId);
  }, [orderId, sessionStatus, userId, outcome]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!orderId) return;
      if (!accessToken) {
        // No session to load with: settle so the page (and tracking) can proceed.
        if (sessionStatus !== "checking") setOrderLoad("failed");
        return;
      }
      try {
        const data = await getMyOrder(orderId, accessToken);
        if (!cancelled) {
          setOrder(data);
          setOrderLoad("loaded");
        }
      } catch {
        // non-fatal — page still shows the outcome even without order detail
        if (!cancelled) setOrderLoad("failed");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [accessToken, orderId, sessionStatus]);

  return (
    <div className="flex flex-col bg-secondary min-h-screen items-center justify-center py-16 px-4">
      <div className="mx-auto w-full max-w-lg rounded-[24px] bg-card p-8 shadow-sm text-center">
        {outcome === "not-completed" ? (
          <OrderNotCompleted orderId={orderId} order={order} />
        ) : (
          <>
            {/* Success icon */}
            <div className="mb-6 flex justify-center">
              <div className="flex size-20 items-center justify-center rounded-full bg-secondary">
                <CheckCircle className="size-10 text-success" aria-hidden />
              </div>
            </div>

            <h1 className="mb-2 font-heading text-3xl font-bold text-primary">
              Order Placed!
            </h1>
            <p className="mb-6 text-sm font-medium text-muted-foreground">
              Thank you for your order. We&apos;ll send you a confirmation email shortly.
            </p>

            {order ? (
              <div className="mb-8 rounded-[16px] border border-border bg-muted p-5 text-left">
                <div className="mb-4 flex items-center gap-2">
                  <Package className="size-4 text-accent" aria-hidden />
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Order Summary
                  </span>
                </div>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-bold text-primary">Order number</span>
                    <span className="font-mono font-bold text-accent">{order.orderNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payment</span>
                    <span className="font-medium text-primary">
                      {formatPaymentModeLabel(order.paymentMode)}
                    </span>
                  </div>
                  {order.items && order.items.length > 0 && (
                    <div className="mt-2 border-t border-border pt-3 grid gap-1.5">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex justify-between text-xs">
                          <span className="text-primary">
                            {item.productName}
                            {item.variantName !== "Default" ? ` — ${item.variantName}` : ""} × {item.quantity}
                          </span>
                          <span className="font-medium text-primary">{formatPrice(item.totalPrice)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 border-t border-border pt-3 flex justify-between font-bold text-primary">
                    <span>Total</span>
                    <span>{formatPrice(order.total)}</span>
                  </div>
                </div>
              </div>
            ) : orderId ? (
              <div className="mb-8 rounded-[16px] border border-border bg-muted p-5">
                <p className="text-sm text-muted-foreground">Loading order details…</p>
              </div>
            ) : null}
          </>
        )}

        <div className="grid gap-3">
          {orderId && (
            <Link
              href={`/orders/${orderId}`}
              className="flex items-center justify-center gap-2 h-12 w-full rounded-full bg-primary text-sm font-bold text-white transition-transform hover:-translate-y-1 hover:bg-accent hover:shadow-lg"
            >
              View Order Details
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
          <Link
            href="/products"
            className="flex items-center justify-center gap-2 h-12 w-full rounded-full border border-primary text-sm font-bold text-primary transition-colors hover:bg-primary hover:text-white"
          >
            <ShoppingBag className="size-4" aria-hidden />
            Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-secondary">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
