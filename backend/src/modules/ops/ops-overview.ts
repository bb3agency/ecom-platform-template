/**
 * Pure helpers behind `GET /api/v1/ops/overview` (one call for the ops console
 * landing screen instead of five) and the per-key `restartPending` flag on
 * `GET /api/v1/ops/config/overview`.
 */
import { isOpsConfigRuntimeOverlayKey } from './ops-config-contract';

/** How many recent DLQ jobs are inspected (matches GET /ops/queues/dlq/summary). */
export const OPS_OVERVIEW_DLQ_INSPECTION_LIMIT = 500;

/** Minimal BullMQ surface used here, so tests can pass plain objects. */
export interface OpsOverviewQueueLike {
  name: string;
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
  getWaiting(start?: number, end?: number): Promise<Array<{ data?: unknown }>>;
  getCompleted(start?: number, end?: number): Promise<Array<{ data?: unknown }>>;
}

export interface OpsOverviewQueueCounts {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export interface OpsOverviewQueueSummary {
  deadLetterTotal: number;
  deadLetterBySource: Array<{ queue: string; count: number }>;
  items: OpsOverviewQueueCounts[];
}

/**
 * Saved DB-overlay values that the running process has not picked up yet.
 *
 * `applyOpsConfigRuntimeOverlay` copies every active runtime-overlay row into
 * `process.env` at boot, so after a restart the two match. A difference means
 * the value was saved (or changed) after this process started. Bootstrap and
 * non-overlay keys are never applied at runtime and are ignored here.
 *
 * Scope: this reflects the API process answering the request. Workers restart
 * with the API in the supported restart flow, so they are treated the same.
 */
export function computeRestartPendingKeys(
  stored: ReadonlyArray<{ key: string; plaintextValue: string }>,
  env: NodeJS.ProcessEnv
): string[] {
  const pending = new Set<string>();
  for (const row of stored) {
    if (!isOpsConfigRuntimeOverlayKey(row.key)) continue;
    if ((env[row.key] ?? '') !== row.plaintextValue) {
      pending.add(row.key);
    }
  }
  return [...pending].sort();
}

function toCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Job counts for every queue plus the dead-letter breakdown by source queue.
 * A queue that cannot be read (Redis hiccup) is reported with zero counts
 * rather than failing the whole overview.
 */
export async function summarizeOpsQueues(
  queues: Readonly<Record<string, OpsOverviewQueueLike | undefined>>,
  deadLetterKey = 'deadLetter'
): Promise<OpsOverviewQueueSummary> {
  const entries = Object.entries(queues).filter(
    (entry): entry is [string, OpsOverviewQueueLike] => Boolean(entry[1])
  );

  const items = await Promise.all(
    entries
      .filter(([key]) => key !== deadLetterKey)
      .map(async ([, queue]): Promise<OpsOverviewQueueCounts> => {
        try {
          const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
          return {
            name: queue.name,
            waiting: toCount(counts.waiting),
            active: toCount(counts.active),
            delayed: toCount(counts.delayed),
            failed: toCount(counts.failed)
          };
        } catch {
          return { name: queue.name, waiting: 0, active: 0, delayed: 0, failed: 0 };
        }
      })
  );

  const dlq = queues[deadLetterKey];
  const bySource = new Map<string, number>();
  let deadLetterTotal = 0;
  if (dlq) {
    try {
      const [waiting, completed] = await Promise.all([
        dlq.getWaiting(0, OPS_OVERVIEW_DLQ_INSPECTION_LIMIT),
        dlq.getCompleted(0, OPS_OVERVIEW_DLQ_INSPECTION_LIMIT)
      ]);
      for (const job of [...waiting, ...completed]) {
        const data = job.data as { sourceQueue?: unknown } | undefined;
        const source = typeof data?.sourceQueue === 'string' && data.sourceQueue ? data.sourceQueue : 'unknown';
        bySource.set(source, (bySource.get(source) ?? 0) + 1);
        deadLetterTotal += 1;
      }
    } catch {
      deadLetterTotal = 0;
      bySource.clear();
    }
  }

  return {
    deadLetterTotal,
    deadLetterBySource: [...bySource.entries()]
      .map(([queue, count]) => ({ queue, count }))
      .sort((a, b) => b.count - a.count || a.queue.localeCompare(b.queue)),
    items: items.sort((a, b) => a.name.localeCompare(b.name))
  };
}
