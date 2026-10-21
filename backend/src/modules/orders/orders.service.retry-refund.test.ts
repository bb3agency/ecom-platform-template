import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OrdersService } from './orders.service';

function owedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order_1',
    status: 'CANCELLED',
    updatedAt: new Date(),
    payment: {
      providerPaymentId: 'pay_1',
      status: 'CAPTURED',
      amount: 108572,
      refundedAmountPaise: 0,
      refundPendingAmountPaise: 0
    },
    statusHistory: [],
    ...overrides
  };
}

function build(order: unknown) {
  const refundsAdd = vi.fn().mockResolvedValue(undefined);
  const historyCreate = vi.fn().mockResolvedValue(undefined);
  const fastify = {
    prisma: {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      orderStatusHistory: { create: historyCreate }
    },
    queues: { refunds: { add: refundsAdd } },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
  } as unknown as FastifyInstance;
  const service = new OrdersService(fastify);
  const detail = vi.spyOn(service, 'adminGetOrderById').mockResolvedValue({ id: 'order_1' } as never);
  return { service, refundsAdd, historyCreate, detail };
}

describe('OrdersService.adminRetryRefund', () => {
  it('re-queues the owed amount with a unique job id and notes who asked (even inside the grace period)', async () => {
    const { service, refundsAdd, historyCreate, detail } = build(owedOrder());

    await service.adminRetryRefund('order_1', 'admin_9');

    expect(historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order_1',
        fromStatus: 'CANCELLED',
        toStatus: 'CANCELLED',
        triggeredBy: 'ADMIN',
        note: 'Refund retry requested (108572 paise) [admin:admin_9]'
      })
    });
    expect(refundsAdd).toHaveBeenCalledWith(
      'initiate-razorpay-refund',
      expect.objectContaining({ orderId: 'order_1', refundAmountPaise: 108572, initiatedBy: 'ADMIN' }),
      { jobId: expect.stringMatching(/^initiate-razorpay-refund-order_1-admin-retry-/) }
    );
    expect(detail).toHaveBeenCalledWith('order_1');
  });

  it('refuses with 409 when nothing is owed (refund already with the provider)', async () => {
    const base = owedOrder();
    const { service, refundsAdd } = build(
      owedOrder({ payment: { ...base.payment, refundPendingAmountPaise: 108572 } })
    );

    await expect(service.adminRetryRefund('order_1', 'admin_9')).rejects.toMatchObject({ statusCode: 409 });
    expect(refundsAdd).not.toHaveBeenCalled();
  });

  it('404s for an unknown order', async () => {
    const { service } = build(null);
    await expect(service.adminRetryRefund('missing', 'admin_9')).rejects.toMatchObject({ statusCode: 404 });
  });
});
