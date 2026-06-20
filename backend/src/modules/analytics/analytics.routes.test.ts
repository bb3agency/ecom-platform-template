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

const analyticsServiceState = vi.hoisted(() => ({
  getRevenue: vi.fn(async () => ({ granularity: 'day', points: [] })),
  exportRevenueCsv: vi.fn(async () => '"bucket","ordersCount","revenuePaise"'),
  getFunnel: vi.fn(async () => ({ steps: [] })),
  getInventoryAlerts: vi.fn(async () => ({ items: [] })),
  getNotificationDeliveryStats: vi.fn(async () => ({ channels: [] })),
  listReconciliationIssues: vi.fn(async () => ({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
  getCategoryBreakdown: vi.fn(async () => ({ items: [] })),
  previewOutboxDeadLetterReplay: vi.fn(async () => ({
    id: 'outbox_1',
    current: { status: 'FAILED', updatedAt: new Date().toISOString() },
    proposed: { action: 'enqueue-replay' },
    diff: { fields: ['status'] }
  })),
  replayOutboxDeadLetter: vi.fn(async () => ({
    id: 'outbox_1',
    status: 'FAILED',
    queueName: 'notifications',
    jobName: 'send-email',
    attemptCount: 1,
    mode: 'dry-run'
  })),
  listOutboxDeadLetters: vi.fn(async () => ({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
  listWebhookInboxFailures: vi.fn(async () => ({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
  previewInboxFailureReplay: vi.fn(async () => ({
    id: 'inbox_1',
    current: { status: 'FAILED', updatedAt: new Date().toISOString() },
    proposed: { action: 'canonical-reprocess' },
    diff: { fields: ['status'] }
  })),
  replayInboxFailure: vi.fn(async () => ({
    id: 'inbox_1',
    provider: 'razorpay',
    eventKey: 'ek_123',
    status: 'PROCESSING',
    mode: 'enqueued'
  }))
}));

vi.mock('./analytics.service', () => {
  class MockAnalyticsService {
    getRevenue = analyticsServiceState.getRevenue;
    exportRevenueCsv = analyticsServiceState.exportRevenueCsv;
    getFunnel = analyticsServiceState.getFunnel;
    getInventoryAlerts = analyticsServiceState.getInventoryAlerts;
    getNotificationDeliveryStats = analyticsServiceState.getNotificationDeliveryStats;
    listReconciliationIssues = analyticsServiceState.listReconciliationIssues;
    getCategoryBreakdown = analyticsServiceState.getCategoryBreakdown;
    previewOutboxDeadLetterReplay = analyticsServiceState.previewOutboxDeadLetterReplay;
    replayOutboxDeadLetter = analyticsServiceState.replayOutboxDeadLetter;
    listOutboxDeadLetters = analyticsServiceState.listOutboxDeadLetters;
    listWebhookInboxFailures = analyticsServiceState.listWebhookInboxFailures;
    previewInboxFailureReplay = analyticsServiceState.previewInboxFailureReplay;
    replayInboxFailure = analyticsServiceState.replayInboxFailure;
    constructor(_fastify: unknown) {}
  }

  return { AnalyticsService: MockAnalyticsService };
});

import { registerAnalyticsRoutes } from './analytics.routes';

describe('analytics routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers replay routes with schema and guards', async () => {
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

    await registerAnalyticsRoutes(app);

    const outboxPreview = routes.find((route) => route.url === '/api/v1/admin/analytics/outbox-dead-letter/:id/replay-preview' && route.method === 'POST');
    expect(outboxPreview).toBeDefined();
    expect(outboxPreview?.preHandler).toBeDefined();
    expect((outboxPreview?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const outboxReplay = routes.find((route) => route.url === '/api/v1/admin/analytics/outbox-dead-letter/:id/replay' && route.method === 'POST');
    expect(outboxReplay).toBeDefined();
    const outboxReplaySchema = outboxReplay?.schema as { body?: unknown; response?: Record<number, unknown> };
    expect(outboxReplaySchema.body).toBeDefined();
    expect(outboxReplaySchema.response?.[200]).toBeDefined();

    const inboxPreview = routes.find((route) => route.url === '/api/v1/admin/analytics/inbox-failures/:id/replay-preview' && route.method === 'POST');
    expect(inboxPreview).toBeDefined();
    expect((inboxPreview?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const inboxReplay = routes.find((route) => route.url === '/api/v1/admin/analytics/inbox-failures/:id/replay' && route.method === 'POST');
    expect(inboxReplay).toBeDefined();
    const inboxReplaySchema = inboxReplay?.schema as { body?: unknown; response?: Record<number, unknown> };
    expect(inboxReplaySchema.body).toBeDefined();
    expect(inboxReplaySchema.response?.[200]).toBeDefined();

    await app.close();
  });

  it('registers analytics read/export routes with schema', async () => {
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

    await registerAnalyticsRoutes(app);

    const revenue = routes.find((route) => route.url === '/api/v1/admin/analytics/revenue' && route.method === 'GET');
    expect(revenue).toBeDefined();
    expect((revenue?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const revenueCsv = routes.find((route) => route.url === '/api/v1/admin/analytics/revenue/export' && route.method === 'GET');
    expect(revenueCsv).toBeDefined();
    expect((revenueCsv?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const notifications = routes.find((route) => route.url === '/api/v1/admin/analytics/notifications' && route.method === 'GET');
    expect(notifications).toBeDefined();
    expect((notifications?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const reconciliation = routes.find((route) => route.url === '/api/v1/admin/analytics/reconciliation-issues' && route.method === 'GET');
    expect(reconciliation).toBeDefined();
    expect((reconciliation?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const funnel = routes.find((route) => route.url === '/api/v1/admin/analytics/funnel' && route.method === 'GET');
    expect(funnel).toBeDefined();
    expect((funnel?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const inventoryAlerts = routes.find((route) => route.url === '/api/v1/admin/analytics/inventory-alerts' && route.method === 'GET');
    expect(inventoryAlerts).toBeDefined();
    expect((inventoryAlerts?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const categoryBreakdown = routes.find((route) => route.url === '/api/v1/admin/analytics/category-breakdown' && route.method === 'GET');
    expect(categoryBreakdown).toBeDefined();
    expect((categoryBreakdown?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const outboxDeadLettersList = routes.find((route) => route.url === '/api/v1/admin/analytics/outbox-dead-letter' && route.method === 'GET');
    expect(outboxDeadLettersList).toBeDefined();
    expect((outboxDeadLettersList?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const inboxFailuresList = routes.find((route) => route.url === '/api/v1/admin/analytics/inbox-failures' && route.method === 'GET');
    expect(inboxFailuresList).toBeDefined();
    expect((inboxFailuresList?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    await app.close();
  });
});
