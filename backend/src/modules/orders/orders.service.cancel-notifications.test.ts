import { OrderStatus, PaymentStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OrdersService } from './orders.service';

function buildSerializedOrderSource(overrides?: Partial<Record<string, unknown>>) {
  const now = new Date();
  return {
    id: 'order_1',
    orderNumber: 'ORD-2026-00001',
    userId: 'user_1',
    status: OrderStatus.CANCELLED,
    shippingAddress: {
      fullName: 'Test User',
      phone: '9999999999',
      line1: 'Line 1',
      city: 'City',
      state: 'State',
      pincode: '560001'
    },
    subtotal: 10000,
    shippingCharge: 0,
    discountAmount: 0,
    total: 10000,
    notes: null,
    createdAt: now,
    updatedAt: now,
    user: {
      email: 'customer@example.com',
      phone: '9999999999'
    },
    items: [],
    statusHistory: [],
    payment: null,
    shipment: null,
    ...overrides
  };
}

describe('OrdersService cancellation notification enqueue', () => {
  it('enqueues OrderCancelled primary notification for customer cancellation', async () => {
    const notificationsAdd = vi.fn().mockResolvedValue(undefined);
    const orderProcessingAdd = vi.fn().mockResolvedValue(undefined);
    const tx = {
      order: {
        findFirst: vi.fn().mockResolvedValue(
          buildSerializedOrderSource({
            status: OrderStatus.CONFIRMED,
            items: [{ variantId: 'variant_1', quantity: 1 }]
          })
        ),
        update: vi.fn().mockResolvedValue({ id: 'order_1' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(buildSerializedOrderSource())
      },
      orderStatusHistory: {
        create: vi.fn().mockResolvedValue(undefined)
      },
      inventory: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      couponUsage: {
        findMany: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined)
      }
    };

    const fastify = {
      prisma: {
        $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx)),
        order: {
          findUnique: vi.fn().mockResolvedValue({ orderNumber: 'ORD-2026-00001' })
        }
      },
      queues: {
        notifications: {
          add: notificationsAdd
        },
        orderProcessing: {
          add: orderProcessingAdd
        }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    await service.cancelMyOrder('user_1', 'order_1');

    expect(notificationsAdd).toHaveBeenCalledWith(
      'send-primary',
      expect.objectContaining({
        email: 'customer@example.com',
        phone: '9999999999',
        template: 'OrderCancelled',
        data: { orderId: 'order_1', orderNumber: 'ORD-2026-00001' }
      }),
      expect.objectContaining({
        jobId: 'notifications-primary-order_1-OrderCancelled'
      })
    );
    expect(orderProcessingAdd).not.toHaveBeenCalled();
  });

  it('does not restore inventory when cancelling COD order before worker side effects complete', async () => {
    const notificationsAdd = vi.fn().mockResolvedValue(undefined);
    const tx = {
      order: {
        findFirst: vi.fn().mockResolvedValue(
          buildSerializedOrderSource({
            status: OrderStatus.CONFIRMED,
            paymentMode: 'COD',
            items: [{ variantId: 'variant_1', quantity: 1 }],
            statusHistory: [{ triggeredBy: 'SYSTEM', createdAt: new Date() }]
          })
        ),
        update: vi.fn().mockResolvedValue({ id: 'order_1' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(buildSerializedOrderSource())
      },
      orderStatusHistory: {
        create: vi.fn().mockResolvedValue(undefined),
        findFirst: vi.fn().mockResolvedValue(null)
      },
      inventory: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      couponUsage: {
        findMany: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined)
      }
    };

    const fastify = {
      prisma: {
        $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx))
      },
      queues: {
        notifications: { add: notificationsAdd },
        orderProcessing: { add: vi.fn() },
        shipping: { add: vi.fn() }
      },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    await service.cancelMyOrder('user_1', 'order_1');

    expect(tx.inventory.updateMany).not.toHaveBeenCalled();
  });

  it('enqueues OrderCancelled notifications and refund job for admin refund path', async () => {
    const notificationsAdd = vi.fn().mockResolvedValue(undefined);
    const orderProcessingAdd = vi.fn().mockResolvedValue(undefined);
    const refundsAdd = vi.fn().mockResolvedValue(undefined);
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(
          buildSerializedOrderSource({
            status: OrderStatus.PROCESSING,
            items: [{ variantId: 'variant_1', quantity: 1 }],
            payment: {
              id: 'payment_1',
              status: PaymentStatus.CAPTURED,
              providerPaymentId: 'pay_1',
              amount: 10000
            }
          })
        ),
        update: vi.fn().mockResolvedValue(undefined),
        findUniqueOrThrow: vi.fn().mockResolvedValue(
          buildSerializedOrderSource({
            status: OrderStatus.CANCELLED,
            statusHistory: [
              {
                id: 'hist_1',
                fromStatus: OrderStatus.PROCESSING,
                toStatus: OrderStatus.CANCELLED,
                note: 'Cancelled by admin',
                createdAt: new Date('2026-04-26T00:00:00.000Z')
              }
            ],
            payment: {
              id: 'payment_1',
              provider: 'RAZORPAY',
              providerOrderId: 'order_1',
              providerPaymentId: 'pay_1',
              amount: 10000,
              status: 'REFUNDED',
              method: null
            }
          })
        )
      },
      payment: {
        update: vi.fn().mockResolvedValue(undefined)
      },
      orderStatusHistory: {
        create: vi.fn().mockResolvedValue(undefined)
      },
      inventory: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      couponUsage: {
        findMany: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined)
      }
    };

    const fastify = {
      prisma: {
        $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx)),
        order: {
          findUnique: vi.fn().mockResolvedValue({ orderNumber: 'ORD-2026-00001' })
        }
      },
      queues: {
        notifications: {
          add: notificationsAdd
        },
        refunds: {
          add: refundsAdd
        },
        orderProcessing: {
          add: orderProcessingAdd
        }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    (service as unknown as { razorpayAdapter: { initiateRefund: (input: unknown) => Promise<unknown> } }).razorpayAdapter = {
      initiateRefund: vi.fn().mockResolvedValue({ refundId: 'rfnd_1' })
    };
    const result = await service.adminCancelOrder('order_1');

    expect(notificationsAdd).toHaveBeenCalledWith(
      'send-primary',
      expect.objectContaining({
        email: 'customer@example.com',
        phone: '9999999999',
        template: 'OrderCancelled',
        data: { orderId: 'order_1', orderNumber: 'ORD-2026-00001' }
      }),
      expect.objectContaining({
        jobId: 'notifications-primary-order_1-OrderCancelled'
      })
    );
    expect(orderProcessingAdd).not.toHaveBeenCalled();
    expect(refundsAdd).toHaveBeenCalledWith(
      'initiate-razorpay-refund',
      expect.objectContaining({
        orderId: 'order_1',
        reason: 'Order cancelled and refunded by admin'
      }),
      expect.objectContaining({
        jobId: 'initiate-razorpay-refund-order_1-full-cancelled'
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: OrderStatus.CANCELLED,
        creditNotes: []
      })
    );
  });

  it('rejects admin cancellation when order is pending payment', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(
          buildSerializedOrderSource({
            status: OrderStatus.PENDING_PAYMENT,
            payment: null
          })
        )
      }
    };

    const fastify = {
      prisma: {
        $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx))
      },
      queues: {
        notifications: { add: vi.fn() },
        refunds: { add: vi.fn() },
        orderProcessing: { add: vi.fn() }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    await expect(service.adminCancelOrder('order_1')).rejects.toMatchObject({
      statusCode: 409
    });
  });
});
