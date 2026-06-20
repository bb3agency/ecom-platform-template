import { Worker, type ConnectionOptions } from 'bullmq';
import { PrismaClient as RealPrismaClient } from '@prisma/client';
import { sendTechnicalFailureAlert } from '../../src/modules/notifications/notification-failure-alert';

type DeadLetterWorkerDeps = {
  PrismaClient?: typeof RealPrismaClient;
  Worker?: typeof Worker;
  sendTechnicalFailureAlert?: typeof sendTechnicalFailureAlert;
};

/**
 * Dead Letter Queue (DLQ) Worker
 *
 * This is a no-op holding pen for terminal failures from all other queues.
 * Jobs land here when they exhaust all retry attempts in their source queue.
 *
 * Ops can inspect and retry jobs via Bull Board UI at /api/v1/ops/queues (ops:read).
 * The worker logs receipt for audit trail and fires a technical failure alert
 * to all ops and admin users — every DLQ arrival is a terminal failure.
 */
export function createDeadLetterWorker(connection: ConnectionOptions, deps?: DeadLetterWorkerDeps): Worker {
  const PrismaClientCtor = deps?.PrismaClient ?? RealPrismaClient;
  const WorkerCtor = deps?.Worker ?? Worker;
  const alertFn = deps?.sendTechnicalFailureAlert ?? sendTechnicalFailureAlert;
  const prisma = new PrismaClientCtor();

  // Notification delivery jobs that can flood the DLQ when a provider is down.
  // These get deduped via WORKER_TERMINAL cooldown rather than firing per-job.
  const NOTIFICATION_DELIVERY_JOBS = new Set(['send-email', 'send-sms', 'send-whatsapp', 'send-primary']);

  const worker = new WorkerCtor(
    'dead-letter',
    async (job) => {
      // No-op: DLQ is a holding pen for admin inspection.
      // Jobs are retained indefinitely (removeOnComplete: false, removeOnFail: false).
      // Admins can retry individual jobs via Bull Board UI.
      const isNotificationDelivery = NOTIFICATION_DELIVERY_JOBS.has(job.name);
      void alertFn({
        prisma,
        template: 'DeadLetterJobArrival',
        channel: 'UNKNOWN',
        recipient: 'dead-letter-queue',
        errorMessage: `Job "${job.name}" (id: ${job.id ?? 'unknown'}) arrived in the dead-letter queue after exhausting all retries`,
        failureStage: 'WORKER_TERMINAL',
        queueName: 'dead-letter',
        jobName: job.name,
        jobId: job.id ?? 'unknown',
        domain: 'workers',
        component: isNotificationDelivery ? `dead-letter-${job.name}` : 'dead-letter-worker',
        // Notification delivery jobs use cooldown dedup (not per-job) to avoid
        // flooding admins when a provider like Resend is temporarily down.
        terminalFailure: !isNotificationDelivery
      });
    },
    {
      connection,
      concurrency: 1,
      autorun: true
    }
  );

  return worker;
}
