import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedError } from 'bullmq';

import { buildRefundReceipt, createRefundsWorker } from './refunds.worker';
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
  const findRefundByReceipt = vi.fn();
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
      findRefundByReceipt,
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
    findRefundByReceipt.mockReset();
    findRefundByReceipt.mockResolvedValue(null);
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

  it('first attempt sends the stable per-job receipt and does not look anything up', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    razorpayInitiateRefund.mockResolvedValue({ providerRefundId: 'rfnd_1', status: 'processed', amount: 10000 });
    tx.payment.updateMany.mockResolvedValue({ count: 1 });

    await processor?.(makeJob({ orderId: 'order_1', reason: 'r' }, { id: 'job_ref', attemptsMade: 0 }));

    expect(findRefundByReceipt).not.toHaveBeenCalled();
    expect(razorpayInitiateRefund).toHaveBeenCalledWith(
      expect.objectContaining({ receipt: buildRefundReceipt({ id: 'job_ref' }, 'order_1') })
    );
    // One dedupe mechanism only: the old notes.refundReference is gone.
    expect(razorpayInitiateRefund.mock.calls[0]?.[0].notes).not.toHaveProperty('refundReference');
  });

  it('a slow-round retry (attemptsMade reset) still looks up by receipt before sending', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    findRefundByReceipt.mockResolvedValue({ providerRefundId: 'rfnd_first', status: 'processed', amount: 2500 });

    await processor?.(
      makeJob({ orderId: 'order_1', reason: 'r', refundAmountPaise: 2500, autoRetryRound: 1 }, { id: 'job_ref', attemptsMade: 0 })
    );

    expect(findRefundByReceipt).toHaveBeenCalledWith({
      providerPaymentId: 'pay_1',
      receipt: buildRefundReceipt({ id: 'job_ref' }, 'order_1')
    });
    expect(razorpayInitiateRefund).not.toHaveBeenCalled();
    // Reservation kept (one updateMany: the reserve) — finalised by refund.processed.
    expect(tx.payment.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: expect.stringContaining('ref rfnd_first') })
    });
  });

  it('a retry with no matching (non-failed) provider refund sends the refund again with the same receipt', async () => {
    startWorker();
    orderFindUnique.mockResolvedValue(capturedOrder());
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    razorpayInitiateRefund.mockResolvedValue({ providerRefundId: 'rfnd_2', status: 'processed', amount: 10000 });

    await processor?.(makeJob({ orderId: 'order_1', reason: 'r' }, { id: 'job_ref', attemptsMade: 2 }));

    expect(findRefundByReceipt).toHaveBeenCalledOnce();
    expect(razorpayInitiateRefund).toHaveBeenCalledOnce();
    expect(razorpayInitiateRefund).toHaveBeenCalledWith(
      expect.objectContaining({ receipt: buildRefundReceipt({ id: 'job_ref' }, 'order_1') })
    );
  });

  it('admin retry, refund.failed re-queue and orphan-capture jobs each get their own stable receipt', () => {
    const ids = [
      'initiate-razorpay-refund-order_1-admin-retry-1700000000000',
      'initiate-razorpay-refund-order_1-provider-failed-rfnd_1',
      'refund-orphan-capture-pay_o'
    ];
    const receipts = ids.map((id) => buildRefundReceipt({ id }, 'order_1'));
    expect(new Set(receipts).size).toBe(ids.length);
    for (const [index, id] of ids.entries()) {
      expect(buildRefundReceipt({ id }, 'other')).toBe(receipts[index]);
      expect(receipts[index]?.length).toBeLessThanOrEqual(40);
    }
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
      receipt: buildRefundReceipt({ id: 'job_1' }, 'pay_o'),
      notes: { providerOrderId: 'order_rzp_o', reason: 'orphan' }
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

  it('an orphan-capture retry adopts the refund an ambiguous earlier attempt created', async () => {
    startWorker();
    paymentFindFirst.mockResolvedValue(null);
    findRefundByReceipt.mockResolvedValue({ providerRefundId: 'rfnd_o', status: 'processed', amount: 9000 });

    await processor?.({
      ...makeJob({ providerPaymentId: 'pay_o', providerOrderId: 'order_rzp_o', reason: 'orphan' }, { attemptsMade: 1 }),
      name: 'refund-orphan-capture'
    });

    expect(findRefundByReceipt).toHaveBeenCalledWith({
      providerPaymentId: 'pay_o',
      receipt: buildRefundReceipt({ id: 'job_1' }, 'pay_o')
    });
    expect(razorpayInitiateRefund).not.toHaveBeenCalled();
  });

  it('an orphan-capture retry does not send blind when the provider cannot be asked', async () => {
    startWorker();
    paymentFindFirst.mockResolvedValue(null);
    findRefundByReceipt.mockRejectedValue(new Error('timeout'));

    await expect(
      processor?.({
        ...makeJob({ providerPaymentId: 'pay_o', providerOrderId: 'order_rzp_o', reason: 'orphan' }, { attemptsMade: 1 }),
        name: 'refund-orphan-capture'
      })
    ).rejects.toThrow('timeout');
    expect(razorpayInitiateRefund).not.toHaveBeenCalled();
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
  describe('be-rel-03: unknown-outcome refunds are reconciled, never re-sent blind', () => {
    const findRefundByReceipt = vi.fn();
    const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

    function startWorkerWithLookup() {
      createRefundsWorker({} as never, {
        Worker: MockWorker as unknown as RefundsWorkerType,
        PrismaClient: MockPrismaClient as unknown as RefundsPrismaType,
        createPaymentProvider: () => ({ ...mockCreatePaymentProvider(), findRefundByReceipt }),
        sendTechnicalFailureAlert,
        now: () => NOW
      });
    }

    beforeEach(() => {
      findRefundByReceipt.mockReset();
    });

    it('sends a stable per-job receipt (<= 40 chars) with the refund', async () => {
      startWorkerWithLookup();
      orderFindUnique.mockResolvedValue(capturedOrder());
      razorpayInitiateRefund.mockResolvedValue({ providerRefundId: 'rfnd_1', status: 'processed', amount: 10000 });
      tx.payment.updateMany.mockResolvedValue({ count: 1 });

      await processor?.(makeJob({ orderId: 'order_1', reason: 'r' }));

      const receipt = buildRefundReceipt({ id: 'job_1' }, 'order_1');
      expect(receipt.length).toBeLessThanOrEqual(40);
      expect(buildRefundReceipt({ id: 'job_1' }, 'order_1')).toBe(receipt);
      expect(buildRefundReceipt({ id: 'job_2' }, 'order_1')).not.toBe(receipt);
      expect(razorpayInitiateRefund).toHaveBeenCalledWith(expect.objectContaining({ receipt }));
      // First attempt: no lookup needed.
      expect(findRefundByReceipt).not.toHaveBeenCalled();
    });

    it('a timeout whose refund the provider DID accept is treated as success: reservation kept, no retry', async () => {
      startWorkerWithLookup();
      orderFindUnique.mockResolvedValue(capturedOrder());
      razorpayInitiateRefund.mockRejectedValue(timeout());
      findRefundByReceipt.mockResolvedValue({ providerRefundId: 'rfnd_late', status: 'processed', amount: 10000 });
      tx.payment.updateMany.mockResolvedValue({ count: 1 });
      const job = makeJob({ orderId: 'order_1', reason: 'r' });

      await expect(processor?.(job, 'tok')).resolves.toBeUndefined();

      // Only the reservation increment — never the release decrement.
      expect(tx.payment.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.payment.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { refundPendingAmountPaise: { decrement: 10000 } } })
      );
      expect(tx.orderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ note: expect.stringContaining('rfnd_late') }) })
      );
    });

    it('a timeout with no refund at the provider releases the reservation and retries', async () => {
      startWorkerWithLookup();
      orderFindUnique.mockResolvedValue(capturedOrder());
      razorpayInitiateRefund.mockRejectedValue(timeout());
      findRefundByReceipt.mockResolvedValue(null);
      tx.payment.updateMany.mockResolvedValue({ count: 1 });

      await expect(processor?.(makeJob({ orderId: 'order_1', reason: 'r' }), 'tok')).rejects.toThrow('timeout');

      expect(tx.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { refundPendingAmountPaise: { decrement: 10000 } } })
      );
    });

    it('on retry, finds the earlier accepted refund and does NOT call the provider again', async () => {
      startWorkerWithLookup();
      orderFindUnique.mockResolvedValue(capturedOrder());
      findRefundByReceipt.mockResolvedValue({ providerRefundId: 'rfnd_first', status: 'processed', amount: 5000 });
      tx.payment.updateMany.mockResolvedValue({ count: 1 });

      await processor?.(makeJob({ orderId: 'order_1', reason: 'r', refundAmountPaise: 5000 }, { attemptsMade: 1 }));

      expect(razorpayInitiateRefund).not.toHaveBeenCalled();
      expect(findRefundByReceipt).toHaveBeenCalledWith({
        providerPaymentId: 'pay_1',
        receipt: buildRefundReceipt({ id: 'job_1' }, 'order_1')
      });
    });

    it('on retry, if the provider cannot be asked, it does not send blind', async () => {
      startWorkerWithLookup();
      orderFindUnique.mockResolvedValue(capturedOrder());
      findRefundByReceipt.mockRejectedValue(timeout());
      tx.payment.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        processor?.(makeJob({ orderId: 'order_1', reason: 'r' }, { attemptsMade: 1 }), 'tok')
      ).rejects.toThrow();

      expect(razorpayInitiateRefund).not.toHaveBeenCalled();
    });
  });
});
