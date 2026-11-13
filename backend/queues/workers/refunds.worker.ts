import { createHash } from 'crypto';
import { DelayedError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { PaymentStatus, PrismaClient as RealPrismaClient } from '@prisma/client';
import { createPaymentProvider } from '@modules/payments/payment-provider';
import { sendTechnicalFailureAlert } from '../../src/modules/notifications/notification-failure-alert';
import {
  describePaymentProviderFailure,
  isPaymentProviderRejection
} from '../../src/common/errors/payment-provider-error';
import {
  REFUND_AUTO_RETRY_WINDOW_LABEL,
  REFUND_NOTE,
  nextRefundRetryDelayMs
} from '../../src/common/payments/refund-retry-policy';

type InitiateRazorpayRefundJobData = {
  orderId: string;
  reason: string;
  refundAmountPaise?: number;
  initiatedBy?: 'ADMIN' | 'CUSTOMER' | 'SYSTEM' | 'SHIPPING_WEBHOOK' | 'PAYMENT_WEBHOOK';
  /** Kept for job-id uniqueness by callers; history rows always use the order's CURRENT status. */
  sourceStatus?: string;
  /** Slow auto-retry round (0 = first run). See refund-retry-policy.ts. */
  autoRetryRound?: number;
};

type RefundsWorkerDeps = {
  PrismaClient?: typeof RealPrismaClient;
  /** Shared process-wide client (workers/index.ts) — avoids one connection pool per worker. */
  prisma?: RealPrismaClient;
  Worker?: typeof Worker;
  createPaymentProvider?: typeof createPaymentProvider;
  sendTechnicalFailureAlert?: typeof sendTechnicalFailureAlert;
  now?: () => number;
};

type RefundOrphanCaptureJobData = {
  providerPaymentId: string;
  providerOrderId: string;
  reason: string;
};

const DEFAULT_FAST_ATTEMPTS = 3;
/** Mirrors REFUND_ORPHAN_CAPTURE_JOB in order-processing.worker.ts. */
const REFUND_ORPHAN_CAPTURE_JOB = 'refund-orphan-capture';

function isRetryAttempt(job: Pick<Job, 'attemptsMade'>, round: number): boolean {
  return (job.attemptsMade ?? 0) > 0 || round > 0;
}

/**
 * Stable identifier for ONE refund job, shared by every retry (fast and slow) of
 * that job. Sent to Razorpay as the refund `receipt` (max 40 chars; also mirrored
 * into notes.refundAttemptId) so an attempt whose outcome is unknown can be found
 * again with findRefundByReceipt instead of being paid out twice. Every refund job
 * carries an explicit jobId (cancel, admin "Retry refund", refund.failed re-queue,
 * refund-orphan-capture), so a NEW job is a new receipt while its retries share one.
 * `fallbackSubject` (order id / provider payment id) is used only if a job has no id.
 */
export function buildRefundReceipt(job: Pick<Job, 'id'>, fallbackSubject: string): string {
  const identity = job.id ?? `subject:${fallbackSubject}`;
  return `rf_${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

export function createRefundsWorker(
  connection: ConnectionOptions,
  deps?: RefundsWorkerDeps
): Worker {
  const PrismaClientCtor = deps?.PrismaClient ?? RealPrismaClient;
  const WorkerCtor = deps?.Worker ?? Worker;
  const resolvePaymentProvider = deps?.createPaymentProvider ?? createPaymentProvider;
  const alertFn = deps?.sendTechnicalFailureAlert ?? sendTechnicalFailureAlert;
  const now = deps?.now ?? Date.now;
  const prisma = deps?.prisma ?? new PrismaClientCtor();
  const paymentProvider = resolvePaymentProvider();

  async function writeRefundNote(orderId: string, actor: string, note: string): Promise<void> {
    // A refund event is not a status change: from == to == the order's status
    // NOW (a courier-cancelled order reads "Cancelled", never its old "Shipped").
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order) return;
    await prisma.orderStatusHistory.create({
      data: { orderId, fromStatus: order.status, toStatus: order.status, triggeredBy: actor, note }
    });
  }

  function alert(job: Job, data: InitiateRazorpayRefundJobData, message: string, terminal: boolean): void {
    void alertFn({
      prisma,
      template: 'RefundsWorkerTerminalFailure',
      channel: 'UNKNOWN',
      recipient: data.orderId,
      errorMessage: message,
      failureStage: 'WORKER_TERMINAL',
      queueName: 'refunds',
      jobName: job.name,
      jobId: job.id ?? 'unknown',
      domain: 'payments',
      component: 'refunds-worker',
      terminalFailure: terminal
    });
  }

  /** Full refund of a capture that never became a store order (no Payment row exists). */
  async function refundOrphanCapture(job: Job): Promise<void> {
    const data = job.data as RefundOrphanCaptureJobData;
    // Re-check: a late confirm-prepaid may have materialised the order after all.
    const recorded = await prisma.payment.findFirst({
      where: {
        OR: [{ providerOrderId: data.providerOrderId }, { providerPaymentId: data.providerPaymentId }]
      },
      select: { id: true }
    });
    if (recorded) {
      return;
    }
    // Provenance: only ever refund a capture on a Razorpay order this platform created
    // (prepare-checkout stamps notes.userId, initiate-payment notes.orderId). Payments
    // from links, POS or other tools on the same merchant account are left alone.
    const orderNotes = paymentProvider.fetchOrderNotes
      ? await paymentProvider.fetchOrderNotes(data.providerOrderId)
      : null;
    if (!orderNotes || (!orderNotes['userId'] && !orderNotes['orderId'])) {
      return;
    }
    // Same dedupe as the order refund path: a retry after an ambiguous attempt asks the
    // provider by receipt first (a failed lookup throws → BullMQ retries; never send blind).
    const receipt = buildRefundReceipt(job, data.providerPaymentId);
    if (isRetryAttempt(job, 0) && paymentProvider.findRefundByReceipt) {
      const existing = await paymentProvider.findRefundByReceipt({
        providerPaymentId: data.providerPaymentId,
        receipt
      });
      if (existing) {
        return;
      }
    }
    // Amount omitted → the provider refunds the full captured amount.
    const result = await paymentProvider.initiateRefund({
      providerPaymentId: data.providerPaymentId,
      receipt,
      notes: {
        providerOrderId: data.providerOrderId,
        reason: data.reason
      }
    });
    void alertFn({
      prisma,
      template: 'OrphanPaymentCapture',
      channel: 'UNKNOWN',
      recipient: data.providerPaymentId,
      errorMessage: `Razorpay payment ${data.providerPaymentId} (order ${data.providerOrderId}) was captured but the checkout never created a store order. It has been refunded in full automatically (refund ${result.providerRefundId}).`,
      failureStage: 'WORKER_TERMINAL',
      queueName: 'refunds',
      jobName: job.name,
      jobId: job.id ?? 'unknown',
      domain: 'payments',
      component: 'refunds-worker',
      terminalFailure: false
    });
  }

  const worker = new WorkerCtor(
    'refunds',
    async (job: Job, token?: string) => {
      if (job.name === REFUND_ORPHAN_CAPTURE_JOB) {
        await refundOrphanCapture(job);
        return;
      }
      if (job.name !== 'initiate-razorpay-refund') {
        return;
      }

      const data = job.data as InitiateRazorpayRefundJobData;
      const actor = data.initiatedBy ?? 'SYSTEM';
      const round = data.autoRetryRound ?? 0;

      // --- Phase 1: atomic CAS gate ---
      // Reserve the refund amount (refundPendingAmountPaise) conditioned on the
      // payment still being refundable. Only the worker whose updateMany wins
      // calls the provider — no double refund from concurrent/duplicate jobs,
      // an admin "Retry refund" racing an automatic retry, or a refund that has
      // since succeeded (balance 0 → gate returns null and the job ends).
      const gate = await prisma.$transaction(async (tx) => {
        const existing = await tx.order.findUnique({
          where: { id: data.orderId },
          include: { payment: true }
        });

        if (!existing?.payment) {
          return null;
        }
        if (existing.payment.status !== PaymentStatus.CAPTURED && existing.payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
          return null;
        }
        if (!existing.payment.providerPaymentId) {
          throw new Error('Missing provider payment id for refund');
        }

        const requestedAmount = data.refundAmountPaise ?? existing.payment.amount;
        const refundableBalance = Math.max(
          existing.payment.amount - existing.payment.refundedAmountPaise - existing.payment.refundPendingAmountPaise,
          0
        );
        const normalizedRequestedAmount =
          requestedAmount > 0 && requestedAmount <= existing.payment.amount
            ? requestedAmount
            : existing.payment.amount;
        const refundAmountPaise = Math.min(normalizedRequestedAmount, refundableBalance);
        if (refundAmountPaise <= 0) {
          return null;
        }

        const paymentResult = await tx.payment.updateMany({
          where: {
            id: existing.payment.id,
            status: { in: [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED] }
          },
          data: {
            refundPendingAmountPaise: {
              increment: refundAmountPaise
            }
          }
        });

        if (paymentResult.count === 0) {
          return null;
        }

        return {
          paymentId: existing.payment.id,
          providerPaymentId: existing.payment.providerPaymentId,
          orderId: existing.id,
          refundAmountPaise
        };
      });

      if (!gate) {
        return;
      }

      // --- Phase 2: external provider call (after the reservation is committed) ---
      const receipt = buildRefundReceipt(job, gate.orderId);
      const lookupRefund = paymentProvider.findRefundByReceipt?.bind(paymentProvider);
      const findExisting = lookupRefund
        ? () => lookupRefund({ providerPaymentId: gate.providerPaymentId, receipt })
        : null;
      const isRetry = isRetryAttempt(job, round);
      try {
        // be-rel-03: on a retry a previous attempt may have been accepted by the
        // provider even though we never saw the answer (timeout / dropped
        // connection). Ask first; only send a new refund when there is none. If
        // one exists, adopt it: the reservation stays held and is finalised by the
        // refund.processed webhook as usual. Failed provider refunds are never
        // adopted (findRefundByReceipt skips them). A failed lookup throws into
        // the transient-error path below — we never send blind on a retry.
        const existing = isRetry && findExisting ? await findExisting() : null;
        const result =
          existing ??
          (await paymentProvider.initiateRefund({
            providerPaymentId: gate.providerPaymentId,
            amount: gate.refundAmountPaise,
            receipt,
            notes: {
              orderId: gate.orderId,
              reason: data.reason
            }
          }));
        // History is written only once the provider has accepted the refund —
        // never per attempt. The refund.processed webhook later finalises it.
        await writeRefundNote(
          gate.orderId,
          actor,
          `${REFUND_NOTE.sent} (${gate.refundAmountPaise} paise) — ref ${result.providerRefundId}`
        );
        return;
      } catch (err) {
        // be-rel-03: a timeout / network error / 5xx is an UNKNOWN outcome — the
        // provider may have accepted the refund. Reconcile before releasing the
        // reservation; if the refund exists, this attempt actually succeeded.
        if (!isPaymentProviderRejection(err) && findExisting) {
          const reconciled = await findExisting().catch(() => null);
          if (reconciled) {
            await writeRefundNote(
              gate.orderId,
              actor,
              `${REFUND_NOTE.sent} (${gate.refundAmountPaise} paise) — ref ${reconciled.providerRefundId}`
            );
            return;
          }
        }

        // Release the reservation: the money is still owed, so the balance must
        // be refundable again for the next (automatic or admin) attempt. A retry
        // of this job re-checks the provider by receipt before sending again.
        await prisma.payment.updateMany({
          where: { id: gate.paymentId, status: { in: [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED] } },
          data: { refundPendingAmountPaise: { decrement: gate.refundAmountPaise } }
        });

        // Transient failure (timeout / 5xx / breaker open) with fast attempts
        // left → let BullMQ retry in seconds. A provider REFUSAL (4xx, e.g. low
        // balance) skips straight to the slow schedule: seconds won't fix it.
        const fastAttempts = job.opts?.attempts ?? DEFAULT_FAST_ATTEMPTS;
        const fastAttemptsLeft = (job.attemptsMade ?? 0) + 1 < fastAttempts;
        if (!isPaymentProviderRejection(err) && fastAttemptsLeft) {
          throw err;
        }

        const reason = describePaymentProviderFailure(err);
        const delay = nextRefundRetryDelayMs(round);

        if (delay === null) {
          await writeRefundNote(
            gate.orderId,
            actor,
            `${REFUND_NOTE.stillOwed} (${gate.refundAmountPaise} paise) — automatic retries stopped after ${REFUND_AUTO_RETRY_WINDOW_LABEL}. Last error: ${reason}. Retry from the order page.`
          );
          alert(
            job,
            data,
            `Refund for order ${gate.orderId} is still owed after ${REFUND_AUTO_RETRY_WINDOW_LABEL} of automatic retries. Last error: ${reason}. Check the Razorpay balance, then use "Retry refund" on the order page.`,
            true
          );
          return;
        }

        if (round === 0) {
          // One note + one alert when the refund first fails; the retries after
          // it are silent until it succeeds or the window runs out.
          await writeRefundNote(
            gate.orderId,
            actor,
            `${REFUND_NOTE.failedRetrying} (${gate.refundAmountPaise} paise): ${reason}. Retrying automatically for up to ${REFUND_AUTO_RETRY_WINDOW_LABEL}.`
          );
          alert(
            job,
            data,
            `Refund for order ${gate.orderId} failed: ${reason}. It will be retried automatically for up to ${REFUND_AUTO_RETRY_WINDOW_LABEL}. If the Razorpay balance is too low, new payments or adding funds in the Razorpay dashboard will let it go through.`,
            false
          );
        }

        await job.updateData({ ...data, autoRetryRound: round + 1 });
        await job.moveToDelayed(now() + delay, token);
        throw new DelayedError();
      }
    },
    { connection }
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;
    const failedData = job.data as Partial<InitiateRazorpayRefundJobData & RefundOrphanCaptureJobData>;
    alert(
      job,
      { orderId: failedData.orderId ?? failedData.providerPaymentId ?? 'unknown', reason: failedData.reason ?? '' },
      error instanceof Error ? error.message : String(error),
      true
    );
  });

  return worker;
}
