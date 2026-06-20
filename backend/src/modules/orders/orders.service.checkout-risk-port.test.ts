import { PaymentProvider } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

describe('OrdersService CheckoutRiskAssessmentPort injection', () => {
  it('calls injected port assertInitiatePaymentAllowed before payment creation', async () => {
    const assertInitiatePaymentAllowed = vi.fn().mockResolvedValue(undefined);
    const findFirst = vi.fn().mockResolvedValue({
      id: 'order_1',
      total: 5000,
      orderNumber: 'ORD-1',
      paymentMode: 'PREPAID',
      status: 'PENDING_PAYMENT'
    });
    const upsert = vi.fn().mockResolvedValue({
      id: 'pay_1',
      provider: PaymentProvider.RAZORPAY,
      providerOrderId: 'rzp_ord_test',
      amount: 5000,
      currency: 'INR'
    });
    const outboxCreate = vi.fn().mockResolvedValue({});

    const fastify = {
      checkoutRisk: { assertInitiatePaymentAllowed },
      prisma: {
        order: { findFirst },
        payment: { upsert },
        outboxMessage: { create: outboxCreate }
      },
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    };

    const service = new OrdersService(fastify as never);

    (service as unknown as Record<string, unknown>).razorpayAdapter = {
      createOrder: vi.fn().mockResolvedValue({
        providerOrderId: 'rzp_ord_test',
        amount: 5000,
        currency: 'INR'
      }),
      verifyWebhookSignature: () => true,
      verifyPaymentSignature: () => true,
      initiateRefund: vi.fn().mockResolvedValue(undefined)
    };

    await service.initiatePayment('user_1', { orderId: 'order_1' });

    expect(assertInitiatePaymentAllowed).toHaveBeenCalledTimes(1);
    expect(assertInitiatePaymentAllowed).toHaveBeenCalledWith({
      userId: 'user_1',
      orderId: 'order_1',
      orderTotalPaise: 5000
    });
  });
});
