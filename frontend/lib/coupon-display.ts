import { formatPrice } from "@/lib/format-price";
import type { Cart } from "@/types/cart";

type AppliedCartCoupon = NonNullable<Cart["coupon"]>;

/** Short benefit phrase for a coupon type (without the code). */
export function formatCouponBenefit(coupon: Pick<AppliedCartCoupon, "type" | "value">): string {
  switch (coupon.type) {
    case "FREE_SHIPPING":
      return "free shipping";
    case "PERCENTAGE_OFF":
      return `${coupon.value}% off`;
    case "FLAT_AMOUNT_OFF":
      return `${formatPrice(coupon.value)} off`;
    case "BUY_X_GET_Y":
      return "buy X get Y offer";
    default:
      return "discount applied";
  }
}

/** Customer-facing label for an applied cart coupon. */
export function formatAppliedCouponLabel(coupon: AppliedCartCoupon | null | undefined): string | null {
  if (!coupon) return null;
  return `${coupon.code} — ${formatCouponBenefit(coupon)}`;
}

export function isFreeShippingCoupon(coupon: AppliedCartCoupon | null | undefined): boolean {
  return coupon?.type === "FREE_SHIPPING";
}
