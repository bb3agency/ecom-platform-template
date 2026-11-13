import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedError } from 'bullmq';

import { createRefundsWorker } from './refunds.worker';
import { PaymentProviderError } from '../../src/common/errors/payment-provider-error';
import { REFUND_AUTO_RETRY_DELAYS_MS } from '../../src/common/payments/refund-retry-policy';

type RefundsWorkerDeps = NonNullable<Parameters<typeof createRefundsWorker>[1]>;
type RefundsWorkerType = NonNullable<RefundsWorkerDeps['Worker']>;
type RefundsPrismaType = NonNullable<RefundsWorkerDeps['PrismaClient']>;

type TestJob = {
  name: string;
  data: unknown;
  id?: string;
  opts?: { attempts?: number };
  attemptsMade?: number;
  updateData?: (data: unknown) => Promise<void>;
  moveToDelayed?: (timestamp: number, token?: string) => Promise<void>;
};

describe('refunds worker', () => {
  let processor: undefined | ((job: TestJob, token?: string) => Promise<void>);
  let failedHandler: ((job: unknown, error: Error) => void) | undefined;
  const razorpayInitiateRefund = vi.fn();
  const findRefundByReference = vi.fn();
  const fetchOrderNotes = vi.fn();
  const paymentFindFirst = vi.fn();
  const orderFindUnique = vi.fn();
  const tx = {
    order: {
      findUnique: orderFindUnique
    },
    payment: {
      updateMany: vi.fn(),
      findFirst: paymentFindFirst
    },
    orderStatusHistory: {
      create: vi.fn()
    }
  };

  function MockWorker(_name: string, proc: (job: TestJob, token?: string) => Promise<void>) {
    processor = proc;
    return { on: (event: string, handler: (job: unknown, error: Error) => void) => { if (event === 'failed') failedHandler = handler; } };
  }

  // Outside the gate transaction the worker uses the same delegates
  // (reservation rollback on the payment, refund notes on the history).
  function MockPrismaClient() {
    return {
      ...tx,
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
      initiateRefund: razorpayInitiateRefund,
      findRefundByReference,
      fetchOrderNotes
    };
  }

  const sendTechnicalFailureAlert = vi.fn().mockResolvedValue(undefined);
  const NOW = 1_800_000_000_000;

  function startWorker() {
    createRefundsWorker({} as never, {
      Worker: MockWorker as unknown as RefundsWorkerType,
      PrismaClient: MockPrismaClient as unknown as RefundsPrismaType,
      createPaymentProvider: mockCreatePaymentProvider,
      sendTechnicalFailureAlert,
      now: () => NOW
    });
  }

  function makeJob(data: Record<string, unknown>, overrides: Partial<TestJob> = {}) {
    const job = {
      name: 'initiate-razorpay-refund',
      id: 'job_1',
      opts: { attempts: 3 },
      attemptsMade: 0,
      data,
      updateData: vi.fn().mockResolvedValue(undefined),
      moveToDelayed: vi.fn().mockResolvedValue(undefined),
      ...overrides
    };
    return job;
  }

  function capturedOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'order_1',
      status: 'CANCELLED',
      payment: {
        id: 'payment_1',
        status: 'CAPTURED',
        amount: 10000,
        refundedAmountPaise: 0,
        refundPendingAmountPaise: 0,
        providerPaymentId: 'pay_1'
      },
      ...overrides
    };
  }

  const lowBalance = () =>
    new PaymentProviderError({
      provider: 'Razorpay',
      httpStatus: 400,
      providerCode: 'BAD_REQUEST_ERROR',
      providerDescription: 'Your account does not have enough balance to carry out the refund operation.'
    });

  beforeEach(() => {
    processor = undefined;
    failedHandler = undefined;
    sendTechnicalFailureAlert.mockReset();
    razorpayInitiateRefund.mockReset();
    findRefundByReference.mockReset();
    findRefundByReference.mockResolvedValue(null);
    fetchOrderNotes.mockReset();
    fetchOrderNotes.mockResolvedValue({ userId: 'user_1' });
    paymentFindFirst.mockReset();
    orderFindUnique.mockReset();
    tx.payment.updateMany.mockReset();
    tx.orderStatusHistory.create.mockReset();
  });

  it('no-ops when order does not exist', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(null);

    await processor?.(makeJob({ orderId: 'order_1', reason: 'Order cancelled and refunded by admin' }));

    expect(razorpayInitiateRefund).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it('reserves the amount, calls the provider and writes one note under the current status', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    razorpayInitiateRefund.mockResolvedValue({ providerRefundId: 'rfnd_1', status: 'processed', amount: 10000 });
    tx.payment.updateMany.mockResolvedValue({ count: 1 });

    await processor?.(
      makeJob({ orderId: 'order_1', reason: 'r', initiatedBy: 'SHIPPING_WEBHOOK', sourceStatus: 'SHIPPED' })
    );

    expect(razorpayInitiateRefund).toHaveBeenCalledWith(
      expect.objectContaining({ providerPaymentId: 'pay_1', amount: 10000 })
    );
    expect(tx.payment.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.orderStatusHistory.create).toHaveBeenCalledTimes(1);
    // A courier-cancelled order reads "Cancelled", never its old "Shipped".
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order_1',
        fromStatus: 'CANCELLED',
        toStatus: 'CANCELLED',
        triggeredBy: 'SHIPPING_WEBHOOK',
        note: expect.stringContaining('ref rfnd_1')
      })
    });
  });

  it('supports a partial refund amount', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder({ id: 'order_2', status: 'DELIVERED' }));
    razorpayInitiateRefund.mockResolvedValue({ providerRefundId: 'rfnd_2', status: 'processed', amount: 2500 });
    tx.payment.updateMany.mockResolvedValue({ count: 1 });

    await processor?.(
      makeJob({ orderId: 'order_2', reason: 'Partial goodwill refund', refundAmountPaise: 2500, initiatedBy: 'ADMIN' })
    );

    expect(razorpayInitiateRefund).toHaveBeenCalledWith(expect.objectContaining({ amount: 2500 }));
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { refundPendingAmountPaise: { increment: 2500 } } })
    );
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'DELIVERED', toStatus: 'DELIVERED', triggeredBy: 'ADMIN' })
    });
  });

  it('a provider refusal (low balance) skips fast retries, releases the reservation and schedules a slow retry', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    razorpayInitiateRefund.mockRejectedValue(lowBalance());
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    const job = makeJob({ orderId: 'order_1', reason: 'r' });

    await expect(processor?.(job, 'tok')).rejects.toBeInstanceOf(DelayedError);

    expect(tx.payment.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: { refundPendingAmountPaise: { decrement: 10000 } } })
    );
    expect(tx.orderStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        toStatus: 'CANCELLED',
        note: expect.stringMatching(
          /^Refund failed \(10000 paise\): Your account does not have enough balance.*Retrying automatically/
        )
      })
    });
    expect(sendTechnicalFailureAlert).toHaveBeenCalledWith(expect.objectContaining({ terminalFailure: false }));
    expect(job.updateData).toHaveBeenCalledWith(expect.objectContaining({ autoRetryRound: 1 }));
    expect(job.moveToDelayed).toHaveBeenCalledWith(NOW + REFUND_AUTO_RETRY_DELAYS_MS[0]!, 'tok');
  });

  it('later slow-retry rounds stay silent (no note, no alert)', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    razorpayInitiateRefund.mockRejectedValue(lowBalance());
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    const job = makeJob({ orderId: 'order_1', reason: 'r', autoRetryRound: 3 });

    await expect(processor?.(job, 'tok')).rejects.toBeInstanceOf(DelayedError);

    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    expect(sendTechnicalFailureAlert).not.toHaveBeenCalled();
    expect(job.moveToDelayed).toHaveBeenCalledWith(NOW + REFUND_AUTO_RETRY_DELAYS_MS[3]!, 'tok');
  });

  it('after the last slow round it stops, records the refund as still owed and alerts', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    razorpayInitiateRefund.mockRejectedValue(lowBalance());
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    const job = makeJob({ orderId: 'order_1', reason: 'r', autoRetryRound: REFUND_AUTO_RETRY_DELAYS_MS.length });

    await expect(processor?.(job, 'tok')).resolves.toBeUndefined();

    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: expect.stringMatching(/^Refund still owed \(10000 paise\)/) })
    });
    expect(sendTechnicalFailureAlert).toHaveBeenCalledWith(expect.objectContaining({ terminalFailure: true }));
  });

  it('a transient failure with fast attempts left is rethrown for BullMQ, with no note', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    razorpayInitiateRefund.mockRejectedValue(new PaymentProviderError({ provider: 'Razorpay', httpStatus: 502 }));
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    const job = makeJob({ orderId: 'order_1', reason: 'r' }, { attemptsMade: 0 });

    await expect(processor?.(job, 'tok')).rejects.toBeInstanceOf(PaymentProviderError);

    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });

  it('a transient failure on the last fast attempt moves to the slow schedule', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    razorpayInitiateRefund.mockRejectedValue(new PaymentProviderError({ provider: 'Razorpay', httpStatus: 502 }));
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    const job = makeJob({ orderId: 'order_1', reason: 'r' }, { attemptsMade: 2 });

    await expect(processor?.(job, 'tok')).rejects.toBeInstanceOf(DelayedError);
    expect(job.moveToDelayed).toHaveBeenCalled();
  });

  it('skips cleanly when a refund is already with the provider (nothing left to reserve)', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(
      capturedOrder({
        payment: {
          id: 'payment_1',
          status: 'CAPTURED',
          amount: 10000,
          refundedAmountPaise: 0,
          refundPendingAmountPaise: 10000,
          providerPaymentId: 'pay_1'
        }
      })
    );

    await processor?.(makeJob({ orderId: 'order_1', reason: 'r', autoRetryRound: 2 }));

    expect(razorpayInitiateRefund).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it('first attempt sends a stable refundReference and does not look anything up', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    razorpayInitiateRefund.mockResolvedValue({ providerRefundId: 'rfnd_1', status: 'processed', amount: 10000 });
    tx.payment.updateMany.mockResolvedValue({ count: 1 });

    await processor?.(makeJob({ orderId: 'order_1', reason: 'r' }, { id: 'job_ref', attemptsMade: 0 }));

    expect(findRefundByReference).not.toHaveBeenCalled();
    expect(razorpayInitiateRefund).toHaveBeenCalledWith(
      expect.objectContaining({ notes: expect.objectContaining({ refundReference: 'job_ref:order_1' }) })
    );
  });

  it('a retry after an ambiguous failure adopts the refund the provider already accepted (no double refund)', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    findRefundByReference.mockResolvedValue({ providerRefundId: 'rfnd_first', status: 'processed', amount: 2500 });

    await processor?.(
      makeJob({ orderId: 'order_1', reason: 'r', refundAmountPaise: 2500 }, { id: 'job_ref', attemptsMade: 1 })
    );

    expect(findRefundByReference).toHaveBeenCalledWith({ providerPaymentId: 'pay_1', reference: 'job_ref:order_1' });
    expect(razorpayInitiateRefund).not.toHaveBeenCalled();
    // Reservation kept (one updateMany: the reserve) — finalised by refund.processed.
    expect(tx.payment.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: expect.stringContaining('ref rfnd_first') })
    });
  });

  it('a retry with no matching provider refund sends the refund again', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    razorpayInitiateRefund.mockResolvedValue({ providerRefundId: 'rfnd_2', status: 'processed', amount: 10000 });

    await processor?.(makeJob({ orderId: 'order_1', reason: 'r' }, { id: 'job_ref', attemptsMade: 2 }));

    expect(findRefundByReference).toHaveBeenCalledOnce();
    expect(razorpayInitiateRefund).toHaveBeenCalledOnce();
  });

  it('refunds an orphan capture in full when no payment row exists', async () => {
    startWorker();
    paymentFindFirst.mockResolvedValue(null);
    razorpayInitiateRefund.mockResolvedValue({ providerRefundId: 'rfnd_o', status: 'processed', amount: 9000 });

    await processor?.({
      ...makeJob({ providerPaymentId: 'pay_o', providerOrderId: 'order_rzp_o', reason: 'orphan' }),
      name: 'refund-orphan-capture'
    });

    expect(fetchOrderNotes).toHaveBeenCalledWith('order_rzp_o');
    expect(razorpayInitiateRefund).toHaveBeenCalledWith({
      providerPaymentId: 'pay_o',
      notes: { providerOrderId: 'order_rzp_o', reason: 'orphan', refundReference: 'job_1:pay_o' }
    });
    expect(sendTechnicalFailureAlert).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'OrphanPaymentCapture', recipient: 'pay_o', terminalFailure: false })
    );
  });

  it('never refunds a capture on a Razorpay order this platform did not create (payment links, POS)', async () => {
    startWorker();
    paymentFindFirst.mockResolvedValue(null);
    fetchOrderNotes.mockResolvedValue({ source: 'payment_link' });

    await processor?.({
      ...makeJob({ providerPaymentId: 'pay_x', providerOrderId: 'order_rzp_x', reason: 'orphan' }),
      name: 'refund-orphan-capture'
    });

    expect(razorpayInitiateRefund).not.toHaveBeenCalled();
    expect(sendTechnicalFailureAlert).not.toHaveBeenCalled();
  });

  it('skips the orphan refund when the order was materialised in the meantime', async () => {
    startWorker();
    paymentFindFirst.mockResolvedValue({ id: 'payment_late' });

    await processor?.({
      ...makeJob({ providerPaymentId: 'pay_o', providerOrderId: 'order_rzp_o', reason: 'orphan' }),
      name: 'refund-orphan-capture'
    });

    expect(razorpayInitiateRefund).not.toHaveBeenCalled();
  });

  it('sends terminal failure alert when refund job exhausts all attempts', () => {
    startWorker();

    failedHandler?.(
      { name: 'initiate-razorpay-refund', id: 'job_r1', opts: { attempts: 3 }, attemptsMade: 3, data: { orderId: 'order_1' } },
      new Error('provider timeout')
    );

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
    startWorker();

    failedHandler?.(
      { name: 'initiate-razorpay-refund', id: 'job_r2', opts: { attempts: 3 }, attemptsMade: 1, data: { orderId: 'order_1' } },
      new Error('transient error')
    );

    expect(sendTechnicalFailureAlert).not.toHaveBeenCalled();
  });

  it('throws when provider payment id is missing', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(
      capturedOrder({
        payment: { id: 'payment_1', status: 'CAPTURED', amount: 10000, refundedAmountPaise: 0, providerPaymentId: null }
      })
    );

    await expect(
      processor?.(makeJob({ orderId: 'order_1', reason: 'Order cancelled and refunded by admin' }))
    ).rejects.toThrow('Missing provider payment id for refund');
  });
});
