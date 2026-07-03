import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let failedHandler: ((job: unknown, error: Error) => void) | undefined;

const state = {
  processor: undefined as undefined | ((job: { name: string; data: unknown }) => Promise<void>),
  notificationsAdd: vi.fn(),
  paymentFindFirst: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    payment: {
      findFirst: vi.fn(),
      update: vi.fn()
    },
    inventory: {
      updateMany: vi.fn()
    },
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    orderStatusHistory: {
      create: vi.fn(),
      findFirst: vi.fn()
    },
    coupon: {
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    couponUsage: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined)
    },
    cart: {
      findFirst: vi.fn().mockResolvedValue({ id: 'cart_1' })
    },
    cartReservation: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    invoice: {
      findUnique: vi.fn(),
      create: vi.fn()
    }
  }
};

function MockWorker(_name: string, processor: (job: { name: string; data: unknown }) => Promise<void>) {
  state.processor = processor;
  return { on: (event: string, handler: (job: unknown, error: Error) => void) => { if (event === 'failed') failedHandler = handler; } };
}

function MockPrismaClient() {
  return {
    $transaction<T>(fn: (tx: typeof state.tx) => Promise<T>) {
      return fn(state.tx);
    },
    payment: {
      findFirst: state.paymentFindFirst
    }
  };
}

import { createOrderProcessingWorker } from './order-processing.worker';
import { featureFlags } from '../../src/config/feature-flags';

describe('order-processing worker error and retry behavior', () => {
  const mockConnection = {} as Parameters<typeof createOrderProcessingWorker>[0];
  let originalGstFlag: boolean;
  type QueueArg = Parameters<typeof createOrderProcessingWorker>[1];
  type InvoiceStorageArg = Parameters<typeof createOrderProcessingWorker>[3];
  type WorkerDeps = NonNullable<Parameters<typeof createOrderProcessingWorker>[6]>;
  type WorkerType = NonNullable<WorkerDeps['Worker']>;
  type PrismaType = NonNullable<WorkerDeps['PrismaClient']>;
  const mockQueue = { add: state.notificationsAdd } as unknown as QueueArg;
  const sendTechnicalFailureAlert = vi.fn().mockResolvedValue(undefined);
  const workerDeps = { Worker: MockWorker as unknown as WorkerType, PrismaClient: MockPrismaClient as unknown as PrismaType, sendTechnicalFailureAlert };
  const boot = (invoiceStorageAdapterArg?: InvoiceStorageArg) =>
    createOrderProcessingWorker(
      mockConnection,
      mockQueue,
      mockQueue,
      invoiceStorageAdapterArg,
      mockQueue,
      mockQueue,
      workerDeps
    );

  beforeEach(() => {
    originalGstFlag = featureFlags.gstInvoicing;
    featureFlags.gstInvoicing = true;
    failedHandler = undefined;
    sendTechnicalFailureAlert.mockReset();
    state.processor = undefined;
    state.paymentFindFirst.mockReset();
    state.tx.payment.findFirst.mockReset();
    state.tx.$executeRaw.mockReset();
    state.tx.$queryRaw.mockReset();
    state.tx.payment.update.mockReset();
    state.tx.inventory.updateMany.mockReset();
    state.tx.order.findUnique.mockReset();
    state.tx.order.update.mockReset();
    state.tx.order.updateMany.mockReset();
    state.tx.orderStatusHistory.create.mockReset();
    state.tx.orderStatusHistory.findFirst.mockReset();
    state.tx.coupon.update.mockReset();
    state.tx.coupon.updateMany.mockReset();
    state.tx.couponUsage.findUnique.mockReset();
    state.tx.couponUsage.create.mockReset();
    state.tx.couponUsage.findMany.mockReset();
    state.tx.couponUsage.delete.mockReset();
    state.tx.cart.findFirst.mockReset();
    state.tx.cartReservation.deleteMany.mockReset();
    state.tx.invoice.findUnique.mockReset();
    state.tx.invoice.create.mockReset();
    state.notificationsAdd.mockReset();
    state.tx.couponUsage.findUnique.mockResolvedValue(null);
    state.tx.couponUsage.findMany.mockResolvedValue([]);
    state.tx.cart.findFirst.mockResolvedValue({ id: 'cart_1' });
    state.tx.cartReservation.deleteMany.mockResolvedValue({ count: 1 });
    state.tx.$executeRaw.mockResolvedValue(undefined);
    state.tx.$queryRaw.mockResolvedValue([{ nextval: 1n }]);
    vi.unstubAllEnvs();
    vi.stubEnv('INVOICE_STORAGE_ROOT', 'tmp/invoices');
  });

  afterEach(() => {
    featureFlags.gstInvoicing = originalGstFlag;
  });

  it('returns without changes when payment is missing', async () => {
    boot();
    state.tx.payment.findFirst.mockResolvedValue(null);

    await state.processor?.({
      name: 'payment-webhook',
      data: { providerOrderId: 'order_1', providerPaymentId: 'pay_1', event: 'payment.failed', payload: '{}' }
    });

    expect(state.tx.payment.update).not.toHaveBeenCalled();
    expect(state.tx.order.update).not.toHaveBeenCalled();
  });

  it('throws when payment update fails so BullMQ can retry', async () => {
    boot();
    state.tx.payment.findFirst.mockResolvedValue({
      id: 'payment_1',
      orderId: 'order_1',
      providerPaymentId: null,
      status: 'CREATED'
    });
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      status: 'PENDING_PAYMENT',
      user: {
        email: 'test@example.com',
        phone: '9999999999'
      }
    });
    state.tx.order.updateMany.mockResolvedValue({ count: 1 });
    state.tx.payment.update.mockRejectedValue(new Error('transient db error'));

    await expect(
      state.processor?.({
        name: 'payment-webhook',
        data: { providerOrderId: 'order_1', providerPaymentId: 'pay_1', event: 'payment.failed', payload: '{}' }
      })
    ).rejects.toThrow('transient db error');
  });

  it('routes deduct-inventory jobs to process-order-update enqueue', async () => {
    boot();
    state.paymentFindFirst.mockResolvedValue({
      id: 'payment_1',
      orderId: 'order_1'
    });

    await state.processor?.({
      name: 'deduct-inventory',
      data: { providerOrderId: 'order_1', providerPaymentId: 'pay_1', event: 'payment.captured', payload: '{}' }
    });

    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'process-order-update',
      expect.objectContaining({
        orderId: 'order_1',
        toStatus: 'CONFIRMED',
        triggeredBy: 'PAYMENT_WEBHOOK',
        providerPaymentId: 'pay_1',
        providerOrderId: 'order_1'
      }),
      expect.objectContaining({
        jobId: 'process-order-update-confirmed-order_1'
      })
    );
    expect(state.tx.order.updateMany).not.toHaveBeenCalled();
    expect(state.tx.inventory.updateMany).not.toHaveBeenCalled();
  });

  it('process-order-update confirms order, deducts inventory and enqueues side effects', async () => {
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_1',
      status: 'PENDING_PAYMENT',
      discountAmount: 500,
      coupons: [],
      user: { email: 'customer@example.com', phone: '9999999999' },
      items: [{ variantId: 'variant_1', quantity: 2 }],
      payment: { id: 'payment_1', status: 'CREATED' }
    });
    state.tx.order.updateMany.mockResolvedValue({ count: 1 });
    state.tx.inventory.updateMany.mockResolvedValue({ count: 1 });
    state.tx.payment.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'process-order-update',
      data: { orderId: 'order_1', toStatus: 'CONFIRMED', triggeredBy: 'PAYMENT_WEBHOOK', providerPaymentId: 'pay_1', providerOrderId: 'order_1' }
    });

    expect(state.tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order_1',
        status: {
          in: ['PENDING_PAYMENT', 'PAYMENT_FAILED']
        }
      },
      data: { status: 'CONFIRMED' }
    });
    expect(state.tx.inventory.updateMany).toHaveBeenCalledWith({
      where: { variantId: 'variant_1', quantity: { gte: 2 } },
      data: { quantity: { decrement: 2 } }
    });
    expect(state.tx.payment.update).toHaveBeenCalled();
    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'generate-invoice',
      expect.objectContaining({ orderId: 'order_1' }),
      expect.objectContaining({ jobId: 'generate-invoice-order_1' })
    );
    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'record-event',
      expect.objectContaining({
        sessionId: 'order-order_1',
        eventType: 'PURCHASE'
      }),
      expect.objectContaining({ jobId: 'analytics-PURCHASE-order-order_1' })
    );
  });

  it('process-order-update confirms order from PAYMENT_FAILED when payment succeeds', async () => {
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_1',
      status: 'PAYMENT_FAILED',
      discountAmount: 0,
      coupons: [],
      user: { email: 'customer@example.com', phone: '9999999999' },
      items: [{ variantId: 'variant_1', quantity: 1 }],
      payment: { id: 'payment_1', status: 'FAILED' }
    });
    state.tx.order.updateMany.mockResolvedValue({ count: 1 });
    state.tx.inventory.updateMany.mockResolvedValue({ count: 1 });
    state.tx.payment.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'process-order-update',
      data: { orderId: 'order_1', toStatus: 'CONFIRMED', triggeredBy: 'PAYMENT_WEBHOOK', providerPaymentId: 'pay_1' }
    });

    expect(state.tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order_1',
        status: {
          in: ['PENDING_PAYMENT', 'PAYMENT_FAILED']
        }
      },
      data: { status: 'CONFIRMED' }
    });
  });

  it('process-order-update marks coupon usage only after successful payment confirmation', async () => {
    boot();
    state.tx.orderStatusHistory.findFirst.mockResolvedValue(null);
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_1',
      status: 'PENDING_PAYMENT',
      discountAmount: 500,
      coupons: [{ id: 'coupon_1', usesCount: 2 }],
      user: { email: 'customer@example.com', phone: '9999999999' },
      items: [{ variantId: 'variant_1', quantity: 1 }],
      payment: { id: 'payment_1', status: 'CREATED' }
    });
    state.tx.order.updateMany.mockResolvedValue({ count: 1 });
    state.tx.inventory.updateMany.mockResolvedValue({ count: 1 });
    state.tx.payment.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);
    state.tx.coupon.update.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'process-order-update',
      data: { orderId: 'order_1', toStatus: 'CONFIRMED', triggeredBy: 'PAYMENT_WEBHOOK', providerPaymentId: 'pay_1' }
    });

    expect(state.tx.coupon.update).toHaveBeenCalledOnce();
    expect(state.tx.couponUsage.create).toHaveBeenCalledWith({
      data: {
        couponId: 'coupon_1',
        orderId: 'order_1',
        userId: 'user_1',
        discountAmount: 500
      }
    });
  });

  it('process-order-update is idempotent when prepaid order is already CONFIRMED', async () => {
    boot();
    state.tx.orderStatusHistory.findFirst.mockResolvedValue(null);
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_1',
      status: 'CONFIRMED',
      coupons: [],
      user: { email: 'customer@example.com', phone: null },
      items: [{ variantId: 'variant_1', quantity: 1 }],
      payment: { id: 'payment_1', status: 'CAPTURED' }
    });

    await state.processor?.({
      name: 'process-order-update',
      data: { orderId: 'order_1', toStatus: 'CONFIRMED', triggeredBy: 'PAYMENT_WEBHOOK' }
    });

    expect(state.tx.order.updateMany).not.toHaveBeenCalled();
    expect(state.tx.inventory.updateMany).not.toHaveBeenCalled();
    expect(state.notificationsAdd).not.toHaveBeenCalledWith('generate-invoice', expect.anything(), expect.anything());
  });

  it('process-order-update runs side effects for COD orders already at CONFIRMED', async () => {
    boot();
    state.tx.orderStatusHistory.findFirst.mockResolvedValue(null);
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_cod_1',
      userId: 'user_1',
      status: 'CONFIRMED',
      coupons: [],
      user: { email: 'customer@example.com', phone: '9999999999' },
      items: [{ variantId: 'variant_1', quantity: 1 }],
      payment: { id: 'payment_cod_1', status: 'CREATED' }
    });
    state.tx.inventory.updateMany.mockResolvedValue({ count: 1 });
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'process-order-update',
      data: {
        orderId: 'order_cod_1',
        toStatus: 'CONFIRMED',
        triggeredBy: 'COD_ORDER_CREATED',
        note: 'COD order placed'
      }
    });

    expect(state.tx.order.updateMany).not.toHaveBeenCalled();
    expect(state.tx.inventory.updateMany).toHaveBeenCalledWith({
      where: { variantId: 'variant_1', quantity: { gte: 1 } },
      data: { quantity: { decrement: 1 } }
    });
    expect(state.tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order_cod_1',
        triggeredBy: 'COD_ORDER_CREATED'
      })
    });
    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'generate-invoice',
      expect.objectContaining({ orderId: 'order_cod_1' }),
      expect.objectContaining({ jobId: 'generate-invoice-order_cod_1' })
    );
  });

  it('process-order-update skips duplicate COD side-effect jobs', async () => {
    boot();
    state.tx.orderStatusHistory.findFirst.mockResolvedValue({ id: 'history_1' });
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_cod_1',
      userId: 'user_1',
      status: 'CONFIRMED',
      coupons: [],
      user: { email: 'customer@example.com', phone: null },
      items: [{ variantId: 'variant_1', quantity: 1 }],
      payment: { id: 'payment_cod_1', status: 'CREATED' }
    });

    await state.processor?.({
      name: 'process-order-update',
      data: {
        orderId: 'order_cod_1',
        toStatus: 'CONFIRMED',
        triggeredBy: 'COD_ORDER_CREATED'
      }
    });

    expect(state.tx.inventory.updateMany).not.toHaveBeenCalled();
    expect(state.notificationsAdd).not.toHaveBeenCalledWith('generate-invoice', expect.anything(), expect.anything());
  });

  it('cancels COD order without capturing payment when inventory deduction fails', async () => {
    boot();
    state.tx.orderStatusHistory.findFirst.mockResolvedValue(null);
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_cod_1',
      userId: 'user_1',
      status: 'CONFIRMED',
      discountAmount: 500,
      coupons: [{ id: 'coupon_1', usesCount: 1 }],
      user: { email: 'customer@example.com', phone: null },
      items: [{ variantId: 'variant_1', quantity: 1 }],
      payment: { id: 'payment_cod_1', status: 'CREATED' }
    });
    state.tx.inventory.updateMany.mockResolvedValue({ count: 0 });
    state.tx.order.updateMany.mockResolvedValue({ count: 1 });
    state.tx.couponUsage.findMany.mockResolvedValue([
      { id: 'usage_1', couponId: 'coupon_1', orderId: 'order_cod_1', userId: 'user_1' }
    ]);

    await state.processor?.({
      name: 'process-order-update',
      data: {
        orderId: 'order_cod_1',
        toStatus: 'CONFIRMED',
        triggeredBy: 'COD_ORDER_CREATED'
      }
    });

    expect(state.tx.payment.update).not.toHaveBeenCalled();
    expect(state.tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order_cod_1', status: 'CONFIRMED' },
      data: { status: 'CANCELLED' }
    });
    expect(state.notificationsAdd).not.toHaveBeenCalledWith(
      'initiate-razorpay-refund',
      expect.anything(),
      expect.anything()
    );
    expect(state.tx.couponUsage.delete).toHaveBeenCalled();
  });

  it('skips deduct-inventory when no payment record is found for providerOrderId', async () => {
    boot();
    state.paymentFindFirst.mockResolvedValue(null);

    await state.processor?.({
      name: 'deduct-inventory',
      data: { providerOrderId: 'order_unknown', providerPaymentId: 'pay_1', event: 'payment.captured', payload: '{}' }
    });

    expect(state.notificationsAdd).not.toHaveBeenCalledWith('process-order-update', expect.anything(), expect.anything());
    expect(state.tx.inventory.updateMany).not.toHaveBeenCalled();
  });

  it('enqueues payment failed primary notification on failed payment webhook', async () => {
    boot();
    state.tx.payment.findFirst.mockResolvedValue({
      id: 'payment_1',
      orderId: 'order_1',
      providerPaymentId: null,
      status: 'CREATED'
    });
    state.tx.order.findUnique
      .mockResolvedValueOnce({
        id: 'order_1',
        status: 'PENDING_PAYMENT',
        user: {
          email: 'customer@example.com',
          phone: '9999999999'
        }
      })
      .mockResolvedValueOnce({
        userId: 'user_1',
        items: [{ variantId: 'variant_1' }]
      });
    state.tx.payment.update.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'payment-webhook',
      data: { providerOrderId: 'order_1', providerPaymentId: 'pay_1', event: 'payment.failed', payload: '{}' }
    });

    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'send-primary',
      expect.objectContaining({
        email: 'customer@example.com',
        phone: '9999999999',
        template: 'PaymentFailed'
      })
    );
    expect(state.tx.cartReservation.deleteMany).toHaveBeenCalled();
  });

  it('releases reservations on payment failure for phone-only customers', async () => {
    boot();
    state.tx.payment.findFirst.mockResolvedValue({
      id: 'payment_1',
      orderId: 'order_1',
      providerPaymentId: null,
      status: 'CREATED'
    });
    state.tx.order.findUnique
      .mockResolvedValueOnce({
        id: 'order_1',
        status: 'PENDING_PAYMENT',
        user: {
          email: null,
          phone: '9999999999'
        }
      })
      .mockResolvedValueOnce({
        userId: 'user_1',
        items: [{ variantId: 'variant_1' }]
      });
    state.tx.payment.update.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'payment-webhook',
      data: { providerOrderId: 'order_1', providerPaymentId: 'pay_1', event: 'payment.failed', payload: '{}' }
    });

    expect(state.tx.cartReservation.deleteMany).toHaveBeenCalled();
    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'send-primary',
      expect.objectContaining({
        phone: '9999999999',
        template: 'PaymentFailed'
      })
    );
  });

  it('confirm-order delegates to process-order-update enqueue', async () => {
    boot();
    state.paymentFindFirst.mockResolvedValue({
      id: 'payment_1',
      orderId: 'order_1'
    });

    await state.processor?.({
      name: 'confirm-order',
      data: { providerOrderId: 'order_1', providerPaymentId: 'pay_1', event: 'payment.captured', payload: '{}' }
    });

    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'process-order-update',
      expect.objectContaining({
        orderId: 'order_1',
        toStatus: 'CONFIRMED',
        triggeredBy: 'PAYMENT_WEBHOOK'
      }),
      expect.objectContaining({
        jobId: 'process-order-update-confirmed-order_1'
      })
    );
    expect(state.tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('process-order-update enqueues invoice and uses send-primary for OrderConfirmed', async () => {
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      status: 'PENDING_PAYMENT',
      userId: 'user_1',
      coupons: [],
      user: { email: null, phone: '9999999999' },
      items: [{ variantId: 'variant_1', quantity: 2 }],
      payment: { id: 'payment_1', status: 'CREATED' }
    });
    state.tx.order.updateMany.mockResolvedValue({ count: 1 });
    state.tx.inventory.updateMany.mockResolvedValue({ count: 1 });
    state.tx.payment.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'process-order-update',
      data: { orderId: 'order_1', toStatus: 'CONFIRMED', triggeredBy: 'PAYMENT_WEBHOOK', providerPaymentId: 'pay_1', providerOrderId: 'order_1' }
    });

    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'send-primary',
      expect.objectContaining({
        email: null,
        phone: '9999999999',
        template: 'OrderConfirmed'
      }),
      expect.objectContaining({ jobId: 'notifications-primary-order_1-OrderConfirmed' })
    );
    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'generate-invoice',
      expect.objectContaining({ orderId: 'order_1' }),
      expect.objectContaining({ jobId: 'generate-invoice-order_1' })
    );
  });

  it('skips generate-invoice when GST invoicing feature flag is disabled', async () => {
    featureFlags.gstInvoicing = false;
    boot();
    await state.processor?.({
      name: 'generate-invoice',
      data: { orderId: 'order_1' }
    });
    expect(state.tx.invoice.create).not.toHaveBeenCalled();
  });

  it('creates invoice record for generate-invoice job', async () => {
    const invoiceStorageAdapter = {
      uploadInvoicePdf: vi.fn().mockResolvedValue({
        storageReference: 'client/invoices/order_1/invoice.pdf',
        providerPayload: {}
      }),
      readInvoicePdf: vi.fn()
    };
    boot(invoiceStorageAdapter);
    state.tx.invoice.findUnique.mockResolvedValue(null);
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      orderNumber: 'ORD-2026-00001',
      shippingAddress: {
        fullName: 'Test Customer',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      subtotal: 1000,
      shippingCharge: 0,
      discountAmount: 0,
      total: 1000,
      user: { email: 'customer@example.com' },
      items: [
        {
          id: 'item_1',
          productName: 'Sample Product',
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000,
          variant: {
            product: {
              attributes: {
                gstRate: 12,
                hsnCode: '1001'
              }
            }
          }
        }
      ]
    });
    state.tx.invoice.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'generate-invoice',
      data: { orderId: 'order_1' }
    });

    expect(invoiceStorageAdapter.uploadInvoicePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order_1',
        invoiceNumber: expect.stringMatching(/^INV-\d{4}-\d{5}$/)
      })
    );
    expect(state.tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order_1',
          invoiceNumber: expect.stringMatching(/^INV-\d{4}-\d{5}$/),
          pdfUrl: 'client/invoices/order_1/invoice.pdf'
        })
      })
    );
  });

  it('throws when generate-invoice job runs for order items missing explicit HSN', async () => {
    const invoiceStorageAdapter = {
      uploadInvoicePdf: vi.fn(),
      readInvoicePdf: vi.fn()
    };
    boot(invoiceStorageAdapter);
    state.tx.invoice.findUnique.mockResolvedValue(null);
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_missing_hsn',
      orderNumber: 'ORD-2026-00009',
      shippingAddress: {
        fullName: 'Test Customer',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      subtotal: 1000,
      shippingCharge: 0,
      discountAmount: 0,
      total: 1000,
      user: { email: 'customer@example.com' },
      items: [
        {
          id: 'item_missing_hsn',
          productName: 'No HSN Product',
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000,
          variant: {
            hsnCode: null,
            gstRatePercent: 0,
            product: {
              attributes: {}
            }
          }
        }
      ]
    });

    await expect(
      state.processor?.({
        name: 'generate-invoice',
        data: { orderId: 'order_missing_hsn' }
      })
    ).rejects.toThrow('Missing product HSN code for GST invoice line item item_missing_hsn');
    expect(invoiceStorageAdapter.uploadInvoicePdf).not.toHaveBeenCalled();
  });

  it('does not regenerate invoice after worker restart when invoice already exists', async () => {
    const invoiceStorageAdapter = {
      uploadInvoicePdf: vi.fn().mockResolvedValue({
        storageReference: 'client/invoices/order_1/invoice.pdf',
        providerPayload: {}
      }),
      readInvoicePdf: vi.fn()
    };

    state.tx.invoice.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'invoice_1' });
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      orderNumber: 'ORD-2026-00001',
      shippingAddress: {
        fullName: 'Test Customer',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      subtotal: 1000,
      shippingCharge: 0,
      discountAmount: 0,
      total: 1000,
      user: { email: 'customer@example.com' },
      items: [
        {
          id: 'item_1',
          productName: 'Sample Product',
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000,
          variant: {
            product: {
              attributes: {
                gstRate: 12,
                hsnCode: '1001'
              }
            }
          }
        }
      ]
    });
    state.tx.invoice.create.mockResolvedValue(undefined);

    boot(invoiceStorageAdapter);
    await state.processor?.({
      name: 'generate-invoice',
      data: { orderId: 'order_1' }
    });

    boot(invoiceStorageAdapter);
    await state.processor?.({
      name: 'generate-invoice',
      data: { orderId: 'order_1' }
    });

    expect(invoiceStorageAdapter.uploadInvoicePdf).toHaveBeenCalledTimes(1);
    expect(state.tx.invoice.create).toHaveBeenCalledTimes(1);
  });

  it('throws when invoice upload fails so BullMQ can retry', async () => {
    const invoiceStorageAdapter = {
      uploadInvoicePdf: vi.fn().mockRejectedValue(new Error('local invoice storage failure')),
      readInvoicePdf: vi.fn()
    };

    boot(invoiceStorageAdapter);
    state.tx.invoice.findUnique.mockResolvedValue(null);
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      orderNumber: 'ORD-2026-00001',
      shippingAddress: {
        fullName: 'Test Customer',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      subtotal: 1000,
      shippingCharge: 0,
      discountAmount: 0,
      total: 1000,
      user: { email: 'customer@example.com' },
      items: [
        {
          id: 'item_1',
          productName: 'Sample Product',
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000,
          variant: {
            product: {
              attributes: {
                gstRate: 12,
                hsnCode: '1001'
              }
            }
          }
        }
      ]
    });

    await expect(
      state.processor?.({
        name: 'generate-invoice',
        data: { orderId: 'order_1' }
      })
    ).rejects.toThrow('local invoice storage failure');

    expect(state.tx.invoice.create).not.toHaveBeenCalled();
  });

  it('uploads credit note PDF when original invoice exists', async () => {
    const invoiceStorageAdapter = {
      uploadInvoicePdf: vi.fn().mockResolvedValue({
        storageReference: 'client/invoices/order_1/credit-note.pdf',
        providerPayload: {}
      }),
      readInvoicePdf: vi.fn()
    };

    boot(invoiceStorageAdapter);
    state.tx.invoice.findUnique.mockResolvedValue({ id: 'inv_1', invoiceNumber: 'INV-ORD-2026-00001' });
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      orderNumber: 'ORD-2026-00001',
      status: 'REFUNDED',
      total: 1000,
      payment: { amount: 1000 },
      shippingAddress: { fullName: 'Test Customer' }
    });

    await state.processor?.({
      name: 'generate-credit-note',
      data: { orderId: 'order_1', reason: 'Order cancelled and refunded by admin' }
    });

    expect(invoiceStorageAdapter.uploadInvoicePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order_1',
        invoiceNumber: 'CN-INV-ORD-2026-00001'
      })
    );
    expect(state.tx.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order_1',
          fromStatus: 'REFUNDED',
          toStatus: 'REFUNDED'
        })
      })
    );
  });

  it('sends terminal failure alert when order-processing job exhausts all attempts', () => {
    boot();

    const terminalJob = { name: 'process-order-update', id: 'job_op1', opts: { attempts: 3 }, attemptsMade: 3 };
    failedHandler?.(terminalJob, new Error('payment capture failed'));

    expect(sendTechnicalFailureAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: 'order-processing',
        jobName: 'process-order-update',
        jobId: 'job_op1',
        terminalFailure: true,
        errorMessage: 'payment capture failed'
      })
    );
  });

  it('does NOT send alert when order-processing job still has remaining attempts', () => {
    boot();

    const retryJob = { name: 'process-order-update', id: 'job_op2', opts: { attempts: 3 }, attemptsMade: 1 };
    failedHandler?.(retryJob, new Error('transient error'));

    expect(sendTechnicalFailureAlert).not.toHaveBeenCalled();
  });

  it('throws in production when required DB-backed seller profile fields are missing', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const invoiceStorageAdapter = {
      uploadInvoicePdf: vi.fn().mockResolvedValue({
        storageReference: 'client/invoices/order_1/invoice.pdf',
        providerPayload: {}
      }),
      readInvoicePdf: vi.fn()
    };

    boot(invoiceStorageAdapter);
    state.tx.invoice.findUnique.mockResolvedValue(null);
    // Simulate missing DB-backed StoreSettings by making delegate undefined or return empty values
    // @ts-expect-error test double
    state.tx.storeSettings = undefined;

    try {
      await expect(
        state.processor?.({
          name: 'generate-invoice',
          data: { orderId: 'order_1' }
        })
      ).rejects.toThrow('Missing required DB-backed configuration for invoicing');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});

