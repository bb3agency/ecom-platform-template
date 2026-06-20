import { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { getCurrentUser } from '@common/decorators/current-user';
import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
import { jwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import { idempotencyOnSend, idempotencyPreHandler } from '@common/idempotency/idempotency';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { loadShedGuard } from '@common/reliability/load-shed.guard';
import {
  adminDeleteReviewSchema,
  adminListReviewsSchema,
  adminReviewSummarySchema,
  createReviewSchema,
  listMyReviewsSchema,
  listProductReviewsSchema,
  listRecentApprovedReviewsSchema,
  moderateReviewSchema
} from './reviews.schemas';
import { ReviewsService } from './reviews.service';

export async function registerReviewsRoutes(fastify: FastifyInstance): Promise<void> {
  const reviewsService = new ReviewsService(fastify);
  const adminGuard = [jwtAuthGuard, rolesGuard(Role.ADMIN)];
  const customerGuard = [jwtAuthGuard, rolesGuard(Role.CUSTOMER)];
  fastify.addHook('onSend', async (request, reply, payload) => {
    await idempotencyOnSend(request, reply, payload);
    return payload;
  });

  fastify.get(
    '/api/v1/reviews/recent',
    {
      schema: listRecentApprovedReviewsSchema,
      config: {
        rateLimit: routeRateLimitProfiles.catalogRead
      }
    },
    async (request) => reviewsService.listRecentApprovedReviews(request.query as never)
  );

  fastify.get(
    '/api/v1/reviews/product/:slug',
    {
      schema: listProductReviewsSchema,
      config: {
        rateLimit: routeRateLimitProfiles.catalogRead
      }
    },
    async (request) => {
      const params = request.params as { slug: string };
      return reviewsService.listProductReviews(params.slug, request.query as never);
    }
  );

  fastify.get(
    '/api/v1/reviews/me',
    {
      schema: listMyReviewsSchema,
      preHandler: customerGuard,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return reviewsService.listMyReviews(user.sub, request.query as never);
    }
  );

  fastify.post(
    '/api/v1/reviews',
    {
      schema: createReviewSchema,
      preHandler: customerGuard,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return reviewsService.createReview(user.sub, request.body as never);
    }
  );

  fastify.get(
    '/api/v1/admin/reviews/summary',
    {
      schema: adminReviewSummarySchema,
      preHandler: [...adminGuard, adminPermissionGuard('reviews:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => reviewsService.adminReviewSummary(request.query as never)
  );

  fastify.get(
    '/api/v1/admin/reviews',
    {
      schema: adminListReviewsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('reviews:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => reviewsService.adminListReviews(request.query as never)
  );

  fastify.patch(
    '/api/v1/admin/reviews/:id/moderate',
    {
      schema: moderateReviewSchema,
      preHandler: [...adminGuard, adminPermissionGuard('reviews:moderate'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return reviewsService.adminModerateReview(params.id, request.body as never);
    }
  );

  fastify.delete(
    '/api/v1/admin/reviews/:id',
    {
      schema: adminDeleteReviewSchema,
      preHandler: [...adminGuard, adminPermissionGuard('reviews:moderate'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return reviewsService.adminDeleteReview(params.id);
    }
  );
}
