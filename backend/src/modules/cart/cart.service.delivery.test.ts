import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { invalidateStorefrontCouponsCache } from '@common/coupons/coupons-feature';
import { CartService } from './cart.service';

const DELHIVERY_TEST_BASE_URL = 'https://delhivery.test';

function createFastifyStub(overrides: Record<string, unknown> = {}): FastifyInstance {
  return {
    prisma: {
      storeSettings: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    },
    ...overrides
  } as unknown as FastifyInstance;
}

describe('CartService delivery utility methods', () => {
  beforeEach(() => {
    invalidateStorefrontCouponsCache();
  });

  afterEach(() => {
    invalidateStorefrontCouponsCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns serviceability from provider when Delhivery key is configured', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('DELHIVERY_BASE_URL', DELHIVERY_TEST_BASE_URL);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ delivery_codes: [{ postal_code: { pin: '500001' } }] })
      })
    );
    const service = new CartService(createFastifyStub({ log: { warn: vi.fn() } }));
    await expect(service.checkPincodeServiceability('500001')).resolves.toEqual({
      pincode: '500001',
      serviceable: true
    });
  });

  it('falls back to noop serviceability when shipping provider is not configured', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', '');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '');
    vi.stubEnv('DELHIVERY_BASE_URL', '');
    const service = new CartService(createFastifyStub());
    await expect(service.checkPincodeServiceability('500001')).resolves.toEqual({
      pincode: '500001',
      serviceable: true
    });
  });

  it('throws when provider serviceability check fails', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('DELHIVERY_BASE_URL', DELHIVERY_TEST_BASE_URL);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => ''
      })
    );
    const warn = vi.fn();
    const service = new CartService(createFastifyStub({ log: { warn } }));
    await expect(service.checkPincodeServiceability('500001')).rejects.toMatchObject({
      statusCode: 503
    });
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to noop delivery rates when shipping provider is not configured', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', '');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '');
    vi.stubEnv('DELHIVERY_BASE_URL', '');
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue(null)
        },
        cart: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'cart_1',
            items: [
              {
                quantity: 1,
                variant: {
                  weight: 500
                }
              }
            ]
          })
        }
      }
    } as unknown as FastifyInstance;
    const service = new CartService(fastify);
    await expect(service.getDeliveryRates('user_1', undefined, '500001')).resolves.toMatchObject({
      pincode: '500001',
      shippingCharge: 0,
      estimatedDays: 3
    });
  });

  it('throws validation error when delivery rates are requested without cart items', async () => {
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue(null)
        },
        cart: {
          findUnique: vi.fn().mockResolvedValue(null)
        }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    await expect(service.getDeliveryRates('user_1', undefined, '500001')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400
    });
  });

  it('returns computed delivery rate for serviceable pincode', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('DELHIVERY_BASE_URL', DELHIVERY_TEST_BASE_URL);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ delivery_codes: [{ postal_code: { pin: '500001' } }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ total_amount: 99.5, estimated_delivery_days: 3 })
      });
    vi.stubGlobal('fetch', fetchMock);

    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            pickupPincode: '110001'
          })
        },
        cart: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'cart_1',
            items: [
              {
                quantity: 2,
                variant: {
                  weight: 750
                }
              }
            ]
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    await expect(service.getDeliveryRates('user_1', undefined, '500001')).resolves.toMatchObject({
      pincode: '500001',
      shippingCharge: 10450, // ₹99.50 provider rate + ₹5 notification surcharge
      estimatedDays: 3
    });
  });

  it('returns zero shipping charge when cart has an active FREE_SHIPPING coupon', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('DELHIVERY_BASE_URL', DELHIVERY_TEST_BASE_URL);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ delivery_codes: [{ postal_code: { pin: '500001' } }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ total_amount: 99.5, estimated_delivery_days: 3 })
      });
    vi.stubGlobal('fetch', fetchMock);

    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
            if (select?.couponsEnabled) {
              return Promise.resolve({ couponsEnabled: true });
            }
            if (select?.pickupPincode) {
              return Promise.resolve({ pickupPincode: '110001' });
            }
            return Promise.resolve(null);
          })
        },
        cart: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'cart_1',
            coupon: {
              id: 'coupon_free_ship',
              type: 'FREE_SHIPPING',
              code: 'FREESHIP'
            },
            items: [
              {
                quantity: 1,
                variant: {
                  id: 'variant_1',
                  weight: 500
                }
              }
            ]
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    await expect(service.getDeliveryRates('user_1', undefined, '500001')).resolves.toMatchObject({
      pincode: '500001',
      shippingCharge: 0,
      estimatedDays: 3
    });
  });

  it('rejects delivery-rate request for unserviceable pincode', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('DELHIVERY_BASE_URL', DELHIVERY_TEST_BASE_URL);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ delivery_codes: [] })
    });
    vi.stubGlobal('fetch', fetchMock);

    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            pickupPincode: '110001'
          })
        },
        cart: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'cart_1',
            items: [
              {
                quantity: 1,
                variant: {
                  weight: 500
                }
              }
            ]
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    await expect(service.getDeliveryRates('user_1', undefined, '500001')).rejects.toMatchObject({
      code: 'PINCODE_NOT_SERVICEABLE',
      statusCode: 422
    });
  });
});

describe('CartService dual-provider delivery rates', () => {
  afterEach(() => {
    invalidateStorefrontCouponsCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns rates from both providers with cheapest marked recommended', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_BASE_URL', DELHIVERY_TEST_BASE_URL);
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('SHIPROCKET_EMAIL', 'sr@example.com');
    vi.stubEnv('SHIPROCKET_PASSWORD', 'srpass');

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('delhivery')) {
        // Delhivery serviceability
        if (url.includes('pin-codes')) {
          return Promise.resolve({
            ok: true, status: 200,
            text: async () => JSON.stringify({ delivery_codes: [{ postal_code: { pin: '500001' } }] })
          });
        }
        // Delhivery rate
        if (url.includes('kinko')) {
          return Promise.resolve({
            ok: true, status: 200,
            text: async () => JSON.stringify({ total_amount: 45, estimated_delivery_days: 4 })
          });
        }
      }
      if (typeof url === 'string' && url.includes('shiprocket')) {
        // Shiprocket auth
        if (url.includes('auth')) {
          return Promise.resolve({
            ok: true, status: 200,
            json: async () => ({ token: 'sr-token' })
          });
        }
        // Shiprocket serviceability
        if (url.includes('courier/serviceability')) {
          return Promise.resolve({
            ok: true, status: 200,
            json: async () => ({
              status: 200,
              data: {
                available_courier_companies: [
                  { courier_company_id: 1, courier_name: 'Delhivery SR', rate: 65, estimated_delivery_days: 3 }
                ]
              }
            })
          });
        }
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
            if (select?.couponsEnabled) return Promise.resolve({ couponsEnabled: false });
            if (select?.pickupPincode) return Promise.resolve({ pickupPincode: '110001' });
            return Promise.resolve(null);
          })
        },
        cart: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'cart_1',
            coupon: null,
            items: [{ quantity: 1, variant: { id: 'v1', weight: 500 } }]
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    const result = await service.getDeliveryRates('user_1', undefined, '500001') as {
      pincode: string;
      shippingCharge: number;
      estimatedDays: number;
      selectedShippingProvider?: string;
    };

    // Backend auto-selects cheapest provider; Delhivery (4500 paise) cheaper than Shiprocket (6500 paise).
    // Customer-facing charge = true cost + ₹5 notification surcharge.
    expect(result.selectedShippingProvider).toBeDefined();
    expect(result.selectedShippingProvider).toBe('DELHIVERY');
    expect(result.shippingCharge).toBe(5000);
  });

  it('persists the winning quote to Redis and reuses it verbatim at checkout', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_BASE_URL', DELHIVERY_TEST_BASE_URL);
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('SHIPROCKET_EMAIL', 'sr@example.com');
    vi.stubEnv('SHIPROCKET_PASSWORD', 'srpass');

    // Shiprocket is cheapest at quote time: courier 7 @ ₹130.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('delhivery')) {
        if (url.includes('pin-codes')) {
          return Promise.resolve({
            ok: true, status: 200,
            text: async () => JSON.stringify({ delivery_codes: [{ postal_code: { pin: '500001' } }] })
          });
        }
        if (url.includes('kinko')) {
          return Promise.resolve({
            ok: true, status: 200,
            text: async () => JSON.stringify({ total_amount: 480, estimated_delivery_days: 2 })
          });
        }
      }
      if (typeof url === 'string' && url.includes('shiprocket')) {
        if (url.includes('auth')) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ token: 'sr-token' }) });
        }
        if (url.includes('courier/serviceability')) {
          return Promise.resolve({
            ok: true, status: 200,
            text: async () => JSON.stringify({
              status: 200,
              data: {
                available_courier_companies: [
                  { courier_company_id: 7, courier_name: 'Cheap Courier', rate: 130, estimated_delivery_days: 3 }
                ]
              }
            })
          });
        }
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = new Map<string, string>();
    const redis = {
      set: vi.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
      get: vi.fn(async (key: string) => store.get(key) ?? null)
    };

    const fastify = {
      redis,
      log: { warn: vi.fn() },
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
            if (select?.couponsEnabled) return Promise.resolve({ couponsEnabled: false });
            if (select?.pickupPincode) return Promise.resolve({ pickupPincode: '110001' });
            return Promise.resolve(null);
          })
        },
        cart: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'cart_1',
            coupon: null,
            items: [{ quantity: 1, variant: { id: 'v1', weight: 500 } }]
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    const quote = await service.getDeliveryRates('user_1', undefined, '500001') as {
      shippingCharge: number;
      selectedShippingProvider?: string;
      courierCompanyId?: number;
    };

    expect(quote.selectedShippingProvider).toBe('SHIPROCKET');
    expect(quote.shippingCharge).toBe(13500); // ₹130 + ₹5 notification surcharge
    expect(quote.courierCompanyId).toBe(7);
    expect(redis.set).toHaveBeenCalled();

    // Checkout reuses the exact quote — provider, rate, AND courier — for the same cart.
    const stored = await service.getStoredShippingQuote('user_1', undefined, 'cart_1', '500001', 'PREPAID');
    expect(stored).toEqual({ provider: 'SHIPROCKET', shippingChargePaise: 13500, estimatedDays: 3, courierCompanyId: 7 });

    // A different cart must NOT reuse the quote (cart fingerprint guard).
    const mismatched = await service.getStoredShippingQuote('user_1', undefined, 'cart_other', '500001', 'PREPAID');
    expect(mismatched).toBeNull();
  });

  it('getCheapestProviderQuoteForCart picks the cheaper provider (Delhivery) over a pricier Shiprocket', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_BASE_URL', DELHIVERY_TEST_BASE_URL);
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('SHIPROCKET_EMAIL', 'sr@example.com');
    vi.stubEnv('SHIPROCKET_PASSWORD', 'srpass');

    // Delhivery ₹156 vs Shiprocket ₹480 — Delhivery must win and be locked.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('delhivery')) {
        if (url.includes('pin-codes')) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ delivery_codes: [{ postal_code: { pin: '500001' } }] }) });
        }
        if (url.includes('kinko')) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ total_amount: 156, estimated_delivery_days: 4 }) });
        }
      }
      if (typeof url === 'string' && url.includes('shiprocket')) {
        if (url.includes('auth')) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ token: 'sr-token' }) });
        }
        if (url.includes('courier/serviceability')) {
          return Promise.resolve({
            ok: true, status: 200,
            text: async () => JSON.stringify({
              status: 200,
              data: { available_courier_companies: [{ courier_company_id: 51, courier_name: 'Blue Dart Air', rate: 480, estimated_delivery_days: 1 }] }
            })
          });
        }
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const fastify = {
      log: { warn: vi.fn() },
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
            if (select?.couponsEnabled) return Promise.resolve({ couponsEnabled: false });
            if (select?.boxPresets) return Promise.resolve({ boxPresets: [] });
            if (select?.pickupPincode) return Promise.resolve({ pickupPincode: '110001' });
            return Promise.resolve(null);
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    const result = await service.getCheapestProviderQuoteForCart({
      cart: { coupon: null, items: [{ quantity: 1, variant: { id: 'v1', weight: 500 } }] },
      destinationPincode: '500001',
      pickupPincode: '110001',
      paymentMode: 'PREPAID'
    });

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('DELHIVERY');
    expect(result?.shippingChargePaise).toBe(16100); // ₹156 + ₹5 notification surcharge
  });

  it('getCheapestProviderQuoteForCart locks the Shiprocket courier when Shiprocket is cheapest', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_BASE_URL', DELHIVERY_TEST_BASE_URL);
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('SHIPROCKET_EMAIL', 'sr@example.com');
    vi.stubEnv('SHIPROCKET_PASSWORD', 'srpass');

    // Shiprocket ₹90 (courier 12) vs Delhivery ₹156 — Shiprocket wins and its courier id is returned.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('delhivery')) {
        if (url.includes('pin-codes')) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ delivery_codes: [{ postal_code: { pin: '500001' } }] }) });
        }
        if (url.includes('kinko')) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ total_amount: 156, estimated_delivery_days: 4 }) });
        }
      }
      if (typeof url === 'string' && url.includes('shiprocket')) {
        if (url.includes('auth')) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ token: 'sr-token' }) });
        }
        if (url.includes('courier/serviceability')) {
          return Promise.resolve({
            ok: true, status: 200,
            text: async () => JSON.stringify({
              status: 200,
              data: { available_courier_companies: [{ courier_company_id: 12, courier_name: 'Eco Surface', rate: 90, estimated_delivery_days: 5 }] }
            })
          });
        }
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const fastify = {
      log: { warn: vi.fn() },
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
            if (select?.couponsEnabled) return Promise.resolve({ couponsEnabled: false });
            if (select?.boxPresets) return Promise.resolve({ boxPresets: [] });
            if (select?.pickupPincode) return Promise.resolve({ pickupPincode: '110001' });
            return Promise.resolve(null);
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    const result = await service.getCheapestProviderQuoteForCart({
      cart: { coupon: null, items: [{ quantity: 1, variant: { id: 'v1', weight: 500 } }] },
      destinationPincode: '500001',
      pickupPincode: '110001',
      paymentMode: 'PREPAID'
    });

    expect(result?.provider).toBe('SHIPROCKET');
    expect(result?.shippingChargePaise).toBe(9500); // ₹90 + ₹5 notification surcharge
    expect(result?.courierCompanyId).toBe(12);
  });

  it('with FREE_SHIPPING coupon, still locks the cheapest provider (Delhivery) not the fastest (Shiprocket)', async () => {
    // Regression: a FREE_SHIPPING coupon zeroed BOTH providers' charges before comparison, so they
    // tied at ₹0 and the "fastest" tiebreaker locked Shiprocket (3d, Blue Dart Air ₹475) over
    // Delhivery (4d, ₹130). Customer paid ₹0 shipping but the merchant's Shiprocket wallet was
    // billed ₹475. Fix: compare on TRUE cost; free shipping only zeroes the customer-facing charge.
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_BASE_URL', DELHIVERY_TEST_BASE_URL);
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('SHIPROCKET_EMAIL', 'sr@example.com');
    vi.stubEnv('SHIPROCKET_PASSWORD', 'srpass');

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('delhivery')) {
        if (url.includes('pin-codes')) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ delivery_codes: [{ postal_code: { pin: '500001' } }] }) });
        }
        if (url.includes('kinko')) {
          // Delhivery ₹130, slower (4 days)
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ total_amount: 130, estimated_delivery_days: 4 }) });
        }
      }
      if (typeof url === 'string' && url.includes('shiprocket')) {
        if (url.includes('auth')) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ token: 'sr-token' }) });
        }
        if (url.includes('courier/serviceability')) {
          // Shiprocket ₹475 Blue Dart Air, faster (3 days) — must NOT win despite being faster.
          return Promise.resolve({
            ok: true, status: 200,
            text: async () => JSON.stringify({
              status: 200,
              data: { available_courier_companies: [{ courier_company_id: 1, courier_name: 'Blue Dart Air', rate: 475, estimated_delivery_days: 3 }] }
            })
          });
        }
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const fastify = {
      log: { warn: vi.fn() },
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
            if (select?.couponsEnabled) return Promise.resolve({ couponsEnabled: true });
            if (select?.boxPresets) return Promise.resolve({ boxPresets: [] });
            if (select?.pickupPincode) return Promise.resolve({ pickupPincode: '110001' });
            return Promise.resolve(null);
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    const result = await service.getCheapestProviderQuoteForCart({
      cart: {
        coupon: { type: 'FREE_SHIPPING' } as unknown as NonNullable<Parameters<CartService['getCheapestProviderQuoteForCart']>[0]['cart']['coupon']>,
        items: [{ quantity: 1, variant: { id: 'v1', weight: 500 } }]
      },
      destinationPincode: '500001',
      pickupPincode: '110001',
      paymentMode: 'PREPAID'
    });

    // Customer pays ₹0 (free shipping), but the order locks the genuinely cheapest provider.
    expect(result?.provider).toBe('DELHIVERY');
    expect(result?.shippingChargePaise).toBe(0);
  });

  it('rejects when both providers say pincode is unserviceable in dual mode', async () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery_key');
    vi.stubEnv('DELHIVERY_BASE_URL', DELHIVERY_TEST_BASE_URL);
    vi.stubEnv('DELHIVERY_PICKUP_PINCODE', '110001');
    vi.stubEnv('SHIPROCKET_EMAIL', 'sr@example.com');
    vi.stubEnv('SHIPROCKET_PASSWORD', 'srpass');

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('delhivery')) {
        if (url.includes('pin-codes')) {
          return Promise.resolve({
            ok: true, status: 200,
            text: async () => JSON.stringify({ delivery_codes: [] })
          });
        }
      }
      if (typeof url === 'string' && url.includes('shiprocket')) {
        if (url.includes('auth')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ token: 'sr-token' }) });
        }
        if (url.includes('serviceability')) {
          return Promise.resolve({
            ok: true, status: 200,
            json: async () => ({ status: 200, data: { available_courier_companies: [] } })
          });
        }
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ pickupPincode: '110001' })
        },
        cart: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'cart_1',
            coupon: null,
            items: [{ quantity: 1, variant: { id: 'v1', weight: 500 } }]
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    await expect(service.getDeliveryRates('user_1', undefined, '999999')).rejects.toMatchObject({
      code: 'PINCODE_NOT_SERVICEABLE',
      statusCode: 422
    });
  });
});
