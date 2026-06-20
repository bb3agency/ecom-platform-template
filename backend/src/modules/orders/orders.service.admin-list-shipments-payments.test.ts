import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

function makeFastify(itemsResult: unknown[] = [], totalResult = 0): FastifyInstance {
  const shipmentFindMany = vi.fn().mockResolvedValue(itemsResult);
  const shipmentCount = vi.fn().mockResolvedValue(totalResult);
  const paymentFindMany = vi.fn().mockResolvedValue(itemsResult);
  const paymentCount = vi.fn().mockResolvedValue(totalResult);

  return {
    prisma: {
      $transaction: vi.fn().mockImplementation(async (ops: Array<Promise<unknown>>) => {
        return Promise.all(ops);
      }),
      shipment: { findMany: shipmentFindMany, count: shipmentCount },
      payment: { findMany: paymentFindMany, count: paymentCount }
    },
    redis: { scan: vi.fn().mockResolvedValue(['0', []]), del: vi.fn().mockResolvedValue(0) },
    queues: { analytics: { add: vi.fn() } },
    log: { error: vi.fn(), info: vi.fn() },
    config: { PAYMENT_PROVIDER: 'razorpay' }
  } as unknown as FastifyInstance;
}

describe('OrdersService adminListShipments', () => {
  it('returns paginated empty list when no shipments exist', async () => {
    const fastify = makeFastify();
    const service = new OrdersService(fastify);

    const result = await service.adminListShipments({});

    expect(result.items).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(20);
  });

  it('passes status filter to Prisma query', async () => {
    const fastify = makeFastify();
    const service = new OrdersService(fastify);

    await service.adminListShipments({ status: 'DELIVERED' as never });

    const shipmentFindMany = (fastify.prisma.shipment as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany;
    expect(shipmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'DELIVERED' }) })
    );
  });

  it('passes search filter for AWB and order number', async () => {
    const fastify = makeFastify();
    const service = new OrdersService(fastify);

    await service.adminListShipments({ search: 'AWB123' });

    const shipmentFindMany = (fastify.prisma.shipment as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany;
    expect(shipmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { awbNumber: { contains: 'AWB123', mode: 'insensitive' } },
            { order: { orderNumber: { contains: 'AWB123', mode: 'insensitive' } } }
          ]
        })
      })
    );
  });

  it('respects pagination parameters', async () => {
    const fastify = makeFastify([], 50);
    const service = new OrdersService(fastify);

    const result = await service.adminListShipments({ page: 2, limit: 10 });

    expect(result.meta.page).toBe(2);
    expect(result.meta.limit).toBe(10);
    expect(result.meta.total).toBe(50);
    expect(result.meta.totalPages).toBe(5);

    const shipmentFindMany = (fastify.prisma.shipment as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany;
    expect(shipmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });
});

describe('OrdersService adminListPayments', () => {
  it('returns paginated empty list when no payments exist', async () => {
    const fastify = makeFastify();
    const service = new OrdersService(fastify);

    const result = await service.adminListPayments({});

    expect(result.items).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.page).toBe(1);
  });

  it('passes status filter to Prisma query', async () => {
    const fastify = makeFastify();
    const service = new OrdersService(fastify);

    await service.adminListPayments({ status: 'CAPTURED' as never });

    const paymentFindMany = (fastify.prisma.payment as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany;
    expect(paymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'CAPTURED' }) })
    );
  });

  it('passes search filter for order number and provider payment ID', async () => {
    const fastify = makeFastify();
    const service = new OrdersService(fastify);

    await service.adminListPayments({ search: 'pay_abc123' });

    const paymentFindMany = (fastify.prisma.payment as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany;
    expect(paymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { providerPaymentId: { contains: 'pay_abc123', mode: 'insensitive' } },
            { order: { orderNumber: { contains: 'pay_abc123', mode: 'insensitive' } } },
            { order: { user: { firstName: { contains: 'pay_abc123', mode: 'insensitive' } } } },
            { order: { user: { lastName: { contains: 'pay_abc123', mode: 'insensitive' } } } },
            { order: { user: { email: { contains: 'pay_abc123', mode: 'insensitive' } } } }
          ]
        })
      })
    );
  });

  it('caps limit at 100', async () => {
    const fastify = makeFastify();
    const service = new OrdersService(fastify);

    await service.adminListPayments({ limit: 9999 });

    const paymentFindMany = (fastify.prisma.payment as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany;
    expect(paymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });
});
