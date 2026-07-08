import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { featureFlags } from '@config/feature-flags';
import { isStorefrontReviewsEnabled } from '@common/reviews/reviews-feature';
import { AddWishlistItemInput, WishlistListQuery } from './wishlist.types';

// Card-ready product shape (matches the storefront product list item) so the
// /wishlist page renders the standard ProductCard without a second fetch.
interface WishlistVariant {
  id: string;
  name: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  weight: number | null;
  hsnCode: string | null;
  gstRatePercent: number;
  isActive: boolean;
  inventory?: { quantity: number } | null;
}

export class WishlistService {
  constructor(private readonly fastify: FastifyInstance) {}

  async listWishlist(userId: string, query: WishlistListQuery) {
    this.assertWishlistEnabled();
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where = { userId };

    const [items, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.wishlistItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            include: {
              category: true,
              images: { orderBy: { sortOrder: 'asc' } },
              variants: {
                where: { isActive: true },
                orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
                include: { inventory: true }
              }
            }
          }
        }
      }),
      this.fastify.prisma.wishlistItem.count({ where })
    ]);

    const reviewsEnabled = await isStorefrontReviewsEnabled(this.fastify.prisma);
    const aggregates = await this.getApprovedReviewAggregates(
      items.map((item) => item.product.id),
      reviewsEnabled
    );

    return {
      items: items.map((item) => ({
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        product: this.serializeWishlistProduct(item.product, aggregates)
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Maps a Prisma product (with category, images and active variants) to the
   * storefront product-list item shape used by the ProductCard. Strips the
   * per-variant inventory (derived into `inStock`) so we never leak stock counts.
   */
  private serializeWishlistProduct(
    product: {
      id: string;
      name: string;
      slug: string;
      description: string;
      tags: string[];
      isFeatured: boolean;
      isActive: boolean;
      metaDescription: string | null;
      category: { id: string; name: string; slug: string } | null;
      images: Array<{ id: string; url: string; altText: string; sortOrder: number }>;
      variants: WishlistVariant[];
    },
    aggregates: Map<string, { rating: number; reviewCount: number }>
  ) {
    const inStock = product.variants.some(
      (variant) => (variant.inventory?.quantity ?? 0) > 0
    );
    const aggregate = aggregates.get(product.id);
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      tags: product.tags ?? [],
      isFeatured: product.isFeatured,
      isActive: product.isActive,
      metaDescription: product.metaDescription ?? null,
      inStock,
      rating: aggregate?.rating ?? 0,
      reviewCount: aggregate?.reviewCount ?? 0,
      category: product.category
        ? { id: product.category.id, name: product.category.name, slug: product.category.slug }
        : { id: '', name: '', slug: '' },
      images: product.images.map((image) => ({
        id: image.id,
        url: image.url,
        altText: image.altText,
        sortOrder: image.sortOrder
      })),
      variants: product.variants.map(({ inventory: _inventory, ...variant }) => variant)
    };
  }

  /**
   * Approved-review aggregates (avg rating to 1 dp + count) for the given
   * products, as one grouped query. Empty when reviews are disabled.
   */
  private async getApprovedReviewAggregates(
    productIds: string[],
    reviewsEnabled: boolean
  ): Promise<Map<string, { rating: number; reviewCount: number }>> {
    const aggregates = new Map<string, { rating: number; reviewCount: number }>();
    if (!reviewsEnabled || productIds.length === 0) {
      return aggregates;
    }
    const rows = await this.fastify.prisma.review.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds }, approved: true },
      _avg: { rating: true },
      _count: { _all: true }
    });
    for (const row of rows) {
      aggregates.set(row.productId, {
        rating: row._avg.rating != null ? Math.round(row._avg.rating * 10) / 10 : 0,
        reviewCount: row._count._all
      });
    }
    return aggregates;
  }

  async addWishlistItem(userId: string, input: AddWishlistItemInput) {
    this.assertWishlistEnabled();
    const product = await this.fastify.prisma.product.findFirst({
      where: { id: input.productId, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isFeatured: true
      }
    });
    if (!product) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Product not found', 404);
    }

    const existing = await this.fastify.prisma.wishlistItem.findUnique({
      where: {
        userId_productId: {
          userId,
          productId: input.productId
        }
      }
    });
    if (existing) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Product already in wishlist', 409);
    }

    const item = await this.fastify.prisma.wishlistItem.create({
      data: {
        userId,
        productId: input.productId
      }
    });

    return {
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      product
    };
  }

  async removeWishlistItem(userId: string, productId: string) {
    this.assertWishlistEnabled();
    const existing = await this.fastify.prisma.wishlistItem.findUnique({
      where: {
        userId_productId: {
          userId,
          productId
        }
      },
      select: { id: true }
    });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Wishlist item not found', 404);
    }

    await this.fastify.prisma.wishlistItem.delete({
      where: { id: existing.id }
    });

    return { message: 'Wishlist item removed' };
  }

  private assertWishlistEnabled() {
    if (!featureFlags.wishlist) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Wishlist is disabled', 400);
    }
  }
}
