import { describe, expect, it } from "vitest";
import {
  formatAdminWhen,
  formatAdminDateCompact,
  orderStatusDisplay,
  paymentStatusDisplay,
  sentenceCaseEnum,
  toDotTone,
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

describe("console status display", () => {
  it("shows merchant words, never raw enums", () => {
    expect(orderStatusDisplay("PENDING_PAYMENT")).toEqual({ label: "Awaiting payment", tone: "warning" });
    expect(orderStatusDisplay("CONFIRMED")).toEqual({ label: "To fulfil", tone: "brand" });
    expect(orderStatusDisplay("delivered").tone).toBe("success");
    expect(paymentStatusDisplay("CAPTURED")).toEqual({ label: "Paid", tone: "success" });
  });

  it("degrades unknown statuses to sentence case instead of SHOUTING_CASE", () => {
    expect(orderStatusDisplay("ON_HOLD")).toEqual({ label: "On hold", tone: "neutral" });
    expect(sentenceCaseEnum(undefined)).toBe("—");
  });

  it("maps legacy badge tones onto dot tones", () => {
    expect(toDotTone("destructive")).toBe("danger");
    expect(toDotTone("default")).toBe("neutral");
    expect(toDotTone("success")).toBe("success");
  });

  it("drops the year from compact dates in the current year only", () => {
    const now = new Date("2026-10-21T12:00:00");
    expect(formatAdminDateCompact("2026-10-21T10:42:00", now)).not.toMatch(/2026/);
    expect(formatAdminDateCompact("2025-03-02T10:42:00", now)).toMatch(/2025/);
    expect(formatAdminDateCompact("not-a-date", now)).toBe("not-a-date");
  });
});

describe("formatAdminWhen", () => {
  const now = new Date("2026-10-21T15:00:00");
  it("shows the time for today, 'Yesterday', then a short date", () => {
    expect(formatAdminWhen("2026-10-21T09:05:00", now)).toMatch(/9:05/);
    expect(formatAdminWhen("2026-10-20T23:59:00", now)).toBe("Yesterday");
    expect(formatAdminWhen("2026-10-02T10:00:00", now)).toMatch(/2 Oct/);
    expect(formatAdminWhen("2025-10-02T10:00:00", now)).toMatch(/2025/);
  });
});
