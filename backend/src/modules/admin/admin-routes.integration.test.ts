import Fastify from 'fastify';
import { Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAnalyticsRoutes } from '../analytics/analytics.routes';
import { registerDashboardRoutes } from '../dashboard/dashboard.routes';
import { registerUsersRoutes } from '../users/users.routes';
import { registerOrdersRoutes } from '../orders/orders.routes';
import { AnalyticsService } from '../analytics/analytics.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { UsersService } from '../users/users.service';
import { OrdersService } from '../orders/orders.service';

interface MockError {
  statusCode?: number;
  code?: string;
  message?: string;
}

interface CreateAppOptions {
  user?: { sub: string; role: Role; permissions: string[] };
}

function createApp(options: CreateAppOptions = {}) {
  const app = Fastify();
  app.setErrorHandler((err, _request, reply) => {
    const error = err as MockError;
    const statusCode =
      typeof error.statusCode === 'number' ? error.statusCode : 500;
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

  const defaultUser = options.user || { sub: 'admin-1', role: Role.ADMIN, permissions: ['*'] };

  // Override jwtVerify request decorator behavior
  try {
    app.decorateRequest('jwtVerify', async function () {
      const req = this as unknown as { user?: unknown };
      req.user = defaultUser;
    });
  } catch (err: any) {
    // If already decorated, ignore
    if (err.code !== 'FST_ERR_DEC_ALREADY_PRESENT') {
      throw err;
    }
  }

  // Ensure log decorator exists
  try {
    app.decorate('log', { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as any);
  } catch (err: any) {
    // If already decorated, ensure it has the mock methods
    if (err.code !== 'FST_ERR_DEC_ALREADY_PRESENT') {
      throw err;
    }
  }

  return app;
}

describe('admin routes integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_SCOPE_ENFORCEMENT = 'false';
  });

  it('serves admin users list and detail routes', async () => {
    vi.spyOn(UsersService.prototype, 'adminListUsers').mockResolvedValue({
      items: [
        {
          id: 'user_1',
          email: 'user@example.com',
          phone: null,
          firstName: 'User',
          lastName: 'One',
          isBanned: false,
          totalOrders: 0,
          totalSpendPaise: 0,
          createdAt: new Date().toISOString()
        }
      ],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 }
    });
    vi.spyOn(UsersService.prototype, 'adminGetUserById').mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
      phone: null,
      firstName: 'User',
      lastName: 'One',
      isBanned: false,
      bannedAt: null,
      bannedReason: null,
      createdAt: new Date().toISOString(),
      addresses: [],
      orders: []
    });

    const app = createApp();
    await registerUsersRoutes(app);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?page=1&limit=20'
    });
    expect(listResponse.statusCode).toBe(200);
    expect(UsersService.prototype.adminListUsers).toHaveBeenCalledTimes(1);

    const detailResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users/user_1'
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(UsersService.prototype.adminGetUserById).toHaveBeenCalledWith('user_1');

    await app.close();
  });

  it('serves dashboard aggregate routes', async () => {
    vi.spyOn(DashboardService.prototype, 'getKpis').mockResolvedValue({
      period: '7d',
      from: new Date().toISOString(),
      to: new Date().toISOString(),
      ordersCount: 5,
      revenuePaise: 10000,
      averageOrderValuePaise: 2000,
      customersCount: 3
    });
    vi.spyOn(DashboardService.prototype, 'getSalesChart').mockResolvedValue({
      granularity: 'day',
      points: [{ bucket: '2026-04-26', ordersCount: 1, revenuePaise: 1000 }]
    });
    vi.spyOn(DashboardService.prototype, 'getTopProducts').mockResolvedValue({
      items: [
        {
          variantId: 'var_1',
          productName: 'Product',
          variantName: 'Variant',
          quantitySold: 1,
          revenuePaise: 1000
        }
      ]
    });

    const app = createApp();
    await registerDashboardRoutes(app);

    const kpisResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dashboard/kpis?period=7d'
    });
    expect(kpisResponse.statusCode).toBe(200);

    const salesResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dashboard/sales-chart?granularity=day'
    });
    expect(salesResponse.statusCode).toBe(200);

    const topProductsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dashboard/top-products?limit=10'
    });
    expect(topProductsResponse.statusCode).toBe(200);
    expect(DashboardService.prototype.getTopProducts).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('serves analytics routes', async () => {
    vi.spyOn(AnalyticsService.prototype, 'getRevenue').mockResolvedValue({
      granularity: 'day',
      points: [{ bucket: '2026-04-26', revenuePaise: 1000, ordersCount: 1 }]
    });
    vi.spyOn(AnalyticsService.prototype, 'exportRevenueCsv').mockResolvedValue('"bucket","ordersCount","revenuePaise"\n"2026-04-26","1","1000"');
    vi.spyOn(AnalyticsService.prototype, 'getFunnel').mockResolvedValue({
      steps: [{ eventType: 'ADD_TO_CART', count: 5, conversionRatePercent: 100 }]
    });
    vi.spyOn(AnalyticsService.prototype, 'getInventoryAlerts').mockResolvedValue({
      items: []
    });
    vi.spyOn(AnalyticsService.prototype, 'getNotificationDeliveryStats').mockResolvedValue({
      channels: [{ channel: 'EMAIL', total: 10, sent: 9, failed: 1, deliveryRatePercent: 90 }]
    });
    vi.spyOn(AnalyticsService.prototype, 'getCategoryBreakdown').mockResolvedValue({
      items: [{ categoryId: 'cat_1', categoryName: 'Snacks', revenuePaise: 1000, sharePercent: 100 }]
    });

    const app = createApp();
    await registerAnalyticsRoutes(app);

    const revenueResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/analytics/revenue?granularity=day'
    });
    expect(revenueResponse.statusCode).toBe(200);

    const funnelResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/analytics/funnel'
    });
    expect(funnelResponse.statusCode).toBe(200);

    const revenueExportResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/analytics/revenue/export?granularity=day'
    });
    expect(revenueExportResponse.statusCode).toBe(200);

    const inventoryResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/analytics/inventory-alerts'
    });
    expect(inventoryResponse.statusCode).toBe(200);

    const notificationsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/analytics/notifications'
    });
    expect(notificationsResponse.statusCode).toBe(200);
    expect(AnalyticsService.prototype.getNotificationDeliveryStats).toHaveBeenCalledTimes(1);

    const categoryBreakdownResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/analytics/category-breakdown'
    });
    expect(categoryBreakdownResponse.statusCode).toBe(200);
    expect(AnalyticsService.prototype.getCategoryBreakdown).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('POST /admin/shipments/:id/sync requires orders:write — rejects with 403 for shipments:read-only user', async () => {
    // User has shipments:read but NOT orders:write
    const app = createApp({
      user: { sub: 'admin-2', role: Role.ADMIN, permissions: ['shipments:read'] }
    });
    const prisma = {
      $connect: vi.fn(),
      $disconnect: vi.fn(),
      storeSettings: { findUnique: vi.fn() },
      adminPermissionGrant: { findMany: vi.fn().mockResolvedValue([{ permission: 'shipments:read' }]) }
    };
    app.decorate('prisma', prisma as any);
    app.decorate('redis', { get: vi.fn(), set: vi.fn(), del: vi.fn() } as any);
    app.decorate('queues', { analytics: { add: vi.fn() }, shipping: { add: vi.fn() }, orderProcessing: { add: vi.fn() }, refunds: { add: vi.fn() }, notifications: { add: vi.fn() } } as any);
    app.decorate('checkoutRisk', { evaluate: vi.fn() } as any);
    process.env.ADMIN_SCOPE_ENFORCEMENT = 'true';
    await registerOrdersRoutes(app);

    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/shipments/ship-123/sync' });
    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it('POST /admin/shipments/:id/sync allows user with orders:write', async () => {
    const app = createApp();
    vi.spyOn(OrdersService.prototype, 'adminSyncShipmentStatus').mockResolvedValue({
      id: 'ship-123',
      status: 'IN_TRANSIT',
      awbNumber: 'AWB001',
      trackingUrl: null,
      updatedAt: new Date().toISOString()
    } as never);
    const prisma = {
      $connect: vi.fn(),
      $disconnect: vi.fn(),
      storeSettings: { findUnique: vi.fn() },
      adminPermissionGrant: { findMany: vi.fn().mockResolvedValue([{ permission: 'orders:write' }]) }
    };
    app.decorate('prisma', prisma as any);
    app.decorate('redis', { get: vi.fn(), set: vi.fn(), del: vi.fn() } as any);
    app.decorate('queues', { analytics: { add: vi.fn() }, shipping: { add: vi.fn() }, orderProcessing: { add: vi.fn() }, refunds: { add: vi.fn() }, notifications: { add: vi.fn() } } as any);
    app.decorate('checkoutRisk', { evaluate: vi.fn() } as any);
    await registerOrdersRoutes(app);

    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/shipments/ship-123/sync' });
    expect(response.statusCode).toBe(200);
    expect(OrdersService.prototype.adminSyncShipmentStatus).toHaveBeenCalledWith('ship-123');

    await app.close();
  });

  it('POST /api/v1/analytics/event ignores body userId when request is authenticated', async () => {
    const app = createApp({
      user: { sub: 'real-user-999', role: Role.CUSTOMER, permissions: [] }
    });
    vi.spyOn(AnalyticsService.prototype, 'recordEvent').mockResolvedValue({ ok: true } as never);
    const prisma = {
      $connect: vi.fn(),
      $disconnect: vi.fn(),
      analyticsEvent: {
        create: vi.fn().mockResolvedValue({ ok: true })
      }
    };
    app.decorate('prisma', prisma as any);
    app.decorate('redis', { get: vi.fn(), set: vi.fn(), del: vi.fn() } as any);
    app.decorate('queues', {
      analytics: { add: vi.fn() },
      shipping: { add: vi.fn() },
      orderProcessing: { add: vi.fn() },
      refunds: { add: vi.fn() },
      notifications: { add: vi.fn() }
    } as any);
    await registerAnalyticsRoutes(app);

    // eventType must match the enum: PRODUCT_VIEW, ADD_TO_CART, etc. (uppercase)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analytics/event',
      payload: { eventType: 'PRODUCT_VIEW', sessionId: 'sess-abc', userId: 'spoofed-user-999' }
    });

    // Route returns 201 on success
    expect(response.statusCode).toBe(201);
    // Verify recordEvent was called with the authenticated user id, not the body userId
    expect(AnalyticsService.prototype.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'real-user-999' })
    );
    expect(AnalyticsService.prototype.recordEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'spoofed-user-999' })
    );

    await app.close();
  });
});

