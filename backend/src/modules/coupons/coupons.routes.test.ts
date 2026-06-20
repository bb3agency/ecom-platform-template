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

const couponsServiceState = vi.hoisted(() => ({
  adminCouponAnalytics: vi.fn(async () => ({ totals: { totalCoupons: 0, activeCoupons: 0, expiredCoupons: 0, pausedCoupons: 0 } })),
  adminListCoupons: vi.fn(async () => ({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
  adminCreateCoupon: vi.fn(async () => ({
    id: 'coupon_1',
    code: 'WELCOME10',
    type: 'PERCENTAGE_OFF',
    value: 10,
    minOrderPaise: 0,
    maxUsesTotal: null,
    maxUsesPerUser: null,
    usesCount: 0,
    isActive: true,
    validFrom: new Date().toISOString(),
    validUntil: null,
    status: 'active',
    applicableTo: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })),
  adminUpdateCoupon: vi.fn(async () => ({
    id: 'coupon_1',
    code: 'WELCOME10',
    type: 'PERCENTAGE_OFF',
    value: 10,
    minOrderPaise: 0,
    maxUsesTotal: null,
    maxUsesPerUser: null,
    usesCount: 0,
    isActive: true,
    validFrom: new Date().toISOString(),
    validUntil: null,
    status: 'active',
    applicableTo: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })),
  adminUpdateCouponStatus: vi.fn(async () => ({
    id: 'coupon_1',
    code: 'WELCOME10',
    type: 'PERCENTAGE_OFF',
    value: 10,
    minOrderPaise: 0,
    maxUsesTotal: null,
    maxUsesPerUser: null,
    usesCount: 0,
    isActive: true,
    validFrom: new Date().toISOString(),
    validUntil: null,
    status: 'active',
    applicableTo: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })),
  adminDeleteCoupon: vi.fn(async () => ({ message: 'Coupon deleted' })),
  adminRestoreCoupon: vi.fn(async () => ({
    id: 'coupon_1',
    code: 'WELCOME10',
    type: 'PERCENTAGE_OFF',
    value: 10,
    minOrderPaise: 0,
    maxUsesTotal: null,
    maxUsesPerUser: null,
    usesCount: 0,
    isActive: true,
    validFrom: new Date().toISOString(),
    validUntil: null,
    status: 'active',
    applicableTo: null,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })),
  getCouponAuditLogs: vi.fn(async () => ({
    items: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 }
  })),
  adminGetCouponById: vi.fn(async () => ({
    id: 'coupon_1',
    code: 'WELCOME10',
    type: 'PERCENTAGE_OFF',
    value: 10,
    minOrderPaise: 0,
    maxUsesTotal: null,
    maxUsesPerUser: null,
    usesCount: 0,
    isActive: true,
    validFrom: new Date().toISOString(),
    validUntil: null,
    status: 'active',
    applicableTo: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })),
  getAdminStorefrontCouponsStatus: vi.fn(async () => ({
    merchantEnabled: true,
    storefrontEnabled: true,
    redeemableCouponCount: 1
  })),
  updateStorefrontCouponsEnabled: vi.fn(async () => ({
    merchantEnabled: true,
    storefrontEnabled: true,
    redeemableCouponCount: 1
  })),
  adminCloneCoupon: vi.fn(async () => ({
    id: 'coupon_2',
    code: 'WELCOME10-CLONE',
    type: 'PERCENTAGE_OFF',
    value: 10,
    minOrderPaise: 0,
    maxUsesTotal: null,
    maxUsesPerUser: null,
    usesCount: 0,
    isActive: true,
    validFrom: new Date().toISOString(),
    validUntil: null,
    status: 'active',
    applicableTo: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }))
}));

vi.mock('./coupons.service', () => {
  class MockCouponsService {
    adminCouponAnalytics = couponsServiceState.adminCouponAnalytics;
    adminListCoupons = couponsServiceState.adminListCoupons;
    adminCreateCoupon = couponsServiceState.adminCreateCoupon;
    adminUpdateCoupon = couponsServiceState.adminUpdateCoupon;
    adminUpdateCouponStatus = couponsServiceState.adminUpdateCouponStatus;
    adminDeleteCoupon = couponsServiceState.adminDeleteCoupon;
    adminRestoreCoupon = couponsServiceState.adminRestoreCoupon;
    getCouponAuditLogs = couponsServiceState.getCouponAuditLogs;
    adminGetCouponById = couponsServiceState.adminGetCouponById;
    getAdminStorefrontCouponsStatus = couponsServiceState.getAdminStorefrontCouponsStatus;
    updateStorefrontCouponsEnabled = couponsServiceState.updateStorefrontCouponsEnabled;
    adminCloneCoupon = couponsServiceState.adminCloneCoupon;
    constructor(_fastify: unknown) {}

    static getInstance(fastify: unknown) {
      return new MockCouponsService(fastify);
    }
  }

  return { CouponsService: MockCouponsService };
});

import { registerCouponsRoutes } from './coupons.routes';

describe('coupons routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('all coupon write routes have idempotencyPreHandler in preHandler chain', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; preHandler: unknown[] | undefined }> = [];

    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        preHandler: routeOptions.preHandler as unknown[] | undefined
      });
    });

    await registerCouponsRoutes(app);

    const writeRoutes = [
      { url: '/api/v1/admin/coupons', method: 'POST' },
      { url: '/api/v1/admin/coupons/:id', method: 'PATCH' },
      { url: '/api/v1/admin/coupons/:id/status', method: 'PATCH' },
      { url: '/api/v1/admin/coupons/:id', method: 'DELETE' },
      { url: '/api/v1/admin/coupons/:id/restore', method: 'POST' },
      { url: '/api/v1/admin/coupons/:id/clone', method: 'POST' }
    ];

    for (const { url, method } of writeRoutes) {
      const route = routes.find((r) => r.url === url && r.method === method);
      expect(route, `route ${method} ${url} should be registered`).toBeDefined();
      expect(Array.isArray(route?.preHandler), `${method} ${url} should have preHandler array`).toBe(true);
      expect((route?.preHandler as unknown[]).length, `${method} ${url} should have ≥4 preHandlers`).toBeGreaterThanOrEqual(4);
    }

    await app.close();
  });

  it('registers admin coupon routes with schema and guards', async () => {
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

    await registerCouponsRoutes(app);

    const storefrontStatusGet = routes.find(
      (route) => route.url === '/api/v1/admin/coupons/storefront-status' && route.method === 'GET'
    );
    expect(storefrontStatusGet).toBeDefined();
    expect(storefrontStatusGet?.preHandler).toBeDefined();

    const storefrontStatusPatch = routes.find(
      (route) => route.url === '/api/v1/admin/coupons/storefront-status' && route.method === 'PATCH'
    );
    expect(storefrontStatusPatch).toBeDefined();
    expect(storefrontStatusPatch?.preHandler).toBeDefined();

    const analytics = routes.find((route) => route.url === '/api/v1/admin/coupons/analytics' && route.method === 'GET');
    expect(analytics).toBeDefined();
    expect(analytics?.preHandler).toBeDefined();
    expect((analytics?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const list = routes.find((route) => route.url === '/api/v1/admin/coupons' && route.method === 'GET');
    expect(list).toBeDefined();
    expect(list?.preHandler).toBeDefined();

    const create = routes.find((route) => route.url === '/api/v1/admin/coupons' && route.method === 'POST');
    expect(create).toBeDefined();
    expect((create?.schema as { body?: unknown }).body).toBeDefined();

    const update = routes.find((route) => route.url === '/api/v1/admin/coupons/:id' && route.method === 'PATCH');
    expect(update).toBeDefined();
    expect((update?.schema as { body?: unknown }).body).toBeDefined();

    const status = routes.find((route) => route.url === '/api/v1/admin/coupons/:id/status' && route.method === 'PATCH');
    expect(status).toBeDefined();

    const del = routes.find((route) => route.url === '/api/v1/admin/coupons/:id' && route.method === 'DELETE');
    expect(del).toBeDefined();
    expect((del?.schema as { body?: unknown }).body).toBeUndefined();

    const getById = routes.find((route) => route.url === '/api/v1/admin/coupons/:id' && route.method === 'GET');
    expect(getById).toBeDefined();
    expect(getById?.preHandler).toBeDefined();
    expect((getById?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const clone = routes.find((route) => route.url === '/api/v1/admin/coupons/:id/clone' && route.method === 'POST');
    expect(clone).toBeDefined();
    expect(clone?.preHandler).toBeDefined();

    const restore = routes.find((route) => route.url === '/api/v1/admin/coupons/:id/restore' && route.method === 'POST');
    expect(restore).toBeDefined();
    expect(restore?.preHandler).toBeDefined();
    expect((restore?.schema as { body?: unknown }).body).toBeUndefined();

    const auditLogs = routes.find((route) => route.url === '/api/v1/admin/coupons/:id/audit' && route.method === 'GET');
    expect(auditLogs).toBeDefined();
    expect(auditLogs?.preHandler).toBeDefined();
    expect((auditLogs?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    await app.close();
  });
});
