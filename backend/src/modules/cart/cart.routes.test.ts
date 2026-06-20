import Fastify from 'fastify';
import { Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCartMock = vi.fn(async () => ({
  id: 'cart_1',
  items: [],
  subtotal: 0,
  discountAmount: 0,
  total: 0,
  minOrderValuePaise: 0,
  meetsMinimumOrder: true,
  coupon: null,
  meta: {
    isGuest: false,
    reservationExpiresAt: null,
    reservedItemCount: 0
  }
}));

vi.mock('./cart.service', () => {
  class MockCartService {
    getCart = getCartMock;
    constructor(_fastify: unknown) {}
  }

  return { CartService: MockCartService };
});

import { registerCartRoutes } from './cart.routes';

function createCartApp(userRecord: { id: string; role: Role; isBanned: boolean } | null) {
  const app = Fastify();
  app.setErrorHandler((err, _request, reply) => {
    const error = err as { statusCode?: number; message?: string; code?: string };
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    reply.status(statusCode).send({
      success: false,
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: error.message,
        statusCode,
        details: { kind: 'internal', hintKey: 'unknown', retryable: false, remediation: '' }
      }
    });
  });
  app.decorate('jwt', {
    verify: vi.fn(() => ({ sub: 'customer_1', role: Role.CUSTOMER }))
  } as never);
  app.decorate('prisma', {
    user: {
      findUnique: vi.fn(async () => userRecord)
    }
  } as never);

  return app;
}

describe('cart routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCartMock.mockResolvedValue({
      id: 'cart_1',
      items: [],
      subtotal: 0,
      discountAmount: 0,
      total: 0,
      minOrderValuePaise: 0,
      meetsMinimumOrder: true,
      coupon: null,
      meta: {
        isGuest: false,
        reservationExpiresAt: null,
        reservedItemCount: 0
      }
    });
  });

  it('registers cart routes with schema and idempotency on mutations', async () => {
    const app = Fastify();
    app.decorate('jwt', {
      verify: vi.fn(() => ({ sub: 'user_1', role: 'CUSTOMER' }))
    } as never);
    app.decorate('prisma', {
      user: {
        findUnique: vi.fn(async () => ({ id: 'user_1', role: Role.CUSTOMER, isBanned: false }))
      }
    } as never);

    const routes: Array<{ method: string | string[]; url: string; schema?: unknown; preHandler?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema,
        preHandler: routeOptions.preHandler
      });
    });

    await registerCartRoutes(app);

    const getCart = routes.find((route) => route.url === '/api/v1/cart' && route.method === 'GET');
    expect(getCart).toBeDefined();
    expect((getCart?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const addItem = routes.find((route) => route.url === '/api/v1/cart/items' && route.method === 'POST');
    expect(addItem).toBeDefined();
    expect(addItem?.preHandler).toBeDefined();

    const applyCoupon = routes.find((route) => route.url === '/api/v1/cart/coupon' && route.method === 'POST');
    expect(applyCoupon).toBeDefined();
    expect(applyCoupon?.preHandler).toBeDefined();

    const merge = routes.find((route) => route.url === '/api/v1/cart/merge' && route.method === 'POST');
    expect(merge).toBeDefined();
    expect((merge?.schema as { body?: unknown }).body).toBeDefined();

    const deliveryRates = routes.find((route) => route.url === '/api/v1/cart/delivery-rates' && route.method === 'GET');
    expect(deliveryRates).toBeDefined();

    await app.close();
  });

  it('rejects banned customers with a valid bearer token', async () => {
    const app = createCartApp({ id: 'customer_1', role: Role.CUSTOMER, isBanned: true });
    await registerCartRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      headers: {
        authorization: 'Bearer valid-token'
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toContain('suspended');
    expect(getCartMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('rejects deleted customer accounts with a valid bearer token', async () => {
    const app = createCartApp(null);
    await registerCartRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      headers: {
        authorization: 'Bearer valid-token'
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe('Authentication required');
    expect(getCartMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('allows active customers with a valid bearer token', async () => {
    const app = createCartApp({ id: 'customer_1', role: Role.CUSTOMER, isBanned: false });
    await registerCartRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      headers: {
        authorization: 'Bearer valid-token'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(getCartMock).toHaveBeenCalledWith('customer_1', undefined);

    await app.close();
  });
});
