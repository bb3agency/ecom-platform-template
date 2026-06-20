import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OrdersService } from './orders.service';

function makeFastify(order: Record<string, unknown> | null): FastifyInstance {
  const inventoryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const orderItemUpdate = vi
    .fn()
    .mockImplementation(async ({ where, data }: { where: { id: string }; data: { quantity: number; totalPrice: number } }) =>
      Promise.resolve({
        id: where.id,
        quantity: data.quantity,
        unitPrice: 10000,
        totalPrice: data.totalPrice
      })
    );
  const orderUpdate = vi.fn().mockResolvedValue(order);
  const historyCreate = vi.fn().mockResolvedValue({});

  return {
    prisma: {
      order: {
        findUnique: vi.fn().mockResolvedValue(order),
        update: orderUpdate
      },
      orderItem: {
        update: orderItemUpdate
      },
      inventory: {
        updateMany: inventoryUpdateMany
      },
      orderStatusHistory: {
        create: historyCreate
      },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          inventory: { updateMany: inventoryUpdateMany },
          orderItem: { update: orderItemUpdate },
          order: { update: orderUpdate },
          orderStatusHistory: { create: historyCreate }
        })
      )
    },
    config: {},
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
  } as unknown as FastifyInstance;
}

describe('OrdersService adminUpdateOrderItems', () => {
  it('throws 404 when order does not exist', async () => {
    const fastify = makeFastify(null);
    const service = new OrdersService(fastify);

    await expect(
      service.adminUpdateOrderItems('admin_1', 'nonexistent', [{ orderItemId: 'item_1', quantity: 2 }])
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 409 when order status is not patchable (e.g. DELIVERED)', async () => {
    const order = {
      id: 'order_1',
      status: 'DELIVERED',
      subtotal: 10000,
      shippingCharge: 0,
      discountAmount: 0,
      items: [{ id: 'item_1', variantId: 'variant_1', quantity: 1, unitPrice: 10000, totalPrice: 10000 }]
    };
    const fastify = makeFastify(order);
    const service = new OrdersService(fastify);

    await expect(
      service.adminUpdateOrderItems('admin_1', 'order_1', [{ orderItemId: 'item_1', quantity: 2 }])
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('throws 400 when none of the provided item IDs match order items', async () => {
    const order = {
      id: 'order_1',
      status: 'CONFIRMED',
      subtotal: 10000,
      shippingCharge: 0,
      discountAmount: 0,
      items: [{ id: 'item_1', variantId: 'variant_1', quantity: 1, unitPrice: 10000, totalPrice: 10000 }]
    };
    const fastify = makeFastify(order);
    const service = new OrdersService(fastify);

    await expect(
      service.adminUpdateOrderItems('admin_1', 'order_1', [{ orderItemId: 'item_WRONG', quantity: 2 }])
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('recalculates subtotal and total correctly for CONFIRMED order', async () => {
    const order = {
      id: 'order_1',
      status: 'CONFIRMED',
      subtotal: 10000,
      shippingCharge: 5000,
      discountAmount: 1000,
      items: [{ id: 'item_1', variantId: 'variant_1', quantity: 1, unitPrice: 10000, totalPrice: 10000 }]
    };
    const fastify = makeFastify(order);
    const service = new OrdersService(fastify);
    const result = await service.adminUpdateOrderItems('admin_1', 'order_1', [{ orderItemId: 'item_1', quantity: 2 }]);

    expect(result.subtotal).toBe(20000);
    expect(result.total).toBe(24000);
    expect(fastify.prisma.inventory.updateMany).toHaveBeenCalledWith({
      where: { variantId: 'variant_1', quantity: { gte: 1 } },
      data: { quantity: { decrement: 1 } }
    });
  });

  it('restores inventory when reducing quantity on CONFIRMED order', async () => {
    const order = {
      id: 'order_1',
      status: 'CONFIRMED',
      subtotal: 20000,
      shippingCharge: 0,
      discountAmount: 0,
      items: [{ id: 'item_1', variantId: 'variant_1', quantity: 2, unitPrice: 10000, totalPrice: 20000 }]
    };
    const fastify = makeFastify(order);
    const service = new OrdersService(fastify);

    await service.adminUpdateOrderItems('admin_1', 'order_1', [{ orderItemId: 'item_1', quantity: 1 }]);

    expect(fastify.prisma.inventory.updateMany).toHaveBeenCalledWith({
      where: { variantId: 'variant_1' },
      data: { quantity: { increment: 1 } }
    });
  });

  it('works with PENDING_PAYMENT status without inventory changes', async () => {
    const order = {
      id: 'order_2',
      status: 'PENDING_PAYMENT',
      subtotal: 5000,
      shippingCharge: 0,
      discountAmount: 0,
      items: [{ id: 'item_2', variantId: 'variant_2', quantity: 1, unitPrice: 5000, totalPrice: 5000 }]
    };
    const fastify = makeFastify(order);
    const service = new OrdersService(fastify);
    const result = await service.adminUpdateOrderItems('admin_1', 'order_2', [{ orderItemId: 'item_2', quantity: 3 }]);

    expect(result.subtotal).toBe(15000);
    expect(result.total).toBe(15000);
    expect(fastify.prisma.inventory.updateMany).not.toHaveBeenCalled();
  });
});
