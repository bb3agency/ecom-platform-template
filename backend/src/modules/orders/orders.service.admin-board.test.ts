import { OrderStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OrdersService } from './orders.service';

function buildOrder(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'order_1',
    orderNumber: 'ORD-2026-00001',
    status: OrderStatus.CONFIRMED,
    paymentMode: 'PREPAID',
    total: 10000,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    user: { firstName: 'Test', lastName: 'User', phone: '9999999999' },
    shipment: null,
    ...overrides
  };
}

function buildFastify(orders: unknown[]) {
  return {
    prisma: {
      order: {
        findMany: vi.fn().mockResolvedValue(orders)
      }
    },
    log: { error: vi.fn() }
  } as unknown as FastifyInstance;
}

describe('OrdersService adminGetOrderBoard', () => {
  it('groups orders by status into columns', async () => {
    const orders = [
      buildOrder({ id: 'o1', status: OrderStatus.CONFIRMED }),
      buildOrder({ id: 'o2', status: OrderStatus.SHIPPED, shipment: { awbNumber: 'AWB001', labelUrl: 'https://label.url/1', status: 'BOOKED' } }),
      buildOrder({ id: 'o3', status: OrderStatus.DELIVERED, paymentMode: 'COD' })
    ];
    const fastify = buildFastify(orders);
    const service = new OrdersService(fastify);

    const result = await service.adminGetOrderBoard();

    expect(result.columns).toHaveProperty('CONFIRMED');
    expect(result.columns).toHaveProperty('PROCESSING');
    expect(result.columns).toHaveProperty('SHIPPED');
    expect(result.columns).toHaveProperty('OUT_FOR_DELIVERY');
    expect(result.columns).toHaveProperty('DELIVERED');
    expect(result.columns).toHaveProperty('CANCELLED');

    expect(result.columns.CONFIRMED).toHaveLength(1);
    expect(result.columns.CONFIRMED![0]).toMatchObject({ id: 'o1', status: 'CONFIRMED', paymentMode: 'PREPAID' });

    expect(result.columns.SHIPPED).toHaveLength(1);
    expect(result.columns.SHIPPED![0]).toMatchObject({
      id: 'o2',
      awbNumber: 'AWB001',
      labelUrl: 'https://label.url/1',
      shipmentStatus: 'BOOKED'
    });

    expect(result.columns.DELIVERED).toHaveLength(1);
    expect(result.columns.DELIVERED![0]).toMatchObject({ id: 'o3', paymentMode: 'COD' });
  });

  it('returns empty arrays for columns with no orders', async () => {
    const fastify = buildFastify([]);
    const service = new OrdersService(fastify);

    const result = await service.adminGetOrderBoard();

    expect(result.columns.CONFIRMED).toEqual([]);
    expect(result.columns.PROCESSING).toEqual([]);
    expect(result.columns.SHIPPED).toEqual([]);
  });

  it('includes awbNumber null and labelUrl null when no shipment', async () => {
    const fastify = buildFastify([buildOrder({ id: 'o1', status: OrderStatus.CONFIRMED })]);
    const service = new OrdersService(fastify);

    const result = await service.adminGetOrderBoard();

    expect(result.columns.CONFIRMED![0]).toMatchObject({
      awbNumber: null,
      labelUrl: null,
      shipmentStatus: null
    });
  });

  it('caps each column at 100 orders', async () => {
    const orders = Array.from({ length: 150 }, (_, i) =>
      buildOrder({ id: `o${i}`, status: OrderStatus.CONFIRMED })
    );
    const fastify = buildFastify(orders);
    const service = new OrdersService(fastify);

    const result = await service.adminGetOrderBoard();

    expect(result.columns.CONFIRMED).toHaveLength(100);
  });

  it('formats createdAt as ISO string', async () => {
    const date = new Date('2026-05-01T12:00:00.000Z');
    const fastify = buildFastify([buildOrder({ id: 'o1', status: OrderStatus.CONFIRMED, createdAt: date })]);
    const service = new OrdersService(fastify);

    const result = await service.adminGetOrderBoard();

    expect(result.columns.CONFIRMED![0]!.createdAt).toBe(date.toISOString());
  });

  it('builds customerName from firstName and lastName', async () => {
    const fastify = buildFastify([
      buildOrder({ id: 'o1', status: OrderStatus.CONFIRMED, user: { firstName: 'John', lastName: 'Doe', phone: '9876543210' } })
    ]);
    const service = new OrdersService(fastify);

    const result = await service.adminGetOrderBoard();

    expect(result.columns.CONFIRMED![0]!.customerName).toBe('John Doe');
  });
});
