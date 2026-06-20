import { Worker, type ConnectionOptions } from 'bullmq';
import { OrderStatus, PaymentStatus, PrismaClient as RealPrismaClient } from '@prisma/client';
import { createPaymentProvider } from '@modules/payments/payment-provider';
import { sendTechnicalFailureAlert } from '../../src/modules/notifications/notification-failure-alert';

type InitiateRazorpayRefundJobData = {
  orderId: string;
  reason: string;
  refundAmountPaise?: number;
  initiatedBy?: 'ADMIN' | 'CUSTOMER' | 'SYSTEM';
  sourceStatus?: OrderStatus;
};

type RefundsWorkerDeps = {
  PrismaClient?: typeof RealPrismaClient;
  Worker?: typeof Worker;
  createPaymentProvider?: typeof createPaymentProvider;
  sendTechnicalFailureAlert?: typeof sendTechnicalFailureAlert;
};

export function createRefundsWorker(
  connection: ConnectionOptions,
  deps?: RefundsWorkerDeps
): Worker {
  const PrismaClientCtor = deps?.PrismaClient ?? RealPrismaClient;
  const WorkerCtor = deps?.Worker ?? Worker;
  const resolvePaymentProvider = deps?.createPaymentProvider ?? createPaymentProvider;
  const alertFn = deps?.sendTechnicalFailureAlert ?? sendTechnicalFailureAlert;
  const prisma = new PrismaClientCtor();
  const paymentProvider = resolvePaymentProvider();

  const worker = new WorkerCtor(
    'refunds',
    async (job) => {
      if (job.name !== 'initiate-razorpay-refund') {
        return;
      }

      const data = job.data as InitiateRazorpayRefundJobData;

      // --- Phase 1: atomic CAS gate ---
      // Read the order+payment snapshot and immediately attempt to increment
      // refundPendingAmountPaise inside a single transaction, conditioned on the
      // payment still being in CAPTURED status and having enough refundable balance.
      // Only if this write succeeds do we proceed to call the external provider,
      // preventing concurrent workers from both reading refundedAmountPaise=0 and
      // both dispatching a full refund to Razorpay (TOCTOU double-spend).
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

        // Atomically reserve the refund amount. This is the exclusive gate: only
        // the first concurrent worker whose updateMany wins (count > 0) continues.
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

        const actor = data.initiatedBy ?? 'SYSTEM';
        const fromStatus = data.sourceStatus ?? existing.status;
        await tx.orderStatusHistory.create({
          data: {
            orderId: existing.id,
            fromStatus,
            toStatus: fromStatus,
            triggeredBy: actor,
            note: `Refund initiated (${refundAmountPaise} paise) by ${actor.toLowerCase()}`
          }
        });

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

      // --- Phase 2: external provider call (after DB gate is committed) ---
      // If this throws, BullMQ will retry the job. On retry the gate transaction
      // will detect that refundPendingAmountPaise already covers the amount and
      // refundableBalance will be 0, so the gate returns null and we skip cleanly.
      try {
        await paymentProvider.initiateRefund({
          providerPaymentId: gate.providerPaymentId,
          amount: gate.refundAmountPaise,
          notes: {
            orderId: gate.orderId,
            reason: data.reason
          }
        });
      } catch (err) {
        // Roll back the pending reservation so the balance is restored for
        // the next retry attempt.
        await prisma.payment.updateMany({
          where: { id: gate.paymentId, status: { in: [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED] } },
          data: { refundPendingAmountPaise: { decrement: gate.refundAmountPaise } }
        });
        throw err;
      }
    },
    { connection }
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;
    void alertFn({
      prisma,
      template: 'RefundsWorkerTerminalFailure',
      channel: 'UNKNOWN',
      recipient: 'refunds-worker',
      errorMessage: error instanceof Error ? error.message : String(error),
      failureStage: 'WORKER_TERMINAL',
      queueName: 'refunds',
      jobName: job.name,
      jobId: job.id ?? 'unknown',
      domain: 'payments',
      component: 'refunds-worker',
      terminalFailure: true
    });
  });

  return worker;
}

