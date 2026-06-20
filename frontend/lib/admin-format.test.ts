import { describe, expect, it } from "vitest";
import {
  couponStatusTone,
  formatCouponUsageLabel,
  formatPaise,
  orderStatusTone,
  paymentStatusTone,
  returnStatusTone,
  reviewApprovalTone,
} from "@/lib/admin-format";

describe("admin-format", () => {
  it("formats paise as INR", () => {
    expect(formatPaise(19900)).toMatch(/199/);
  });

  it("formats coupon usage labels", () => {
    expect(formatCouponUsageLabel(0, null)).toBe("0 / ∞");
    expect(formatCouponUsageLabel(undefined, 100)).toBe("0 / 100");
    expect(formatCouponUsageLabel(12, 50)).toBe("12 / 50");
  });

  it("maps order status tones", () => {
    expect(orderStatusTone("DELIVERED")).toBe("success");
    expect(orderStatusTone("CANCELLED")).toBe("destructive");
    expect(orderStatusTone("UNKNOWN")).toBe("default");
  });

  it("maps payment status tones", () => {
    expect(paymentStatusTone("captured")).toBe("success");
    expect(paymentStatusTone("failed")).toBe("destructive");
  });

  it("maps return status tones", () => {
    expect(returnStatusTone("REQUESTED")).toBe("warning");
    expect(returnStatusTone("REFUNDED")).toBe("success");
  });

  it("maps coupon status tones", () => {
    expect(couponStatusTone("active")).toBe("success");
    expect(couponStatusTone("paused")).toBe("warning");
  });

  it("maps review approval tones", () => {
    expect(reviewApprovalTone(true)).toBe("success");
    expect(reviewApprovalTone(false)).toBe("warning");
  });
});
