import { OrderStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { OrdersService } from './orders.service';

describe('OrdersService adminUpdateOrderStatus', () => {
  it('rejects manual pending payment to confirmed transition', async () => {
    const existingOrder = {
      id: 'order_1',
      orderNumber: 'ORD-2026-00001',
      userId: 'user_1',
      status: OrderStatus.PENDING_PAYMENT,
      shippingAddress: {
        fullName: 'Test User',
        phone: '9999999999',
        line1: 'Line 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      subtotal: 10000,
      shippingCharge: 0,
      discountAmount: 0,
      total: 10000,
      notes: null,
      createdAt: new Date('2026-04-27T00:00:00.000Z'),
      updatedAt: new Date('2026-04-27T00:00:00.000Z'),
      items: [],
      payment: null,
      invoice: null,
      shipment: null,
      statusHistory: []
    };

    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(existingOrder),
        update: vi.fn(),
        findUniqueOrThrow: vi.fn()
      },
      orderStatusHistory: {
        create: vi.fn()
      },
      inventory: {
        updateMany: vi.fn()
      }
    };

    const fastify = {
      prisma: {
        $transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx))
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    await expect(service.adminUpdateOrderStatus('order_1', { status: OrderStatus.CONFIRMED })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_STATUS_TRANSITION,
      statusCode: 409
    } satisfies Partial<AppError>);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  // Regression: a courier order was manually advanced to SHIPPED from the status
  // dropdown. The shipping worker skips anything already SHIPPED, so no AWB could ever
  // be booked, "Print label" failed, and the customer got a shipped notification with no
  // tracking. The manual path must refuse to fake fulfilment for a courier order.
  function buildOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'order_1',
      orderNumber: 'ORD-2026-00002',
      userId: 'user_1',
      status: OrderStatus.PROCESSING,
      shippingAddress: {
        fullName: 'Test User',
        phone: '9999999999',
        line1: 'Line 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      subtotal: 10000,
      shippingCharge: 0,
      discountAmount: 0,
      total: 10000,
      notes: null,
      createdAt: new Date('2026-04-27T00:00:00.000Z'),
      updatedAt: new Date('2026-04-27T00:00:00.000Z'),
      items: [],
      payment: null,
      invoice: null,
      shipment: null,
      statusHistory: [],
      selectedShippingProvider: 'SHIPROCKET',
      ...overrides
    };
  }

  function buildHarness(existingOrder: Record<string, unknown>) {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(existingOrder),
        update: vi.fn().mockResolvedValue({ ...existingOrder, status: OrderStatus.SHIPPED }),
        // The service re-reads the order at the end of the transaction and returns it.
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...existingOrder,
          status: OrderStatus.SHIPPED,
          items: [],
          payment: null,
          invoice: null,
          statusHistory: [],
          couponUsages: [],
          user: { firstName: 'Test', lastName: 'User', email: 't@example.com', phone: '9999999999' }
        })
      },
      orderStatusHistory: { create: vi.fn() },
      inventory: { updateMany: vi.fn() },
      outboxMessage: { create: vi.fn() }
    };
    const fastify = {
      prisma: {
        $transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)),
        outboxMessage: { create: vi.fn() }
      }
    } as unknown as FastifyInstance;
    return { tx, service: new OrdersService(fastify) };
  }

  it('refuses to mark a courier order shipped by hand when no AWB has been booked', async () => {
    const { tx, service } = buildHarness(buildOrder());

    await expect(
      service.adminUpdateOrderStatus('order_1', { status: OrderStatus.SHIPPED })
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_STATUS_TRANSITION,
      statusCode: 409
    } satisfies Partial<AppError>);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('refuses a manual jump to DELIVERED on a courier order with no AWB', async () => {
    const { tx, service } = buildHarness(buildOrder());

    await expect(
      service.adminUpdateOrderStatus('order_1', { status: OrderStatus.DELIVERED })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('still allows manual fulfilment for local delivery orders, which never book a courier', async () => {
    const { tx, service } = buildHarness(
      buildOrder({ selectedShippingProvider: 'LOCAL' })
    );

    await service.adminUpdateOrderStatus('order_1', { status: OrderStatus.SHIPPED });
    expect(tx.order.update).toHaveBeenCalled();
  });

  // Previously this allowed a manual advance as soon as an AWB existed. That is what let
  // an order be marked "out for delivery" while the parcel was still with the merchant:
  // the customer was told it was on its way, and the order moved past the point where it
  // could be cancelled. On a courier order these stages belong to the courier.
  it('refuses a manual advance even once a courier AWB exists', async () => {
    const { tx, service } = buildHarness(
      buildOrder({
        status: OrderStatus.SHIPPED,
        shipment: { awbNumber: 'AWB123', status: 'BOOKED' }
      })
    );

    await expect(
      service.adminUpdateOrderStatus('order_1', { status: OrderStatus.OUT_FOR_DELIVERY })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('still allows local delivery to be advanced through its own stages', async () => {
    const { tx, service } = buildHarness(
      buildOrder({ status: OrderStatus.PROCESSING, selectedShippingProvider: 'LOCAL' })
    );

    await service.adminUpdateOrderStatus('order_1', { status: OrderStatus.OUT_FOR_DELIVERY });
    expect(tx.order.update).toHaveBeenCalled();
  });
});
