import { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from './analytics.service';

function createAnalyticsServiceHarness() {
  const orderFindManyMock = vi.fn();
  const analyticsQueryRawMock = vi.fn();
  const inventoryFindManyMock = vi.fn();
  const cartReservationGroupByMock = vi.fn().mockResolvedValue([]);
  const notificationGroupByMock = vi.fn();

  const fastify = {
    prisma: {
      order: {
        findMany: orderFindManyMock
      },
      // getFunnel uses $queryRaw for COUNT(DISTINCT sessionId)
      $queryRaw: analyticsQueryRawMock,
      inventory: {
        findMany: inventoryFindManyMock
      },
      cartReservation: {
        groupBy: cartReservationGroupByMock
      },
      notificationLog: {
        groupBy: notificationGroupByMock
      }
    }
  } as unknown as FastifyInstance;

  return {
    service: new AnalyticsService(fastify),
    orderFindManyMock,
    analyticsQueryRawMock,
    inventoryFindManyMock,
    cartReservationGroupByMock,
    notificationGroupByMock
  };
}

describe('AnalyticsService date-window and empty-data behavior', () => {
  it('throws validation error when date range is invalid', async () => {
    const { service } = createAnalyticsServiceHarness();

    await expect(
      service.getRevenue({
        from: '2026-04-27T00:00:00.000Z',
        to: '2026-04-26T00:00:00.000Z',
        granularity: 'day'
      })
    ).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('returns empty revenue points for no orders', async () => {
    const { service, orderFindManyMock } = createAnalyticsServiceHarness();
    orderFindManyMock.mockResolvedValue([]);

    const result = await service.getRevenue({ granularity: 'day' });

    expect(result.points).toEqual([]);
  });

  it('buckets revenue correctly at UTC hour boundaries', async () => {
    const { service, orderFindManyMock } = createAnalyticsServiceHarness();
    orderFindManyMock.mockResolvedValue([
      {
        createdAt: new Date('2026-04-26T10:59:59.000Z'),
        total: 1000
      },
      {
        createdAt: new Date('2026-04-26T11:00:00.000Z'),
        total: 2000
      },
      {
        createdAt: new Date('2026-04-26T11:10:00.000Z'),
        total: 500
      }
    ]);

    const result = await service.getRevenue({ granularity: 'hour' });

    expect(result.points).toEqual([
      { bucket: '2026-04-26T10', revenuePaise: 1000, ordersCount: 1 },
      { bucket: '2026-04-26T11', revenuePaise: 2500, ordersCount: 2 }
    ]);
  });

  it('buckets revenue week granularity using monday UTC start', async () => {
    const { service, orderFindManyMock } = createAnalyticsServiceHarness();
    orderFindManyMock.mockResolvedValue([
      {
        createdAt: new Date('2026-04-26T12:00:00.000Z'),
        total: 1000
      },
      {
        createdAt: new Date('2026-04-27T01:00:00.000Z'),
        total: 2000
      }
    ]);

    const result = await service.getRevenue({ granularity: 'week' });

    expect(result.points).toEqual([
      { bucket: '2026-04-20', revenuePaise: 1000, ordersCount: 1 },
      { bucket: '2026-04-27', revenuePaise: 2000, ordersCount: 1 }
    ]);
  });

  it('returns zeroed funnel conversion when no events exist', async () => {
    const { service, analyticsQueryRawMock } = createAnalyticsServiceHarness();
    analyticsQueryRawMock.mockResolvedValue([]);

    const result = await service.getFunnel({});

    expect(result.steps).toHaveLength(5);
    for (const step of result.steps) {
      expect(step.count).toBe(0);
      expect(step.conversionRatePercent).toBe(0);
    }
  });

  it('deduplicates sessions in funnel — repeated actions by same session count once', async () => {
    const { service, analyticsQueryRawMock } = createAnalyticsServiceHarness();
    // Simulate: 10 unique sessions viewed product, 7 added to cart, 5 started checkout,
    // 3 began payment (some retried but same session deduped), 2 completed purchase
    analyticsQueryRawMock.mockResolvedValue([
      { event_type: 'PRODUCT_VIEW', unique_sessions: BigInt(10) },
      { event_type: 'ADD_TO_CART', unique_sessions: BigInt(7) },
      { event_type: 'CHECKOUT_STARTED', unique_sessions: BigInt(5) },
      { event_type: 'PAYMENT_INITIATED', unique_sessions: BigInt(3) },
      { event_type: 'PURCHASE', unique_sessions: BigInt(2) }
    ]);

    const result = await service.getFunnel({});

    expect(result.steps[0]).toMatchObject({ eventType: 'PRODUCT_VIEW', count: 10, conversionRatePercent: 100 });
    expect(result.steps[1]).toMatchObject({ eventType: 'ADD_TO_CART', count: 7, conversionRatePercent: 70 });
    expect(result.steps[2]).toMatchObject({ eventType: 'CHECKOUT_STARTED', count: 5, conversionRatePercent: 50 });
    expect(result.steps[3]).toMatchObject({ eventType: 'PAYMENT_INITIATED', count: 3, conversionRatePercent: 30 });
    expect(result.steps[4]).toMatchObject({ eventType: 'PURCHASE', count: 2, conversionRatePercent: 20 });

    // All steps must be <= previous step (monotonic funnel)
    for (let i = 1; i < result.steps.length; i++) {
      expect(result.steps[i]!.count).toBeLessThanOrEqual(result.steps[i - 1]!.count);
    }
  });

  it('reports only variants currently at/below threshold from live inventory (not the alert log)', async () => {
    const { service, inventoryFindManyMock, cartReservationGroupByMock } = createAnalyticsServiceHarness();
    // GK is restocked to 100 (must NOT appear); SK sits at 3 available (must appear).
    inventoryFindManyMock.mockResolvedValue([
      {
        variantId: 'v_sk',
        quantity: 3,
        lowStockThreshold: 5,
        updatedAt: new Date('2026-07-10T00:00:00.000Z'),
        variant: { name: '250gms', sku: 'SK250', product: { name: 'Sambar Kaaram' } }
      },
      {
        variantId: 'v_gk',
        quantity: 100,
        lowStockThreshold: 5,
        updatedAt: new Date('2026-07-10T00:00:00.000Z'),
        variant: { name: '250gms', sku: 'GK250', product: { name: 'Goddu Kaaram' } }
      }
    ]);
    cartReservationGroupByMock.mockResolvedValue([]);

    const result = await service.getInventoryAlerts();

    expect(result.items).toEqual([
      {
        variantId: 'v_sk',
        sku: 'SK250',
        variantName: '250gms',
        quantity: 3,
        lowStockThreshold: 5,
        productName: 'Sambar Kaaram',
        occurredAt: '2026-07-10T00:00:00.000Z'
      }
    ]);
  });

  it('subtracts active reservations when deciding low-stock (available, not on-hand)', async () => {
    const { service, inventoryFindManyMock, cartReservationGroupByMock } = createAnalyticsServiceHarness();
    inventoryFindManyMock.mockResolvedValue([
      {
        variantId: 'v1',
        quantity: 8,
        lowStockThreshold: 5,
        updatedAt: new Date('2026-07-10T00:00:00.000Z'),
        variant: { name: 'Default', sku: 'SKU1', product: { name: 'Test' } }
      }
    ]);
    cartReservationGroupByMock.mockResolvedValue([{ variantId: 'v1', _sum: { quantity: 5 } }]);

    const result = await service.getInventoryAlerts();
    // 8 on-hand − 5 reserved = 3 available ≤ 5 threshold → alert.
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.quantity).toBe(3);
  });

  it('returns empty channels when notification logs are absent', async () => {
    const { service, notificationGroupByMock } = createAnalyticsServiceHarness();
    notificationGroupByMock.mockResolvedValue([]);

    const result = await service.getNotificationDeliveryStats({});

    expect(result.channels).toEqual([]);
  });

  it('returns category revenue breakdown with share percentages', async () => {
    const { service, orderFindManyMock } = createAnalyticsServiceHarness();
    orderFindManyMock.mockResolvedValue([
      {
        items: [
          {
            totalPrice: 700,
            variant: {
              product: {
                categoryId: 'cat_1',
                category: { name: 'Snacks' }
              }
            }
          },
          {
            totalPrice: 300,
            variant: {
              product: {
                categoryId: 'cat_2',
                category: { name: 'Beverages' }
              }
            }
          }
        ]
      }
    ]);

    const result = await service.getCategoryBreakdown({});

    expect(result.items).toEqual([
      { categoryId: 'cat_1', categoryName: 'Snacks', revenuePaise: 700, sharePercent: 70 },
      { categoryId: 'cat_2', categoryName: 'Beverages', revenuePaise: 300, sharePercent: 30 }
    ]);
  });

  it('exports revenue report as CSV', async () => {
    const { service, orderFindManyMock } = createAnalyticsServiceHarness();
    orderFindManyMock.mockResolvedValue([
      {
        createdAt: new Date('2026-04-26T10:00:00.000Z'),
        total: 1000
      }
    ]);

    const csv = await service.exportRevenueCsv({ granularity: 'day' });
    expect(csv).toContain('"bucket","ordersCount","revenuePaise"');
    expect(csv).toContain('"2026-04-26","1","1000"');
  });
});

