import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { recordQueueDeadLetterGrowth, recordQueueFailure, recordQueueJob, recordQueueWorkerStall } from '@common/observability/metrics';
import { redactSensitiveData } from '@common/security/redaction';

type WorkerLike = {
  readonly name: string;
  on(event: 'active' | 'completed', handler: (job: JobLike) => void): void;
  on(event: 'failed', handler: (job: JobLike, error?: Error) => void): void;
  on(event: 'stalled', handler: (jobId: string) => void): void;
};

type TerminalFailureContext = {
  queue: string;
  jobName: string;
  jobId: string;
  attempt: number;
  maxAttempts: number;
  terminalFailure: boolean;
  errorMessage: string;
  originalData: unknown;
};

type JobLike = {
  id?: string | undefined;
  name: string;
  attemptsMade: number;
  data?: unknown;
  opts?: {
    attempts?: number;
  };
};

const startedAtByJobId = new Map<string, number>();

// M1: Bounded Map sweep — evict orphaned entries older than 10 minutes.
// If a job enters 'active' but never hits 'completed' or 'failed' (e.g., worker crash,
// stall detection failure), the Map entry leaks. This sweep runs every 60s and cleans
// entries that are impossibly old, preventing unbounded memory growth over weeks.
const STARTED_AT_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const STARTED_AT_SWEEP_INTERVAL_MS = 60 * 1000; // 1 minute

const sweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [jobId, startedAt] of startedAtByJobId) {
    if (now - startedAt > STARTED_AT_MAX_AGE_MS) {
      startedAtByJobId.delete(jobId);
    }
  }
}, STARTED_AT_SWEEP_INTERVAL_MS);
sweepInterval.unref(); // Prevent blocking graceful shutdown

export function attachWorkerLogging(
  worker: WorkerLike,
  logger: Logger,
  deadLetterQueue?: Queue,
  onFailure?: (context: TerminalFailureContext) => void,
  onDlqFailure?: (context: { queue: string; jobName: string; jobId: string; errorMessage: string }) => void,
  onStall?: (context: { queue: string; jobId: string }) => void
): void {
  worker.on('active', (job) => {
    const jobId = resolveJobId(job);
    startedAtByJobId.set(jobId, Date.now());

    logger.info(
      {
        queue: worker.name,
        jobName: job.name,
        jobId,
        attempt: job.attemptsMade + 1,
        status: 'active'
      },
      'BullMQ job started'
    );
    recordQueueJob(worker.name, job.name, 'active');
  });

  worker.on('completed', (job) => {
    const jobId = resolveJobId(job);
    const durationMs = resolveDurationMs(jobId);
    logger.info(
      {
        queue: worker.name,
        jobName: job.name,
        jobId,
        attempt: job.attemptsMade + 1,
        status: 'success',
        durationMs
      },
      'BullMQ job completed'
    );
    recordQueueJob(worker.name, job.name, 'success', durationMs);
  });

  worker.on('failed', (job, error) => {
    const jobId = resolveJobId(job);
    const durationMs = resolveDurationMs(jobId);
    const maxAttempts = Math.max(1, Number(job.opts?.attempts ?? 1));
    const attemptNumber = Math.max(1, job.attemptsMade + 1);
    const terminalFailure = attemptNumber >= maxAttempts;
    logger.error(
      {
        queue: worker.name,
        jobName: job.name,
        jobId,
        attempt: attemptNumber,
        maxAttempts,
        terminalFailure,
        status: 'failure',
        durationMs,
        errorMessage: redactSensitiveData(error?.message ?? 'Unknown worker error')
      },
      'BullMQ job failed'
    );
    recordQueueJob(worker.name, job.name, 'failure', durationMs);
    recordQueueFailure({
      queue: worker.name,
      jobName: job.name,
      terminal: terminalFailure
    });

    if (onFailure) {
      onFailure({
        queue: worker.name,
        jobName: job.name,
        jobId,
        attempt: attemptNumber,
        maxAttempts,
        terminalFailure,
        errorMessage: String(redactSensitiveData(error?.message ?? 'Unknown worker error')),
        originalData: job.data ?? null
      });
    }

    if (terminalFailure && deadLetterQueue) {
      deadLetterQueue
        .add('dead-letter-entry', {
          sourceQueue: worker.name,
          jobName: job.name,
          jobId: jobId,
          errorMessage: redactSensitiveData(error?.message ?? 'Unknown worker error'),
          failedAt: new Date().toISOString(),
          originalData: job.data ?? null
        })
        .then(() => {
          recordQueueDeadLetterGrowth('dead-letter', job.name);
          logger.warn(
            { sourceQueue: worker.name, jobName: job.name, jobId },
            'Terminal failure routed to dead-letter queue'
          );
        })
        .catch((dlqError: unknown) => {
          logger.error(
            { sourceQueue: worker.name, jobName: job.name, jobId, dlqError },
            'Failed to enqueue terminal failure into dead-letter queue'
          );
          if (onDlqFailure) {
            onDlqFailure({
              queue: worker.name,
              jobName: job.name,
              jobId,
              errorMessage: dlqError instanceof Error ? dlqError.message : String(dlqError)
            });
          }
        });
    }
  });

  worker.on('stalled', (jobId) => {
    logger.error(
      {
        queue: worker.name,
        jobId,
        status: 'stalled'
      },
      'BullMQ job stalled'
    );
    recordQueueWorkerStall(worker.name);
    if (onStall) {
      onStall({ queue: worker.name, jobId });
    }
  });
}

function resolveJobId(job: JobLike): string {
  return job.id ?? `unknown-${job.name}`;
}

function resolveDurationMs(jobId: string): number {
  const startedAt = startedAtByJobId.get(jobId);
  if (!startedAt) {
    return 0;
  }
  startedAtByJobId.delete(jobId);
  return Math.max(0, Date.now() - startedAt);
}
