/**
 * The reference we give the courier for an order ("client reference" / `order_id`).
 *
 * Normally this is just the order number. It gains a `-R<n>` suffix after a booking
 * attempt is abandoned at the courier, because couriers key an order by this reference
 * and refuse to reuse it once it has been cancelled: Shiprocket answers a re-book on a
 * cancelled reference with `HTTP 500 — order is in cancelled state`, which left the order
 * permanently unbookable from admin. A fresh reference is a fresh courier order.
 *
 * Both booking and lookup MUST derive the reference the same way, or in-flight recovery
 * would search for a reference we never sent and book a duplicate.
 */
export function resolveBookingClientReference(orderNumber: string, attempt: number | null | undefined): string {
  const n = typeof attempt === 'number' && Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return n === 0 ? orderNumber : `${orderNumber}-R${n + 1}`;
}
