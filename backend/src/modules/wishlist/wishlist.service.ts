import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { featureFlags } from '@config/feature-flags';
import { AddWishlistItemInput, WishlistListQuery } from './wishlist.types';

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
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              isFeatured: true
            }
          }
        }
      }),
      this.fastify.prisma.wishlistItem.count({ where })
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        product: item.product
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
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
