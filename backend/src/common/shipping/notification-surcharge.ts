/**
 * Flat per-order notification surcharge folded into the customer-facing
 * shipping charge. Covers the WhatsApp Business API conversation cost the
 * merchant pays per order (~₹5). It is intentionally invisible to the
 * customer as a separate line: it is part of "shipping cost" everywhere
 * (quote, checkout total, payment, invoice).
 *
 * Rules:
 *  - Applied AFTER the cheapest-provider comparison (never skews which
 *    courier wins — that comparison runs on true provider cost).
 *  - NOT applied when the customer-facing shipping charge is zero
 *    (FREE_SHIPPING coupon / noop mode) — a "Free Shipping" order must not
 *    suddenly show a ₹5 shipping line.
 *  - Override via SHIPPING_NOTIFICATION_SURCHARGE_PAISE (integer paise,
 *    0 disables).
 */
export const DEFAULT_SHIPPING_NOTIFICATION_SURCHARGE_PAISE = 500;

export function getShippingNotificationSurchargePaise(): number {
  const raw = process.env.SHIPPING_NOTIFICATION_SURCHARGE_PAISE;
  if (raw != null && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed);
    }
  }
  return DEFAULT_SHIPPING_NOTIFICATION_SURCHARGE_PAISE;
}

/**
 * Adds the notification surcharge to a customer-facing shipping charge.
 * Zero/negative charges (free shipping) are returned unchanged.
 */
export function applyShippingNotificationSurcharge(customerShippingChargePaise: number): number {
  if (customerShippingChargePaise <= 0) {
    return customerShippingChargePaise;
  }
  return customerShippingChargePaise + getShippingNotificationSurchargePaise();
}
