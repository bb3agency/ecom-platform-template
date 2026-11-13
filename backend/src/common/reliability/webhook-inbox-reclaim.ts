import type { Prisma, PrismaClient } from '@prisma/client';
import type { TechnicalFailureAlertInput } from '@modules/notifications/notification-failure-alert';

/**
 * Stuck webhook inbox reclaim (be-rel-05 follow-up).
 *
 * A provider webhook claims a `WebhookInboxEvent` row in PROCESSING, writes the
 * outbox row, then moves the inbox row to ENQUEUED. A crash (or a lost DB
 * connection) between the claim and the outbox write leaves the row in
 * PROCESSING forever: the provider's retry is acked as a duplicate (24h
 * event-id lock / PROCESSING claim) and the event is never processed.
 *
 * At claim time the webhook stores the exact outbox message it is about to
 * write (`redriveSpec`). This sweep finds rows that have sat in PROCESSING for
 * longer than the stale window and re-drives them through the same outbox path
 * the webhook uses. The outbox `jobId` is deterministic per event, so a row
 * whose outbox write DID land (crash after the write, before ENQUEUED) is only
 * moved to ENQUEUED — never written twice.
 */

export const WEBHOOK_INBOX_RECLAIM_JOB_NAME = 'reclaim-stuck-webhook-inbox';

export const DEFAULT_INBOX_RECLAIM_STALE_MINUTES = 10;
export const DEFAULT_INBOX_RECLAIM_MAX_ATTEMPTS = 3;
const DEFAULT_INBOX_RECLAIM_BATCH_SIZE = 100;

const OUTBOX_QUEUE_NAMES = ['orderProcessing', 'shipping', 'refunds', 'notifications', 'analytics'] as const;
export type WebhookInboxOutboxQueue = (typeof OUTBOX_QUEUE_NAMES)[number];

export type WebhookInboxRedriveSpec = {
  queueName: WebhookInboxOutboxQueue;
  jobName: string;
  payload: Record<string, unknown>;
  /** Already sanitized (no ':'), exactly as stored on the outbox row. */
  jobId: string;
};

export type WebhookInboxReclaimConfig = {
  staleAfterMs: number;
  maxAttempts: number;
  batchSize: number;
};

export type WebhookInboxReclaimSummary = {
  scanned: number;
  reEnqueued: number;
  alreadyEnqueued: number;
  deferred: number;
  failed: number;
  skipped: number;
};

type ReclaimDeps = {
  prisma: PrismaClient;
  sendTechnicalFailureAlert: (input: TechnicalFailureAlertInput) => Promise<void>;
  config?: WebhookInboxReclaimConfig;
  now?: () => number;
  log?: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
};

/** BullMQ rejects ':' in custom job ids; the outbox stores the sanitized form. */
export function sanitizeOutboxJobId(jobId: string): string {
  return jobId.replace(/:/g, '-');
}

export function buildWebhookInboxRedriveSpec(
  queueName: WebhookInboxOutboxQueue,
  jobName: string,
  payload: Record<string, unknown>,
  jobId: string
): WebhookInboxRedriveSpec {
  return { queueName, jobName, payload, jobId: sanitizeOutboxJobId(jobId) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOutboxQueue = (value: unknown): value is WebhookInboxOutboxQueue =>
  typeof value === 'string' && (OUTBOX_QUEUE_NAMES as readonly string[]).includes(value);

export function parseWebhookInboxRedriveSpec(value: unknown): WebhookInboxRedriveSpec | null {
  if (!isRecord(value)) return null;
  const { queueName, jobName, payload, jobId } = value;
  if (!isOutboxQueue(queueName)) return null;
  if (typeof jobName !== 'string' || jobName.length === 0) return null;
  if (typeof jobId !== 'string' || jobId.length === 0) return null;
  if (!isRecord(payload)) return null;
  return { queueName, jobName, payload, jobId: sanitizeOutboxJobId(jobId) };
}

const readPositiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function resolveWebhookInboxReclaimConfig(
  env: Record<string, string | undefined> = process.env
): WebhookInboxReclaimConfig {
  const staleMinutes = readPositiveInt(env.WEBHOOK_INBOX_RECLAIM_AFTER_MINUTES, DEFAULT_INBOX_RECLAIM_STALE_MINUTES);
  return {
    staleAfterMs: staleMinutes * 60 * 1000,
    maxAttempts: readPositiveInt(env.WEBHOOK_INBOX_RECLAIM_MAX_ATTEMPTS, DEFAULT_INBOX_RECLAIM_MAX_ATTEMPTS),
    batchSize: DEFAULT_INBOX_RECLAIM_BATCH_SIZE
  };
}

/** Thrown inside the re-drive transaction to roll it back when the row left PROCESSING. */
class InboxRowChangedError extends Error {
  constructor() {
    super('Webhook inbox row left PROCESSING during reclaim');
  }
}

type StuckInboxRow = {
  id: string;
  provider: string;
  eventKey: string;
  eventName: string | null;
  redriveSpec: Prisma.JsonValue | null;
  reclaimAttempts: number;
  updatedAt: Date;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function reclaimStuckWebhookInboxEvents(deps: ReclaimDeps): Promise<WebhookInboxReclaimSummary> {
  const { prisma, sendTechnicalFailureAlert, log } = deps;
  const config = deps.config ?? resolveWebhookInboxReclaimConfig();
  const nowMs = (deps.now ?? Date.now)();
  const summary: WebhookInboxReclaimSummary = {
    scanned: 0,
    reEnqueued: 0,
    alreadyEnqueued: 0,
    deferred: 0,
    failed: 0,
    skipped: 0
  };

  const rows: StuckInboxRow[] = await prisma.webhookInboxEvent.findMany({
    where: { status: 'PROCESSING', updatedAt: { lt: new Date(nowMs - config.staleAfterMs) } },
    orderBy: { updatedAt: 'asc' },
    take: config.batchSize,
    select: {
      id: true,
      provider: true,
      eventKey: true,
      eventName: true,
      redriveSpec: true,
      reclaimAttempts: true,
      updatedAt: true
    }
  });
  summary.scanned = rows.length;

  const alertTerminal = async (row: StuckInboxRow, errorMessage: string, spec: WebhookInboxRedriveSpec | null) => {
    await sendTechnicalFailureAlert({
      prisma,
      template: `${row.provider}.webhook.${row.eventName ?? 'unknown'}`,
      channel: 'UNKNOWN',
      recipient: row.id,
      errorMessage,
      failureStage: 'WEBHOOK_PROCESSING',
      domain: 'webhooks',
      component: 'webhook-inbox-reclaim',
      ...(spec ? { queueName: spec.queueName, jobName: spec.jobName, jobId: spec.jobId } : {}),
      terminalFailure: true
    }).catch(() => undefined);
  };

  const markFailed = async (row: StuckInboxRow, lastError: string): Promise<boolean> => {
    const result = await prisma.webhookInboxEvent.updateMany({
      where: { id: row.id, status: 'PROCESSING' },
      data: { status: 'FAILED', lastError: lastError.slice(0, 1000) }
    });
    return result.count > 0;
  };

  for (const row of rows) {
    // CAS claim: bump the attempt counter (and updatedAt) only if nobody else
    // touched the row since we read it. A concurrent sweeper — or a row that
    // finished meanwhile — makes this a no-op.
    const claim = await prisma.webhookInboxEvent.updateMany({
      where: { id: row.id, status: 'PROCESSING', updatedAt: row.updatedAt },
      data: { reclaimAttempts: { increment: 1 } }
    });
    if (claim.count === 0) {
      summary.skipped += 1;
      continue;
    }
    const attempt = row.reclaimAttempts + 1;
    const stuckForMinutes = Math.round((nowMs - row.updatedAt.getTime()) / 60000);

    const spec = parseWebhookInboxRedriveSpec(row.redriveSpec);
    if (!spec) {
      // Rows written before redriveSpec existed (or by an operator mark_processing
      // with no stored payload) cannot be re-driven automatically. Surface them in
      // the FAILED inbox queue, where canonical replay with the raw payload works.
      const message = `Stuck in PROCESSING for ${stuckForMinutes}m with no stored redrive payload — operator replay required`;
      if (await markFailed(row, message)) {
        summary.failed += 1;
        log?.error({ inboxEventId: row.id, provider: row.provider }, message);
        await alertTerminal(row, message, null);
      } else {
        summary.skipped += 1;
      }
      continue;
    }

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const existing = await tx.outboxMessage.findFirst({
          where: { jobId: spec.jobId, queueName: spec.queueName, jobName: spec.jobName },
          select: { id: true }
        });
        if (!existing) {
          await tx.outboxMessage.create({
            data: {
              queueName: spec.queueName,
              jobName: spec.jobName,
              payload: spec.payload as Prisma.InputJsonValue,
              jobId: spec.jobId
            }
          });
        }
        const moved = await tx.webhookInboxEvent.updateMany({
          where: { id: row.id, status: 'PROCESSING' },
          data: {
            status: 'ENQUEUED',
            enqueuedAt: new Date(nowMs),
            lastError: `Reclaimed by inbox sweep after ${stuckForMinutes}m in PROCESSING (attempt ${attempt}${
              existing ? ', outbox row already present' : ''
            })`
          }
        });
        if (moved.count === 0) {
          throw new InboxRowChangedError();
        }
        return existing ? 'already-enqueued' : 're-enqueued';
      });
      if (outcome === 'already-enqueued') {
        summary.alreadyEnqueued += 1;
      } else {
        summary.reEnqueued += 1;
        log?.warn(
          { inboxEventId: row.id, provider: row.provider, jobName: spec.jobName, attempt },
          'Re-drove stuck webhook inbox event through the outbox'
        );
      }
    } catch (error) {
      if (error instanceof InboxRowChangedError) {
        summary.skipped += 1;
        continue;
      }
      const message = `Inbox reclaim attempt ${attempt}/${config.maxAttempts} failed: ${errorText(error)}`;
      if (attempt >= config.maxAttempts) {
        if (await markFailed(row, message)) {
          summary.failed += 1;
          log?.error({ inboxEventId: row.id, provider: row.provider, attempt }, 'Webhook inbox reclaim exhausted attempts');
          await alertTerminal(row, message, spec);
        } else {
          summary.skipped += 1;
        }
      } else {
        // Leave it in PROCESSING; the claim bumped updatedAt, so the next attempt
        // waits another full stale window.
        await prisma.webhookInboxEvent
          .updateMany({ where: { id: row.id, status: 'PROCESSING' }, data: { lastError: message.slice(0, 1000) } })
          .catch(() => undefined);
        summary.deferred += 1;
        log?.warn({ inboxEventId: row.id, provider: row.provider, attempt }, 'Webhook inbox reclaim attempt failed; will retry');
      }
    }
  }

  return summary;
}
