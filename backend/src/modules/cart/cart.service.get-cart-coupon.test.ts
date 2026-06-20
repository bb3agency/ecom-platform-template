import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { invalidateStorefrontCouponsCache } from '@common/coupons/coupons-feature';
import { CartService } from './cart.service';

function mockStoreSettings(couponsEnabled: boolean) {
  return {
    findUnique: vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
      if (select?.couponsEnabled) {
        return Promise.resolve({ couponsEnabled });
      }
      if (select?.minOrderValuePaise) {
        return Promise.resolve({ minOrderValuePaise: 0 });
      }
      return Promise.resolve(null);
    })
  };
}

describe('CartService getCart stale coupon cleanup', () => {
  afterEach(() => {
    invalidateStorefrontCouponsCache();
  });

  it('clears orphaned couponId from DB when storefront coupons are disabled', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const cartRecord = {
      id: 'cart_1',
      sessionToken: null,
      coupon: {
        id: 'coupon_1',
        code: 'SAVE10',
        type: 'PERCENTAGE_OFF',
        value: 10,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2026-12-31T23:59:59.000Z'),
        applicableTo: null
      },
      reservations: [],
      items: [
        {
          id: 'item_1',
          variantId: 'variant_1',
          quantity: 1,
          priceSnapshot: 1000,
          variant: {
            id: 'variant_1',
            name: 'Variant 1',
            sku: 'SKU-1',
            price: 1000,
            productId: 'product_1',
            product: { categoryId: 'category_1' }
          }
        }
      ]
    };
    const fastify = {
      prisma: {
        storeSettings: mockStoreSettings(false),
        cart: {
          upsert: vi.fn().mockResolvedValue(cartRecord),
          update
        },
        cartReservation: {
          findMany: vi.fn().mockResolvedValue([]),
          updateMany: vi.fn().mockResolvedValue(undefined)
        }
      }
    } as unknown as FastifyInstance;
    const service = new CartService(fastify);

    const result = await service.getCart('user_1', undefined);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'cart_1' },
      data: { couponId: null }
    });
    expect(result.coupon).toBeNull();
    expect(result.discountAmount).toBe(0);
  });

  it('keeps cart coupon when merchant has enabled storefront coupons', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const cartRecord = {
      id: 'cart_1',
      userId: 'user_1',
      sessionToken: null,
      coupon: {
        id: 'coupon_1',
        code: 'FREEDELIVERY',
        type: 'FREE_SHIPPING',
        value: 0,
        minOrderPaise: 0,
        maxUsesTotal: null,
        maxUsesPerUser: null,
        usesCount: 0,
        isActive: true,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: null,
        applicableTo: null
      },
      reservations: [],
      items: [
        {
          id: 'item_1',
          variantId: 'variant_1',
          quantity: 1,
          priceSnapshot: 1000,
          variant: {
            id: 'variant_1',
            name: 'Variant 1',
            sku: 'SKU-1',
            price: 1000,
            productId: 'product_1',
            product: { categoryId: 'category_1', name: 'Product 1', metaDescription: null, images: [] }
          }
        }
      ]
    };
    const fastify = {
      prisma: {
        storeSettings: mockStoreSettings(true),
        cart: {
          upsert: vi.fn().mockResolvedValue(cartRecord),
          update
        },
        order: {
          count: vi.fn().mockResolvedValue(0)
        },
        cartReservation: {
          findMany: vi.fn().mockResolvedValue([]),
          updateMany: vi.fn().mockResolvedValue(undefined)
        }
      },
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn()
      }
    } as unknown as FastifyInstance;
    const service = new CartService(fastify);

    const result = await service.getCart('user_1', undefined);

    expect(update).not.toHaveBeenCalled();
    expect(result.coupon).toMatchObject({ code: 'FREEDELIVERY' });
  });

  it('clears expired coupon on cart read and returns zero discount', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const expiredCoupon = {
      id: 'coupon_1',
      code: 'SAVE10',
      type: 'PERCENTAGE_OFF',
      value: 10,
      minOrderPaise: 0,
      maxUsesTotal: null,
      maxUsesPerUser: null,
      usesCount: 0,
      isActive: true,
      validFrom: new Date('2024-01-01T00:00:00.000Z'),
      validUntil: new Date('2024-12-31T23:59:59.000Z'),
      applicableTo: null
    };
    const cartRecord = {
      id: 'cart_1',
      userId: 'user_1',
      sessionToken: null,
      coupon: expiredCoupon,
      reservations: [],
      items: [
        {
          id: 'item_1',
          variantId: 'variant_1',
          quantity: 1,
          priceSnapshot: 1000,
          variant: {
            id: 'variant_1',
            name: 'Variant 1',
            sku: 'SKU-1',
            price: 1000,
            productId: 'product_1',
            product: { categoryId: 'category_1' }
          }
        }
      ]
    };
    const fastify = {
      prisma: {
        storeSettings: mockStoreSettings(true),
        cart: {
          upsert: vi.fn().mockResolvedValue(cartRecord),
          update
        },
        order: {
          count: vi.fn().mockResolvedValue(0)
        },
        cartReservation: {
          findMany: vi.fn().mockResolvedValue([]),
          updateMany: vi.fn().mockResolvedValue(undefined)
        }
      }
    } as unknown as FastifyInstance;
    const service = new CartService(fastify);

    const result = await service.getCart('user_1', undefined);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'cart_1' },
      data: { couponId: null }
    });
    expect(result.coupon).toBeNull();
    expect(result.discountAmount).toBe(0);
  });
});
