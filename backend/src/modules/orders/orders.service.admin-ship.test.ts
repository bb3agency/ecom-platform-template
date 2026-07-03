import { OrderStatus, PaymentStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OrdersService } from './orders.service';

function buildOrder(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'order_1',
    orderNumber: 'ORD-2026-00001',
    userId: 'user_1',
    status: OrderStatus.PROCESSING,
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
    createdAt: new Date('2026-04-26T00:00:00.000Z'),
    updatedAt: new Date('2026-04-26T00:00:00.000Z'),
    items: [
      {
        id: 'order_item_1',
        variantId: 'variant_1',
        quantity: 1
      }
    ],
    statusHistory: [],
    payment: {
      id: 'payment_1',
      provider: 'RAZORPAY',
      providerOrderId: 'order_provider_1',
      providerPaymentId: 'pay_1',
      amount: 10000,
      status: PaymentStatus.CAPTURED,
      method: null
    },
    shipment: null,
    ...overrides
  };
}

describe('OrdersService admin ship enqueue', () => {
  it('enqueues create-shipment and merchant primary notification', async () => {
    const shippingAdd = vi.fn().mockResolvedValue(undefined);
    const notificationAdd = vi.fn().mockResolvedValue(undefined);
    const order = buildOrder();
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'true');
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            pickupPincode: '500001',
            contactEmail: 'merchant@example.com',
            contactPhone: '9888877777',
            notifySmsEnabled: true,
            notifyWhatsappEnabled: true,
            notifyEmailEnabled: true
          })
        },
        order: {
          findUnique: vi.fn().mockResolvedValue(order)
        }
      },
      queues: {
        shipping: {
          add: shippingAdd
        },
        notifications: {
          add: notificationAdd
        }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    const result = await service.adminShipOrder('order_1');

    expect(shippingAdd).toHaveBeenCalledWith(
      'create-shipment',
      expect.objectContaining({
        orderId: 'order_1'
      }),
      undefined
    );
    expect(notificationAdd).toHaveBeenCalledWith(
      'send-primary',
      expect.objectContaining({
        email: 'merchant@example.com',
        phone: '9888877777',
        template: 'OrderShipped',
        data: { orderId: 'order_1', orderNumber: 'ORD-2026-00001' }
      }),
      expect.objectContaining({
        jobId: 'merchant-notifications-primary-order_1-OrderShipped'
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'order_1',
        status: OrderStatus.PROCESSING
      })
    );
    vi.unstubAllEnvs();
  });

  it('rejects ship enqueue for prepaid orders with uncaptured payment', async () => {
    const shippingAdd = vi.fn().mockResolvedValue(undefined);
    const order = buildOrder({
      payment: {
        id: 'payment_2',
        provider: 'RAZORPAY',
        providerOrderId: 'order_provider_2',
        providerPaymentId: null,
        amount: 10000,
        status: PaymentStatus.CREATED,
        method: null
      }
    });
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            pickupPincode: '500001'
          })
        },
        order: {
          findUnique: vi.fn().mockResolvedValue(order)
        }
      },
      queues: {
        shipping: {
          add: shippingAdd
        },
        notifications: {
          add: vi.fn()
        }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    await expect(service.adminShipOrder('order_1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(shippingAdd).not.toHaveBeenCalled();
  });
});
