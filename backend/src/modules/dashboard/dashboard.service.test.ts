import { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service';

function createDashboardServiceHarness() {
  const orderCountMock = vi.fn();
  const orderAggregateMock = vi.fn();
  const orderFindManyMock = vi.fn();
  const orderItemFindManyMock = vi.fn();
  const userCountMock = vi.fn();
  const transactionMock = vi.fn(async (operations: unknown[]) => Promise.all(operations as Promise<unknown>[]));

  const fastify = {
    prisma: {
      $transaction: transactionMock,
      order: {
        count: orderCountMock,
        aggregate: orderAggregateMock,
        findMany: orderFindManyMock
      },
      user: {
        count: userCountMock
      },
      orderItem: {
        findMany: orderItemFindManyMock
      }
    }
  } as unknown as FastifyInstance;

  return {
    service: new DashboardService(fastify),
    orderCountMock,
    orderAggregateMock,
    orderFindManyMock,
    orderItemFindManyMock,
    userCountMock
  };
}

describe('DashboardService date-window and empty-data behavior', () => {
  it('throws validation error when custom period misses dates', async () => {
    const { service } = createDashboardServiceHarness();

    await expect(service.getKpis({ period: 'custom' })).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('throws validation error when from is greater than to', async () => {
    const { service } = createDashboardServiceHarness();

    await expect(
      service.getKpis({
        period: '7d',
        from: '2026-04-26T12:00:00.000Z',
        to: '2026-04-25T12:00:00.000Z'
      })
    ).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('returns zeroed KPI payload for empty data', async () => {
    const { service, orderCountMock, orderAggregateMock, userCountMock } = createDashboardServiceHarness();
    orderCountMock.mockResolvedValue(0);
    orderAggregateMock.mockResolvedValue({ _sum: { total: null } });
    userCountMock.mockResolvedValue(0);

    const result = await service.getKpis({ period: '7d' });

    expect(result.ordersCount).toBe(0);
    expect(result.revenuePaise).toBe(0);
    expect(result.averageOrderValuePaise).toBe(0);
    expect(result.customersCount).toBe(0);
  });

  it('returns a zero bucket for every day when sales chart has no orders', async () => {
    const { service, orderFindManyMock } = createDashboardServiceHarness();
    orderFindManyMock.mockResolvedValue([]);

    const result = await service.getSalesChart({ granularity: 'day' });

    // Default window is 30 days back from now → 31 calendar-day buckets, all zero.
    expect(result.points.length).toBeGreaterThanOrEqual(30);
    expect(result.points.every((p) => p.ordersCount === 0 && p.revenuePaise === 0)).toBe(true);
  });

  it('returns empty items when top products has no matching order items', async () => {
    const { service, orderItemFindManyMock } = createDashboardServiceHarness();
    orderItemFindManyMock.mockResolvedValue([]);

    const result = await service.getTopProducts({ limit: 10 });

    expect(result.items).toEqual([]);
  });
});


describe('DashboardService action queue and status counts', () => {
  function harness() {
    const prisma = {
      order: { count: vi.fn(), groupBy: vi.fn() },
      returnRequest: { count: vi.fn() },
      review: { count: vi.fn() },
      inventory: { findMany: vi.fn() },
      cartReservation: { groupBy: vi.fn() }
    };
    return { prisma, service: new DashboardService({ prisma } as unknown as FastifyInstance) };
  }

  it('counts work waiting on the merchant, splitting stock by what is actually available', async () => {
    const { prisma, service } = harness();
    prisma.order.count.mockResolvedValueOnce(7).mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    prisma.returnRequest.count.mockResolvedValue(3);
    prisma.review.count.mockResolvedValue(4);
    prisma.inventory.findMany.mockResolvedValue([
      { variantId: 'a', quantity: 50, lowStockThreshold: 5 }, // healthy
      { variantId: 'b', quantity: 4, lowStockThreshold: 5 }, // low
      { variantId: 'c', quantity: 0, lowStockThreshold: 5 }, // out
      { variantId: 'd', quantity: 6, lowStockThreshold: 5 } // 6 on hand, 6 held in carts → out
    ]);
    prisma.cartReservation.groupBy.mockResolvedValue([{ variantId: 'd', _sum: { quantity: 6 } }]);

    const result = await service.getActionQueue();

    expect(result).toMatchObject({
      ordersToFulfil: 7,
      ordersProcessing: 5,
      ordersAwaitingPayment: 2,
      returnsToReview: 3,
      reviewsToModerate: 4,
      lowStockVariants: 1,
      outOfStockVariants: 2
    });
    expect(prisma.order.count).toHaveBeenNthCalledWith(1, { where: { status: 'CONFIRMED' } });
    expect(prisma.order.count).toHaveBeenNthCalledWith(2, { where: { status: 'PROCESSING' } });
    expect(prisma.returnRequest.count).toHaveBeenCalledWith({ where: { status: 'REQUESTED' } });
  });

  it('returns every status (zero-filled) for the window and the equal-length window before it', async () => {
    const { prisma, service } = harness();
    prisma.order.groupBy
      .mockResolvedValueOnce([
        { status: 'DELIVERED', _count: { _all: 5 } },
        { status: 'CONFIRMED', _count: { _all: 2 } }
      ])
      .mockResolvedValueOnce([{ status: 'DELIVERED', _count: { _all: 1 } }]);

    const result = await service.getOrderStatusCounts({
      from: '2026-10-08T00:00:00.000Z',
      to: '2026-10-14T23:59:59.999Z'
    });

    expect(result.current.total).toBe(7);
    expect(result.current.byStatus.DELIVERED).toBe(5);
    expect(result.current.byStatus.CANCELLED).toBe(0);
    expect(Object.keys(result.current.byStatus)).toHaveLength(9);
    expect(result.previous.total).toBe(1);
    expect(result.previousTo).toBe('2026-10-07T23:59:59.999Z');
    expect(result.previousFrom).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rejects an inverted range', async () => {
    const { service } = harness();
    await expect(
      service.getOrderStatusCounts({ from: '2026-10-14T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('DashboardService sales chart zero-fill', () => {
  it('emits a bucket for every day in range, including days with no orders', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { createdAt: new Date('2026-10-02T10:00:00.000Z'), total: 1000 },
      { createdAt: new Date('2026-10-04T10:00:00.000Z'), total: 2500 }
    ]);
    const service = new DashboardService({ prisma: { order: { findMany } } } as unknown as FastifyInstance);

    const result = await service.getSalesChart({
      granularity: 'day',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-05T23:59:59.000Z'
    });

    expect(result.points.map((p) => p.bucket)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05'
    ]);
    expect(result.points.map((p) => p.revenuePaise)).toEqual([0, 1000, 0, 2500, 0]);
  });
});
