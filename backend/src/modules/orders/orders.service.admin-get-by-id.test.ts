import { OrderStatus, PaymentStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

describe('OrdersService admin get order by id', () => {
  it('serializes payment object to schema-safe fields only', async () => {
    const fastify = {
      prisma: {
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'order_1',
            orderNumber: 'ORD-2026-00001',
            userId: 'user_1',
            status: OrderStatus.REFUNDED,
            shippingAddress: { city: 'Hyderabad' },
            subtotal: 10000,
            shippingCharge: 0,
            discountAmount: 0,
            total: 10000,
            notes: null,
            createdAt: new Date('2026-04-27T00:00:00.000Z'),
            updatedAt: new Date('2026-04-27T00:00:00.000Z'),
            items: [],
            statusHistory: [],
            payment: {
              id: 'payment_1',
              provider: 'RAZORPAY',
              providerOrderId: 'provider_order_1',
              providerPaymentId: 'provider_payment_1',
              amount: 10000,
              status: PaymentStatus.REFUNDED,
              method: 'upi',
              refundPendingAmountPaise: 0,
              refundedAmountPaise: 10000,
              currency: 'INR',
              webhookPayload: { foo: 'bar' },
              capturedAt: new Date('2026-04-27T00:00:00.000Z'),
              createdAt: new Date('2026-04-27T00:00:00.000Z'),
              updatedAt: new Date('2026-04-27T00:00:00.000Z')
            },
            shipment: null
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    const result = await service.adminGetOrderById('order_1');

    expect(result.payment).toEqual({
      id: 'payment_1',
      provider: 'RAZORPAY',
      providerOrderId: 'provider_order_1',
      providerPaymentId: 'provider_payment_1',
      amount: 10000,
      status: PaymentStatus.REFUNDED,
      method: 'upi',
      capturedAt: '2026-04-27T00:00:00.000Z',
      refundPendingAmountPaise: 0,
      refundedAmountPaise: 10000
    });
    expect(result.payment).not.toHaveProperty('currency');
    expect(result.payment).not.toHaveProperty('webhookPayload');
    expect(result.payment).not.toHaveProperty('createdAt');
  });

  it('keeps shipmentLabelUrl null unless tracking URL is explicitly label-like', async () => {
    const fastify = {
      prisma: {
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'order_2',
            orderNumber: 'ORD-2026-00002',
            userId: 'user_2',
            status: OrderStatus.SHIPPED,
            shippingAddress: { city: 'Mumbai' },
            subtotal: 20000,
            shippingCharge: 0,
            discountAmount: 0,
            total: 20000,
            notes: null,
            createdAt: new Date('2026-04-27T00:00:00.000Z'),
            updatedAt: new Date('2026-04-27T00:00:00.000Z'),
            items: [],
            statusHistory: [],
            payment: null,
            shipment: {
              id: 'shipment_2',
              provider: 'DELHIVERY',
              status: 'SHIPPED',
              awbNumber: 'AWB-2',
              trackingUrl: 'https://tracking.example.com/awb/AWB-2',
              events: []
            }
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    const result = await service.adminGetOrderById('order_2');
    expect(result.shipment).toMatchObject({
      trackingUrl: 'https://tracking.example.com/awb/AWB-2',
      shipmentLabelUrl: null
    });
  });
});
