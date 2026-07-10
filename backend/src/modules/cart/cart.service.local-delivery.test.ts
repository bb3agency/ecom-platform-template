import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { invalidateStorefrontCouponsCache } from '@common/coupons/coupons-feature';
import { CartService } from './cart.service';

const LOCAL_SETTINGS_ROW = {
  localDeliveryEnabled: true,
  localDeliveryPincodes: [
    { pincode: '500001', feePaise: 3500 },
    { pincode: '500002', feePaise: null }
  ],
  localDeliveryDefaultFeePaise: 2000,
  localDeliveryFreeAbovePaise: null,
  localDeliveryEstimatedDays: 1
};

function createFastify(overrides: Record<string, unknown> = {}): FastifyInstance {
  return {
    prisma: {
      storeSettings: {
        findUnique: vi.fn().mockResolvedValue(LOCAL_SETTINGS_ROW)
      },
      cart: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'cart_1',
          coupon: null,
          items: [
            { quantity: 2, priceSnapshot: 10000, variant: { id: 'v1', weight: 500 } }
          ]
        })
      }
    },
    redis: { set: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null) },
    log: { warn: vi.fn() },
    ...overrides
  } as unknown as FastifyInstance;
}

describe('CartService local delivery short-circuit', () => {
  beforeEach(() => {
    invalidateStorefrontCouponsCache();
    // Configure a courier so the test proves the LOCAL branch wins BEFORE any courier call.
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('DELHIVERY_BASE_URL', 'https://delhivery.test');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        throw new Error('Courier API must NEVER be called for a whitelisted local pincode');
      })
    );
  });

  afterEach(() => {
    invalidateStorefrontCouponsCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reports a whitelisted pincode serviceable without touching the courier', async () => {
    const service = new CartService(createFastify());
    await expect(service.checkPincodeServiceability('500001')).resolves.toEqual({
      pincode: '500001',
      serviceable: true
    });
  });

  it('quotes the per-pincode local fee with provider LOCAL and persists the quote', async () => {
    const fastify = createFastify();
    const service = new CartService(fastify);
    await expect(service.getDeliveryRates('user_1', undefined, '500001')).resolves.toEqual({
      pincode: '500001',
      shippingCharge: 3500,
      estimatedDays: 1,
      selectedShippingProvider: 'LOCAL'
    });
    const redisSet = (fastify as unknown as { redis: { set: ReturnType<typeof vi.fn> } }).redis.set;
    expect(redisSet).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(redisSet.mock.calls[0]?.[1] as string) as { provider: string };
    expect(persisted.provider).toBe('LOCAL');
  });

  it('falls back to the default ₹20 fee when the pincode row has no fee', async () => {
    const service = new CartService(createFastify());
    await expect(service.getDeliveryRates('user_1', undefined, '500002')).resolves.toMatchObject({
      shippingCharge: 2000,
      selectedShippingProvider: 'LOCAL'
    });
  });

  it('getLocalDeliveryQuoteForCheckout mirrors the storefront quote (free-above respected)', async () => {
    const fastify = createFastify();
    (fastify.prisma.storeSettings.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...LOCAL_SETTINGS_ROW,
      localDeliveryFreeAbovePaise: 50000
    });
    const service = new CartService(fastify);
    await expect(service.getLocalDeliveryQuoteForCheckout('500001', 50000, false)).resolves.toEqual({
      provider: 'LOCAL',
      shippingChargePaise: 0,
      estimatedDays: 1
    });
    await expect(service.getLocalDeliveryQuoteForCheckout('500001', 10000, false)).resolves.toEqual({
      provider: 'LOCAL',
      shippingChargePaise: 3500,
      estimatedDays: 1
    });
    await expect(service.getLocalDeliveryQuoteForCheckout('999999', 10000, false)).resolves.toBeNull();
  });
});
