"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Package, ArrowRight, ShoppingBag } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { getMyOrder, type OrderSummary } from "@/lib/orders-api";
import { formatPrice } from "@/lib/format-price";
import { trackEvent } from "@/lib/analytics";
import { formatPaymentModeLabel } from "@/lib/format-payment-mode";

function SuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const accessToken = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.user?.id);
  const [order, setOrder] = useState<OrderSummary | null>(null);

  useEffect(() => {
    if (orderId) {
      trackEvent("PURCHASE", { orderId }, userId);
    }
  }, [orderId, userId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!accessToken || !orderId) return;
      try {
        const data = await getMyOrder(orderId, accessToken);
        if (!cancelled) setOrder(data);
      } catch {
        // non-fatal — page still shows success even without order detail
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [accessToken, orderId]);

  return (
    <div className="flex flex-col bg-secondary min-h-screen items-center justify-center py-16 px-4">
      <div className="mx-auto w-full max-w-lg rounded-[24px] bg-card p-8 shadow-sm text-center">
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
