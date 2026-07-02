import { OrderStatus, PaymentStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { invalidateStorefrontCouponsCache } from '@common/coupons/coupons-feature';
import { OrdersService } from './orders.service';
import { CartService } from '@modules/cart/cart.service';

function buildFastifyForCreateOrder(couponType: 'PERCENTAGE_OFF' | 'FREE_SHIPPING') {
  const createdOrders: Array<{ shippingCharge: number; total: number }> = [];
  const address = {
    id: 'address_1',
    userId: 'user_1',
    fullName: 'Test User',
    phone: '9999999999',
    line1: 'Street 1',
    line2: null,
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500001'
  };

  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ nextval: 1n }]),
    address: {
      findFirst: vi.fn().mockResolvedValue(address)
    },
    cart: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'cart_1',
        coupon: {
          id: 'coupon_1',
          type: couponType,
          value: couponType === 'PERCENTAGE_OFF' ? 10 : 0,
          minOrderPaise: 0,
          maxUsesTotal: null,
          maxUsesPerUser: 10,
          usesCount: 0,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2026-12-31T23:59:59.000Z'),
          isActive: true,
          applicableTo: null
        },
        items: [
          {
            variantId: 'variant_1',
            quantity: 2,
            priceSnapshot: 5000,
            variant: {
              id: 'variant_1',
              name: 'Variant 1',
              sku: 'SKU-1',
              productId: 'product_1',
              isActive: true,
              product: {
                categoryId: 'category_1',
                isActive: true
              },
              inventory: {
                quantity: 10
              }
            }
          }
        ]
      }),
      update: vi.fn().mockResolvedValue(undefined)
    },
    order: {
      create: vi.fn().mockImplementation(({ data }: { data: { shippingCharge: number; total: number } }) => {
        createdOrders.push({
          shippingCharge: data.shippingCharge,
          total: data.total
        });
        return Promise.resolve({
          id: 'order_1'
        });
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(() => {
        const latest = createdOrders[createdOrders.length - 1] ?? { shippingCharge: 0, total: 0 };
        return Promise.resolve({
          id: 'order_1',
          orderNumber: 'ORD-2026-00001',
          userId: 'user_1',
          status: OrderStatus.PENDING_PAYMENT,
          shippingAddress: {
            fullName: 'Test User',
            phone: '9999999999',
            line1: 'Street 1',
            city: 'Hyderabad',
            state: 'Telangana',
            pincode: '500001'
          },
          subtotal: 10000,
          shippingCharge: latest.shippingCharge,
          discountAmount: couponType === 'PERCENTAGE_OFF' ? 1000 : 0,
          total: latest.total,
          notes: null,
          createdAt: new Date('2026-04-26T00:00:00.000Z'),
          updatedAt: new Date('2026-04-26T00:00:00.000Z'),
          items: [
            {
              id: 'item_1',
              variantId: 'variant_1',
              productName: 'Variant 1',
              variantName: 'Variant 1',
              sku: 'SKU-1',
              quantity: 2,
              unitPrice: 5000,
              totalPrice: 10000
            }
          ],
          statusHistory: [],
          payment: {
            id: 'payment_1',
            provider: 'RAZORPAY',
            providerOrderId: 'provider_order_1',
            providerPaymentId: 'provider_payment_1',
            amount: latest.total,
            status: PaymentStatus.CREATED,
            method: null
          },
          shipment: null
        });
      }),
      count: vi.fn().mockResolvedValue(0)
    },
    orderItem: {
      create: vi.fn().mockResolvedValue(undefined)
    },
    orderStatusHistory: {
      create: vi.fn().mockResolvedValue(undefined)
    },
    cartItem: {
      deleteMany: vi.fn().mockResolvedValue(undefined)
    },
    coupon: {
      update: vi.fn().mockResolvedValue(undefined)
    },
    storeSettings: {
      findUnique: vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
        if (select?.couponsEnabled) {
          return Promise.resolve({ couponsEnabled: true });
        }
        return Promise.resolve({ minOrderValuePaise: 0 });
      })
    },
    couponUsage: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn(),
      delete: vi.fn()
    }
  };

  const fastify = {
    prisma: {
        order: {
          count: vi.fn().mockResolvedValue(0)
        },
      storeSettings: {
        findUnique: vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
          if (select?.couponsEnabled) {
            return Promise.resolve({ couponsEnabled: true });
          }
          return Promise.resolve({ minOrderValuePaise: 0 });
        })
      },
      address: {
        findFirst: vi.fn().mockResolvedValue(address)
      },
      $transaction: vi.fn().mockImplementation(async (fn: (arg0: typeof tx) => Promise<unknown>) => fn(tx))
    },
    log: {
      error: vi.fn(),
      warn: vi.fn()
    },
    queues: {
      analytics: { add: vi.fn() },
      shipping: { add: vi.fn() },
      orderProcessing: { add: vi.fn() },
      refunds: { add: vi.fn() },
      notifications: { add: vi.fn() }
    },
    redis: {
      set: vi.fn()
    }
  } as unknown as FastifyInstance;

  return { fastify, createdOrders };
}

describe('OrdersService createOrder pricing composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateStorefrontCouponsCache();
    vi.spyOn(CartService.prototype, 'usesNoopShipping').mockReturnValue(true);
    vi.spyOn(CartService.prototype, 'checkPincodeServiceability').mockResolvedValue({
      pincode: '500001',
      serviceable: true
    });
  });

  afterEach(() => {
    invalidateStorefrontCouponsCache();
  });

  it('applies Delhivery-derived shipping charge to order total', async () => {
    vi.spyOn(CartService.prototype, 'computeShippingChargeForCart').mockResolvedValue({
      shippingChargePaise: 4500,
      estimatedDays: 3
    });
    const { fastify } = buildFastifyForCreateOrder('PERCENTAGE_OFF');
    const service = new OrdersService(fastify);

    const result = await service.createOrder('user_1', { addressId: 'address_1' });
    expect(result.shippingCharge).toBe(4500);
    expect(result.total).toBe(13500);
  });

  it('forces shipping charge to zero for FREE_SHIPPING coupon', async () => {
    vi.spyOn(CartService.prototype, 'computeShippingChargeForCart').mockResolvedValue({
      shippingChargePaise: 0,
      estimatedDays: 3
    });
    const { fastify } = buildFastifyForCreateOrder('FREE_SHIPPING');
    const service = new OrdersService(fastify);

    const result = await service.createOrder('user_1', { addressId: 'address_1' });
    expect(result.shippingCharge).toBe(0);
    expect(result.total).toBe(10000);
  });
});
