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
export function manualNextStatuses(
  current: string,
  options: { isLocalDelivery?: boolean; canRefund?: boolean } = {},
): OrderStatusValue[] {
  const next = ORDER_STATUS_TRANSITIONS[current as OrderStatusValue] ?? [];
  return next.filter((status) => {
    if (status === "CANCELLED") return false;
    if (status === "REFUNDED") return Boolean(options.canRefund);
    if (current === "PENDING_PAYMENT" && status === "CONFIRMED") return false;
    if (options.isLocalDelivery && status === "SHIPPED") return false;
    return true;
  });
}
