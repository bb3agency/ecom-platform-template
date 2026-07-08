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

  it('lists wishlist items as card-ready products with pagination meta', async () => {
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
            tags: ['festive'],
            isFeatured: false,
            isActive: true,
            metaDescription: null,
            category: { id: 'cat_1', name: 'Laddu', slug: 'laddu' },
            images: [
              { id: 'img_1', url: 'https://cdn.example/laddu.jpg', altText: 'Laddu', sortOrder: 0 }
            ],
            variants: [
              {
                id: 'var_1',
                name: '500g',
                sku: 'LAD-500',
                price: 29900,
                compareAtPrice: null,
                weight: 500,
                hsnCode: null,
                gstRatePercent: 5,
                isActive: true,
                inventory: { quantity: 12 }
              }
            ]
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
        $transaction: vi.fn().mockResolvedValue(tx),
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ reviewsEnabled: true })
        },
        review: {
          groupBy: vi.fn().mockResolvedValue([
            { productId: 'product_1', _avg: { rating: 4.6 }, _count: { _all: 8 } }
          ])
        }
      }
    } as unknown as FastifyInstance);

    const result = await service.listWishlist('user_1', { page: 1, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(1);

    const item = result.items[0];
    expect(item).toBeDefined();
    if (!item) throw new Error('expected a wishlist item');
    expect(item.product.id).toBe('product_1');
    // Card-ready shape: image, priced variant, derived stock + review aggregate.
    expect(item.product.inStock).toBe(true);
    expect(item.product.images[0]?.url).toBe('https://cdn.example/laddu.jpg');
    expect(item.product.variants[0]?.price).toBe(29900);
    expect(item.product.rating).toBe(4.6);
    expect(item.product.reviewCount).toBe(8);
    // Inventory must never leak through the serializer.
    expect(item.product.variants[0]).not.toHaveProperty('inventory');
  });

  it('returns zero review aggregates when reviews are disabled', async () => {
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
            tags: [],
            isFeatured: false,
            isActive: true,
            metaDescription: null,
            category: { id: 'cat_1', name: 'Laddu', slug: 'laddu' },
            images: [],
            variants: [
              {
                id: 'var_1',
                name: '500g',
                sku: 'LAD-500',
                price: 29900,
                compareAtPrice: null,
                weight: 500,
                hsnCode: null,
                gstRatePercent: 5,
                isActive: true,
                inventory: { quantity: 0 }
              }
            ]
          }
        }
      ],
      1
    ];

    const groupBy = vi.fn();
    const service = new WishlistService({
      prisma: {
        wishlistItem: { findMany: vi.fn(), count: vi.fn() },
        $transaction: vi.fn().mockResolvedValue(tx),
        storeSettings: { findUnique: vi.fn().mockResolvedValue({ reviewsEnabled: false }) },
        review: { groupBy }
      }
    } as unknown as FastifyInstance);

    const result = await service.listWishlist('user_1', { page: 1, limit: 20 });
    expect(result.items[0]?.product.rating).toBe(0);
    expect(result.items[0]?.product.reviewCount).toBe(0);
    expect(result.items[0]?.product.inStock).toBe(false);
    // No review query when the merchant has reviews turned off.
    expect(groupBy).not.toHaveBeenCalled();
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
