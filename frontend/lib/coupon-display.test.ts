import { describe, expect, it } from "vitest";
import {
  formatAppliedCouponLabel,
  formatCouponBenefit,
  isFreeShippingCoupon,
} from "@/lib/coupon-display";

describe("coupon-display", () => {
  it("formats free shipping coupons with code and benefit", () => {
    expect(
      formatAppliedCouponLabel({
        id: "c1",
        code: "FREEDELIVERY",
        type: "FREE_SHIPPING",
        value: 0,
      }),
    ).toBe("FREEDELIVERY — free shipping");
  });

  it("formats percentage coupons with code and percent off", () => {
    expect(
      formatAppliedCouponLabel({
        id: "c1",
        code: "SAVE10",
        type: "PERCENTAGE_OFF",
        value: 10,
      }),
    ).toBe("SAVE10 — 10% off");
  });

  it("formats flat amount coupons with code and currency off", () => {
    expect(
      formatAppliedCouponLabel({
        id: "c1",
        code: "FLAT100",
        type: "FLAT_AMOUNT_OFF",
        value: 10000,
      }),
    ).toBe("FLAT100 — ₹100.00 off");
  });

  it("formats buy X get Y coupons with a generic benefit label", () => {
    expect(
      formatCouponBenefit({ type: "BUY_X_GET_Y", value: 0 }),
    ).toBe("buy X get Y offer");
  });

  it("detects free shipping coupon type", () => {
    expect(
      isFreeShippingCoupon({
        id: "c1",
        code: "FREEDELIVERY",
        type: "FREE_SHIPPING",
        value: 0,
      }),
    ).toBe(true);
  });
});
