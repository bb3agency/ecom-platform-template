import { OrderStatus, Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { featureFlags } from '@config/feature-flags';
import {
  AdminReviewListQuery,
  CreateReviewInput,
  ModerateReviewInput,
  RecentApprovedReviewsQuery,
  ReviewListQuery
} from './reviews.types';

type ReviewWithUser = Prisma.ReviewGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
      };
    };
  };
}> & { product?: { name: string; slug: string } | null };

export class ReviewsService {
  constructor(private readonly fastify: FastifyInstance) {}

  async createReview(userId: string, input: CreateReviewInput) {
    this.assertStorefrontReviewsEnabled();

    const product = await this.fastify.prisma.product.findFirst({
      where: { id: input.productId, isActive: true },
      select: { id: true }
    });
    if (!product) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Product not found', 404);
    }

    const deliveredOrder = await this.fastify.prisma.order.findFirst({
      where: {
        id: input.orderId,
        userId,
        status: OrderStatus.DELIVERED,
        items: {
          some: {
            variant: {
              productId: input.productId
            }
          }
        }
      },
      select: { id: true }
    });
    if (!deliveredOrder) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Only delivered order purchasers can review this product',
        403
      );
    }

    const existing = await this.fastify.prisma.review.findUnique({
      where: {
        userId_orderId_productId: {
          userId,
          orderId: input.orderId,
          productId: input.productId
        }
      }
    });
    if (existing) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Review already exists for this order item', 409);
    }

    const review = await this.fastify.prisma.review.create({
      data: {
        userId,
        orderId: input.orderId,
        productId: input.productId,
        rating: input.rating,
        ...(input.body !== undefined ? { body: input.body } : {}),
        images: input.images ?? []
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    return this.serializeReview(review, 'owner');
  }

  async listMyReviews(userId: string, query: ReviewListQuery) {
    this.assertStorefrontReviewsEnabled();
    return this.listReviews({ userId }, query);
  }

  /**
   * Distinct products from one of the customer's DELIVERED orders that are eligible
   * for a review, each flagged with whether they've already reviewed it. Drives the
   * storefront write-review UI. Returns an empty list (never throws) when reviews are
   * disabled, the order isn't theirs, or it isn't DELIVERED — the UI simply shows nothing.
   */
  async listReviewableProductsForOrder(userId: string, orderId: string) {
    if (!featureFlags.reviews) {
      return { items: [] };
    }

    const order = await this.fastify.prisma.order.findFirst({
      where: { id: orderId, userId, status: OrderStatus.DELIVERED },
      select: {
        items: {
          select: {
            variant: {
              select: {
                product: { select: { id: true, name: true, slug: true, isActive: true } }
              }
            }
          }
        }
      }
    });

    if (!order) {
      return { items: [] };
    }

    const existingReviews = await this.fastify.prisma.review.findMany({
      where: { userId, orderId },
      select: { productId: true }
    });
    const reviewedProductIds = new Set(existingReviews.map((review) => review.productId));

    const seen = new Set<string>();
    const items: Array<{
      productId: string;
      productName: string;
      productSlug: string;
      alreadyReviewed: boolean;
    }> = [];
    for (const item of order.items) {
      const product = item.variant?.product;
      if (!product || !product.isActive || seen.has(product.id)) {
        continue;
      }
      seen.add(product.id);
      items.push({
        productId: product.id,
        productName: product.name,
        productSlug: product.slug,
        alreadyReviewed: reviewedProductIds.has(product.id)
      });
    }

    return { items };
  }

  async listProductReviews(slug: string, query: ReviewListQuery) {
    const product = await this.fastify.prisma.product.findFirst({
      where: { slug, isActive: true },
      select: { id: true }
    });
    if (!product) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Product not found', 404);
    }

    if (!featureFlags.reviews) {
      const page = query.page ?? 1;
      const limit = Math.min(query.limit ?? 20, 100);
      return {
        items: [],
        meta: {
          page,
          limit,
          total: 0,
          totalPages: 0
        }
      };
    }

    return this.listReviews({ productId: product.id, approved: true }, query, 'public');
  }

  /**
   * Latest merchant-approved reviews for storefront social proof (homepage testimonials).
   * Ordered by approval time (`updatedAt` desc) among reviews with non-empty body text.
   */
  async listRecentApprovedReviews(query: RecentApprovedReviewsQuery) {
    const limit = Math.min(Math.max(query.limit ?? 3, 1), 10);

    if (!featureFlags.reviews) {
      return {
        items: [],
        meta: {
          page: 1,
          limit,
          total: 0,
          totalPages: 0
        }
      };
    }

    const where: Prisma.ReviewWhereInput = {
      approved: true,
      body: { not: null },
      NOT: { body: '' },
      product: { isActive: true }
    };

    const include = {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true
        }
      },
      product: {
        select: {
          name: true,
          slug: true
        }
      }
    } as const;

    const batchSize = 20;
    const maxScan = 200;
    let skip = 0;
    const candidates: ReviewWithUser[] = [];

    while (candidates.length < limit && skip < maxScan) {
      const batch = await this.fastify.prisma.review.findMany({
        where,
        skip,
        take: batchSize,
        orderBy: { updatedAt: 'desc' },
        include
      });
      if (batch.length === 0) {
        break;
      }

      for (const item of batch) {
        if (typeof item.body === 'string' && item.body.trim().length > 0) {
          candidates.push(item);
          if (candidates.length >= limit) {
            break;
          }
        }
      }

      skip += batch.length;
      if (batch.length < batchSize) {
        break;
      }
    }

    const total = await this.fastify.prisma.review.count({ where });

    const items = candidates
      .slice(0, limit)
      .map((item) => this.serializeReview(item, 'storefront'));

    return {
      items,
      meta: {
        page: 1,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async adminReviewSummary(query: { from?: string; to?: string }) {
    const where: Prisma.ReviewWhereInput = {
      approved: true,
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {})
            }
          }
        : {})
    };

    const [aggregate, groups] = await Promise.all([
      this.fastify.prisma.review.aggregate({
        where,
        _avg: { rating: true },
        _count: { id: true }
      }),
      this.fastify.prisma.review.groupBy({
        by: ['rating'],
        where,
        _count: { id: true }
      })
    ]);

    const distribution: Record<'1' | '2' | '3' | '4' | '5', number> = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0
    };
    for (const row of groups) {
      const key = String(row.rating) as keyof typeof distribution;
      if (key in distribution) {
        distribution[key] = row._count.id;
      }
    }

    return {
      averageRating: aggregate._avg.rating,
      totalApproved: aggregate._count.id,
      distribution
    };
  }

  async adminListReviews(query: AdminReviewListQuery) {
    const searchTerm = query.search?.trim();
    const where: Prisma.ReviewWhereInput = {
      ...(query.approved !== undefined ? { approved: query.approved } : {}),
      ...(query.ratingLte !== undefined || query.ratingGte !== undefined
        ? {
            rating: {
              ...(query.ratingLte !== undefined ? { lte: query.ratingLte } : {}),
              ...(query.ratingGte !== undefined ? { gte: query.ratingGte } : {})
            }
          }
        : {}),
      ...(searchTerm
        ? {
            OR: [
              { body: { contains: searchTerm, mode: 'insensitive' } },
              { user: { firstName: { contains: searchTerm, mode: 'insensitive' } } },
              { user: { lastName: { contains: searchTerm, mode: 'insensitive' } } },
              { product: { name: { contains: searchTerm, mode: 'insensitive' } } }
            ]
          }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {})
            }
          }
        : {})
    };
    return this.listReviews(where, query, 'admin');
  }

  async adminModerateReview(id: string, input: ModerateReviewInput) {
    const existing = await this.fastify.prisma.review.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Review not found', 404);
    }

    const review = await this.fastify.prisma.review.update({
      where: { id },
      data: { approved: input.approved },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });
    return this.serializeReview(review, 'admin');
  }

  private async listReviews(
    where: Prisma.ReviewWhereInput,
    query: { page?: number; limit?: number },
    visibility: 'owner' | 'public' | 'admin' = 'owner'
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true
            }
          },
          product: {
            select: {
              name: true,
              slug: true
            }
          }
        }
      }),
      this.fastify.prisma.review.count({ where })
    ]);

    return {
      items: items.map((item) => this.serializeReview(item, visibility)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  private serializePublicAuthor(user: { firstName: string | null; lastName: string | null }) {
    return {
      firstName: user.firstName?.trim() || 'Customer',
      lastName: user.lastName?.trim() || ''
    };
  }

  private serializeReview(
    review: ReviewWithUser,
    visibility: 'owner' | 'public' | 'admin' | 'storefront' = 'owner'
  ) {
    const author = this.serializePublicAuthor(review.user);
    const base = {
      id: review.id,
      rating: review.rating,
      body: review.body,
      images: review.images,
      approved: review.approved,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
      author
    };
    if (visibility === 'storefront') {
      return {
        id: review.id,
        rating: review.rating,
        body: review.body?.trim() ?? '',
        images: review.images,
        createdAt: review.createdAt.toISOString(),
        author,
        productName: review.product?.name ?? null,
        productSlug: review.product?.slug ?? null
      };
    }
    if (visibility === 'public') {
      return base;
    }
    if (visibility === 'owner') {
      return {
        ...base,
        productId: review.productId
      };
    }
    return {
      ...base,
      userId: review.userId,
      productId: review.productId,
      productName: review.product?.name ?? null,
      productSlug: review.product?.slug ?? null,
      orderId: review.orderId,
      author: {
        id: review.user.id,
        firstName: review.user.firstName,
        lastName: review.user.lastName
      }
    };
  }

  /**
   * Hard-delete a review by ID. Used by admins to remove spam or illegal content.
   * @param id - The review UUID
   */
  async adminDeleteReview(id: string) {
    const existing = await this.fastify.prisma.review.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Review not found', 404);
    }
    await this.fastify.prisma.review.delete({ where: { id } });
    return { id, deleted: true };
  }

  private assertStorefrontReviewsEnabled() {
    if (!featureFlags.reviews) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Reviews are disabled', 400);
    }
  }
}
