import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { getCurrentUser } from '@common/decorators/current-user';
import { ERROR_CODES } from '@common/errors/error-codes';
import { assertAuthAccountActive } from '@common/guards/auth-account-status';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { idempotencyOnSend, idempotencyPreHandler } from '@common/idempotency/idempotency';
import {
  addCartItemSchema,
  applyCouponSchema,
  checkPincodeSchema,
  clearCartSchema,
  deleteCartItemSchema,
  deliveryRatesSchema,
  getCartSchema,
  mergeCartSchema,
  removeCouponSchema,
  updateCartItemSchema
} from './cart.schemas';
import { CartService } from './cart.service';
import { buildCartSessionSetCookieHeader, parseCartSessionToken } from './cart-cookies';

function parseSessionToken(cookieHeader?: string): string | undefined {
  return parseCartSessionToken(cookieHeader);
}

function setSessionCookie(reply: { header: (name: string, value: string) => unknown }, sessionToken: string | null): void {
  if (!sessionToken) {
    return;
  }

  reply.header('Set-Cookie', buildCartSessionSetCookieHeader(sessionToken));
}

function resolveSessionToken(userId: string | undefined, sessionToken: string | undefined): string | undefined {
  if (userId) {
    return undefined;
  }
  return sessionToken ?? randomUUID();
}

async function getOptionalUserId(
  fastify: FastifyInstance,
  request: FastifyRequest
): Promise<string | undefined> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return undefined;
  }

  try {
    const decoded = fastify.jwt.verify<{ sub: string; role: Role }>(token);
    request.user = decoded;

    const account = await fastify.prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, role: true, isBanned: true }
    });
    assertAuthAccountActive(
      { sub: decoded.sub, role: decoded.role as 'CUSTOMER' | 'ADMIN' },
      account
    );

    return getCurrentUser(request).sub;
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) {
      throw error;
    }
    return undefined;
  }
}

export async function registerCartRoutes(fastify: FastifyInstance): Promise<void> {
  const cartService = new CartService(fastify);
  fastify.addHook('onSend', async (request, reply, payload) => {
    // Cart responses are per-session (guest cart_session cookie / per-user) and
    // carry Set-Cookie. They must never be cached by an edge/CDN (e.g. Cloudflare),
    // which would otherwise serve a stale cart to all guests and strip Set-Cookie —
    // silently dropping the guest session. Force no-store on every cart route.
    reply.header('Cache-Control', 'no-store');
    await idempotencyOnSend(request, reply, payload);
    return payload;
  });

  fastify.get(
    '/api/v1/cart',
    {
      schema: getCartSchema,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request, reply) => {
      const userId = await getOptionalUserId(fastify, request);
      const incomingSessionToken = parseSessionToken(request.headers.cookie);
      const sessionToken = resolveSessionToken(userId, incomingSessionToken);
      const cart = await cartService.getCart(userId, sessionToken);
      setSessionCookie(reply, sessionToken ?? null);
      return cart;
    }
  );

  fastify.post(
    '/api/v1/cart/items',
    {
      schema: addCartItemSchema,
      preHandler: [idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request, reply) => {
      const userId = await getOptionalUserId(fastify, request);
      const incomingSessionToken = parseSessionToken(request.headers.cookie);
      const sessionToken = resolveSessionToken(userId, incomingSessionToken);
      const cart = await cartService.addItem(userId, sessionToken, request.body as never);
      setSessionCookie(reply, sessionToken ?? null);
      return cart;
    }
  );

  fastify.patch(
    '/api/v1/cart/items/:id',
    {
      schema: updateCartItemSchema,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request, reply) => {
      const userId = await getOptionalUserId(fastify, request);
      const incomingSessionToken = parseSessionToken(request.headers.cookie);
      const sessionToken = resolveSessionToken(userId, incomingSessionToken);
      const params = request.params as { id: string };
      const cart = await cartService.updateItem(userId, sessionToken, params.id, request.body as never);
      setSessionCookie(reply, sessionToken ?? null);
      return cart;
    }
  );

  fastify.delete(
    '/api/v1/cart/items/:id',
    {
      schema: deleteCartItemSchema,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request, reply) => {
      const userId = await getOptionalUserId(fastify, request);
      const incomingSessionToken = parseSessionToken(request.headers.cookie);
      const sessionToken = resolveSessionToken(userId, incomingSessionToken);
      const params = request.params as { id: string };
      const cart = await cartService.deleteItem(userId, sessionToken, params.id);
      setSessionCookie(reply, sessionToken ?? null);
      return cart;
    }
  );

  fastify.delete(
    '/api/v1/cart',
    {
      schema: clearCartSchema,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request, reply) => {
      const userId = await getOptionalUserId(fastify, request);
      const incomingSessionToken = parseSessionToken(request.headers.cookie);
      const sessionToken = resolveSessionToken(userId, incomingSessionToken);
      const cart = await cartService.clearCart(userId, sessionToken);
      setSessionCookie(reply, sessionToken ?? null);
      return cart;
    }
  );

  fastify.post(
    '/api/v1/cart/merge',
    {
      schema: mergeCartSchema,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const userId = await getOptionalUserId(fastify, request);
      if (!userId) {
        throw new AppError(ERROR_CODES.UNAUTHORISED, 'Authentication required', 401);
      }
      const sessionToken = parseSessionToken(request.headers.cookie);
      const cart = await cartService.mergeGuestCart(userId, sessionToken);
      return cart;
    }
  );

  fastify.post(
    '/api/v1/cart/coupon',
    {
      schema: applyCouponSchema,
      preHandler: [idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request, reply) => {
      const userId = await getOptionalUserId(fastify, request);
      const incomingSessionToken = parseSessionToken(request.headers.cookie);
      const sessionToken = resolveSessionToken(userId, incomingSessionToken);
      const cart = await cartService.applyCoupon(userId, sessionToken, request.body as never);
      setSessionCookie(reply, sessionToken ?? null);
      return cart;
    }
  );

  fastify.delete(
    '/api/v1/cart/coupon',
    {
      schema: removeCouponSchema,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request, reply) => {
      const userId = await getOptionalUserId(fastify, request);
      const incomingSessionToken = parseSessionToken(request.headers.cookie);
      const sessionToken = resolveSessionToken(userId, incomingSessionToken);
      const cart = await cartService.removeCoupon(userId, sessionToken);
      setSessionCookie(reply, sessionToken ?? null);
      return cart;
    }
  );

  fastify.post(
    '/api/v1/cart/check-pincode',
    {
      schema: checkPincodeSchema,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const body = request.body as { pincode: string };
      return cartService.checkPincodeServiceability(body.pincode);
    }
  );

  fastify.get(
    '/api/v1/cart/delivery-rates',
    {
      schema: deliveryRatesSchema,
      config: {
        rateLimit: routeRateLimitProfiles.cartOps
      }
    },
    async (request) => {
      const userId = await getOptionalUserId(fastify, request);
      const sessionToken = parseSessionToken(request.headers.cookie);
      const query = request.query as { pincode: string; paymentMode?: 'COD' | 'PREPAID' };
      return cartService.getDeliveryRates(userId, sessionToken, query.pincode, query.paymentMode ?? 'PREPAID');
    }
  );
}

