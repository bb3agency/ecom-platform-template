import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  buildWebhookInboxRedriveSpec,
  parseWebhookInboxRedriveSpec,
  reclaimStuckWebhookInboxEvents,
  resolveWebhookInboxReclaimConfig,
  type WebhookInboxReclaimConfig
} from './webhook-inbox-reclaim';

type InboxRow = {
  id: string;
  provider: string;
  eventKey: string;
  eventName: string | null;
  status: 'PROCESSING' | 'ENQUEUED' | 'PROCESSED' | 'FAILED';
  redriveSpec: unknown;
  reclaimAttempts: number;
  lastError: string | null;
  enqueuedAt: Date | null;
  updatedAt: Date;
};

type OutboxRow = { id: string; queueName: string; jobName: string; payload: unknown; jobId: string | null };

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60 * 1000);
const config: WebhookInboxReclaimConfig = { staleAfterMs: 10 * 60 * 1000, maxAttempts: 3, batchSize: 100 };

const paymentSpec = buildWebhookInboxRedriveSpec(
  'orderProcessing',
  'payment-webhook',
  { event: 'payment.failed', providerOrderId: 'order_1', providerPaymentId: 'pay_1' },
  'payment-webhook:abc123'
);

function makeRow(overrides: Partial<InboxRow> = {}): InboxRow {
  return {
    id: 'inbox_1',
    provider: 'razorpay',
    eventKey: 'evt_1',
    eventName: 'payment.failed',
    status: 'PROCESSING',
    redriveSpec: paymentSpec,
    reclaimAttempts: 0,
    lastError: null,
    enqueuedAt: null,
    updatedAt: minutesAgo(30),
    ...overrides
  };
}

/** Minimal in-memory Prisma double covering exactly what the sweep uses. */
function createFakePrisma(initialRows: InboxRow[], initialOutbox: OutboxRow[] = []) {
  const rows = new Map(initialRows.map((row) => [row.id, { ...row }]));
  const outbox = [...initialOutbox];
  let tick = 0;
  const outboxCreate = vi.fn(async ({ data }: { data: Omit<OutboxRow, 'id'> }) => {
    const created = { id: `outbox_${outbox.length + 1}`, ...data };
    outbox.push(created);
    return created;
  });

  type Where = { id?: string; status?: string; updatedAt?: Date | { lt: Date } };
  const matches = (row: InboxRow, where: Where) => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    if (where.updatedAt instanceof Date && row.updatedAt.getTime() !== where.updatedAt.getTime()) return false;
    if (where.updatedAt && !(where.updatedAt instanceof Date) && !(row.updatedAt < where.updatedAt.lt)) return false;
    return true;
  };

  const inboxUpdateMany = vi.fn(
    async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of rows.values()) {
        if (!matches(row, where)) continue;
        const { reclaimAttempts, ...rest } = data;
        if (reclaimAttempts && typeof reclaimAttempts === 'object') {
          row.reclaimAttempts += (reclaimAttempts as { increment: number }).increment;
        }
        Object.assign(row, rest);
        tick += 1;
        row.updatedAt = new Date(NOW + tick);
        count += 1;
      }
      return { count };
    }
  );

  const webhookInboxEvent = {
    findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) =>
      [...rows.values()]
        .filter((row) => matches(row, where))
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        .slice(0, take)
        .map((row) => ({ ...row }))
    ),
    updateMany: inboxUpdateMany
  };
  const outboxMessage = {
    findFirst: vi.fn(
      async ({ where }: { where: { jobId: string; queueName: string; jobName: string } }) =>
        outbox.find(
          (row) => row.jobId === where.jobId && row.queueName === where.queueName && row.jobName === where.jobName
        ) ?? null
    ),
    create: outboxCreate
  };

  // Interactive transaction with rollback: snapshot, run, restore on throw.
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const rowSnapshot = new Map([...rows].map(([id, row]) => [id, { ...row }]));
    const outboxLength = outbox.length;
    try {
      return await fn({ webhookInboxEvent, outboxMessage });
    } catch (error) {
      rows.clear();
      rowSnapshot.forEach((row, id) => rows.set(id, row));
      outbox.length = outboxLength;
      throw error;
    }
  });

  const prisma = { webhookInboxEvent, outboxMessage, $transaction } as unknown as PrismaClient;
  return { prisma, rows, outbox, outboxCreate, outboxMessage, inboxUpdateMany };
}

const run = (prisma: PrismaClient, alert = vi.fn(async () => undefined), overrides: Partial<WebhookInboxReclaimConfig> = {}) =>
  reclaimStuckWebhookInboxEvents({
    prisma,
    sendTechnicalFailureAlert: alert,
    config: { ...config, ...overrides },
    now: () => NOW
  });

describe('reclaimStuckWebhookInboxEvents', () => {
  it('re-drives a stale PROCESSING row through the outbox and marks it ENQUEUED', async () => {
    const fake = createFakePrisma([makeRow()]);

    const summary = await run(fake.prisma);

    expect(summary).toMatchObject({ scanned: 1, reEnqueued: 1, alreadyEnqueued: 0, failed: 0 });
    expect(fake.outboxCreate).toHaveBeenCalledWith({
      data: {
        queueName: 'orderProcessing',
        jobName: 'payment-webhook',
        payload: paymentSpec.payload,
        jobId: 'payment-webhook-abc123'
      }
    });
    const row = fake.rows.get('inbox_1');
    expect(row?.status).toBe('ENQUEUED');
    expect(row?.reclaimAttempts).toBe(1);
    expect(row?.enqueuedAt).toEqual(new Date(NOW));
  });

  it('does not write a second outbox row when the original write landed before the crash', async () => {
    const fake = createFakePrisma(
      [makeRow()],
      [{ id: 'outbox_orig', queueName: 'orderProcessing', jobName: 'payment-webhook', payload: {}, jobId: 'payment-webhook-abc123' }]
    );

    const summary = await run(fake.prisma);

    expect(summary).toMatchObject({ reEnqueued: 0, alreadyEnqueued: 1 });
    expect(fake.outboxCreate).not.toHaveBeenCalled();
    expect(fake.outbox).toHaveLength(1);
    expect(fake.rows.get('inbox_1')?.status).toBe('ENQUEUED');
  });

  it('ignores rows that are not yet stale or not in PROCESSING', async () => {
    const fake = createFakePrisma([
      makeRow({ id: 'fresh', updatedAt: minutesAgo(5) }),
      makeRow({ id: 'done', status: 'ENQUEUED' }),
      makeRow({ id: 'failed', status: 'FAILED' })
    ]);

    const summary = await run(fake.prisma);

    expect(summary.scanned).toBe(0);
    expect(fake.outboxCreate).not.toHaveBeenCalled();
    expect(fake.rows.get('fresh')?.status).toBe('PROCESSING');
  });

  it('is idempotent across repeated sweeps', async () => {
    const fake = createFakePrisma([makeRow()]);

    await run(fake.prisma);
    const second = await run(fake.prisma);

    expect(second.scanned).toBe(0);
    expect(fake.outboxCreate).toHaveBeenCalledTimes(1);
  });

  it('skips a row another sweeper claimed between the read and the CAS', async () => {
    const fake = createFakePrisma([makeRow()]);
    const realUpdateMany = fake.inboxUpdateMany.getMockImplementation();
    // First updateMany is the CAS claim: simulate a concurrent sweeper bumping the row first.
    fake.inboxUpdateMany.mockImplementationOnce(async (args) => {
      const row = fake.rows.get('inbox_1');
      if (row) row.updatedAt = new Date(NOW - 1);
      return realUpdateMany ? realUpdateMany(args) : { count: 0 };
    });

    const summary = await run(fake.prisma);

    expect(summary.skipped).toBe(1);
    expect(fake.outboxCreate).not.toHaveBeenCalled();
  });

  it('keeps the row PROCESSING with the attempt counted when a re-drive fails below the limit', async () => {
    const fake = createFakePrisma([makeRow()]);
    fake.outboxCreate.mockRejectedValueOnce(new Error('connection pool timeout'));
    const alert = vi.fn(async () => undefined);

    const summary = await run(fake.prisma, alert);

    expect(summary.deferred).toBe(1);
    const row = fake.rows.get('inbox_1');
    expect(row?.status).toBe('PROCESSING');
    expect(row?.reclaimAttempts).toBe(1);
    expect(row?.lastError).toContain('attempt 1/3');
    expect(row?.lastError).toContain('connection pool timeout');
    expect(fake.outbox).toHaveLength(0);
    expect(alert).not.toHaveBeenCalled();
  });

  it('moves the row to FAILED and alerts once max attempts are exhausted', async () => {
    const fake = createFakePrisma([makeRow({ reclaimAttempts: 2 })]);
    fake.outboxCreate.mockRejectedValueOnce(new Error('connection pool timeout'));
    const alert = vi.fn(async () => undefined);

    const summary = await run(fake.prisma, alert);

    expect(summary.failed).toBe(1);
    const row = fake.rows.get('inbox_1');
    expect(row?.status).toBe('FAILED');
    expect(row?.reclaimAttempts).toBe(3);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({
        failureStage: 'WEBHOOK_PROCESSING',
        component: 'webhook-inbox-reclaim',
        jobName: 'payment-webhook',
        terminalFailure: true
      })
    );
  });

  it('fails rows without a stored redrive payload into the operator replay queue', async () => {
    const fake = createFakePrisma([makeRow({ redriveSpec: null })]);
    const alert = vi.fn(async () => undefined);

    const summary = await run(fake.prisma, alert);

    expect(summary.failed).toBe(1);
    expect(fake.rows.get('inbox_1')?.status).toBe('FAILED');
    expect(fake.rows.get('inbox_1')?.lastError).toContain('operator replay required');
    expect(fake.outboxCreate).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('rolls back the outbox write when the row left PROCESSING mid re-drive', async () => {
    const fake = createFakePrisma([makeRow()]);
    const realUpdateMany = fake.inboxUpdateMany.getMockImplementation();
    let call = 0;
    fake.inboxUpdateMany.mockImplementation(async (args) => {
      call += 1;
      if (call === 2) {
        // The ENQUEUED move inside the transaction: the row was finished elsewhere.
        return { count: 0 };
      }
      return realUpdateMany ? realUpdateMany(args) : { count: 0 };
    });

    const summary = await run(fake.prisma);

    expect(summary.skipped).toBe(1);
    expect(fake.outbox).toHaveLength(0);
  });

  it('never lets an alert failure abort the sweep', async () => {
    const fake = createFakePrisma([makeRow({ id: 'a', redriveSpec: null }), makeRow({ id: 'b', updatedAt: minutesAgo(20) })]);
    const alert = vi.fn(async () => {
      throw new Error('resend down');
    });

    const summary = await run(fake.prisma, alert);

    expect(summary).toMatchObject({ failed: 1, reEnqueued: 1 });
  });
});

describe('webhook inbox redrive spec helpers', () => {
  it('sanitizes colons out of the jobId exactly like the outbox writer', () => {
    expect(buildWebhookInboxRedriveSpec('shipping', 'update-shipment-status', {}, 'a:b:c').jobId).toBe('a-b-c');
  });

  it('rejects malformed stored specs', () => {
    expect(parseWebhookInboxRedriveSpec(null)).toBeNull();
    expect(parseWebhookInboxRedriveSpec({ queueName: 'nope', jobName: 'x', jobId: 'y', payload: {} })).toBeNull();
    expect(parseWebhookInboxRedriveSpec({ queueName: 'shipping', jobName: '', jobId: 'y', payload: {} })).toBeNull();
    expect(parseWebhookInboxRedriveSpec({ queueName: 'shipping', jobName: 'x', jobId: 'y', payload: [] })).toBeNull();
    expect(parseWebhookInboxRedriveSpec({ queueName: 'shipping', jobName: 'x', jobId: 'y', payload: { a: 1 } })).toEqual({
      queueName: 'shipping',
      jobName: 'x',
      jobId: 'y',
      payload: { a: 1 }
    });
  });

  it('reads the stale window and attempt limit from env with safe defaults', () => {
    expect(resolveWebhookInboxReclaimConfig({})).toMatchObject({ staleAfterMs: 10 * 60 * 1000, maxAttempts: 3 });
    expect(
      resolveWebhookInboxReclaimConfig({
        WEBHOOK_INBOX_RECLAIM_AFTER_MINUTES: '30',
        WEBHOOK_INBOX_RECLAIM_MAX_ATTEMPTS: '5'
      })
    ).toMatchObject({ staleAfterMs: 30 * 60 * 1000, maxAttempts: 5 });
    expect(
      resolveWebhookInboxReclaimConfig({
        WEBHOOK_INBOX_RECLAIM_AFTER_MINUTES: '0',
        WEBHOOK_INBOX_RECLAIM_MAX_ATTEMPTS: 'abc'
      })
    ).toMatchObject({ staleAfterMs: 10 * 60 * 1000, maxAttempts: 3 });
  });
});
