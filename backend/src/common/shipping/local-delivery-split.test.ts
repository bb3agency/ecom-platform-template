import { describe, expect, it } from 'vitest';
import { classifyLocalDeliverySplit } from './local-delivery-split';

type Item = { sku: string; isLocalDeliveryOnly: boolean };

const localItem = (sku: string): Item => ({ sku, isLocalDeliveryOnly: true });
const courierItem = (sku: string): Item => ({ sku, isLocalDeliveryOnly: false });

describe('classifyLocalDeliverySplit', () => {
  it('delivers the whole cart locally when the pincode is whitelisted', () => {
    // The whitelist is "I drive to this area", so flagged and unflagged items ride together —
    // one local order, no courier, no split.
    const result = classifyLocalDeliverySplit([localItem('L1'), courierItem('C1')], {
      pincodeLocallyDeliverable: true
    });
    expect(result.mode).toBe('ALL_LOCAL');
    expect(result.localItems.map((i) => i.sku)).toEqual(['L1', 'C1']);
    expect(result.courierItems).toEqual([]);
    expect(result.blockedItems).toEqual([]);
  });

  it('delivers an ordinary cart locally when the pincode is whitelisted', () => {
    const result = classifyLocalDeliverySplit([courierItem('A'), courierItem('B')], {
      pincodeLocallyDeliverable: true
    });
    expect(result.mode).toBe('ALL_LOCAL');
    expect(result.localItems).toHaveLength(2);
  });

  it('routes an ordinary cart to the courier when the pincode is not whitelisted', () => {
    const result = classifyLocalDeliverySplit([courierItem('A'), courierItem('B')], {
      pincodeLocallyDeliverable: false
    });
    expect(result.mode).toBe('ALL_COURIER');
    expect(result.courierItems).toHaveLength(2);
    expect(result.localItems).toEqual([]);
    expect(result.blockedItems).toEqual([]);
  });

  it('blocks checkout and names the flagged items when the pincode is not whitelisted', () => {
    const result = classifyLocalDeliverySplit(
      [localItem('L1'), courierItem('C1'), localItem('L2')],
      { pincodeLocallyDeliverable: false }
    );
    expect(result.mode).toBe('BLOCKED');
    expect(result.blockedItems.map((i) => i.sku)).toEqual(['L1', 'L2']);
    // Nothing may be fulfilled while the cart is blocked — the customer removes items first.
    expect(result.localItems).toEqual([]);
    expect(result.courierItems).toEqual([]);
  });

  it('blocks an all-flagged cart bound for a non-whitelisted pincode', () => {
    const result = classifyLocalDeliverySplit([localItem('L1')], {
      pincodeLocallyDeliverable: false
    });
    expect(result.mode).toBe('BLOCKED');
    expect(result.blockedItems).toHaveLength(1);
  });

  it('does not throw on an empty cart', () => {
    // Empty carts are rejected upstream; this only guards the classifier itself.
    expect(classifyLocalDeliverySplit([], { pincodeLocallyDeliverable: false }).mode).toBe(
      'ALL_COURIER'
    );
    expect(classifyLocalDeliverySplit([], { pincodeLocallyDeliverable: true }).mode).toBe(
      'ALL_LOCAL'
    );
  });
});
