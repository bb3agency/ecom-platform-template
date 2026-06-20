import { describe, expect, it } from 'vitest';
import { ReviewsService } from './reviews.service';

describe('ReviewsService secure owner payload contracts', () => {
  it('does not expose internal linkage identifiers in owner visibility payload', () => {
    const service = new ReviewsService({} as never);
    const review = {
      id: 'review_1',
      userId: 'user_1',
      productId: 'product_1',
      orderId: 'order_1',
      rating: 5,
      body: 'Great product',
      images: [],
      approved: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      user: {
        id: 'user_1',
        firstName: 'Jane',
        lastName: 'Doe'
      }
    };

    const result = (
      service as unknown as {
        serializeReview: (value: unknown, visibility: 'owner' | 'public' | 'admin') => Record<string, unknown>;
      }
    ).serializeReview(review, 'owner');

    expect(result).toHaveProperty('productId', 'product_1');
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('orderId');
    expect(result.author).not.toHaveProperty('id');
  });

  it('storefront serialization omits linkage fields and returns trimmed body with product context', () => {
    const service = new ReviewsService({} as never);
    const review = {
      id: 'review_1',
      userId: 'user_1',
      productId: 'product_1',
      orderId: 'order_1',
      rating: 5,
      body: '  Great product  ',
      images: [],
      approved: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      user: { id: 'user_1', firstName: null, lastName: 'Doe' },
      product: { name: 'Turmeric', slug: 'turmeric' }
    };

    const result = (
      service as unknown as {
        serializeReview: (
          value: unknown,
          visibility: 'owner' | 'public' | 'admin' | 'storefront'
        ) => Record<string, unknown>;
      }
    ).serializeReview(review, 'storefront');

    expect(result.body).toBe('Great product');
    expect(result).toHaveProperty('productName', 'Turmeric');
    expect(result).toHaveProperty('productSlug', 'turmeric');
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('orderId');
    expect(result).not.toHaveProperty('productId');
    expect(result).not.toHaveProperty('approved');
    expect(result).not.toHaveProperty('updatedAt');
    expect(result.author).toEqual({ firstName: 'Customer', lastName: 'Doe' });
  });

  it('public catalog serialization omits user linkage and moderation internals', () => {
    const service = new ReviewsService({} as never);
    const review = {
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
      user: { id: 'user_1', firstName: 'Jane', lastName: 'Doe' }
    };

    const result = (
      service as unknown as {
        serializeReview: (value: unknown, visibility: 'owner' | 'public' | 'admin') => Record<string, unknown>;
      }
    ).serializeReview(review, 'public');

    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('orderId');
    expect(result).not.toHaveProperty('productId');
    expect((result.author as Record<string, unknown>) ?? {}).not.toHaveProperty('id');
  });

  it('admin list serialization retains moderation identifiers', () => {
    const service = new ReviewsService({} as never);
    const review = {
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
      user: { id: 'user_1', firstName: 'Jane', lastName: 'Doe' }
    };

    const result = (
      service as unknown as {
        serializeReview: (value: unknown, visibility: 'owner' | 'public' | 'admin') => Record<string, unknown>;
      }
    ).serializeReview(review, 'admin');

    expect(result).toHaveProperty('userId', 'user_1');
    expect(result).toHaveProperty('orderId', 'order_1');
    expect(result).toHaveProperty('productId', 'product_1');
    expect((result.author as Record<string, unknown>).id).toBe('user_1');
  });
});
