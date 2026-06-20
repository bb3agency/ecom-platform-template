import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OrderStatus } from '@prisma/client';
import { invalidateStorefrontCouponsCache } from '@common/coupons/coupons-feature';
import { OrdersService } from './orders.service';
import { CartService } from '@modules/cart/cart.service';

describe('OrdersService createOrder coupon merchant toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateStorefrontCouponsCache();
  });

  afterEach(() => {
    invalidateStorefrontCouponsCache();
  });

  it('ignores stale cart coupon when storefront coupons are disabled', async () => {
    vi.spyOn(CartService.prototype, 'usesNoopShipping').mockReturnValue(true);
    vi.spyOn(CartService.prototype, 'checkPincodeServiceability').mockResolvedValue({
      pincode: '500001',
      serviceable: true
    });
    vi.spyOn(CartService.prototype, 'computeShippingChargeForCart').mockResolvedValue({
      shippingChargePaise: 500,
      estimatedDays: 3
    });

    const orderCreate = vi.fn().mockResolvedValue({
      id: 'order_1',
      status: OrderStatus.PENDING_PAYMENT,
      paymentMode: 'PREPAID'
    });

    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([{ nextval: 1n }]),
      address: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'address_1',
          userId: 'user_1',
          fullName: 'Test User',
          phone: '9999999999',
          line1: 'Street 1',
          line2: null,
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500001'
        })
      },
      cart: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cart_1',
          coupon: {
            id: 'coupon_1',
            code: 'SAVE10',
            type: 'PERCENTAGE_OFF',
            value: 10,
            minOrderPaise: 0,
            maxUsesTotal: null,
            maxUsesPerUser: null,
            usesCount: 0,
            validFrom: new Date('2026-01-01T00:00:00.000Z'),
            validUntil: new Date('2026-12-31T23:59:59.000Z'),
            isActive: true,
            applicableTo: null
          },
          items: [
            {
              variantId: 'variant_1',
              quantity: 1,
              priceSnapshot: 5000,
              variant: {
                id: 'variant_1',
                name: 'Variant 1',
                sku: 'SKU-1',
                weight: 500,
                inventory: { quantity: 10 },
                product: { categoryId: 'category_1', name: 'Product 1' }
              }
            }
          ]
        }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      order: {
        create: orderCreate,
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'order_1',
          orderNumber: 'ORD-2026-00001',
          userId: 'user_1',
          status: OrderStatus.PENDING_PAYMENT,
          paymentMode: 'PREPAID',
          shippingAddress: {
            fullName: 'Test User',
            phone: '9999999999',
            line1: 'Street 1',
            city: 'Hyderabad',
            state: 'Telangana',
            pincode: '500001'
          },
          subtotal: 5000,
          shippingCharge: 500,
          discountAmount: 0,
          total: 5500,
          notes: null,
          createdAt: new Date('2026-04-26T00:00:00.000Z'),
          updatedAt: new Date('2026-04-26T00:00:00.000Z'),
          items: [],
          payment: null,
          invoice: null,
          shipment: null,
          statusHistory: []
        })
      },
      orderItem: { create: vi.fn().mockResolvedValue(undefined) },
      orderStatusHistory: { create: vi.fn().mockResolvedValue(undefined) },
      cartItem: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      storeSettings: {
        findUnique: vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
          if (select?.couponsEnabled) {
            return Promise.resolve({ couponsEnabled: false });
          }
          return Promise.resolve({ minOrderValuePaise: 0 });
        })
      }
    };

    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ minOrderValuePaise: 0 })
        },
        address: {
          findFirst: vi.fn().mockResolvedValue({ id: 'address_1', pincode: '500001' })
        },
        $transaction: vi.fn().mockImplementation(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx))
      },
      log: { error: vi.fn(), warn: vi.fn() },
      queues: {
        analytics: { add: vi.fn() },
        shipping: { add: vi.fn() },
        orderProcessing: { add: vi.fn() },
        refunds: { add: vi.fn() },
        notifications: { add: vi.fn() }
      },
      redis: { set: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);

    await expect(service.createOrder('user_1', { addressId: 'address_1' })).resolves.toBeDefined();
    expect(orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 5000,
          discountAmount: 0,
          total: 5500
        })
      })
    );
    const createArgs = orderCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(createArgs.data).not.toHaveProperty('coupons');
  });
});
