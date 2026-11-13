import { OrderStatus, PaymentStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService, findStaleCartPrices } from './orders.service';

type ServiceDeps = ConstructorParameters<typeof OrdersService>[0];

function serializedOrder(overrides?: Partial<Record<string, unknown>>) {
  const now = new Date();
  return {
    id: 'order_1',
    orderNumber: 'ORD-ABC123',
    userId: 'user_1',
    status: OrderStatus.CONFIRMED,
    paymentMode: 'PREPAID',
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
    discountAmount: 1000,
    total: 9000,
    notes: null,
    createdAt: now,
    updatedAt: now,
    items: [],
    statusHistory: [],
    payment: null,
    shipment: null,
    invoice: null,
    couponUsages: [],
    ...overrides
  };
}

const session = {
  userId: 'user_1',
  cartId: 'cart_1',
  addressId: null,
  shippingAddress: {
    fullName: 'Test User',
    phone: '9999999999',
    line1: 'Line 1',
    city: 'City',
    state: 'State',
    pincode: '560001'
  },
  notes: null,
  subtotal: 10000,
  shippingCharge: 0,
  discountAmount: 1000,
  total: 9000,
  couponId: 'coupon_1',
  razorpayOrderId: 'order_rzp_1',
  items: [
    {
      variantId: 'variant_1',
      productName: 'Rice',
      variantName: '1kg',
      sku: 'RICE-1',
      quantity: 1,
      unitPrice: 10000,
      totalPrice: 10000,
      weightGrams: 1000
    }
  ]
};

function buildConfirmPrepaidHarness(couponRow: {
  usesCount: number;
  maxUsesTotal: number | null;
  maxUsesPerUser: number | null;
}) {
  const outboxCreate = vi.fn().mockResolvedValue(undefined);
  const topLevelOutboxCreate = vi.fn().mockResolvedValue(undefined);
  const orderUpdate = vi.fn().mockResolvedValue(undefined);
  const historyCreate = vi.fn().mockResolvedValue(undefined);
  const couponUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const redisDel = vi.fn().mockResolvedValue(1);
  let finalStatus: OrderStatus = OrderStatus.CONFIRMED;
  orderUpdate.mockImplementation(async (args: { data: { status: OrderStatus } }) => {
    finalStatus = args.data.status;
  });

  const tx = {
    coupon: {
      findUnique: vi.fn().mockResolvedValue({ id: 'coupon_1', ...couponRow }),
      updateMany: couponUpdateMany,
      // Plain function (not a vi mock) so the atomic CAS path runs.
      update: async () => undefined
    },
    couponUsage: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0)
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'order_1' }),
      update: orderUpdate,
      findUniqueOrThrow: vi.fn(async () => serializedOrder({ status: finalStatus }))
    },
    payment: { create: vi.fn().mockResolvedValue(undefined) },
    orderItem: { create: vi.fn().mockResolvedValue(undefined) },
    orderStatusHistory: { create: historyCreate },
    cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cart: { update: vi.fn().mockResolvedValue(undefined), findFirst: vi.fn().mockResolvedValue(null) },
    outboxMessage: { create: outboxCreate }
  };

  const service = new OrdersService({
    log: { warn: vi.fn(), error: vi.fn() },
    redis: {
      get: vi.fn().mockResolvedValue(JSON.stringify(session)),
      set: vi.fn().mockResolvedValue('OK'),
      del: redisDel
    },
    prisma: {
      payment: { findFirst: vi.fn().mockResolvedValue(null) },
      user: { findUnique: vi.fn().mockResolvedValue({ email: null, phone: null }) },
      outboxMessage: { create: topLevelOutboxCreate },
      $transaction: <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx)
    },
    queues: {},
    checkoutRisk: { assertInitiatePaymentAllowed: vi.fn() }
  } as unknown as ServiceDeps);

  (service as unknown as { razorpayAdapter: { verifyPaymentSignature: () => boolean } }).razorpayAdapter = {
    verifyPaymentSignature: () => true
  };

  return { service, tx, outboxCreate, topLevelOutboxCreate, orderUpdate, historyCreate, couponUpdateMany, redisDel };
}

const confirmInput = {
  checkoutSessionId: 'checkout:session:abc',
  razorpayOrderId: 'order_rzp_1',
  razorpayPaymentId: 'pay_1',
  razorpaySignature: 'sig'
};

describe('OrdersService confirmPrepaid money safety', () => {
  it('writes the process-order-update outbox row inside the order transaction', async () => {
    const h = buildConfirmPrepaidHarness({ usesCount: 1, maxUsesTotal: 10, maxUsesPerUser: null });

    const result = await h.service.confirmPrepaid('user_1', confirmInput);

    expect(result).toMatchObject({ status: OrderStatus.CONFIRMED });
    expect(h.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        queueName: 'orderProcessing',
        jobName: 'process-order-update',
        jobId: 'process-order-update-confirmed-order_1',
        payload: expect.objectContaining({ orderId: 'order_1', triggeredBy: 'PREPAID_CONFIRMED' })
      })
    });
    // Never via the separate, after-commit outbox insert.
    expect(h.topLevelOutboxCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ jobName: 'process-order-update' }) })
    );
    expect(h.redisDel).toHaveBeenCalledWith('checkout:session:abc');
  });

  it('does not throw when the coupon cap was reached after capture: cancels and queues a full refund', async () => {
    const h = buildConfirmPrepaidHarness({ usesCount: 5, maxUsesTotal: 5, maxUsesPerUser: null });

    const result = await h.service.confirmPrepaid('user_1', confirmInput);

    expect(result).toMatchObject({ status: OrderStatus.CANCELLED });
    expect(h.couponUpdateMany).not.toHaveBeenCalled();
    expect(h.orderUpdate).toHaveBeenCalledWith({ where: { id: 'order_1' }, data: { status: OrderStatus.CANCELLED } });
    expect(h.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        queueName: 'refunds',
        jobName: 'initiate-razorpay-refund',
        payload: expect.objectContaining({ orderId: 'order_1', initiatedBy: 'SYSTEM' })
      })
    });
    expect(h.outboxCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ jobName: 'process-order-update' }) })
    );
  });

  it('cancels and refunds when the per-user coupon allowance was used by a parallel session', async () => {
    const h = buildConfirmPrepaidHarness({ usesCount: 1, maxUsesTotal: null, maxUsesPerUser: 1 });
    h.tx.couponUsage.count.mockResolvedValue(1);

    const result = await h.service.confirmPrepaid('user_1', confirmInput);

    expect(result).toMatchObject({ status: OrderStatus.CANCELLED });
    expect(h.couponUpdateMany).not.toHaveBeenCalled();
  });

  it('returns the already-materialised order for a replayed confirmation, whatever its status', async () => {
    const h = buildConfirmPrepaidHarness({ usesCount: 0, maxUsesTotal: null, maxUsesPerUser: null });
    const fastify = (h.service as unknown as { fastify: { prisma: { payment: { findFirst: ReturnType<typeof vi.fn> } } } }).fastify;
    fastify.prisma.payment.findFirst.mockResolvedValue({ order: serializedOrder({ status: OrderStatus.CANCELLED }) });

    const result = await h.service.confirmPrepaid('user_1', confirmInput);

    expect(result).toMatchObject({ status: OrderStatus.CANCELLED });
    expect(h.tx.order.create).not.toHaveBeenCalled();
  });
});

describe('OrdersService initiatePayment reuses the live Razorpay order', () => {
  function build(payment: Record<string, unknown> | null) {
    const createOrder = vi.fn().mockResolvedValue({ providerOrderId: 'order_rzp_new', amount: 9000, currency: 'INR' });
    const paymentUpdate = vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...payment, ...args.data }));
    const paymentUpsert = vi.fn().mockResolvedValue({ provider: 'RAZORPAY', providerOrderId: 'order_rzp_new', amount: 9000, currency: 'INR' });
    const service = new OrdersService({
      log: { error: vi.fn() },
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'order_1',
            userId: 'user_1',
            orderNumber: 'ORD-ABC123',
            paymentMode: 'PREPAID',
            status: OrderStatus.PENDING_PAYMENT,
            total: 9000,
            payment
          })
        },
        payment: { upsert: paymentUpsert, update: paymentUpdate }
      },
      queues: { analytics: { add: vi.fn() } },
      checkoutRisk: { assertInitiatePaymentAllowed: vi.fn().mockResolvedValue(undefined) }
    } as unknown as ServiceDeps);
    (service as unknown as { razorpayAdapter: { createOrder: typeof createOrder } }).razorpayAdapter = { createOrder };
    return { service, createOrder, paymentUpsert, paymentUpdate };
  }

  const existingPayment = {
    id: 'payment_1',
    provider: 'RAZORPAY',
    providerOrderId: 'order_rzp_first',
    amount: 9000,
    currency: 'INR'
  };

  it('returns the existing order_id instead of orphaning it (double click / second tab / retry)', async () => {
    const h = build({ ...existingPayment, status: PaymentStatus.CREATED });

    const result = await h.service.initiatePayment('user_1', { orderId: 'order_1' });

    expect(result).toMatchObject({ providerOrderId: 'order_rzp_first', amount: 9000 });
    expect(h.createOrder).not.toHaveBeenCalled();
    expect(h.paymentUpsert).not.toHaveBeenCalled();
  });

  it('reuses the order_id after a failed attempt and resets the payment to CREATED', async () => {
    const h = build({ ...existingPayment, status: PaymentStatus.FAILED });

    const result = await h.service.initiatePayment('user_1', { orderId: 'order_1' });

    expect(result).toMatchObject({ providerOrderId: 'order_rzp_first' });
    expect(h.paymentUpdate).toHaveBeenCalledWith({ where: { id: 'payment_1' }, data: { status: PaymentStatus.CREATED } });
    expect(h.createOrder).not.toHaveBeenCalled();
  });

  it('issues a new Razorpay order when the amount changed', async () => {
    const h = build({ ...existingPayment, amount: 12000, status: PaymentStatus.CREATED });

    const result = await h.service.initiatePayment('user_1', { orderId: 'order_1' });

    expect(h.createOrder).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ providerOrderId: 'order_rzp_new' });
  });
});

describe('findStaleCartPrices', () => {
  it('flags lines whose add-time snapshot differs from the live variant price', () => {
    expect(
      findStaleCartPrices([
        { id: 'ci_1', variantId: 'v1', priceSnapshot: 8000, variant: { price: 10000 } },
        { id: 'ci_2', variantId: 'v2', priceSnapshot: 5000, variant: { price: 5000 } },
        { id: 'ci_3', variantId: 'v3', priceSnapshot: 7000, variant: { price: 6500 } }
      ])
    ).toEqual([
      { cartItemId: 'ci_1', variantId: 'v1', previousPricePaise: 8000, currentPricePaise: 10000 },
      { cartItemId: 'ci_3', variantId: 'v3', previousPricePaise: 7000, currentPricePaise: 6500 }
    ]);
  });
});

describe('OrdersService prepareCheckout guards', () => {
  function buildPrepare(cartItems: unknown[], reservedByOthers: number) {
    const cartItemUpdate = vi.fn().mockResolvedValue(undefined);
    const createOrder = vi.fn();
    const service = new OrdersService({
      log: { error: vi.fn() },
      prisma: {
        address: { findFirst: vi.fn() },
        cart: { findFirst: vi.fn().mockResolvedValue({ id: 'cart_1', coupon: null, reservations: [], items: cartItems }) },
        cartItem: { update: cartItemUpdate },
        cartReservation: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: reservedByOthers } }) },
        storeSettings: { findUnique: vi.fn().mockResolvedValue({ minOrderValuePaise: 0 }) },
        pincodeServiceability: { findFirst: vi.fn() }
      },
      checkoutRisk: { assertInitiatePaymentAllowed: vi.fn() }
    } as unknown as ServiceDeps);
    (service as unknown as { razorpayAdapter: { createOrder: typeof createOrder } }).razorpayAdapter = { createOrder };
    return { service, cartItemUpdate, createOrder };
  }

  const line = (priceSnapshot: number, price: number, stock: number) => ({
    id: 'ci_1',
    variantId: 'variant_1',
    quantity: 1,
    priceSnapshot,
    variant: {
      id: 'variant_1',
      name: '1kg',
      sku: 'RICE-1',
      price,
      isActive: true,
      inventory: { quantity: stock },
      product: { categoryId: 'cat_1', name: 'Rice', isActive: true, isLocalDeliveryOnly: false }
    }
  });

  const shippingAddress = {
    fullName: 'Test User',
    phone: '9999999999',
    line1: 'Line 1',
    city: 'City',
    state: 'State',
    pincode: '560001'
  };

  async function withServiceablePincode<T>(run: () => Promise<T>): Promise<T> {
    const { CartService } = await import('../cart/cart.service');
    const spy = vi
      .spyOn(CartService.prototype, 'checkPincodeServiceability')
      .mockResolvedValue({ serviceable: true } as Awaited<ReturnType<typeof CartService.prototype.checkPincodeServiceability>>);
    try {
      return await run();
    } finally {
      spy.mockRestore();
    }
  }

  it('rejects with PRICE_CHANGED and re-prices the cart before any Razorpay order is created', async () => {
    const h = buildPrepare([line(8000, 10000, 5)], 0);

    await withServiceablePincode(async () => {
      await expect(h.service.prepareCheckout('user_1', { shippingAddress })).rejects.toMatchObject({
        code: 'PRICE_CHANGED',
        statusCode: 409,
        details: { items: [{ variantId: 'variant_1', previousPricePaise: 8000, currentPricePaise: 10000 }] }
      });
    });

    expect(h.cartItemUpdate).toHaveBeenCalledWith({ where: { id: 'ci_1' }, data: { priceSnapshot: 10000 } });
    expect(h.createOrder).not.toHaveBeenCalled();
  });

  it('counts other carts’ live reservations against available stock (no double sale of the last unit)', async () => {
    const h = buildPrepare([line(10000, 10000, 1)], 1);

    await withServiceablePincode(async () => {
      await expect(h.service.prepareCheckout('user_1', { shippingAddress })).rejects.toMatchObject({
        code: 'INSUFFICIENT_STOCK'
      });
    });

    expect(h.createOrder).not.toHaveBeenCalled();
  });
});
