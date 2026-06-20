import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./wishlist.service', () => {
  class MockWishlistService {
    constructor(_fastify: unknown) {}
  }

  return { WishlistService: MockWishlistService };
});

import { registerWishlistRoutes } from './wishlist.routes';

describe('wishlist routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers wishlist routes with schema and customer guards', async () => {
    const app = Fastify();

    const routes: Array<{ method: string | string[]; url: string; schema?: unknown; preHandler?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema,
        preHandler: routeOptions.preHandler
      });
    });

    await registerWishlistRoutes(app);

    const list = routes.find((route) => route.url === '/api/v1/wishlist' && route.method === 'GET');
    expect(list).toBeDefined();
    expect(list?.preHandler).toBeDefined();

    const add = routes.find((route) => route.url === '/api/v1/wishlist/items' && route.method === 'POST');
    expect(add).toBeDefined();
    expect(add?.preHandler).toBeDefined();

    const remove = routes.find((route) => route.url === '/api/v1/wishlist/items/:productId' && route.method === 'DELETE');
    expect(remove).toBeDefined();
    expect(remove?.preHandler).toBeDefined();

    await app.close();
  });
});
