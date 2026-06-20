import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerInventoryRoutes } from './inventory.routes';

interface MockError {
  statusCode?: number;
  code?: string;
  message?: string;
}

function createApp() {
  const app = Fastify();
  app.decorateRequest('jwtVerify', async function () {
    (this as unknown as { user: unknown }).user = {
      sub: 'user-1',
      role: 'ADMIN',
      permissions: ['inventory:read', 'inventory:write']
    };
  });
  app.setErrorHandler((err, _request, reply) => {
    const error = err as MockError;
    reply.status(error.statusCode ?? 500).send({
      success: false,
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: error.message,
        statusCode: error.statusCode ?? 500,
        details: { kind: 'internal', hintKey: 'unknown', retryable: false, remediation: '' }
      }
    });
  });
  app.decorate('prisma', {
    $transaction: vi.fn(async (queries: any[]) => Promise.all(queries)),
    inventory: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({}))
    },
    inventoryAdjustment: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0)
    },
    cartReservation: {
      groupBy: vi.fn(async () => [])
    }
  } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);
  return app;
}

describe('inventory routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bulk-update and patch routes have idempotencyPreHandler in preHandler chain', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; preHandler: unknown[] | undefined }> = [];

    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        preHandler: routeOptions.preHandler as unknown[] | undefined
      });
    });

    await registerInventoryRoutes(app);

    const bulkUpdate = routes.find((r) => r.url === '/api/v1/admin/inventory/bulk-update' && r.method === 'POST');
    expect(bulkUpdate).toBeDefined();
    expect(Array.isArray(bulkUpdate?.preHandler)).toBe(true);
    expect((bulkUpdate?.preHandler as unknown[]).length).toBeGreaterThanOrEqual(4);

    const patchVariant = routes.find((r) => r.url === '/api/v1/admin/inventory/:variantId' && r.method === 'PATCH');
    expect(patchVariant).toBeDefined();
    expect(Array.isArray(patchVariant?.preHandler)).toBe(true);
    expect((patchVariant?.preHandler as unknown[]).length).toBeGreaterThanOrEqual(4);

    await app.close();
  });

  it('serves inventory list route', async () => {
    const app = createApp();
    await registerInventoryRoutes(app);

    const getResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/inventory',
      headers: { authorization: 'Bearer token' }
    });
    expect(getResponse.statusCode).toBe(200);

    await app.close();
  });

  it('serves bulk-update route and returns updated/failed counts', async () => {
    const app = createApp();
    const prisma = app.prisma as unknown as { inventory: { findMany: import('vitest').Mock, findUnique: import('vitest').Mock }, $transaction: import('vitest').Mock };
    prisma.inventory.findMany.mockResolvedValue([{ variantId: 'v1' }]);
    prisma.$transaction.mockResolvedValue([{}]);

    await registerInventoryRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/inventory/bulk-update',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: JSON.stringify({ updates: [{ variantId: 'v1', quantity: 20 }] })
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('updated');
    expect(body).toHaveProperty('failed');

    await app.close();
  });

  it('rejects bulk-update with empty updates array', async () => {
    const app = createApp();
    await registerInventoryRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/inventory/bulk-update',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: JSON.stringify({ updates: [] })
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('serves low-stock route and returns array', async () => {
    const app = createApp();
    const prisma = app.prisma as unknown as { inventory: { findMany: import('vitest').Mock }, cartReservation: { groupBy: import('vitest').Mock } };
    prisma.inventory.findMany.mockResolvedValue([]);
    prisma.cartReservation.groupBy.mockResolvedValue([]);

    await registerInventoryRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/inventory/low-stock',
      headers: { authorization: 'Bearer token' }
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);

    await app.close();
  });

  it('serves history/:variantId route and returns paginated result', async () => {
    const app = createApp();
    const prisma = app.prisma as unknown as { inventory: { findUnique: import('vitest').Mock }, $transaction: import('vitest').Mock };
    prisma.inventory.findUnique.mockResolvedValue({ variantId: 'v1' });
    prisma.$transaction.mockResolvedValue([[], 0]);

    await registerInventoryRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/inventory/history/v1',
      headers: { authorization: 'Bearer token' }
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('variantId', 'v1');
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');

    await app.close();
  });
});
