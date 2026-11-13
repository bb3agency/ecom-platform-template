import { Worker, type ConnectionOptions } from 'bullmq';
import { PrismaClient as RealPrismaClient } from '@prisma/client';
import { sendTechnicalFailureAlert } from '../../src/modules/notifications/notification-failure-alert';

type DeadLetterWorkerDeps = {
  PrismaClient?: typeof RealPrismaClient;
  /** Shared process-wide client (workers/index.ts) — avoids one connection pool per worker. */
  prisma?: RealPrismaClient;
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
  const prisma = deps?.prisma ?? new PrismaClientCtor();

  // Notification delivery jobs that can flood the DLQ when a provider is down.
  // These get deduped via WORKER_TERMINAL cooldown rather than firing per-job.
  const NOTIFICATION_DELIVERY_JOBS = new Set(['send-email', 'send-sms', 'send-whatsapp', 'send-primary']);

  const worker = new WorkerCtor(
    'dead-letter',
    async (job) => {
      // No-op: DLQ is a holding pen for admin inspection.
      // Jobs are retained indefinitely (removeOnComplete: false, removeOnFail: false).
      // Admins can retry individual jobs via Bull Board UI.
      // DLQ entries are enqueued as 'dead-letter-entry' by worker-logging; the
      // original job/queue names live in the payload. Fall back to job.name for
      // entries added by hand (e.g. Bull Board).
      const { jobName: originalJobName, sourceQueue } = readDeadLetterPayload(job.data, job.name);
      const isNotificationDelivery = NOTIFICATION_DELIVERY_JOBS.has(originalJobName);
      void alertFn({
        prisma,
        template: 'DeadLetterJobArrival',
        channel: 'UNKNOWN',
        recipient: 'dead-letter-queue',
        errorMessage: `Job "${originalJobName}"${sourceQueue ? ` from queue "${sourceQueue}"` : ''} (id: ${job.id ?? 'unknown'}) arrived in the dead-letter queue after exhausting all retries`,
        failureStage: 'WORKER_TERMINAL',
        queueName: 'dead-letter',
        jobName: originalJobName,
        jobId: job.id ?? 'unknown',
        domain: 'workers',
        component: isNotificationDelivery ? `dead-letter-${originalJobName}` : 'dead-letter-worker',
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

function readDeadLetterPayload(data: unknown, fallbackJobName: string): { jobName: string; sourceQueue: string | null } {
  if (typeof data !== 'object' || data === null) {
    return { jobName: fallbackJobName, sourceQueue: null };
  }
  const { jobName, sourceQueue } = data as { jobName?: unknown; sourceQueue?: unknown };
  return {
    jobName: typeof jobName === 'string' && jobName.length > 0 ? jobName : fallbackJobName,
    sourceQueue: typeof sourceQueue === 'string' && sourceQueue.length > 0 ? sourceQueue : null
  };
}
