import { describe, expect, it } from "vitest";
import {
  buildCheckoutOutcomeUrl,
  CHECKOUT_OUTCOME_NOT_COMPLETED,
  getNotCompletedCopy,
  getOrderRefundNotice,
  isOrderNotCompleted,
  resolveCheckoutOutcome,
  shouldTrackPurchase,
  type RefundNoticeOrder,
} from "./checkout-outcome";

describe("isOrderNotCompleted", () => {
  it("is true only for cancelled or refunded orders", () => {
    expect(isOrderNotCompleted("CANCELLED")).toBe(true);
    expect(isOrderNotCompleted("REFUNDED")).toBe(true);
    expect(isOrderNotCompleted("CONFIRMED")).toBe(false);
    expect(isOrderNotCompleted("PAYMENT_FAILED")).toBe(false);
    expect(isOrderNotCompleted(undefined)).toBe(false);
    expect(isOrderNotCompleted(null)).toBe(false);
  });
});

describe("buildCheckoutOutcomeUrl", () => {
  it("sends a confirmed order to the plain success page", () => {
    expect(buildCheckoutOutcomeUrl({ id: "ord_1", status: "CONFIRMED" })).toBe(
      "/checkout/success?orderId=ord_1",
    );
  });

  it("flags an order confirm-prepaid returned CANCELLED as not completed", () => {
    expect(buildCheckoutOutcomeUrl({ id: "ord_1", status: "CANCELLED" })).toBe(
      `/checkout/success?orderId=ord_1&outcome=${CHECKOUT_OUTCOME_NOT_COMPLETED}`,
    );
  });

  it("encodes the order id and treats a missing status as placed", () => {
    expect(buildCheckoutOutcomeUrl({ id: "a b&c" })).toBe("/checkout/success?orderId=a+b%26c");
  });
});

describe("resolveCheckoutOutcome", () => {
  it("trusts the checkout's not-completed flag before the order loads", () => {
    expect(
      resolveCheckoutOutcome({ outcomeParam: "not-completed", orderStatus: undefined, orderLoad: "loading" }),
    ).toBe("not-completed");
  });

  it("detects a cancelled order on load even without the flag (post-capture stock cancel)", () => {
    expect(
      resolveCheckoutOutcome({ outcomeParam: null, orderStatus: "CANCELLED", orderLoad: "loaded" }),
    ).toBe("not-completed");
    expect(
      resolveCheckoutOutcome({ outcomeParam: null, orderStatus: "REFUNDED", orderLoad: "loaded" }),
    ).toBe("not-completed");
  });

  it("is pending while the order loads", () => {
    expect(resolveCheckoutOutcome({ outcomeParam: null, orderStatus: undefined, orderLoad: "loading" })).toBe(
      "pending",
    );
  });

  it("is placed for a live order, or when the order could not be loaded", () => {
    expect(
      resolveCheckoutOutcome({ outcomeParam: null, orderStatus: "CONFIRMED", orderLoad: "loaded" }),
    ).toBe("placed");
    expect(resolveCheckoutOutcome({ outcomeParam: null, orderStatus: undefined, orderLoad: "failed" })).toBe(
      "placed",
    );
  });

  it("ignores unknown outcome values", () => {
    expect(
      resolveCheckoutOutcome({ outcomeParam: "whatever", orderStatus: "CONFIRMED", orderLoad: "loaded" }),
    ).toBe("placed");
  });
});

describe("shouldTrackPurchase", () => {
  it("tracks a placed order once the session check settles", () => {
    expect(shouldTrackPurchase({ orderId: "o1", sessionStatus: "authenticated", outcome: "placed" })).toBe(true);
    expect(shouldTrackPurchase({ orderId: "o1", sessionStatus: "guest", outcome: "placed" })).toBe(true);
  });

  it("never tracks a cancelled-and-refunded order", () => {
    expect(
      shouldTrackPurchase({ orderId: "o1", sessionStatus: "authenticated", outcome: "not-completed" }),
    ).toBe(false);
  });

  it("waits while the order or the session is still loading", () => {
    expect(shouldTrackPurchase({ orderId: "o1", sessionStatus: "authenticated", outcome: "pending" })).toBe(false);
    expect(shouldTrackPurchase({ orderId: "o1", sessionStatus: "checking", outcome: "placed" })).toBe(false);
  });

  it("does nothing without an order id", () => {
    expect(shouldTrackPurchase({ orderId: null, sessionStatus: "authenticated", outcome: "placed" })).toBe(false);
  });
});

describe("getOrderRefundNotice", () => {
  const paidCancelled: RefundNoticeOrder = {
    status: "CANCELLED",
    paymentMode: "PREPAID",
    total: 50_000,
    payment: { provider: "RAZORPAY", amount: 50_000, status: "CAPTURED", refundedAmountPaise: 0 },
  };

  it("shows a refund in progress for a cancelled, captured prepaid order", () => {
    const notice = getOrderRefundNotice(paidCancelled);
    expect(notice?.kind).toBe("refund-in-progress");
    expect(notice?.amountPaise).toBe(50_000);
    expect(notice?.body).toContain("₹500");
    expect(notice?.body).toContain("5–7 working days");
  });

  it("counts only what is still to be refunded after a partial refund", () => {
    const notice = getOrderRefundNotice({
      ...paidCancelled,
      payment: { provider: "RAZORPAY", amount: 50_000, status: "PARTIALLY_REFUNDED", refundedAmountPaise: 20_000 },
    });
    expect(notice?.amountPaise).toBe(30_000);
  });

  it("still reads 'on its way' while the refund is with the provider", () => {
    const notice = getOrderRefundNotice({
      ...paidCancelled,
      payment: { provider: "RAZORPAY", amount: 50_000, status: "CAPTURED", refundPendingAmountPaise: 50_000 },
    });
    expect(notice?.kind).toBe("refund-in-progress");
  });

  it("shows the refund as complete once the order or payment is refunded", () => {
    const notice = getOrderRefundNotice({
      ...paidCancelled,
      status: "REFUNDED",
      payment: { provider: "RAZORPAY", amount: 50_000, status: "REFUNDED", refundedAmountPaise: 50_000 },
    });
    expect(notice?.kind).toBe("refunded");
    expect(notice?.amountPaise).toBe(50_000);
  });

  it("falls back to the order total when the payment amount is missing", () => {
    const notice = getOrderRefundNotice({
      ...paidCancelled,
      payment: { provider: "RAZORPAY", amount: 0, status: "CAPTURED" },
    });
    expect(notice?.amountPaise).toBe(50_000);
  });

  it("says nothing for COD, unpaid, failed or active orders", () => {
    expect(getOrderRefundNotice({ ...paidCancelled, paymentMode: "COD" })).toBeNull();
    expect(getOrderRefundNotice({ ...paidCancelled, payment: null })).toBeNull();
    expect(
      getOrderRefundNotice({
        ...paidCancelled,
        payment: { provider: "RAZORPAY", amount: 50_000, status: "FAILED" },
      }),
    ).toBeNull();
    expect(getOrderRefundNotice({ ...paidCancelled, status: "CONFIRMED" })).toBeNull();
  });
});

describe("getNotCompletedCopy", () => {
  it("says payment was received, the order was not completed and a full refund started", () => {
    const copy = getNotCompletedCopy(50_000);
    expect(copy.title).toBe("We couldn't complete your order");
    expect(copy.title).not.toMatch(/placed/i);
    expect(copy.reason).toMatch(/payment was received/i);
    expect(copy.reason).toMatch(/item or the coupon/i);
    expect(copy.refund).toContain("full refund of your ₹500 payment");
    expect(copy.refund).toContain("5–7 working days");
  });

  it("omits the amount when it is not known", () => {
    expect(getNotCompletedCopy(null).refund).toContain("full refund of your payment");
    expect(getNotCompletedCopy(0).refund).toContain("full refund of your payment");
  });
});
