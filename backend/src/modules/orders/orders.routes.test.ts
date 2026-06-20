import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./orders.service', () => {
  class MockOrdersService {
    constructor(_fastify: unknown) {}
  }

  return { OrdersService: MockOrdersService };
});

import { registerOrdersRoutes } from './orders.routes';

describe('orders routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('registers customer, admin, and webhook routes with schema and guards', async () => {
    const app = Fastify();
    app.decorate(
      'checkoutRisk',
      {
        assertInitiatePaymentAllowed: vi.fn(async () => undefined)
      } as never
    );

    const routes: Array<{ method: string | string[]; url: string; schema?: unknown; preHandler?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema,
        preHandler: routeOptions.preHandler
      });
    });

    await registerOrdersRoutes(app);

    const createOrder = routes.find((route) => route.url === '/api/v1/orders' && route.method === 'POST');
    expect(createOrder).toBeDefined();
    expect(createOrder?.preHandler).toBeDefined();
    expect((createOrder?.schema as { body?: unknown }).body).toBeDefined();

    const paymentWebhook = routes.find((route) => route.url === '/api/v1/payments/webhook' && route.method === 'POST');
    expect(paymentWebhook).toBeDefined();
    expect((paymentWebhook?.schema as { body?: unknown }).body).toBeDefined();

    const prepareCheckout = routes.find((route) => route.url === '/api/v1/payments/prepare-checkout' && route.method === 'POST');
    expect(prepareCheckout).toBeDefined();
    expect(prepareCheckout?.preHandler).toBeDefined();
    expect((prepareCheckout?.schema as { body?: unknown }).body).toBeDefined();

    const confirmPrepaid = routes.find((route) => route.url === '/api/v1/payments/confirm-prepaid' && route.method === 'POST');
    expect(confirmPrepaid).toBeDefined();
    expect(confirmPrepaid?.preHandler).toBeDefined();
    expect((confirmPrepaid?.schema as { body?: unknown }).body).toBeDefined();

    const adminList = routes.find((route) => route.url === '/api/v1/admin/orders' && route.method === 'GET');
    expect(adminList).toBeDefined();
    expect(adminList?.preHandler).toBeDefined();
    expect((adminList?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const adminStatus = routes.find((route) => route.url === '/api/v1/admin/orders/:id/status' && route.method === 'PATCH');
    expect(adminStatus).toBeDefined();
    expect(adminStatus?.preHandler).toBeDefined();

    const returnRequestsAdmin = routes.find((route) => route.url === '/api/v1/admin/return-requests' && route.method === 'GET');
    expect(returnRequestsAdmin).toBeDefined();
    expect(returnRequestsAdmin?.preHandler).toBeDefined();

    const shipmentById = routes.find((route) => route.url === '/api/v1/admin/shipments/:id' && route.method === 'GET');
    expect(shipmentById).toBeDefined();
    expect(shipmentById?.preHandler).toBeDefined();
    expect((shipmentById?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const paymentById = routes.find((route) => route.url === '/api/v1/admin/payments/:id' && route.method === 'GET');
    expect(paymentById).toBeDefined();
    expect(paymentById?.preHandler).toBeDefined();
    expect((paymentById?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const orderTimeline = routes.find((route) => route.url === '/api/v1/admin/orders/:id/timeline' && route.method === 'GET');
    expect(orderTimeline).toBeDefined();
    expect(orderTimeline?.preHandler).toBeDefined();
    expect((orderTimeline?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const adminBoard = routes.find((route) => route.url === '/api/v1/admin/orders/board' && route.method === 'GET');
    expect(adminBoard).toBeDefined();
    expect(adminBoard?.preHandler).toBeDefined();
    expect((adminBoard?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const adminExport = routes.find((route) => route.url === '/api/v1/admin/orders/export' && route.method === 'GET');
    expect(adminExport).toBeDefined();
    expect(adminExport?.preHandler).toBeDefined();

    const adminGetById = routes.find((route) => route.url === '/api/v1/admin/orders/:id' && route.method === 'GET');
    expect(adminGetById).toBeDefined();
    expect(adminGetById?.preHandler).toBeDefined();
    expect((adminGetById?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const adminInvoice = routes.find((route) => route.url === '/api/v1/admin/orders/:id/invoice.pdf' && route.method === 'GET');
    expect(adminInvoice).toBeDefined();
    expect(adminInvoice?.preHandler).toBeDefined();

    const adminShip = routes.find((route) => route.url === '/api/v1/admin/orders/:id/ship' && route.method === 'POST');
    expect(adminShip).toBeDefined();
    expect(adminShip?.preHandler).toBeDefined();

    const adminCancel = routes.find((route) => route.url === '/api/v1/admin/orders/:id/cancel' && route.method === 'POST');
    expect(adminCancel).toBeDefined();
    expect(adminCancel?.preHandler).toBeDefined();

    const adminSchedulePickup = routes.find((route) => route.url === '/api/v1/admin/orders/:id/schedule-pickup' && route.method === 'POST');
    expect(adminSchedulePickup).toBeDefined();
    expect(adminSchedulePickup?.preHandler).toBeDefined();

    const adminPrintLabel = routes.find((route) => route.url === '/api/v1/admin/orders/:id/print-label' && route.method === 'POST');
    expect(adminPrintLabel).toBeDefined();
    expect(adminPrintLabel?.preHandler).toBeDefined();

    const adminRetrigger = routes.find((route) => route.url === '/api/v1/admin/orders/:id/notifications/retrigger' && route.method === 'POST');
    expect(adminRetrigger).toBeDefined();
    expect(adminRetrigger?.preHandler).toBeDefined();

    const adminGetReturnRequest = routes.find((route) => route.url === '/api/v1/admin/return-requests/:id' && route.method === 'GET');
    expect(adminGetReturnRequest).toBeDefined();
    expect(adminGetReturnRequest?.preHandler).toBeDefined();

    const adminUpdateReturnRequest = routes.find((route) => route.url === '/api/v1/admin/return-requests/:id' && route.method === 'PATCH');
    expect(adminUpdateReturnRequest).toBeDefined();
    expect(adminUpdateReturnRequest?.preHandler).toBeDefined();

    const adminUpdateOrderItems = routes.find((route) => route.url === '/api/v1/admin/orders/:id/items' && route.method === 'PATCH');
    expect(adminUpdateOrderItems).toBeDefined();
    expect(adminUpdateOrderItems?.preHandler).toBeDefined();

    const adminListShipments = routes.find((route) => route.url === '/api/v1/admin/shipments' && route.method === 'GET');
    expect(adminListShipments).toBeDefined();
    expect(adminListShipments?.preHandler).toBeDefined();
    expect((adminListShipments?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    const adminListPayments = routes.find((route) => route.url === '/api/v1/admin/payments' && route.method === 'GET');
    expect(adminListPayments).toBeDefined();
    expect(adminListPayments?.preHandler).toBeDefined();
    expect((adminListPayments?.schema as { response?: Record<number, unknown> }).response?.[200]).toBeDefined();

    await app.close();
  });

  it('all admin write routes have idempotencyPreHandler in preHandler chain', async () => {
    const app = Fastify();
    app.decorate(
      'checkoutRisk',
      {
        assertInitiatePaymentAllowed: vi.fn(async () => undefined)
      } as never
    );

    const routes: Array<{ method: string | string[]; url: string; preHandler: unknown[] | undefined }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        preHandler: routeOptions.preHandler as unknown[] | undefined
      });
    });

    await registerOrdersRoutes(app);

    const writeRoutes = [
      { url: '/api/v1/admin/orders/:id/status', method: 'PATCH' },
      { url: '/api/v1/admin/orders/:id/ship', method: 'POST' },
      { url: '/api/v1/admin/orders/:id/cancel', method: 'POST' },
      { url: '/api/v1/admin/orders/:id/schedule-pickup', method: 'POST' },
      { url: '/api/v1/admin/orders/:id/print-label', method: 'POST' },
      { url: '/api/v1/admin/orders/:id/notifications/retrigger', method: 'POST' },
      { url: '/api/v1/admin/return-requests/:id', method: 'PATCH' },
      { url: '/api/v1/admin/orders/:id/items', method: 'PATCH' }
    ];

    for (const { url, method } of writeRoutes) {
      const route = routes.find((r) => r.url === url && r.method === method);
      expect(route, `route ${method} ${url} should be registered`).toBeDefined();
      expect(Array.isArray(route?.preHandler), `${method} ${url} should have preHandler array`).toBe(true);
      expect((route?.preHandler as unknown[]).length, `${method} ${url} should have ≥4 preHandlers`).toBeGreaterThanOrEqual(4);
    }

    await app.close();
  });
});
