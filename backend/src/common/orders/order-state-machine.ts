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
  CONFIRMED: ['PROCESSING', 'SHIPPED', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: []
};

export function canTransitionOrder(fromStatus: OrderStatus, toStatus: OrderStatus): boolean {
  return (ORDER_STATUS_TRANSITIONS[fromStatus] ?? []).includes(toStatus);
}

