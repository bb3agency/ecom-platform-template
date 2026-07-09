import { describe, expect, it } from 'vitest';
import { ORDER_STATUS_TRANSITIONS, canTransitionOrder } from './order-state-machine';

const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED'
] as const;

describe('order state machine', () => {
  it('contains transition rules for all order states', () => {
    expect(Object.keys(ORDER_STATUS_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it('allows documented valid transitions', () => {
    expect(canTransitionOrder('PENDING_PAYMENT', 'CONFIRMED')).toBe(true);
    expect(canTransitionOrder('PENDING_PAYMENT', 'PAYMENT_FAILED')).toBe(true);
    expect(canTransitionOrder('CONFIRMED', 'PROCESSING')).toBe(true);
    expect(canTransitionOrder('CONFIRMED', 'SHIPPED')).toBe(true);
    expect(canTransitionOrder('PROCESSING', 'SHIPPED')).toBe(true);
    expect(canTransitionOrder('SHIPPED', 'OUT_FOR_DELIVERY')).toBe(true);
    // Shiprocket may cancel a booked shipment before physical pickup
    expect(canTransitionOrder('SHIPPED', 'CANCELLED')).toBe(true);
    // Couriers often report delivery without an out-for-delivery scan reaching us
    expect(canTransitionOrder('SHIPPED', 'DELIVERED')).toBe(true);
    expect(canTransitionOrder('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
    expect(canTransitionOrder('DELIVERED', 'REFUNDED')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransitionOrder('PENDING_PAYMENT', 'CANCELLED')).toBe(false);
    expect(canTransitionOrder('PENDING_PAYMENT', 'DELIVERED')).toBe(false);
    expect(canTransitionOrder('CANCELLED', 'CONFIRMED')).toBe(false);
    expect(canTransitionOrder('REFUNDED', 'PROCESSING')).toBe(false);
    expect(canTransitionOrder('OUT_FOR_DELIVERY', 'CANCELLED')).toBe(false);
    expect(canTransitionOrder('OUT_FOR_DELIVERY', 'PROCESSING')).toBe(false);
  });
});

