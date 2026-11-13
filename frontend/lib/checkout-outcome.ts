import { formatPrice } from "@/lib/format-price";
import type { CheckoutPaymentMode, OrderPaymentSummary } from "@/lib/orders-api";

/**
 * What the customer sees after checkout, and whether it counts as a purchase.
 *
 * A prepaid order can come back from POST /payments/confirm-prepaid already
 * CANCELLED: the money was captured, but a coupon's last use or the last unit
 * of stock went to someone else in the meantime. The backend cancels the order
 * and queues a full refund (backend/docs/REFUND_LIFECYCLE.md). The same can
 * happen shortly after a CONFIRMED order when post-capture stock deduction
 * fails. Such an order must never be presented (or tracked) as "placed".
 */

/** Statuses that mean the order will not be fulfilled. */
export const NOT_COMPLETED_ORDER_STATUSES = ["CANCELLED", "REFUNDED"] as const;

export function isOrderNotCompleted(status: string | null | undefined): boolean {
  return (NOT_COMPLETED_ORDER_STATUSES as readonly string[]).includes(status ?? "");
}

/** Query param the checkout uses to tell the outcome page the order was not completed. */
export const CHECKOUT_OUTCOME_PARAM = "outcome";
export const CHECKOUT_OUTCOME_NOT_COMPLETED = "not-completed";

/** Where checkout goes after the backend returns the order. */
export function buildCheckoutOutcomeUrl(order: { id: string; status?: string | null }): string {
  const params = new URLSearchParams({ orderId: order.id });
  if (isOrderNotCompleted(order.status)) {
    params.set(CHECKOUT_OUTCOME_PARAM, CHECKOUT_OUTCOME_NOT_COMPLETED);
  }
  return `/checkout/success?${params.toString()}`;
}

export type OrderLoadState = "loading" | "loaded" | "failed";

/**
 * - `not-completed`: checkout said so, or the loaded order is cancelled/refunded.
 * - `pending`: still loading the order — do not count a purchase yet.
 * - `placed`: the order loaded and is live, or it could not be loaded and
 *   checkout did not flag it (the success page has always shown "placed" then).
 */
export type CheckoutOutcome = "placed" | "not-completed" | "pending";

export interface ResolveCheckoutOutcomeInput {
  outcomeParam: string | null;
  orderStatus: string | null | undefined;
  orderLoad: OrderLoadState;
}

export function resolveCheckoutOutcome({
  outcomeParam,
  orderStatus,
  orderLoad,
}: ResolveCheckoutOutcomeInput): CheckoutOutcome {
  if (outcomeParam === CHECKOUT_OUTCOME_NOT_COMPLETED) return "not-completed";
  if (orderLoad === "loaded" && isOrderNotCompleted(orderStatus)) return "not-completed";
  if (orderLoad === "loading") return "pending";
  return "placed";
}

export interface ShouldTrackPurchaseInput {
  orderId: string | null;
  sessionStatus: "checking" | "authenticated" | "guest";
  outcome: CheckoutOutcome;
}

/** PURCHASE is sent only for an order that was actually placed. */
export function shouldTrackPurchase({ orderId, sessionStatus, outcome }: ShouldTrackPurchaseInput): boolean {
  if (!orderId || sessionStatus === "checking") return false;
  return outcome === "placed";
}

// ── Refund notice (customer-facing) ──────────────────────────────────────────

export interface RefundNoticeOrder {
  status: string;
  paymentMode: CheckoutPaymentMode;
  total: number;
  payment?: OrderPaymentSummary | null;
}

export interface OrderRefundNotice {
  kind: "refund-in-progress" | "refunded";
  /** Paise still being returned (in progress) or returned in total (refunded). */
  amountPaise: number;
  title: string;
  body: string;
}

/** Typical time for a Razorpay refund to reach the customer's account. */
export const REFUND_ARRIVAL_COPY = "It usually reaches your account in 5–7 working days.";

/**
 * Refund state of a cancelled prepaid order, or null when there is nothing to say
 * (COD, never paid, still active). Customers never see merchant-side refund notes,
 * so a refund that is retrying behind the scenes still reads "on its way".
 */
export function getOrderRefundNotice(order: RefundNoticeOrder): OrderRefundNotice | null {
  if (order.paymentMode !== "PREPAID") return null;
  const payment = order.payment;
  if (!payment) return null;
  const paidAmount = payment.amount > 0 ? payment.amount : order.total;
  const refunded = Math.max(payment.refundedAmountPaise ?? 0, 0);

  if (order.status === "REFUNDED" || payment.status === "REFUNDED") {
    const amountPaise = refunded > 0 ? refunded : paidAmount;
    return {
      kind: "refunded",
      amountPaise,
      title: "Refund complete",
      body: `We've refunded ${formatPrice(amountPaise)} to your original payment method. If you can't see it yet, check with your bank — it can take a few days to show.`,
    };
  }

  if (order.status !== "CANCELLED") return null;
  if (payment.status !== "CAPTURED" && payment.status !== "PARTIALLY_REFUNDED") return null;

  const amountPaise = Math.max(paidAmount - refunded, 0);
  if (amountPaise === 0) return null;
  return {
    kind: "refund-in-progress",
    amountPaise,
    title: "Refund on its way",
    body: `We've started a refund of ${formatPrice(amountPaise)} to your original payment method. ${REFUND_ARRIVAL_COPY}`,
  };
}

// ── "Order not completed" screen copy ────────────────────────────────────────

export interface NotCompletedCopy {
  title: string;
  reason: string;
  refund: string;
  reassurance: string;
}

/**
 * Copy for a paid order that could not be completed. `amountPaise` is the amount
 * being refunded when known (falls back to wording without an amount).
 */
export function getNotCompletedCopy(amountPaise: number | null): NotCompletedCopy {
  const amount = amountPaise !== null && amountPaise > 0 ? `${formatPrice(amountPaise)} ` : "";
  return {
    title: "We couldn't complete your order",
    reason:
      "Your payment was received, but an item or the coupon in your order ran out while the payment was going through.",
    refund: `We've automatically started a full refund of your ${amount}payment to your original payment method. ${REFUND_ARRIVAL_COPY}`,
    reassurance: "You don't need to do anything. Keep your order number handy if you contact us about it.",
  };
}
