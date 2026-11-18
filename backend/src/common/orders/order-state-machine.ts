export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, ReadonlyArray<OrderStatus>> = {
  PENDING_PAYMENT: ['PAYMENT_FAILED', 'CONFIRMED'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
  // OUT_FOR_DELIVERY directly from CONFIRMED/PROCESSING: merchant-fulfilled local
  // delivery orders (selectedShippingProvider = LOCAL) have no courier SHIPPED hop —
  // the admin advances them manually (packing → out for delivery → delivered).
  CONFIRMED: ['PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'OUT_FOR_DELIVERY', 'CANCELLED', 'REFUNDED'],
  // SHIPPED → DELIVERED directly: couriers frequently report delivery without an
  // out-for-delivery scan ever reaching us (missed webhook, OFD not pushed). Requiring
  // the intermediate hop left orders stuck at SHIPPED while the shipment was DELIVERED.
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: []
};

export function canTransitionOrder(fromStatus: OrderStatus, toStatus: OrderStatus): boolean {
  return (ORDER_STATUS_TRANSITIONS[fromStatus] ?? []).includes(toStatus);
}

/**
 * Backwards corrections allowed ONLY when the courier's own tracking proves the
 * order ran ahead of the shipment — e.g. an operator set OUT_FOR_DELIVERY by
 * hand before the parcel was ever collected. This is deliberately NOT part of
 * ORDER_STATUS_TRANSITIONS: webhooks and manual admin status changes must never
 * walk an order backwards (a stale webhook would undo a correct status, and an
 * operator going back by hand is how the mismatch happens in the first place).
 * DELIVERED is never walked back — delivery notifications, COD capture and
 * invoicing have already fired against it.
 */
export const ORDER_COURIER_CORRECTIONS: Partial<Record<OrderStatus, ReadonlyArray<OrderStatus>>> = {
  OUT_FOR_DELIVERY: ['SHIPPED']
};

export function canCorrectOrderFromCourierEvidence(
  fromStatus: OrderStatus,
  toStatus: OrderStatus
): boolean {
  return (ORDER_COURIER_CORRECTIONS[fromStatus] ?? []).includes(toStatus);
}
