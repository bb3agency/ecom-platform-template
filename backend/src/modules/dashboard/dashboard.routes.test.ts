import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@common/guards/jwt-auth.guard', () => ({
  jwtAuthGuard: vi.fn(async () => undefined)
}));
vi.mock('@common/guards/roles.guard', () => ({
  rolesGuard: vi.fn(() => async () => undefined)
}));
vi.mock('@common/guards/admin-permissions.guard', () => ({
  adminPermissionGuard: vi.fn(() => async () => undefined)
}));
vi.mock('@common/reliability/load-shed.guard', () => ({
  loadShedGuard: vi.fn(async () => undefined)
}));

const dashboardServiceState = vi.hoisted(() => ({
  getKpis: vi.fn(async () => ({
    period: '7d',
    from: new Date().toISOString(),
    to: new Date().toISOString(),
    ordersCount: 0,
    revenuePaise: 0,
    averageOrderValuePaise: 0,
    customersCount: 0
  })),
  getSalesChart: vi.fn(async () => ({
    granularity: 'day',
    points: []
  })),
  getTopProducts: vi.fn(async () => ({ items: [] }))
}));

vi.mock('./dashboard.service', () => {
  class MockDashboardService {
    getKpis = dashboardServiceState.getKpis;
    getSalesChart = dashboardServiceState.getSalesChart;
    getTopProducts = dashboardServiceState.getTopProducts;
    constructor(_fastify: unknown) {}
  }

  return { DashboardService: MockDashboardService };
});

import { registerDashboardRoutes } from './dashboard.routes';

describe('dashboard routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all dashboard admin routes with schemas', async () => {
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

    await registerDashboardRoutes(app);

    const kpis = routes.find((route) => route.url === '/api/v1/admin/dashboard/kpis' && route.method === 'GET');
    expect(kpis).toBeDefined();
    expect(kpis?.preHandler).toBeDefined();
    expect((kpis?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const salesChart = routes.find((route) => route.url === '/api/v1/admin/dashboard/sales-chart' && route.method === 'GET');
    expect(salesChart).toBeDefined();
    expect(salesChart?.preHandler).toBeDefined();
    expect((salesChart?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const topProducts = routes.find((route) => route.url === '/api/v1/admin/dashboard/top-products' && route.method === 'GET');
    expect(topProducts).toBeDefined();
    expect(topProducts?.preHandler).toBeDefined();
    expect((topProducts?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    await app.close();
  });
});
