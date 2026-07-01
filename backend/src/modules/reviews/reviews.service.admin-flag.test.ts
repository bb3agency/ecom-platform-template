import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ReviewsService } from './reviews.service';

// Storefront reviews are gated on StoreSettings.reviewsEnabled (Admin toggle).
// Admin moderation must keep working even when the storefront toggle is OFF.
describe('ReviewsService admin when storefront reviews toggle is off', () => {
  it('still allows admin to list reviews for moderation', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const service = new ReviewsService({
      prisma: {
        storeSettings: { findUnique: async () => ({ reviewsEnabled: false }) },
        review: { findMany, count },
        $transaction: vi.fn((promises: Array<Promise<unknown>>) => Promise.all(promises))
      }
    } as unknown as FastifyInstance);

    await expect(service.adminListReviews({ page: 1, limit: 10 })).resolves.toEqual({
      items: [],
      meta: {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0
      }
    });
  });

  it('still blocks customer review creation when the toggle is off', async () => {
    const service = new ReviewsService({
      prisma: {
        storeSettings: { findUnique: async () => ({ reviewsEnabled: false }) },
        product: { findFirst: vi.fn() },
        order: { findFirst: vi.fn() },
        review: { findUnique: vi.fn(), create: vi.fn() }
      }
    } as unknown as FastifyInstance);

    await expect(
      service.createReview('user_1', {
        productId: 'product_1',
        orderId: 'order_1',
        rating: 5
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400
    });
  });
});
