import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ReviewsService } from './reviews.service';

describe('ReviewsService.listReviewableProductsForOrder', () => {
  function buildFastify(overrides: {
    reviewsEnabled?: boolean;
    order: unknown;
    reviews?: Array<{ productId: string }>;
  }) {
    return {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ reviewsEnabled: overrides.reviewsEnabled ?? true })
        },
        order: { findFirst: vi.fn().mockResolvedValue(overrides.order) },
        review: { findMany: vi.fn().mockResolvedValue(overrides.reviews ?? []) }
      }
    } as unknown as FastifyInstance;
  }

  it('returns distinct active products with already-reviewed flags', async () => {
    const fastify = buildFastify({
      order: {
        items: [
          { variant: { product: { id: 'p1', name: 'Honey', slug: 'honey', isActive: true } } },
          // duplicate product via a second variant — must be de-duplicated
          { variant: { product: { id: 'p1', name: 'Honey', slug: 'honey', isActive: true } } },
          { variant: { product: { id: 'p2', name: 'Ghee', slug: 'ghee', isActive: true } } },
          // inactive product is excluded
          { variant: { product: { id: 'p3', name: 'Old', slug: 'old', isActive: false } } }
        ]
      },
      reviews: [{ productId: 'p1' }]
    });

    const service = new ReviewsService(fastify);
    const result = await service.listReviewableProductsForOrder('user_1', 'order_1');

    expect(result.items).toEqual([
      { productId: 'p1', productName: 'Honey', productSlug: 'honey', alreadyReviewed: true },
      { productId: 'p2', productName: 'Ghee', productSlug: 'ghee', alreadyReviewed: false }
    ]);
  });

  it('returns empty when reviews are disabled (no order lookup)', async () => {
    const fastify = buildFastify({ reviewsEnabled: false, order: null });
    const service = new ReviewsService(fastify);

    const result = await service.listReviewableProductsForOrder('user_1', 'order_1');

    expect(result.items).toEqual([]);
    expect(fastify.prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('returns empty when the order is not the customer’s delivered order', async () => {
    const fastify = buildFastify({ order: null });
    const service = new ReviewsService(fastify);

    const result = await service.listReviewableProductsForOrder('user_1', 'order_1');

    expect(result.items).toEqual([]);
  });
});
