import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

function makeOrderFastify() {
  const orderFindMany = vi.fn().mockResolvedValue([]);
  const orderCount = vi.fn().mockResolvedValue(0);
  const fastify = {
    prisma: {
      order: { findMany: orderFindMany, count: orderCount },
      $transaction: vi.fn().mockResolvedValue([[], 0])
    }
  } as unknown as FastifyInstance;
  return { fastify, orderFindMany };
}

describe('OrdersService admin search filters', () => {
  it('filters by paymentMode=COD', async () => {
    const { fastify, orderFindMany } = makeOrderFastify();
    const service = new OrdersService(fastify);
    await service.adminListOrders({ paymentMode: 'COD' });
    const where = orderFindMany.mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(where.paymentMode).toBe('COD');
  });

  it('sorts ascending when sort=oldest', async () => {
    const { fastify, orderFindMany } = makeOrderFastify();
    const service = new OrdersService(fastify);
    await service.adminListOrders({ sort: 'oldest' });
    const orderBy = orderFindMany.mock.calls[0]?.[0].orderBy as Record<string, unknown>;
    expect(orderBy.createdAt).toBe('asc');
  });

  it('defaults to descending sort', async () => {
    const { fastify, orderFindMany } = makeOrderFastify();
    const service = new OrdersService(fastify);
    await service.adminListOrders({});
    const orderBy = orderFindMany.mock.calls[0]?.[0].orderBy as Record<string, unknown>;
    expect(orderBy.createdAt).toBe('desc');
  });

  it('includes customer first/last name in adminListOrders search filter', async () => {
    const orderFindMany = vi.fn().mockResolvedValue([]);
    const orderCount = vi.fn().mockResolvedValue(0);
    const fastify = {
      prisma: {
        order: {
          findMany: orderFindMany,
          count: orderCount
        },
        $transaction: vi.fn().mockResolvedValue([[], 0])
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    await service.adminListOrders({ search: 'asha' });

    const firstFindManyCall = orderFindMany.mock.calls[0];
    expect(firstFindManyCall).toBeDefined();
    if (!firstFindManyCall) {
      throw new Error('Expected findMany to be called');
    }
    const where = firstFindManyCall[0].where as { OR: Array<unknown> };
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { user: { firstName: { contains: 'asha', mode: 'insensitive' } } },
        { user: { lastName: { contains: 'asha', mode: 'insensitive' } } }
      ])
    );
  });

  it('includes customer first/last name in adminExportOrdersCsv search filter', async () => {
    const orderFindMany = vi.fn().mockResolvedValue([]);
    const fastify = {
      prisma: {
        order: {
          findMany: orderFindMany
        }
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    await service.adminExportOrdersCsv({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.999Z',
      search: 'reddy'
    });

    const firstFindManyCall = orderFindMany.mock.calls[0];
    expect(firstFindManyCall).toBeDefined();
    if (!firstFindManyCall) {
      throw new Error('Expected findMany to be called');
    }
    const where = firstFindManyCall[0].where as { OR: Array<unknown> };
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { user: { firstName: { contains: 'reddy', mode: 'insensitive' } } },
        { user: { lastName: { contains: 'reddy', mode: 'insensitive' } } }
      ])
    );
  });
});
