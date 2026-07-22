import { describe, expect, it } from 'vitest';
import {
  apportionPaise,
  classifyLocalDeliverySplit,
  computeSplitLegTotals
} from './local-delivery-split';

type Item = { sku: string; isLocalDeliveryOnly: boolean };

const localItem = (sku: string): Item => ({ sku, isLocalDeliveryOnly: true });
const courierItem = (sku: string): Item => ({ sku, isLocalDeliveryOnly: false });

describe('classifyLocalDeliverySplit', () => {
  it('routes a cart with no local-only products to the courier', () => {
    const result = classifyLocalDeliverySplit([courierItem('A'), courierItem('B')], {
      pincodeLocallyDeliverable: false
    });
    expect(result.mode).toBe('ALL_COURIER');
    expect(result.courierItems).toHaveLength(2);
    expect(result.localItems).toEqual([]);
    expect(result.blockedItems).toEqual([]);
  });

  it('keeps ordinary products on the courier even when the pincode is locally deliverable', () => {
    // Deliberate: the whitelist gates what local-only products can reach; it does not pull
    // ordinary products into the merchant-fulfilled channel.
    const result = classifyLocalDeliverySplit([courierItem('A')], {
      pincodeLocallyDeliverable: true
    });
    expect(result.mode).toBe('ALL_COURIER');
    expect(result.courierItems).toHaveLength(1);
  });

  it('routes an all-local cart to the local channel when the pincode is whitelisted', () => {
    const result = classifyLocalDeliverySplit([localItem('A'), localItem('B')], {
      pincodeLocallyDeliverable: true
    });
    expect(result.mode).toBe('ALL_LOCAL');
    expect(result.localItems).toHaveLength(2);
    expect(result.courierItems).toEqual([]);
  });

  it('splits a mixed cart when the pincode is whitelisted', () => {
    const result = classifyLocalDeliverySplit(
      [localItem('L1'), courierItem('C1'), localItem('L2')],
      { pincodeLocallyDeliverable: true }
    );
    expect(result.mode).toBe('SPLIT');
    expect(result.localItems.map((i) => i.sku)).toEqual(['L1', 'L2']);
    expect(result.courierItems.map((i) => i.sku)).toEqual(['C1']);
    expect(result.blockedItems).toEqual([]);
  });

  it('blocks checkout and names the offending items when a local-only product cannot reach the pincode', () => {
    const result = classifyLocalDeliverySplit([localItem('L1'), courierItem('C1')], {
      pincodeLocallyDeliverable: false
    });
    expect(result.mode).toBe('BLOCKED');
    expect(result.blockedItems.map((i) => i.sku)).toEqual(['L1']);
    // Nothing may be fulfilled while the cart is blocked — the customer removes items first.
    expect(result.localItems).toEqual([]);
    expect(result.courierItems).toEqual([]);
  });

  it('blocks an all-local cart bound for a non-whitelisted pincode', () => {
    const result = classifyLocalDeliverySplit([localItem('L1')], {
      pincodeLocallyDeliverable: false
    });
    expect(result.mode).toBe('BLOCKED');
    expect(result.blockedItems).toHaveLength(1);
  });

  it('treats an empty cart as ALL_COURIER rather than throwing', () => {
    const result = classifyLocalDeliverySplit([], { pincodeLocallyDeliverable: true });
    expect(result.mode).toBe('ALL_COURIER');
  });
});

describe('apportionPaise', () => {
  it('splits proportionally when the division is exact', () => {
    expect(apportionPaise(1000, [3000, 1000])).toEqual([750, 250]);
  });

  it('never loses or invents paise on an inexact division', () => {
    const parts = apportionPaise(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  it('sums back to the original amount across many random-ish weightings', () => {
    const cases: Array<[number, number[]]> = [
      [999, [1234, 5678]],
      [1, [1, 1]],
      [7, [3, 3, 3]],
      [123456, [999, 1, 100000]]
    ];
    for (const [amount, weights] of cases) {
      expect(apportionPaise(amount, weights).reduce((a, b) => a + b, 0)).toBe(amount);
    }
  });

  it('puts everything on the first bucket when all weights are zero', () => {
    expect(apportionPaise(500, [0, 0])).toEqual([500, 0]);
  });

  it('ignores negative and non-finite weights instead of producing negative shares', () => {
    const parts = apportionPaise(100, [-5, 100, Number.NaN]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts.every((p) => p >= 0)).toBe(true);
    expect(parts[1]).toBe(100);
  });

  it('returns an empty array for no buckets', () => {
    expect(apportionPaise(100, [])).toEqual([]);
  });
});

describe('computeSplitLegTotals', () => {
  it('apportions the discount by subtotal and gives each leg its own shipping', () => {
    const { local, courier } = computeSplitLegTotals({
      localSubtotalPaise: 30000,
      courierSubtotalPaise: 10000,
      localShippingPaise: 2000,
      courierShippingPaise: 5000,
      totalDiscountPaise: 4000
    });

    expect(local.discountAmountPaise).toBe(3000);
    expect(courier.discountAmountPaise).toBe(1000);
    expect(local.totalPaise).toBe(30000 + 2000 - 3000);
    expect(courier.totalPaise).toBe(10000 + 5000 - 1000);
  });

  it('preserves the customer-facing total exactly across the split', () => {
    const input = {
      localSubtotalPaise: 33333,
      courierSubtotalPaise: 16667,
      localShippingPaise: 2000,
      courierShippingPaise: 4900,
      totalDiscountPaise: 7777
    };
    const { local, courier } = computeSplitLegTotals(input);

    const combined = local.totalPaise + courier.totalPaise;
    const unsplit =
      input.localSubtotalPaise +
      input.courierSubtotalPaise +
      input.localShippingPaise +
      input.courierShippingPaise -
      input.totalDiscountPaise;
    expect(combined).toBe(unsplit);
  });

  it('never produces a negative leg total when the discount exceeds a leg', () => {
    const { local } = computeSplitLegTotals({
      localSubtotalPaise: 100,
      courierSubtotalPaise: 0,
      localShippingPaise: 0,
      courierShippingPaise: 0,
      totalDiscountPaise: 5000
    });
    expect(local.totalPaise).toBe(0);
  });

  it('handles a zero discount without touching the leg totals', () => {
    const { local, courier } = computeSplitLegTotals({
      localSubtotalPaise: 5000,
      courierSubtotalPaise: 7000,
      localShippingPaise: 2000,
      courierShippingPaise: 3000,
      totalDiscountPaise: 0
    });
    expect(local.totalPaise).toBe(7000);
    expect(courier.totalPaise).toBe(10000);
  });
});
