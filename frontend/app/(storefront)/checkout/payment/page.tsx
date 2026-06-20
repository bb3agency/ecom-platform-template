"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSafeRouter } from "@/lib/use-safe-router";
import Script from "next/script";
import { useAuthStore } from "@/stores/auth";
import { useCartStore } from "@/stores/cart";
import { getMyOrder, retryPayment, verifyPayment, type OrderSummary } from "@/lib/orders-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { trackEvent } from "@/lib/analytics";
import { formatPrice } from "@/lib/format-price";
import { Button } from "@/components/ui/button";
import { createIdempotencyKey } from "@/lib/idempotency";

function PaymentContent() {
  const searchParams = useSearchParams();
  const { replace, push, isReady } = useSafeRouter();
  const orderId = searchParams ? searchParams.get("orderId") : null;
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const clearCart = useCartStore((s) => s.clearCart);
  const clearPendingMerge = useCartStore((s) => s.clearPendingMerge);
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isReady || !orderId || !accessToken) return;
    replace(
      `/login?redirect=${encodeURIComponent(`/checkout/payment?orderId=${orderId}`)}`,
    );
  }, [accessToken, isReady, orderId, replace]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!accessToken || !orderId) return;
      try {
        const data = await getMyOrder(orderId, accessToken);
        if (!cancelled) {
          setOrder(data);
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
  }, [accessToken, orderId]);

  const handlePay = async () => {
    if (!accessToken || !order) return;
    setBusy(true);
    setError(null);
    setStatusMessage(null);

    try {
      const paymentInitKey = createIdempotencyKey();
      const payment = await retryPayment(order.id, accessToken, paymentInitKey);
      const razorpayKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

      if (!razorpayKey) {
        setStatusMessage("Set NEXT_PUBLIC_RAZORPAY_KEY_ID to continue prepaid checkout.");
        setBusy(false);
        return;
      }

      if (!window.Razorpay) {
        setError("Razorpay SDK is currently unavailable. Please refresh and try again.");
        setBusy(false);
        return;
      }

      const verifyKey = createIdempotencyKey();
      const razorpay = new window.Razorpay({
        key: razorpayKey,
        amount: payment.amount,
        currency: payment.currency,
        order_id: payment.providerOrderId,
        name: process.env.NEXT_PUBLIC_STORE_NAME ?? "Raghava Organics",
        description: `Order ${order.orderNumber}`,
        prefill: {
          name: order.shippingAddress?.fullName ?? "",
          contact: order.shippingAddress?.phone ?? "",
          ...(user?.email ? { email: user.email } : {}),
        },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            await verifyPayment(
              {
                orderId: order.id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              },
              accessToken,
              verifyKey,
            );
            clearPendingMerge();
            clearCart();
            push(`/checkout/success?orderId=${order.id}`);
          } catch (verifyError) {
            setError(getApiErrorMessage(verifyError));
          } finally {
            setBusy(false);
          }
        },
        modal: {
          ondismiss: () => {
            setBusy(false);
          }
        }
      });

      trackEvent("PAYMENT_INITIATED", { orderId: order.id }, user?.id);
      razorpay.open();
    } catch (err) {
      setError(getApiErrorMessage(err));
      setBusy(false);
    }
  };

  if (!orderId) {
    return <p className="text-sm text-destructive">Missing order ID parameters.</p>;
  }

  if (error && !order) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!accessToken) {
    return <p className="text-sm text-muted-foreground">Redirecting to sign in…</p>;
  }

  if (!order) {
    return <p className="text-sm text-muted-foreground">Loading order details...</p>;
  }

  const canRetry =
    order.paymentMode !== "COD" &&
    (order.status === "PENDING_PAYMENT" || order.status === "PAYMENT_FAILED");

  if (order.paymentMode === "COD") {
    return (
      <p className="text-sm text-muted-foreground">
        This order uses Cash on Delivery.{" "}
        <a href={`/orders/${order.id}`} className="underline text-[#23403d]">
          View order details
        </a>
      </p>
    );
  }

  if (!canRetry) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-[#efe8e4] bg-white p-6 shadow-sm">
        <h1 className="mb-4 font-heading text-2xl font-bold text-[#23403d]">Payment unavailable</h1>
        <p className="text-sm text-[#767676]">
          This order is in <span className="font-semibold text-[#23403d]">{order.status}</span> status and cannot accept payment here.
        </p>
        <a href={`/orders/${order.id}`} className="mt-4 inline-block text-sm underline text-[#23403d]">
          View order details
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-[#efe8e4] bg-white p-6 shadow-sm">
      <h1 className="mb-4 font-heading text-2xl font-bold text-[#23403d]">Complete Payment</h1>
      <p className="mb-6 text-sm text-[#767676]">
        Please complete your payment of <span className="font-bold text-[#23403d]">{formatPrice(order.total)}</span> for Order <span className="font-mono font-bold text-[#23403d]">{order.orderNumber}</span>.
      </p>

      {error && <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {statusMessage && <p className="mb-4 rounded-md bg-[#eff5ee] px-3 py-2 text-sm text-[#23403d]">{statusMessage}</p>}

      <Button
        onClick={handlePay}
        disabled={busy}
        className="w-full h-12 rounded-full bg-[#23403d] font-bold text-white transition-colors hover:bg-[#ec6e55]"
      >
        {busy ? "Opening Gateway..." : "Pay Now"}
      </Button>
    </div>
  );
}

export default function CheckoutPaymentPage() {
  return (
    <div className="flex bg-[#eff5ee] min-h-screen items-center justify-center py-16 px-4">
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <PaymentContent />
      </Suspense>
    </div>
  );
}
