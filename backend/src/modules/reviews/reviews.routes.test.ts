import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./reviews.service', () => {
  class MockReviewsService {
    constructor(_fastify: unknown) {}
  }

  return { ReviewsService: MockReviewsService };
});

import { registerReviewsRoutes } from './reviews.routes';

describe('reviews routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers public, customer, and admin review routes with schema and guards', async () => {
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

    await registerReviewsRoutes(app);

    const recentReviews = routes.find((route) => route.url === '/api/v1/reviews/recent' && route.method === 'GET');
    expect(recentReviews).toBeDefined();
    expect((recentReviews?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const productReviews = routes.find((route) => route.url === '/api/v1/reviews/product/:slug' && route.method === 'GET');
    expect(productReviews).toBeDefined();
    expect((productReviews?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const myReviews = routes.find((route) => route.url === '/api/v1/reviews/me' && route.method === 'GET');
    expect(myReviews).toBeDefined();
    expect(myReviews?.preHandler).toBeDefined();

    const createReview = routes.find((route) => route.url === '/api/v1/reviews' && route.method === 'POST');
    expect(createReview).toBeDefined();
    expect(createReview?.preHandler).toBeDefined();

    const adminReviewSummary = routes.find(
      (route) => route.url === '/api/v1/admin/reviews/summary' && route.method === 'GET'
    );
    expect(adminReviewSummary).toBeDefined();

    const adminReviews = routes.find((route) => route.url === '/api/v1/admin/reviews' && route.method === 'GET');
    expect(adminReviews).toBeDefined();
    expect(adminReviews?.preHandler).toBeDefined();

    const moderateReview = routes.find((route) => route.url === '/api/v1/admin/reviews/:id/moderate' && route.method === 'PATCH');
    expect(moderateReview).toBeDefined();
    expect(moderateReview?.preHandler).toBeDefined();

    const deleteReview = routes.find((route) => route.url === '/api/v1/admin/reviews/:id' && route.method === 'DELETE');
    expect(deleteReview).toBeDefined();
    expect(deleteReview?.preHandler).toBeDefined();

    await app.close();
  });

  it('moderate review route has loadShedGuard in preHandler chain (same depth as delete)', async () => {
    const app = Fastify();

    const routes: Array<{ method: string | string[]; url: string; preHandler?: unknown[] }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        preHandler: routeOptions.preHandler as unknown[]
      });
    });

    await registerReviewsRoutes(app);

    const moderateRoute = routes.find(
      (r) => r.url === '/api/v1/admin/reviews/:id/moderate' && r.method === 'PATCH'
    );
    const deleteRoute = routes.find(
      (r) => r.url === '/api/v1/admin/reviews/:id' && r.method === 'DELETE'
    );

    expect(moderateRoute?.preHandler).toBeDefined();
    expect(deleteRoute?.preHandler).toBeDefined();

    const moderateHandlerCount = Array.isArray(moderateRoute?.preHandler)
      ? moderateRoute.preHandler.length
      : 0;
    const deleteHandlerCount = Array.isArray(deleteRoute?.preHandler)
      ? deleteRoute.preHandler.length
      : 0;

    expect(moderateHandlerCount).toBeGreaterThanOrEqual(3);
    expect(moderateHandlerCount).toBe(deleteHandlerCount);

    await app.close();
  });
});
