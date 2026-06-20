import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRefundsWorker } from './refunds.worker';

type RefundsWorkerDeps = NonNullable<Parameters<typeof createRefundsWorker>[1]>;
type RefundsWorkerType = NonNullable<RefundsWorkerDeps['Worker']>;
type RefundsPrismaType = NonNullable<RefundsWorkerDeps['PrismaClient']>;

describe('refunds worker', () => {
  let processor: undefined | ((job: { name: string; data: unknown }) => Promise<void>);
  let failedHandler: ((job: unknown, error: Error) => void) | undefined;
  const refundsQueueAdd = vi.fn();
  const razorpayInitiateRefund = vi.fn();
  const orderFindUnique = vi.fn();
  const tx = {
    order: {
      findUnique: orderFindUnique
    },
    payment: {
      updateMany: vi.fn()
    },
    orderStatusHistory: {
      create: vi.fn()
    }
  };

  function MockWorker(_name: string, proc: (job: { name: string; data: unknown }) => Promise<void>) {
    processor = proc;
    return { on: (event: string, handler: (job: unknown, error: Error) => void) => { if (event === 'failed') failedHandler = handler; } };
  }

  function MockPrismaClient() {
    return {
      $transaction<T>(fn: (mockTx: typeof tx) => Promise<T>) {
        return fn(tx);
      }
    };
  }

  function mockCreatePaymentProvider() {
    return {
      createOrder: vi.fn(),
      verifyPaymentSignature: vi.fn(),
      verifyWebhookSignature: vi.fn(),
      initiateRefund: razorpayInitiateRefund
    };
  }

  const sendTechnicalFailureAlert = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    processor = undefined;
    failedHandler = undefined;
    sendTechnicalFailureAlert.mockReset();
    refundsQueueAdd.mockReset();
    razorpayInitiateRefund.mockReset();
    orderFindUnique.mockReset();
    tx.payment.updateMany.mockReset();
    tx.orderStatusHistory.create.mockReset();
  });

  it('no-ops when order does not exist', async () => {
    createRefundsWorker({} as never, {
      Worker: MockWorker as unknown as RefundsWorkerType,
      PrismaClient: MockPrismaClient as unknown as RefundsPrismaType,
      createPaymentProvider: mockCreatePaymentProvider,
      sendTechnicalFailureAlert
    });
    orderFindUnique.mockResolvedValue(null);

    await processor?.({
      name: 'initiate-razorpay-refund',
      data: { orderId: 'order_1', reason: 'Order cancelled and refunded by admin' }
    });

    expect(razorpayInitiateRefund).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(refundsQueueAdd).not.toHaveBeenCalled();
  });

  it('updates statuses and enqueues credit note after refund success', async () => {
    createRefundsWorker({} as never, {
      Worker: MockWorker as unknown as RefundsWorkerType,
      PrismaClient: MockPrismaClient as unknown as RefundsPrismaType,
      createPaymentProvider: mockCreatePaymentProvider,
      sendTechnicalFailureAlert
    });
    orderFindUnique.mockResolvedValue({
      id: 'order_1',
      status: 'CANCELLED',
      payment: {
        id: 'payment_1',
        status: 'CAPTURED',
        amount: 10000,
        refundedAmountPaise: 0,
        refundPendingAmountPaise: 0,
        providerPaymentId: 'pay_1'
      }
    });
    razorpayInitiateRefund.mockResolvedValue({ providerRefundId: 'rfnd_1' });
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await processor?.({
      name: 'initiate-razorpay-refund',
      data: { orderId: 'order_1', reason: 'Order cancelled and refunded by admin' }
    });

    expect(razorpayInitiateRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: 'pay_1',
        amount: 10000
      })
    );
    expect(tx.payment.updateMany).toHaveBeenCalled();
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order_1',
          fromStatus: 'CANCELLED',
          toStatus: 'CANCELLED',
          triggeredBy: 'SYSTEM'
        })
      })
    );
    expect(refundsQueueAdd).not.toHaveBeenCalled();
  });

  it('supports direct refunded state and partial refund amount', async () => {
    createRefundsWorker({} as never, {
      Worker: MockWorker as unknown as RefundsWorkerType,
      PrismaClient: MockPrismaClient as unknown as RefundsPrismaType,
      createPaymentProvider: mockCreatePaymentProvider,
      sendTechnicalFailureAlert
    });
    orderFindUnique.mockResolvedValue({
      id: 'order_2',
      status: 'REFUNDED',
      payment: {
        id: 'payment_2',
        status: 'CAPTURED',
        amount: 10000,
        refundedAmountPaise: 0,
        refundPendingAmountPaise: 0,
        providerPaymentId: 'pay_2'
      }
    });
    razorpayInitiateRefund.mockResolvedValue({ providerRefundId: 'rfnd_2' });
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await processor?.({
      name: 'initiate-razorpay-refund',
      data: {
        orderId: 'order_2',
        reason: 'Partial goodwill refund',
        refundAmountPaise: 2500,
        initiatedBy: 'ADMIN',
        sourceStatus: 'DELIVERED'
      }
    });

    expect(razorpayInitiateRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: 'pay_2',
        amount: 2500
      })
    );
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          refundPendingAmountPaise: {
            increment: 2500
          }
        })
      })
    );
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: 'DELIVERED',
          toStatus: 'DELIVERED',
          triggeredBy: 'ADMIN'
        })
      })
    );
  });

  it('sends terminal failure alert when refund job exhausts all attempts', () => {
    createRefundsWorker({} as never, {
      Worker: MockWorker as unknown as RefundsWorkerType,
      PrismaClient: MockPrismaClient as unknown as RefundsPrismaType,
      createPaymentProvider: mockCreatePaymentProvider,
      sendTechnicalFailureAlert
    });

    const terminalJob = { name: 'initiate-razorpay-refund', id: 'job_r1', opts: { attempts: 3 }, attemptsMade: 3 };
    failedHandler?.(terminalJob, new Error('provider timeout'));

    expect(sendTechnicalFailureAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: 'refunds',
        jobName: 'initiate-razorpay-refund',
        jobId: 'job_r1',
        terminalFailure: true,
        errorMessage: 'provider timeout'
      })
    );
  });

  it('does NOT send alert when refund job still has remaining attempts', () => {
    createRefundsWorker({} as never, {
      Worker: MockWorker as unknown as RefundsWorkerType,
      PrismaClient: MockPrismaClient as unknown as RefundsPrismaType,
      createPaymentProvider: mockCreatePaymentProvider,
      sendTechnicalFailureAlert
    });

    const retryJob = { name: 'initiate-razorpay-refund', id: 'job_r2', opts: { attempts: 3 }, attemptsMade: 1 };
    failedHandler?.(retryJob, new Error('transient error'));

    expect(sendTechnicalFailureAlert).not.toHaveBeenCalled();
  });

  it('throws when provider payment id is missing', async () => {
    createRefundsWorker({} as never, {
      Worker: MockWorker as unknown as RefundsWorkerType,
      PrismaClient: MockPrismaClient as unknown as RefundsPrismaType,
      createPaymentProvider: mockCreatePaymentProvider,
      sendTechnicalFailureAlert
    });
    orderFindUnique.mockResolvedValue({
      id: 'order_1',
      status: 'CANCELLED',
      payment: {
        id: 'payment_1',
        status: 'CAPTURED',
        amount: 10000,
        refundedAmountPaise: 0,
        providerPaymentId: null
      }
    });

    await expect(
      processor?.({
        name: 'initiate-razorpay-refund',
        data: { orderId: 'order_1', reason: 'Order cancelled and refunded by admin' }
      })
    ).rejects.toThrow('Missing provider payment id for refund');
  });
});

