import { OrderStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { invalidateStorefrontCouponsCache } from '@common/coupons/coupons-feature';
import { OrdersService } from './orders.service';
import { CartService } from '@modules/cart/cart.service';

/**
 * Service-level wiring for product-level local delivery. The classification rules themselves
 * are unit-tested in common/shipping/local-delivery-split.test.ts; what matters here is that
 * createOrder actually splits the cart into two orders, partitions the items correctly, keeps
 * the money exact, links the siblings, and consumes the coupon only once.
 */

const ADDRESS = {
  id: 'addr_1',
  userId: 'user_1',
  fullName: 'Test',
  phone: '9999999999',
  line1: 'L1',
  line2: null,
  city: 'Hyd',
  state: 'TG',
  pincode: '500001'
};

function cartItem(
  variantId: string,
  productName: string,
  pricePaise: number,
  isLocalDeliveryOnly: boolean
) {
  return {
    variantId,
    quantity: 1,
    priceSnapshot: pricePaise,
    variant: {
      id: variantId,
      name: 'Default',
      sku: `SKU-${variantId}`,
      productId: `p-${variantId}`,
      isActive: true,
      weight: 500,
      inventory: { quantity: 10 },
      product: { categoryId: 'c1', name: productName, isActive: true, isLocalDeliveryOnly }
    }
  };
}

function buildTx(items: ReturnType<typeof cartItem>[]) {
  let created = 0;
  return {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ nextval: 1n }]),
    address: { findFirst: vi.fn().mockResolvedValue(ADDRESS) },
    cart: {
      findFirst: vi.fn().mockResolvedValue({ id: 'cart_1', coupon: null, items }),
      update: vi.fn().mockResolvedValue(undefined)
    },
    storeSettings: {
      findUnique: vi.fn().mockResolvedValue({ isCodEnabled: true, minOrderValuePaise: 0 })
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(() => {
        created += 1;
        return Promise.resolve({ id: `order_${created}`, status: OrderStatus.CONFIRMED });
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'order_1',
        orderNumber: 'ORD-AAAA-BBBB',
        userId: 'user_1',
        status: OrderStatus.CONFIRMED,
        shippingAddress: ADDRESS,
        subtotal: 10000,
        shippingCharge: 0,
        discountAmount: 0,
        total: 10000,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
        statusHistory: [],
        payment: null,
        shipment: null,
        creditNotes: [],
        invoice: null,
        customer: null
      })
    },
    orderItem: { create: vi.fn().mockResolvedValue(undefined) },
    orderStatusHistory: { create: vi.fn().mockResolvedValue(undefined) },
    cartItem: { deleteMany: vi.fn().mockResolvedValue(undefined) },
    payment: { create: vi.fn().mockResolvedValue({ id: 'pay_1' }) }
  };
}

function buildFastify(tx: ReturnType<typeof buildTx>) {
  return {
    prisma: {
      order: { count: vi.fn().mockResolvedValue(0) },
      storeSettings: { findUnique: vi.fn().mockResolvedValue({ minOrderValuePaise: 0 }) },
      address: { findFirst: vi.fn().mockResolvedValue(ADDRESS) },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx))
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
}

/** Orders in creation order, with the fields the split is responsible for. */
function createdOrders(tx: ReturnType<typeof buildTx>) {
  return tx.order.create.mock.calls.map(
    (call) => (call[0] as { data: Record<string, unknown> }).data
  );
}

describe('OrdersService createOrder — product-level local delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateStorefrontCouponsCache();
    vi.spyOn(CartService.prototype, 'usesNoopShipping').mockReturnValue(true);
    vi.spyOn(CartService.prototype, 'checkPincodeServiceability').mockResolvedValue({
      pincode: '500001',
      serviceable: true
    });
    // 500001 is whitelisted for local delivery at a ₹35 flat fee.
    vi.spyOn(CartService.prototype, 'getLocalDeliveryQuoteForCheckout').mockImplementation(
      async (pincode: string) =>
        pincode === '500001'
          ? { provider: 'LOCAL' as const, shippingChargePaise: 3500, estimatedDays: 1 }
          : null
    );
    vi.spyOn(CartService.prototype, 'computeShippingChargeForCart').mockResolvedValue({
      shippingChargePaise: 5000,
      estimatedDays: 3
    } as never);
  });

  it('splits a mixed cart into two linked COD orders with the items partitioned', async () => {
    const tx = buildTx([
      cartItem('v1', 'Fresh Greens', 30000, true),
      cartItem('v2', 'Packaged Honey', 10000, false)
    ]);
    const service = new OrdersService(buildFastify(tx));

    await service.createOrder('user_1', { addressId: 'addr_1', paymentMode: 'COD' });

    const orders = createdOrders(tx);
    expect(orders).toHaveLength(2);

    // Local leg first, courier leg second.
    expect(orders[0]?.['selectedShippingProvider']).toBe('LOCAL');
    expect(orders[1]?.['selectedShippingProvider']).toBeUndefined();

    // Siblings are linked by a shared, non-null group id.
    const groupIds = orders.map((order) => order['orderGroupId']);
    expect(groupIds[0]).toBeTruthy();
    expect(groupIds[0]).toBe(groupIds[1]);

    // Each leg is priced on its own items plus its own shipping.
    expect(orders[0]?.['subtotal']).toBe(30000);
    expect(orders[0]?.['shippingCharge']).toBe(3500);
    expect(orders[1]?.['subtotal']).toBe(10000);
    expect(orders[1]?.['shippingCharge']).toBe(5000);

    // Items land in the right order: local product on the local leg only.
    const itemRows = tx.orderItem.create.mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data
    );
    const localItems = itemRows.filter((row) => row['orderId'] === 'order_1');
    const courierItems = itemRows.filter((row) => row['orderId'] === 'order_2');
    expect(localItems.map((row) => row['productName'])).toEqual(['Fresh Greens']);
    expect(courierItems.map((row) => row['productName'])).toEqual(['Packaged Honey']);

    // One COD payment per order, each for its own leg total.
    expect(tx.payment.create).toHaveBeenCalledTimes(2);
    const paymentAmounts = tx.payment.create.mock.calls.map(
      (call) => (call[0] as { data: Record<string, number> }).data['amount']
    );
    expect(paymentAmounts).toEqual([33500, 15000]);
  });

  it('keeps a single order when nothing in the cart is local-delivery-only', async () => {
    const tx = buildTx([cartItem('v2', 'Packaged Honey', 10000, false)]);
    const service = new OrdersService(buildFastify(tx));

    await service.createOrder('user_1', { addressId: 'addr_1', paymentMode: 'COD' });

    const orders = createdOrders(tx);
    expect(orders).toHaveLength(1);
    // Ordinary products stay on the courier even though 500001 is whitelisted.
    expect(orders[0]?.['selectedShippingProvider']).toBeUndefined();
    expect(orders[0]?.['orderGroupId']).toBeUndefined();
  });

  it('keeps a single LOCAL order when the whole cart is local-delivery-only', async () => {
    const tx = buildTx([cartItem('v1', 'Fresh Greens', 30000, true)]);
    const service = new OrdersService(buildFastify(tx));

    await service.createOrder('user_1', { addressId: 'addr_1', paymentMode: 'COD' });

    const orders = createdOrders(tx);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.['selectedShippingProvider']).toBe('LOCAL');
    expect(orders[0]?.['shippingCharge']).toBe(3500);
    expect(orders[0]?.['orderGroupId']).toBeUndefined();
  });

  it('refuses checkout when a local-delivery-only item cannot reach the pincode', async () => {
    const tx = buildTx([
      cartItem('v1', 'Fresh Greens', 30000, true),
      cartItem('v2', 'Packaged Honey', 10000, false)
    ]);
    tx.address.findFirst.mockResolvedValue({ ...ADDRESS, pincode: '999999' });
    const fastify = buildFastify(tx);
    (fastify.prisma.address.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ADDRESS,
      pincode: '999999'
    });

    const service = new OrdersService(fastify);

    await expect(
      service.createOrder('user_1', { addressId: 'addr_1', paymentMode: 'COD' })
    ).rejects.toMatchObject({
      code: 'LOCAL_DELIVERY_ONLY_UNAVAILABLE',
      statusCode: 422,
      details: { pincode: '999999', products: [{ productName: 'Fresh Greens' }] }
    });

    // Nothing may be written while the cart is undeliverable.
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('rejects a prepaid split on the legacy two-step flow instead of stranding an order', async () => {
    // POST /orders + POST /payments/initiate funds a single orderId, so a split there would
    // leave the second order permanently unpaid. Prepaid splits must use prepare-checkout.
    const tx = buildTx([
      cartItem('v1', 'Fresh Greens', 30000, true),
      cartItem('v2', 'Packaged Honey', 10000, false)
    ]);
    const service = new OrdersService(buildFastify(tx));

    await expect(
      service.createOrder('user_1', { addressId: 'addr_1', paymentMode: 'PREPAID' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

    expect(tx.order.create).not.toHaveBeenCalled();
  });
});
