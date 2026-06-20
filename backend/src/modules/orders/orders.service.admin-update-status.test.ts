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
});
