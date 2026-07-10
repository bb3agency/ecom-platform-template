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

