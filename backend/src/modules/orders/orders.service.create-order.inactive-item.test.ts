import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OrdersService } from './orders.service';
import { CartService } from '@modules/cart/cart.service';

/**
 * A deactivated variant/product must never be ordered, even when a stale cart line raced the
 * deactivation-time cart purge. Regression for the gap where checkout only validated stock —
 * a merchant-pulled product could still be purchased through an existing cart.
 */
describe('OrdersService createOrder inactive-item guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeHarness(cartItems: unknown[]) {
    vi.spyOn(CartService.prototype, 'checkPincodeServiceability').mockResolvedValue({
      pincode: '500001',
      serviceable: true
    });
    vi.spyOn(CartService.prototype, 'getDeliveryRates').mockResolvedValue({
      pincode: '500001',
      shippingCharge: 2500,
      estimatedDays: 3
    });

    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([{ nextval: 1n }]),
      address: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'address_1',
          userId: 'user_1',
          fullName: 'Test User',
          phone: '9999999999',
          line1: 'Street 1',
          line2: null,
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500001'
        })
      },
      cart: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cart_1',
          coupon: null,
          reservations: [],
          items: cartItems
        }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      order: {
        // generateUniqueOrderNumber pre-insert check — null = candidate unused
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'order_1' }),
        findUniqueOrThrow: vi.fn()
      },
      orderItem: { create: vi.fn() },
      orderStatusHistory: { create: vi.fn() },
      cartItem: { deleteMany: vi.fn() },
      coupon: { update: vi.fn() },
      storeSettings: {
        findUnique: vi.fn().mockResolvedValue({ minOrderValuePaise: 0 })
      }
    };

    const fastify = {
      prisma: {
        storeSettings: { findUnique: vi.fn().mockResolvedValue({ minOrderValuePaise: 0 }) },
        address: { findFirst: vi.fn().mockResolvedValue({ id: 'address_1', pincode: '500001' }) },
        $transaction: vi.fn().mockImplementation(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx))
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

    return { fastify, tx };
  }

  it('rejects checkout when a cart line references a deactivated VARIANT', async () => {
    const { fastify, tx } = makeHarness([
      {
        variantId: 'variant_1',
        quantity: 1,
        priceSnapshot: 5000,
        variant: {
          id: 'variant_1',
          name: 'Variant 1',
          sku: 'SKU-1',
          isActive: false,
          product: { categoryId: 'cat_1', name: 'Pulled Product', isActive: true },
          inventory: { quantity: 10 }
        }
      }
    ]);

    const service = new OrdersService(fastify);
    await expect(service.createOrder('user_1', { addressId: 'address_1' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: expect.stringContaining('no longer available')
    });
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('rejects checkout when a cart line references a deactivated PRODUCT (active variant)', async () => {
    const { fastify, tx } = makeHarness([
      {
        variantId: 'variant_1',
        quantity: 1,
        priceSnapshot: 5000,
        variant: {
          id: 'variant_1',
          name: 'Variant 1',
          sku: 'SKU-1',
          isActive: true,
          product: { categoryId: 'cat_1', name: 'Pulled Product', isActive: false },
          inventory: { quantity: 10 }
        }
      }
    ]);

    const service = new OrdersService(fastify);
    await expect(service.createOrder('user_1', { addressId: 'address_1' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: expect.stringContaining('Pulled Product')
    });
    expect(tx.order.create).not.toHaveBeenCalled();
  });
});
