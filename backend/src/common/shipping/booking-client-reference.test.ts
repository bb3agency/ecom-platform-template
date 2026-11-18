import { describe, expect, it } from 'vitest';
import { resolveBookingClientReference } from './booking-client-reference';

describe('resolveBookingClientReference', () => {
  it('uses the bare order number for a first attempt', () => {
    expect(resolveBookingClientReference('ORD-8FYX-RNTP', 0)).toBe('ORD-8FYX-RNTP');
    expect(resolveBookingClientReference('ORD-8FYX-RNTP', null)).toBe('ORD-8FYX-RNTP');
    expect(resolveBookingClientReference('ORD-8FYX-RNTP', undefined)).toBe('ORD-8FYX-RNTP');
  });

  // Couriers refuse to reuse a reference they hold as cancelled — Shiprocket answers
  // "order is in cancelled state" — so each abandoned attempt needs a fresh one.
  it('suffixes a fresh reference after each abandoned attempt', () => {
    expect(resolveBookingClientReference('ORD-8FYX-RNTP', 1)).toBe('ORD-8FYX-RNTP-R2');
    expect(resolveBookingClientReference('ORD-8FYX-RNTP', 2)).toBe('ORD-8FYX-RNTP-R3');
  });

  it('is stable for the same attempt, so booking and lookup agree', () => {
    const a = resolveBookingClientReference('ORD-1', 3);
    const b = resolveBookingClientReference('ORD-1', 3);
    expect(a).toBe(b);
  });

  it('ignores nonsense attempt values rather than producing a broken reference', () => {
    expect(resolveBookingClientReference('ORD-1', -5)).toBe('ORD-1');
    expect(resolveBookingClientReference('ORD-1', Number.NaN)).toBe('ORD-1');
    expect(resolveBookingClientReference('ORD-1', 1.7)).toBe('ORD-1-R2');
  });
});
