import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

describe('OrdersService initiatePayment guards', () => {
  it('rejects payment initiation for COD orders', async () => {
    const service = new OrdersService({
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'order_1',
            userId: 'user_1',
            paymentMode: 'COD',
            status: 'CONFIRMED',
            total: 10_000
          })
        }
      }
    } as unknown as ConstructorParameters<typeof OrdersService>[0]);

    await expect(
      service.initiatePayment('user_1', { orderId: 'order_1' })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'COD orders do not require online payment'
    });
  });

  it('rejects payment initiation when order is not pending payment', async () => {
    const service = new OrdersService({
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'order_1',
            userId: 'user_1',
            paymentMode: 'PREPAID',
            status: 'CONFIRMED',
            total: 10_000
          })
        }
      }
    } as unknown as ConstructorParameters<typeof OrdersService>[0]);

    await expect(
      service.initiatePayment('user_1', { orderId: 'order_1' })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Payment can only be initiated for pending-payment orders'
    });
  });

  it('returns 404 when order is not found for the user', async () => {
    const service = new OrdersService({
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue(null)
        }
      }
    } as unknown as ConstructorParameters<typeof OrdersService>[0]);

    await expect(
      service.initiatePayment('user_1', { orderId: 'missing_order' })
    ).rejects.toMatchObject({
      statusCode: 404,
      message: 'Order not found'
    });
  });

  it('returns 502 and logs when Razorpay createOrder fails', async () => {
    const paymentUpsert = vi.fn();
    const logError = vi.fn();
    const service = new OrdersService({
      log: { error: logError },
      prisma: {
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'order_1',
            userId: 'user_1',
            orderNumber: 'ORD-2026-00001',
            paymentMode: 'PREPAID',
            status: 'PENDING_PAYMENT',
            total: 10_000
          })
        },
        payment: { upsert: paymentUpsert }
      },
      checkoutRisk: {
        assertInitiatePaymentAllowed: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as ConstructorParameters<typeof OrdersService>[0]);

    (
      service as unknown as {
        razorpayAdapter: { createOrder: ReturnType<typeof vi.fn> };
      }
    ).razorpayAdapter = {
      createOrder: vi.fn().mockRejectedValue(new Error('razorpay timeout'))
    };

    await expect(
      service.initiatePayment('user_1', { orderId: 'order_1' })
    ).rejects.toMatchObject({
      statusCode: 502,
      message: 'Unable to initiate payment order'
    });

    expect(logError).toHaveBeenCalled();
    expect(paymentUpsert).not.toHaveBeenCalled();
  });
});
