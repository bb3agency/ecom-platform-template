import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ReviewsService } from './reviews.service';

// Storefront reviews are gated on StoreSettings.reviewsEnabled (Admin toggle), read
// via prisma.storeSettings.findUnique — mocks for gated methods include it.
const reviewsOn = () => ({ findUnique: async () => ({ reviewsEnabled: true }) });
const reviewsOff = () => ({ findUnique: async () => ({ reviewsEnabled: false }) });

describe('ReviewsService', () => {
  it('creates review for delivered order purchaser', async () => {
    const service = new ReviewsService({
      prisma: {
        storeSettings: reviewsOn(),
        product: {
          findFirst: async () => ({ id: 'product_1' })
        },
        order: {
          findFirst: async () => ({ id: 'order_1' })
        },
        review: {
          findUnique: async () => null,
          create: async () => ({
            id: 'review_1',
            userId: 'user_1',
            productId: 'product_1',
            orderId: 'order_1',
            rating: 5,
            body: 'Great',
            images: [],
            approved: false,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            user: {
              id: 'user_1',
              firstName: 'Test',
              lastName: 'User'
            }
          })
        }
      }
    } as unknown as FastifyInstance);

    const result = await service.createReview('user_1', {
      productId: 'product_1',
      orderId: 'order_1',
      rating: 5,
      body: 'Great'
    });
    expect(result.id).toBe('review_1');
    expect('approved' in result && result.approved).toBe(false);
  });

  it('admin can moderate (approve) a review', async () => {
    const updatedReview = {
      id: 'review_1',
      userId: 'user_1',
      productId: 'product_1',
      orderId: 'order_1',
      rating: 5,
      body: 'Great',
      images: [],
      approved: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      user: { id: 'user_1', firstName: 'Test', lastName: 'User' }
    };
    const service = new ReviewsService({
      prisma: {
        review: {
          findUnique: async () => ({ id: 'review_1' }),
          update: async () => updatedReview
        }
      }
    } as unknown as FastifyInstance);

    const result = await service.adminModerateReview('review_1', { approved: true });
    expect('approved' in result && result.approved).toBe(true);
    expect('userId' in result && result.userId).toBe('user_1');
  });

  it('admin moderate throws 404 for unknown review', async () => {
    const service = new ReviewsService({
      prisma: {
        review: {
          findUnique: async () => null
        }
      }
    } as unknown as FastifyInstance);

    await expect(
      service.adminModerateReview('nonexistent', { approved: true })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('admin can delete a review', async () => {
    const service = new ReviewsService({
      prisma: {
        review: {
          findUnique: async () => ({ id: 'review_1' }),
          delete: async () => ({})
        }
      }
    } as unknown as FastifyInstance);

    const result = await service.adminDeleteReview('review_1');
    expect(result).toMatchObject({ id: 'review_1', deleted: true });
  });

  it('admin delete throws 404 for unknown review', async () => {
    const service = new ReviewsService({
      prisma: {
        review: {
          findUnique: async () => null
        }
      }
    } as unknown as FastifyInstance);

    await expect(
      service.adminDeleteReview('nonexistent')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('adminReviewSummary returns average and distribution for approved reviews', async () => {
    const aggregate = vi.fn().mockResolvedValue({
      _avg: { rating: 4.2 },
      _count: { id: 12 }
    });
    const groupBy = vi.fn().mockResolvedValue([
      { rating: 5, _count: { id: 7 } },
      { rating: 4, _count: { id: 3 } },
      { rating: 2, _count: { id: 2 } }
    ]);
    const service = new ReviewsService({
      prisma: {
        review: { aggregate, groupBy }
      }
    } as unknown as FastifyInstance);

    const result = await service.adminReviewSummary({
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T23:59:59.999Z'
    });

    expect(result.averageRating).toBe(4.2);
    expect(result.totalApproved).toBe(12);
    expect(result.distribution['5']).toBe(7);
    expect(result.distribution['2']).toBe(2);
  });

  it('admin list applies date, approval, and rating filters', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const service = new ReviewsService({
      prisma: {
        review: { findMany, count },
        $transaction: vi.fn((promises: Array<Promise<unknown>>) => Promise.all(promises))
      }
    } as unknown as FastifyInstance);

    await service.adminListReviews({
      approved: true,
      ratingLte: 2,
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T23:59:59.999Z'
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          approved: true,
          rating: { lte: 2 },
          createdAt: {
            gte: new Date('2026-05-01T00:00:00.000Z'),
            lte: new Date('2026-05-31T23:59:59.999Z')
          }
        }
      })
    );
  });

  it('admin list applies search filter on body and reviewer name', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const service = new ReviewsService({
      prisma: {
        review: { findMany, count },
        $transaction: vi.fn((promises: Array<Promise<unknown>>) => Promise.all(promises))
      }
    } as unknown as FastifyInstance);

    await service.adminListReviews({ search: 'great product' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { body: { contains: 'great product', mode: 'insensitive' } },
            { user: { firstName: { contains: 'great product', mode: 'insensitive' } } },
            { user: { lastName: { contains: 'great product', mode: 'insensitive' } } },
            { product: { name: { contains: 'great product', mode: 'insensitive' } } }
          ]
        })
      })
    );
  });

  it('listRecentApprovedReviews returns latest approved reviews with product context', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'review_1',
        userId: 'user_1',
        productId: 'product_1',
        orderId: 'order_1',
        rating: 5,
        body: 'Excellent turmeric.',
        images: [],
        approved: true,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-02T00:00:00.000Z'),
        user: { id: 'user_1', firstName: 'Priya', lastName: 'Reddy' },
        product: { name: 'Turmeric Powder', slug: 'turmeric-powder' }
      }
    ]);
    const count = vi.fn().mockResolvedValue(1);
    const service = new ReviewsService({
      prisma: {
        storeSettings: reviewsOn(),
        review: { findMany, count },
        $transaction: vi.fn((promises: Array<Promise<unknown>>) => Promise.all(promises))
      }
    } as unknown as FastifyInstance);

    const result = await service.listRecentApprovedReviews({ limit: 3 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          approved: true,
          body: { not: null },
          NOT: { body: '' },
          product: { isActive: true }
        },
        skip: 0,
        take: 20,
        orderBy: { updatedAt: 'desc' }
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'review_1',
      body: 'Excellent turmeric.',
      productName: 'Turmeric Powder',
      productSlug: 'turmeric-powder',
      author: { firstName: 'Priya', lastName: 'Reddy' }
    });
    expect(result.items[0]).not.toHaveProperty('approved');
    expect(result.items[0]).not.toHaveProperty('userId');
    expect(result.meta.total).toBe(1);
  });

  it('listRecentApprovedReviews skips whitespace-only bodies and still returns limit items', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'review_ws',
        userId: 'user_1',
        productId: 'product_1',
        orderId: 'order_1',
        rating: 5,
        body: '   ',
        images: [],
        approved: true,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-02T00:00:00.000Z'),
        user: { id: 'user_1', firstName: 'A', lastName: 'B' },
        product: { name: 'Item', slug: 'item' }
      },
      {
        id: 'review_ok',
        userId: 'user_2',
        productId: 'product_2',
        orderId: 'order_2',
        rating: 4,
        body: 'Tastes fresh.',
        images: [],
        approved: true,
        createdAt: new Date('2026-05-03T00:00:00.000Z'),
        updatedAt: new Date('2026-05-04T00:00:00.000Z'),
        user: { id: 'user_2', firstName: null, lastName: null },
        product: { name: 'Ghee', slug: 'ghee' }
      }
    ]);
    const count = vi.fn().mockResolvedValue(2);
    const service = new ReviewsService({
      prisma: {
        storeSettings: reviewsOn(),
        review: { findMany, count },
        $transaction: vi.fn((promises: Array<Promise<unknown>>) => Promise.all(promises))
      }
    } as unknown as FastifyInstance);

    const result = await service.listRecentApprovedReviews({ limit: 3 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'review_ok',
      body: 'Tastes fresh.',
      author: { firstName: 'Customer', lastName: '' }
    });
  });

  it('listRecentApprovedReviews scans additional batches when early rows are whitespace-only', async () => {
    const whitespaceBatch = Array.from({ length: 20 }, (_, index) => ({
      id: `review_ws_${index}`,
      userId: 'user_1',
      productId: 'product_1',
      orderId: 'order_1',
      rating: 5,
      body: '   ',
      images: [],
      approved: true,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-02T00:00:00.000Z'),
      user: { id: 'user_1', firstName: 'A', lastName: 'B' },
      product: { name: 'Item', slug: 'item' }
    }));
    const validReview = {
      id: 'review_ok',
      userId: 'user_2',
      productId: 'product_2',
      orderId: 'order_2',
      rating: 4,
      body: 'Worth every rupee.',
      images: [],
      approved: true,
      createdAt: new Date('2026-05-03T00:00:00.000Z'),
      updatedAt: new Date('2026-05-04T00:00:00.000Z'),
      user: { id: 'user_2', firstName: 'Ravi', lastName: 'K' },
      product: { name: 'Honey', slug: 'honey' }
    };
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(whitespaceBatch)
      .mockResolvedValueOnce([validReview]);
    const count = vi.fn().mockResolvedValue(21);
    const service = new ReviewsService({
      prisma: {
        storeSettings: reviewsOn(),
        review: { findMany, count }
      }
    } as unknown as FastifyInstance);

    const result = await service.listRecentApprovedReviews({ limit: 3 });

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        skip: 20,
        take: 20
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'review_ok',
      body: 'Worth every rupee.',
      productSlug: 'honey'
    });
  });

  it('listRecentApprovedReviews returns empty list when reviews feature is disabled', async () => {
    const service = new ReviewsService({
      prisma: {
        storeSettings: reviewsOff(),
        review: {
          findMany: vi.fn(),
          count: vi.fn()
        }
      }
    } as unknown as FastifyInstance);

    const result = await service.listRecentApprovedReviews({ limit: 3 });

    expect(result.items).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('rejects review when user is not eligible purchaser', async () => {
    const service = new ReviewsService({
      prisma: {
        storeSettings: reviewsOn(),
        product: {
          findFirst: async () => ({ id: 'product_1' })
        },
        order: {
          findFirst: async () => null
        }
      }
    } as unknown as FastifyInstance);

    await expect(
      service.createReview('user_1', {
        productId: 'product_1',
        orderId: 'order_1',
        rating: 4
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403
    });
  });
});
