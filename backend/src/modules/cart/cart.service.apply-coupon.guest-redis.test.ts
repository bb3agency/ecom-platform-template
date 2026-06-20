import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@modules/notifications/notification-failure-alert', () => ({
  sendTechnicalFailureAlert: vi.fn().mockResolvedValue(undefined)
}));

describe('CartService applyCoupon guest redis failure', () => {
  beforeEach(() => {
    invalidateStorefrontCouponsCache();
  });

  afterEach(() => {
    invalidateStorefrontCouponsCache();
  });

  it('fails closed when guest coupon redis increment fails', async () => {
    const coupon = {
      id: 'coupon_1',
      code: 'WELCOME10',
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
    };
    const cartRecord = {
      id: 'guest_cart_1',
      sessionToken: 'session_abc',
      coupon: null,
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
    const cartWithCoupon = {
      ...cartRecord,
      coupon
    };

    const fastify = {
      prisma: {
        coupon: {
          findFirst: vi.fn().mockResolvedValue(coupon)
        },
        cart: {
          findUnique: vi.fn().mockResolvedValue(cartRecord),
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValueOnce(cartRecord)
            .mockResolvedValueOnce(cartWithCoupon),
          update: vi.fn().mockResolvedValue(undefined)
        },
        order: {
          count: vi.fn().mockResolvedValue(0)
        },
        storeSettings: mockStoreSettings(true)
      },
      redis: {
        get: vi.fn().mockResolvedValue('0'),
        incr: vi.fn().mockRejectedValue(new Error('redis unavailable')),
        expire: vi.fn(),
        set: vi.fn(),
        del: vi.fn()
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);

    await expect(
      service.applyCoupon(undefined, 'session_abc', { code: 'WELCOME10' })
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      statusCode: 503,
      message: 'Unable to apply coupon right now. Please try again.'
    });
  });
});
