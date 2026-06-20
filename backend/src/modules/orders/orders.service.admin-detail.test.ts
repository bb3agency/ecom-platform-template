import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

function makeShipmentFastify(shipmentResult: unknown = null): FastifyInstance {
  return {
    prisma: {
      shipment: { findUnique: vi.fn().mockResolvedValue(shipmentResult) }
    },
    redis: { scan: vi.fn().mockResolvedValue(['0', []]), del: vi.fn() },
    queues: { analytics: { add: vi.fn() } },
    log: { error: vi.fn(), info: vi.fn() },
    config: { PAYMENT_PROVIDER: 'razorpay' }
  } as unknown as FastifyInstance;
}

function makePaymentFastify(paymentResult: unknown = null): FastifyInstance {
  return {
    prisma: {
      payment: { findUnique: vi.fn().mockResolvedValue(paymentResult) }
    },
    redis: { scan: vi.fn().mockResolvedValue(['0', []]), del: vi.fn() },
    queues: { analytics: { add: vi.fn() } },
    log: { error: vi.fn(), info: vi.fn() },
    config: { PAYMENT_PROVIDER: 'razorpay' }
  } as unknown as FastifyInstance;
}

function makeTimelineFastify(orderResult: unknown = null): FastifyInstance {
  return {
    prisma: {
      order: { findUnique: vi.fn().mockResolvedValue(orderResult) }
    },
    redis: { scan: vi.fn().mockResolvedValue(['0', []]), del: vi.fn() },
    queues: { analytics: { add: vi.fn() } },
    log: { error: vi.fn(), info: vi.fn() },
    config: { PAYMENT_PROVIDER: 'razorpay' }
  } as unknown as FastifyInstance;
}

describe('OrdersService adminGetShipmentById', () => {
  it('throws 404 when shipment does not exist', async () => {
    const fastify = makeShipmentFastify(null);
    const service = new OrdersService(fastify);

    await expect(service.adminGetShipmentById('nonexistent')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('returns mapped shipment when found', async () => {
    const raw = {
      id: 'ship_1',
      orderId: 'order_1',
      order: { orderNumber: 'ORD-001', userId: 'user_1' },
      provider: 'SHIPROCKET',
      status: 'DELIVERED',
      awbNumber: 'AWB123',
      trackingUrl: 'https://track.example.com',
      shiprocketShipmentId: 'SR123',
      labelUrl: null,
      pickupScheduledDate: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z')
    };
    const fastify = makeShipmentFastify(raw);
    const service = new OrdersService(fastify);

    const result = await service.adminGetShipmentById('ship_1');

    expect(result).toMatchObject({
      id: 'ship_1',
      orderId: 'order_1',
      orderNumber: 'ORD-001',
      provider: 'SHIPROCKET',
      status: 'DELIVERED',
      awbNumber: 'AWB123'
    });
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('OrdersService adminGetPaymentById', () => {
  it('throws 404 when payment does not exist', async () => {
    const fastify = makePaymentFastify(null);
    const service = new OrdersService(fastify);

    await expect(service.adminGetPaymentById('nonexistent')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('returns mapped payment when found', async () => {
    const raw = {
      id: 'pay_1',
      orderId: 'order_1',
      order: { orderNumber: 'ORD-001' },
      provider: 'RAZORPAY',
      method: 'UPI',
      status: 'CAPTURED',
      amount: 50000,
      currency: 'INR',
      providerPaymentId: 'rzp_pay_1',
      providerOrderId: 'rzp_order_1',
      capturedAt: new Date('2026-01-01T12:00:00.000Z'),
      refundPendingAmountPaise: null,
      refundedAmountPaise: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T12:00:00.000Z')
    };
    const fastify = makePaymentFastify(raw);
    const service = new OrdersService(fastify);

    const result = await service.adminGetPaymentById('pay_1');

    expect(result).toMatchObject({
      id: 'pay_1',
      orderId: 'order_1',
      orderNumber: 'ORD-001',
      provider: 'RAZORPAY',
      status: 'CAPTURED',
      amount: 50000,
      currency: 'INR'
    });
    expect(result.capturedAt).toBe('2026-01-01T12:00:00.000Z');
  });
});

describe('OrdersService adminGetOrderTimeline', () => {
  it('throws 404 when order does not exist', async () => {
    const fastify = makeTimelineFastify(null);
    const service = new OrdersService(fastify);

    await expect(service.adminGetOrderTimeline('nonexistent')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('returns mapped timeline with empty events', async () => {
    const raw = {
      id: 'order_1',
      orderNumber: 'ORD-001',
      status: 'DELIVERED',
      statusHistory: []
    };
    const fastify = makeTimelineFastify(raw);
    const service = new OrdersService(fastify);

    const result = await service.adminGetOrderTimeline('order_1');

    expect(result).toMatchObject({
      orderId: 'order_1',
      orderNumber: 'ORD-001',
      currentStatus: 'DELIVERED',
      timeline: []
    });
  });

  it('maps status history entries correctly', async () => {
    const raw = {
      id: 'order_1',
      orderNumber: 'ORD-001',
      status: 'DELIVERED',
      statusHistory: [
        {
          id: 'hist_1',
          fromStatus: 'PENDING',
          toStatus: 'CONFIRMED',
          triggeredBy: 'admin_1',
          note: 'Manual confirm',
          createdAt: new Date('2026-01-01T10:00:00.000Z')
        }
      ]
    };
    const fastify = makeTimelineFastify(raw);
    const service = new OrdersService(fastify);

    const result = await service.adminGetOrderTimeline('order_1');

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]).toMatchObject({
      id: 'hist_1',
      fromStatus: 'PENDING',
      toStatus: 'CONFIRMED',
      triggeredBy: 'admin_1',
      note: 'Manual confirm'
    });
    expect(result.timeline[0]!.createdAt).toBe('2026-01-01T10:00:00.000Z');
  });
});
