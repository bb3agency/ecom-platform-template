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

  it('computes the recommended packing box from the order variant dimensions', async () => {
    const fastify = {
      prisma: {
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'order_3',
            orderNumber: 'ORD-2026-00003',
            userId: 'user_3',
            status: OrderStatus.CONFIRMED,
            shippingAddress: { city: 'Pune' },
            subtotal: 30000,
            shippingCharge: 0,
            discountAmount: 0,
            total: 30000,
            notes: null,
            createdAt: new Date('2026-06-28T00:00:00.000Z'),
            updatedAt: new Date('2026-06-28T00:00:00.000Z'),
            items: [
              { id: 'oi_1', variantId: 'v_base', productName: 'Base', variantName: 'D', sku: 'B', quantity: 1, unitPrice: 10000, totalPrice: 10000 },
              { id: 'oi_2', variantId: 'v_top', productName: 'Top', variantName: 'D', sku: 'T', quantity: 2, unitPrice: 10000, totalPrice: 20000 }
            ],
            statusHistory: [],
            payment: null,
            shipment: null
          })
        },
        productVariant: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'v_base', weight: 1000, packageLengthCm: 15, packageWidthCm: 10, packageHeightCm: 4, keepUpright: false },
            { id: 'v_top', weight: 200, packageLengthCm: 10, packageWidthCm: 5, packageHeightCm: 2, keepUpright: false }
          ])
        },
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ boxPresets: null })
        }
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    const result = await service.adminGetOrderById('order_3');
    // Raw bounding box 15×10×6, +1cm padding → 16×11×7. Weight 1000 + 2×200 = 1400.
    expect(result.packingBox).toEqual({
      lengthCm: 16,
      widthCm: 11,
      heightCm: 7,
      weightGrams: 1400,
      source: 'computed',
      boxName: null
    });
  });
});
