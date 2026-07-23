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

/**
 * Since product-level local delivery landed, the LOCAL channel is driven by the PRODUCT flag —
 * a whitelisted pincode alone no longer pulls an ordinary product out of the courier channel.
 * So the local-delivery fixtures must flag their products as local-delivery-only.
 */
function createFastify(
  overrides: Record<string, unknown> = {},
  opts: { localDeliveryOnly?: boolean } = {}
): FastifyInstance {
  const isLocalDeliveryOnly = opts.localDeliveryOnly ?? true;
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
            {
              variantId: 'v1',
              quantity: 2,
              priceSnapshot: 10000,
              variant: {
                id: 'v1',
                name: 'Default',
                sku: 'SKU-1',
                weight: 500,
                product: { name: 'Fresh Greens', isLocalDeliveryOnly }
              }
            }
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

  it('delivers an ORDINARY (unflagged) product locally when the pincode is whitelisted', async () => {
    // Regression guard for the reported "whitelisted pincode still quoted Shiprocket" bug.
    // An unflagged product is not courier-only — a whitelisted pincode means the merchant
    // drives there, so the whole cart is delivered locally at the pincode fee. The beforeEach
    // fetch stub throws on ANY courier call, so this passing also proves no provider was
    // consulted.
    const fastify = createFastify({}, { localDeliveryOnly: false });
    const service = new CartService(fastify);
    await expect(service.getDeliveryRates('user_1', undefined, '500001')).resolves.toEqual({
      pincode: '500001',
      shippingCharge: 3500,
      estimatedDays: 1,
      selectedShippingProvider: 'LOCAL'
    });
  });

  it('sends an ordinary product to the courier when the pincode is NOT whitelisted', async () => {
    const fastify = createFastify({}, { localDeliveryOnly: false });
    const service = new CartService(fastify);
    // Courier path entered → the throwing fetch stub fires, proving no LOCAL short-circuit.
    await expect(service.getDeliveryRates('user_1', undefined, '999999')).rejects.toThrow();
  });

  it('refuses to quote when a local-delivery-only product cannot reach the pincode', async () => {
    const service = new CartService(createFastify());
    // The customer must remove these items before checkout can proceed — the storefront turns
    // error.details.products into the blocking "remove these items" modal.
    await expect(service.getDeliveryRates('user_1', undefined, '999999')).rejects.toMatchObject({
      code: 'LOCAL_DELIVERY_ONLY_UNAVAILABLE',
      statusCode: 422,
      details: {
        pincode: '999999',
        products: [{ productName: 'Fresh Greens', sku: 'SKU-1' }]
      }
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
