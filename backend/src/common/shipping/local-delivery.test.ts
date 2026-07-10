import { describe, expect, it } from 'vitest';
import {
  LOCAL_DELIVERY_DEFAULT_FEE_PAISE,
  parseLocalDeliveryPincodes,
  resolveLocalDeliveryQuote,
  resolveLocalDeliverySettings,
  type LocalDeliverySettings
} from './local-delivery';

function settings(overrides: Partial<LocalDeliverySettings> = {}): LocalDeliverySettings {
  return {
    enabled: true,
    pincodes: [
      { pincode: '500001', feePaise: 3000 },
      { pincode: '500002', feePaise: null }
    ],
    defaultFeePaise: LOCAL_DELIVERY_DEFAULT_FEE_PAISE,
    freeAbovePaise: null,
    estimatedDays: 1,
    ...overrides
  };
}

describe('parseLocalDeliveryPincodes', () => {
  it('parses valid entries and drops invalid/duplicate pincodes', () => {
    const parsed = parseLocalDeliveryPincodes([
      { pincode: '500001', feePaise: 2500 },
      { pincode: '500001', feePaise: 9999 }, // duplicate — dropped
      { pincode: '0500', feePaise: 100 }, // invalid — dropped
      { pincode: '500002' }, // no fee → null (default applies)
      'garbage',
      null
    ]);
    expect(parsed).toEqual([
      { pincode: '500001', feePaise: 2500 },
      { pincode: '500002', feePaise: null }
    ]);
  });

  it('returns [] for non-array input', () => {
    expect(parseLocalDeliveryPincodes(null)).toEqual([]);
    expect(parseLocalDeliveryPincodes({})).toEqual([]);
  });
});

describe('resolveLocalDeliveryQuote', () => {
  it('returns null when the feature is disabled', () => {
    expect(resolveLocalDeliveryQuote(settings({ enabled: false }), '500001')).toBeNull();
  });

  it('returns null for a pincode that is not whitelisted', () => {
    expect(resolveLocalDeliveryQuote(settings(), '600001')).toBeNull();
  });

  it('uses the per-pincode fee when set', () => {
    expect(resolveLocalDeliveryQuote(settings(), '500001')).toEqual({
      provider: 'LOCAL',
      shippingChargePaise: 3000,
      estimatedDays: 1
    });
  });

  it('falls back to the default fee (₹20) when the pincode has no fee', () => {
    expect(resolveLocalDeliveryQuote(settings(), '500002')?.shippingChargePaise).toBe(2000);
  });

  it('is free at/above the free-above threshold', () => {
    const configured = settings({ freeAbovePaise: 50000 });
    expect(
      resolveLocalDeliveryQuote(configured, '500001', { subtotalPaise: 50000 })?.shippingChargePaise
    ).toBe(0);
    expect(
      resolveLocalDeliveryQuote(configured, '500001', { subtotalPaise: 49999 })?.shippingChargePaise
    ).toBe(3000);
  });

  it('is free with a FREE_SHIPPING coupon', () => {
    expect(
      resolveLocalDeliveryQuote(settings(), '500001', { freeShippingCoupon: true })?.shippingChargePaise
    ).toBe(0);
  });
});

describe('resolveLocalDeliverySettings', () => {
  it('reads the StoreSettings singleton and normalizes values', async () => {
    const prisma = {
      storeSettings: {
        findUnique: async () => ({
          localDeliveryEnabled: true,
          localDeliveryPincodes: [{ pincode: '110001', feePaise: 4000 }],
          localDeliveryDefaultFeePaise: 2500,
          localDeliveryFreeAbovePaise: 99900,
          localDeliveryEstimatedDays: 2
        })
      }
    };
    const resolved = await resolveLocalDeliverySettings(prisma as never);
    expect(resolved).toEqual({
      enabled: true,
      pincodes: [{ pincode: '110001', feePaise: 4000 }],
      defaultFeePaise: 2500,
      freeAbovePaise: 99900,
      estimatedDays: 2
    });
  });

  it('fails safe to disabled on read errors or missing row', async () => {
    const throwing = { storeSettings: { findUnique: async () => { throw new Error('db down'); } } };
    expect((await resolveLocalDeliverySettings(throwing as never)).enabled).toBe(false);
    const empty = { storeSettings: { findUnique: async () => null } };
    expect((await resolveLocalDeliverySettings(empty as never)).enabled).toBe(false);
  });
});
