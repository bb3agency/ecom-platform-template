import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OrdersService } from './orders.service';
import { CartService } from '@modules/cart/cart.service';
import { invalidateStorefrontCouponsCache } from '@common/coupons/coupons-feature';

describe('OrdersService createOrder serviceability enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateStorefrontCouponsCache();
  });

  it('rejects order creation when shipping pincode is unserviceable', async () => {
    vi.spyOn(CartService.prototype, 'checkPincodeServiceability').mockResolvedValue({
      pincode: '500001',
      serviceable: false
    });

    const transactionSpy = vi.fn();
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            minOrderValuePaise: 0
          })
        },
        address: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'address_1',
            pincode: '500001'
          })
        },
        $transaction: transactionSpy
      },
      log: {
        error: vi.fn(),
        warn: vi.fn()
      },
      queues: {
        analytics: { add: vi.fn() },
        shipping: { add: vi.fn() },
        orderProcessing: { add: vi.fn() },
        refunds: { add: vi.fn() },
        notifications: { add: vi.fn() }
      },
      redis: {
        set: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);

    await expect(service.createOrder('user_1', { addressId: 'address_1' })).rejects.toMatchObject({
      code: 'PINCODE_NOT_SERVICEABLE',
      statusCode: 422
    });
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it('proceeds to transaction only after serviceability check passes', async () => {
    // Mock the CartService method at the prototype level before creating service instance
    const checkServiceabilitySpy = vi.spyOn(CartService.prototype, 'checkPincodeServiceability').mockResolvedValue({
      pincode: '500001',
      serviceable: true
    });

    const transactionSpy = vi.fn();
    const fastify = {
      prisma: {
        order: {
          count: vi.fn().mockResolvedValue(0)
        },
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            minOrderValuePaise: 0
          })
        },
        address: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'address_1',
            userId: 'user_1',
            fullName: 'Test User',
            phone: '9999999999',
            line1: 'Street 1',
            city: 'Hyderabad',
            state: 'Telangana',
            pincode: '500001'
          })
        },
        $transaction: transactionSpy.mockRejectedValue(new Error('transaction-failed'))
      },
      log: {
        error: vi.fn(),
        warn: vi.fn()
      },
      queues: {
        analytics: { add: vi.fn() },
        shipping: { add: vi.fn() },
        orderProcessing: { add: vi.fn() },
        refunds: { add: vi.fn() },
        notifications: { add: vi.fn() }
      },
      redis: {
        set: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);

    // Should call serviceability check
    await expect(service.createOrder('user_1', { addressId: 'address_1' })).rejects.toThrow('transaction-failed');
    expect(checkServiceabilitySpy).toHaveBeenCalledWith('500001');
    // Should proceed to transaction after serviceability passes
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it('computes delivery rate inside order transaction', async () => {
    vi.spyOn(CartService.prototype, 'checkPincodeServiceability').mockResolvedValue({
      pincode: '500001',
      serviceable: true
    });
    // Force noop mode so the code goes straight to computeShippingChargeForCart
    // without calling getCheapestProviderQuoteForCart (which needs real shipping adapters).
    vi.spyOn(CartService.prototype, 'usesNoopShipping').mockReturnValue(true);

    const computeShippingSpy = vi
      .spyOn(CartService.prototype, 'computeShippingChargeForCart')
      .mockRejectedValue(new Error('stop-after-precheck'));

    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([{ nextval: 1n }]),
      cart: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cart_1',
          coupon: null,
          reservations: [],
          items: [
            {
              id: 'item_1',
              variantId: 'variant_1',
              quantity: 1,
              priceSnapshot: 10_00,
              variant: {
                id: 'variant_1',
                weight: 500,
                isActive: true,
                packageLengthCm: null,
                packageWidthCm: null,
                packageHeightCm: null,
                inventory: { quantity: 10 },
                product: { categoryId: 'cat_1', name: 'Test Product', isActive: true }
              }
            }
          ]
        })
      },
      storeSettings: {
        findUnique: vi.fn().mockImplementation((args: { select?: Record<string, unknown> }) => {
          const sel = args?.select ?? {};
          if ('minOrderValuePaise' in sel) return Promise.resolve({ minOrderValuePaise: 0 });
          if ('pickupPincode' in sel) return Promise.resolve({ pickupPincode: '500001' });
          if ('couponsEnabled' in sel) return Promise.resolve({ couponsEnabled: false });
          return Promise.resolve(null);
        })
      }
    };

    const transactionSpy = vi
      .fn()
      .mockImplementation(async (fn) => fn(tx));

    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ minOrderValuePaise: 0 })
        },
        address: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'address_1',
            userId: 'user_1',
            fullName: 'Test User',
            phone: '9999999999',
            line1: 'Street 1',
            city: 'Hyderabad',
            state: 'Telangana',
            pincode: '500001'
          })
        },
        $transaction: transactionSpy
      },
      log: { error: vi.fn(), warn: vi.fn() },
      queues: {
        analytics: { add: vi.fn() },
        shipping: { add: vi.fn() },
        orderProcessing: { add: vi.fn() },
        refunds: { add: vi.fn() },
        notifications: { add: vi.fn() }
      },
      redis: { set: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);

    await expect(service.createOrder('user_1', { addressId: 'address_1' })).rejects.toThrow('stop-after-precheck');
    expect(computeShippingSpy).toHaveBeenCalledTimes(1);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });
});
