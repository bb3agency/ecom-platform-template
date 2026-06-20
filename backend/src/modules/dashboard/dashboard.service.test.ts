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

  it('returns empty points when sales chart has no orders', async () => {
    const { service, orderFindManyMock } = createDashboardServiceHarness();
    orderFindManyMock.mockResolvedValue([]);

    const result = await service.getSalesChart({ granularity: 'day' });

    expect(result.points).toEqual([]);
  });

  it('returns empty items when top products has no matching order items', async () => {
    const { service, orderItemFindManyMock } = createDashboardServiceHarness();
    orderItemFindManyMock.mockResolvedValue([]);

    const result = await service.getTopProducts({ limit: 10 });

    expect(result.items).toEqual([]);
  });
});

