import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

vi.mock('@modules/payments/payment-provider', () => ({
  createPaymentProvider: () => ({
    verifyWebhookSignature: () => true,
    verifyPaymentSignature: () => true
  })
}));

describe('OrdersService secure data flow', () => {
  it('scopes shipment tracking lookups to the requesting user', async () => {
    const findFirst = vi.fn(async () => ({
      id: 'shipment_1',
      events: [
        {
          id: 'evt_1',
          shipmentId: 'shipment_1',
          status: 'IN_TRANSIT',
          location: 'Mumbai',
          description: 'On route',
          occurredAt: new Date('2026-01-01T00:00:00.000Z')
        }
      ]
    }));

    const service = new OrdersService({
      prisma: {
        shipment: { findFirst }
      }
    } as unknown as ConstructorParameters<typeof OrdersService>[0]);

    const result = await service.getShippingTracking('user_1', 'awb_1');
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('shipmentId');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          awbNumber: 'awb_1',
          order: { userId: 'user_1' }
        }
      })
    );
  });

  it('does not expose provider payment identifiers in customer order payloads', async () => {
    const findFirst = vi.fn(async () => ({
      id: 'order_1',
      orderNumber: 'ORD-2026-00001',
      userId: 'user_1',
      status: 'CONFIRMED',
      shippingAddress: {
        fullName: 'Jane Doe',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'TS',
        pincode: '500001'
      },
      subtotal: 10000,
      shippingCharge: 500,
      discountAmount: 0,
      total: 10500,
      notes: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      items: [],
      statusHistory: [],
      payment: {
        id: 'pay_1',
        provider: 'RAZORPAY',
        providerOrderId: 'order_rzp_1',
        providerPaymentId: 'pay_rzp_1',
        amount: 10500,
        status: 'CAPTURED',
        method: 'upi',
        capturedAt: new Date('2026-01-01T00:00:10.000Z'),
        refundPendingAmountPaise: 0,
        refundedAmountPaise: 0
      },
      invoice: null,
      shipment: null
    }));

    const service = new OrdersService({
      prisma: {
        order: { findFirst }
      }
    } as unknown as ConstructorParameters<typeof OrdersService>[0]);

    const result = await service.getMyOrderById('user_1', 'order_1');
    expect(result).not.toHaveProperty('userId');
    expect(result.payment).toBeTruthy();
    expect(result.payment).not.toHaveProperty('id');
    expect(result.payment).not.toHaveProperty('providerOrderId');
    expect(result.payment).not.toHaveProperty('providerPaymentId');
  });

  it('strips admin subject markers from customer-visible status history notes', async () => {
    const findFirst = vi.fn(async () => ({
      id: 'order_1',
      orderNumber: 'ORD-2026-00001',
      userId: 'user_1',
      status: 'PROCESSING',
      shippingAddress: {
        fullName: 'Jane Doe',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'TS',
        pincode: '500001'
      },
      subtotal: 10000,
      shippingCharge: 500,
      discountAmount: 0,
      total: 10500,
      notes: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      items: [],
      statusHistory: [
        {
          id: 'hist_1',
          fromStatus: 'CONFIRMED',
          toStatus: 'PROCESSING',
          triggeredBy: 'ADMIN',
          note: 'Status moved to processing [admin:admin_123]',
          createdAt: new Date('2026-01-01T00:00:00.000Z')
        }
      ],
      payment: null,
      invoice: null,
      shipment: null
    }));
    const service = new OrdersService({
      prisma: {
        order: { findFirst }
      }
    } as unknown as ConstructorParameters<typeof OrdersService>[0]);
    const result = await service.getMyOrderById('user_1', 'order_1');
    expect(result.statusHistory[0]?.note).toBe('Status moved to processing');
  });

  it('strips multiple admin markers and empty marker-only notes for customers', async () => {
    const findFirst = vi.fn(async () => ({
      id: 'order_2',
      orderNumber: 'ORD-2026-00002',
      userId: 'user_1',
      status: 'PROCESSING',
      shippingAddress: {
        fullName: 'Jane Doe',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'TS',
        pincode: '500001'
      },
      subtotal: 10000,
      shippingCharge: 500,
      discountAmount: 0,
      total: 10500,
      notes: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      items: [],
      statusHistory: [
        {
          id: 'hist_2',
          fromStatus: 'CONFIRMED',
          toStatus: 'PROCESSING',
          triggeredBy: 'ADMIN',
          note: '[admin:admin_1]',
          createdAt: new Date('2026-01-01T00:00:00.000Z')
        },
        {
          id: 'hist_3',
          fromStatus: 'PROCESSING',
          toStatus: 'SHIPPED',
          triggeredBy: 'ADMIN',
          note: 'Packed [admin:admin_1] and shipped [admin:admin_2]',
          createdAt: new Date('2026-01-01T00:00:10.000Z')
        }
      ],
      payment: null,
      invoice: null,
      shipment: null
    }));
    const service = new OrdersService({
      prisma: {
        order: { findFirst }
      }
    } as unknown as ConstructorParameters<typeof OrdersService>[0]);
    const result = await service.getMyOrderById('user_1', 'order_2');
    expect(result.statusHistory[0]?.note).toBeNull();
    expect(result.statusHistory[1]?.note).toBe('Packed and shipped');
  });

  it('enriches customer order items with PDP slug, thumbnail and purchasability', async () => {
    const findFirst = vi.fn(async () => ({
      id: 'order_3',
      orderNumber: 'ORD-2026-00003',
      userId: 'user_1',
      status: 'DELIVERED',
      shippingAddress: {
        fullName: 'Jane Doe',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'TS',
        pincode: '500001'
      },
      subtotal: 10000,
      shippingCharge: 0,
      discountAmount: 0,
      total: 10000,
      notes: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      items: [
        {
          id: 'item_1',
          variantId: 'variant_1',
          productName: 'Cold-Pressed Oil',
          variantName: '1L',
          sku: 'OIL-1L',
          quantity: 2,
          unitPrice: 5000,
          totalPrice: 10000,
          variant: {
            isActive: true,
            product: {
              slug: 'cold-pressed-oil',
              isActive: true,
              images: [{ url: 'https://cdn.example/oil.jpg' }]
            }
          }
        },
        {
          id: 'item_2',
          variantId: 'variant_2',
          productName: 'Retired Product',
          variantName: '500g',
          sku: 'RET-500',
          quantity: 1,
          unitPrice: 0,
          totalPrice: 0,
          variant: {
            isActive: false,
            product: { slug: 'retired-product', isActive: true, images: [] }
          }
        }
      ],
      statusHistory: [],
      payment: null,
      invoice: null,
      shipment: null
    }));
    const service = new OrdersService({
      prisma: {
        order: { findFirst }
      }
    } as unknown as ConstructorParameters<typeof OrdersService>[0]);
    const result = await service.getMyOrderById('user_1', 'order_3');
    const items = result.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      productSlug: 'cold-pressed-oil',
      imageUrl: 'https://cdn.example/oil.jpg',
      isPurchasable: true
    });
    // Deactivated variant: still enriched (slug shown) but flagged not purchasable; no image → null.
    expect(items[1]).toMatchObject({
      productSlug: 'retired-product',
      imageUrl: null,
      isPurchasable: false
    });
    // The raw Prisma relation must never leak into the API payload.
    expect(items[0]).not.toHaveProperty('variant');
  });
});
