import { describe, expect, it, vi } from 'vitest';
import { OrderStatus, PaymentProvider, PaymentStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { OrdersService } from './orders.service';

describe('OrdersService analytics producers', () => {
  it('enqueues CHECKOUT_STARTED and PAYMENT_INITIATED on initiatePayment success', async () => {
    const analyticsAdd = vi.fn().mockResolvedValue(undefined);
    const fastify = {
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'order_1',
            userId: 'user_1',
            total: 10000,
            orderNumber: 'ORD-2026-00001',
            paymentMode: 'PREPAID',
            status: OrderStatus.PENDING_PAYMENT
          })
        },
        payment: {
          upsert: vi.fn().mockResolvedValue({
            provider: PaymentProvider.RAZORPAY,
            providerOrderId: 'rzp_order_1',
            amount: 10000,
            currency: 'INR'
          })
        }
      },
      queues: {
        analytics: {
          add: analyticsAdd
        }
      },
      redis: {
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1)
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    (service as unknown as { razorpayAdapter: { createOrder: (input: unknown) => Promise<unknown> } }).razorpayAdapter = {
      createOrder: vi.fn().mockResolvedValue({
        providerOrderId: 'rzp_order_1',
        amount: 10000,
        currency: 'INR'
      })
    };

    await service.initiatePayment('user_1', { orderId: 'order_1' });

    expect(analyticsAdd).toHaveBeenCalledWith(
      'record-event',
      expect.objectContaining({
        eventType: 'CHECKOUT_STARTED',
        sessionId: 'order:order_1',
        userId: 'user_1'
      }),
      expect.objectContaining({
        jobId: 'analytics-CHECKOUT_STARTED-order-order_1'
      })
    );
    expect(analyticsAdd).toHaveBeenCalledWith(
      'record-event',
      expect.objectContaining({
        eventType: 'PAYMENT_INITIATED',
        sessionId: 'order:order_1',
        userId: 'user_1'
      }),
      expect.objectContaining({
        jobId: 'analytics-PAYMENT_INITIATED-order-order_1'
      })
    );
  });

  it('enqueues order-processing job on verifyPayment success', async () => {
    const orderProcessingAdd = vi.fn().mockResolvedValue(undefined);
    const analyticsAdd = vi.fn().mockResolvedValue(undefined);

    const fastify = {
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'order_1',
            userId: 'user_1',
            status: OrderStatus.PENDING_PAYMENT,
            payment: {
              id: 'payment_1',
              providerOrderId: 'rzp_order_1',
              status: PaymentStatus.CREATED
            }
          })
        }
      },
      queues: {
        orderProcessing: {
          add: orderProcessingAdd
        },
        analytics: {
          add: analyticsAdd
        }
      },
      redis: {
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1)
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    (service as unknown as { razorpayAdapter: { verifyPaymentSignature: (input: unknown) => boolean } }).razorpayAdapter = {
      verifyPaymentSignature: vi.fn().mockReturnValue(true)
    };

    await service.verifyPayment('user_1', {
      orderId: 'order_1',
      razorpayPaymentId: 'pay_1',
      razorpaySignature: 'sig'
    });

    expect(orderProcessingAdd).toHaveBeenCalledWith(
      'deduct-inventory',
      expect.objectContaining({
        event: 'payment.captured',
        providerOrderId: 'rzp_order_1',
        providerPaymentId: 'pay_1'
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^deduct-inventory-[a-f0-9]{24}$/)
      })
    );
    expect(analyticsAdd).not.toHaveBeenCalledWith(
      'record-event',
      expect.objectContaining({ eventType: 'PURCHASE' })
    );
  });

  it('does not enqueue duplicate PURCHASE when payment already captured', async () => {
    const analyticsAdd = vi.fn().mockResolvedValue(undefined);
    const fastify = {
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'order_1',
            userId: 'user_1',
            status: OrderStatus.CONFIRMED,
            payment: {
              id: 'payment_1',
              providerOrderId: 'rzp_order_1',
              providerPaymentId: 'pay_1',
              status: PaymentStatus.CAPTURED
            }
          })
        },
        $transaction: vi.fn()
      },
      queues: {
        analytics: {
          add: analyticsAdd
        }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    (service as unknown as { razorpayAdapter: { verifyPaymentSignature: (input: unknown) => boolean } }).razorpayAdapter = {
      verifyPaymentSignature: vi.fn().mockReturnValue(true)
    };

    const result = await service.verifyPayment('user_1', {
      orderId: 'order_1',
      razorpayPaymentId: 'pay_1',
      razorpaySignature: 'sig'
    });

    expect(result).toEqual({ message: 'Payment already verified' });
    expect(analyticsAdd).not.toHaveBeenCalled();
  });
});

