import { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { getCurrentUser } from '@common/decorators/current-user';
import { jwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { addWishlistItemSchema, listWishlistSchema, removeWishlistItemSchema } from './wishlist.schemas';
import { WishlistService } from './wishlist.service';

export async function registerWishlistRoutes(fastify: FastifyInstance): Promise<void> {
  const wishlistService = new WishlistService(fastify);
  const customerGuard = [jwtAuthGuard, rolesGuard(Role.CUSTOMER)];

  fastify.get(
    '/api/v1/wishlist',
    {
      schema: listWishlistSchema,
      preHandler: customerGuard,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return wishlistService.listWishlist(user.sub, request.query as never);
    }
  );

  fastify.post(
    '/api/v1/wishlist/items',
    {
      schema: addWishlistItemSchema,
      preHandler: customerGuard,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return wishlistService.addWishlistItem(user.sub, request.body as never);
    }
  );

  fastify.delete(
    '/api/v1/wishlist/items/:productId',
    {
      schema: removeWishlistItemSchema,
      preHandler: customerGuard,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      const params = request.params as { productId: string };
      return wishlistService.removeWishlistItem(user.sub, params.productId);
    }
  );
}
