import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { featureFlags } from '@config/feature-flags';
import { WishlistService } from './wishlist.service';

describe('WishlistService', () => {
  const originalWishlistFlag = featureFlags.wishlist;

  beforeEach(() => {
    featureFlags.wishlist = true;
  });

  afterEach(() => {
    featureFlags.wishlist = originalWishlistFlag;
  });

  it('adds wishlist item for active product', async () => {
    const service = new WishlistService({
      prisma: {
        product: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'product_1',
            name: 'Product 1',
            slug: 'product-1',
            description: 'desc',
            isFeatured: false
          })
        },
        wishlistItem: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({
            id: 'wishlist_1',
            createdAt: new Date('2026-01-01T00:00:00.000Z')
          })
        }
      }
    } as unknown as FastifyInstance);

    const result = await service.addWishlistItem('user_1', { productId: 'product_1' });
    expect(result.id).toBe('wishlist_1');
    expect(result.product.id).toBe('product_1');
  });

  it('rejects duplicate wishlist item', async () => {
    const service = new WishlistService({
      prisma: {
        product: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'product_1',
            name: 'Product 1',
            slug: 'product-1',
            description: 'desc',
            isFeatured: false
          })
        },
        wishlistItem: {
          findUnique: vi.fn().mockResolvedValue({ id: 'wishlist_1' })
        }
      }
    } as unknown as FastifyInstance);

    await expect(service.addWishlistItem('user_1', { productId: 'product_1' })).rejects.toMatchObject({
      code: 'CONFLICT',
      statusCode: 409
    });
  });

  it('lists wishlist items with pagination meta', async () => {
    const tx = [
      [
        {
          id: 'wishlist_1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          product: {
            id: 'product_1',
            name: 'Product 1',
            slug: 'product-1',
            description: 'desc',
            isFeatured: false
          }
        }
      ],
      1
    ];

    const service = new WishlistService({
      prisma: {
        wishlistItem: {
          findMany: vi.fn(),
          count: vi.fn()
        },
        $transaction: vi.fn().mockResolvedValue(tx)
      }
    } as unknown as FastifyInstance);

    const result = await service.listWishlist('user_1', { page: 1, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('rejects addToWishlist when wishlist feature flag is disabled', async () => {
    featureFlags.wishlist = false;
    const service = new WishlistService({
      prisma: {
        product: { findFirst: vi.fn() },
        wishlistItem: { findUnique: vi.fn(), create: vi.fn() }
      }
    } as unknown as FastifyInstance);

    await expect(service.addWishlistItem('user_1', { productId: 'product_1' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Wishlist is disabled'
    });
  });
});
