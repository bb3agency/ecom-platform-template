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

describe('CartService applyCoupon merchant toggle', () => {
  beforeEach(() => {
    invalidateStorefrontCouponsCache();
  });

  afterEach(() => {
    invalidateStorefrontCouponsCache();
  });

  it('rejects applyCoupon when merchant has disabled storefront coupons', async () => {
    const fastify = {
      prisma: {
        storeSettings: mockStoreSettings(false),
        coupon: {
          count: vi.fn(),
          findFirst: vi.fn()
        },
        cart: {
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn()
        },
        cartItem: { findMany: vi.fn() }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    await expect(
      service.applyCoupon('user_1', undefined, { code: 'SAVE10' })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Coupons are disabled'
    });
  });
});
