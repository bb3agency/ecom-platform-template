/**
 * Mirror of backend/src/common/orders/order-state-machine.ts — which order status
 * moves the API accepts. The admin UI uses it to offer only valid next steps
 * instead of a dropdown of every status that mostly answers 409.
 *
 * order-state-machine.test.ts parses the backend file and fails if these drift.
 */

export type OrderStatusValue =
  | "PENDING_PAYMENT"
  | "PAYMENT_FAILED"
  | "CONFIRMED"
  | "PROCESSING"
  | "SHIPPED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "REFUNDED";

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatusValue, ReadonlyArray<OrderStatusValue>> = {
  PENDING_PAYMENT: ["PAYMENT_FAILED", "CONFIRMED"],
  PAYMENT_FAILED: ["PENDING_PAYMENT", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "SHIPPED", "OUT_FOR_DELIVERY", "CANCELLED", "REFUNDED"],
  PROCESSING: ["SHIPPED", "OUT_FOR_DELIVERY", "CANCELLED", "REFUNDED"],
  SHIPPED: ["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: ["REFUNDED"],
  REFUNDED: [],
};

/**
 * Statuses an admin may set directly from the status control.
 * - CANCELLED goes through the cancel dialog (reason, restock, auto-refund).
 * - REFUNDED needs orders:refund and is offered only when the caller says so.
 * - PENDING_PAYMENT → CONFIRMED is refused by the API (only a verified payment confirms).
 * - Local-delivery orders skip SHIPPED: the store's own team delivers them.
 */
/** Fulfilment stages a courier order may only reach by booking the courier. */
const COURIER_FULFILMENT_STATUSES: ReadonlyArray<OrderStatusValue> = [
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

export function manualNextStatuses(
  current: string,
  options: { isLocalDelivery?: boolean; canRefund?: boolean; hasAwb?: boolean } = {},
): OrderStatusValue[] {
  const next = ORDER_STATUS_TRANSITIONS[current as OrderStatusValue] ?? [];
  return next.filter((status) => {
    if (status === "CANCELLED") return false;
    if (status === "REFUNDED") return Boolean(options.canRefund);
    if (current === "PENDING_PAYMENT" && status === "CONFIRMED") return false;
    if (options.isLocalDelivery && status === "SHIPPED") return false;
    // A courier order takes these stages from the shipment booking, not from a person
    // clicking through them. Advancing by hand produced orders the courier had never
    // heard of: the shipping worker skips anything already SHIPPED, so no AWB could ever
    // be booked, the label could not be printed, and the customer was notified with no
    // tracking. Local delivery is exempt — manual moves are its only status driver.
    if (
      !options.isLocalDelivery &&
      options.hasAwb === false &&
      COURIER_FULFILMENT_STATUSES.includes(status)
    ) {
      return false;
    }
    return true;
  });
}
