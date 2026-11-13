import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

vi.mock('@modules/payments/payment-provider', () => ({
  createPaymentProvider: () => ({
    verifyWebhookSignature: () => true,
    verifyPaymentSignature: () => true
  })
}));

class RedisMock {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, _mode: 'EX', _ttl: number, condition?: 'NX'): Promise<'OK' | null> {
    if (condition === 'NX' && this.values.has(key)) {
      return null;
    }
    this.values.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
}

type InboxRow = { provider: string; eventKey: string; payloadHash: string; status: string; lastError?: string | null };

function createInboxDelegate() {
  const rows = new Map<string, InboxRow>();
  const key = (provider: string, eventKey: string) => `${provider}|${eventKey}`;
  const delegate = {
    rows,
    create: vi.fn(async ({ data }: { data: InboxRow }) => {
      const k = key(data.provider, data.eventKey);
      if (rows.has(k)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      rows.set(k, { ...data });
      return data;
    }),
    updateMany: vi.fn(
      async ({ where, data }: { where: { provider: string; eventKey: string; status: string }; data: Partial<InboxRow> }) => {
        const row = rows.get(key(where.provider, where.eventKey));
        if (!row || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }
    ),
    findUnique: vi.fn(
      async ({ where }: { where: { provider_eventKey: { provider: string; eventKey: string } } }) =>
        rows.get(key(where.provider_eventKey.provider, where.provider_eventKey.eventKey)) ?? null
    ),
    update: vi.fn(
      async ({
        where,
        data
      }: {
        where: { provider_eventKey: { provider: string; eventKey: string } };
        data: Partial<InboxRow>;
      }) => {
        const row = rows.get(key(where.provider_eventKey.provider, where.provider_eventKey.eventKey));
        if (!row) throw new Error('Record to update not found');
        Object.assign(row, data);
        return row;
      }
    )
  };
  return delegate;
}

function createService() {
  const redis = new RedisMock();
  const inbox = createInboxDelegate();
  const outboxCreate = vi.fn(async () => undefined);
  const service = new OrdersService({
    redis,
    prisma: {
      webhookInboxEvent: inbox,
      outboxMessage: { create: outboxCreate }
    },
    queues: {
      orderProcessing: { add: vi.fn(async () => undefined) }
    },
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
  } as unknown as ConstructorParameters<typeof OrdersService>[0]);
  return { service, redis, inbox, outboxCreate };
}

const payload = Buffer.from(
  JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_inbox_1', order_id: 'order_inbox_1' } } }
  })
);
const signature = createHmac('sha256', 'rzp-secret').update(payload).digest('hex');

describe('OrdersService Razorpay webhook inbox reliability (be-rel-05)', () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp-secret';
  });

  it('releases the event-id lock when the inbox claim throws, so the provider retry is processed', async () => {
    const { service, redis, inbox, outboxCreate } = createService();
    inbox.create.mockRejectedValueOnce(new Error("Can't reach database server"));

    await expect(service.processPaymentWebhook(signature, payload, 'evt_1')).rejects.toThrow(
      "Can't reach database server"
    );
    // Nothing retained that would make the retry look like a duplicate.
    expect([...redis.values.keys()].some((k) => k.includes('rzp:webhook:event'))).toBe(false);
    expect([...redis.values.keys()].some((k) => k.includes('rzp:capture'))).toBe(false);
    expect(outboxCreate).not.toHaveBeenCalled();

    // Razorpay retries the same event once the DB is back.
    await expect(service.processPaymentWebhook(signature, payload, 'evt_1')).resolves.toEqual({ received: true });
    expect(outboxCreate).toHaveBeenCalledTimes(1);
  });

  it('marks a claimed inbox row FAILED and rolls back markers when a later step throws', async () => {
    const { service, redis, inbox, outboxCreate } = createService();
    const originalSet = redis.set.bind(redis);
    const setSpy = vi.spyOn(redis, 'set');
    setSpy.mockImplementation(async (key, value, mode, ttl, condition) => {
      if (key.includes('rzp:capture')) {
        throw new Error('READONLY You cannot write against a read only replica');
      }
      return originalSet(key, value, mode, ttl, condition);
    });

    await expect(service.processPaymentWebhook(signature, payload, 'evt_2')).rejects.toThrow('READONLY');

    const row = [...inbox.rows.values()][0];
    expect(row?.status).toBe('FAILED');
    expect([...redis.values.keys()].some((k) => k.includes('rzp:webhook'))).toBe(false);

    setSpy.mockRestore();
    await service.processPaymentWebhook(signature, payload, 'evt_2');
    expect(outboxCreate).toHaveBeenCalledTimes(1);
  });

  it('moves the inbox row to ENQUEUED after the outbox write succeeds', async () => {
    const { service, inbox } = createService();

    await service.processPaymentWebhook(signature, payload, 'evt_3');

    const row = [...inbox.rows.values()][0];
    expect(row?.status).toBe('ENQUEUED');
  });

  it('still acknowledges true duplicates without re-enqueueing', async () => {
    const { service, outboxCreate } = createService();

    await service.processPaymentWebhook(signature, payload, 'evt_4');
    await service.processPaymentWebhook(signature, payload, 'evt_4');

    expect(outboxCreate).toHaveBeenCalledTimes(1);
  });
});

describe('OrdersService webhook inbox redrive spec (stuck-PROCESSING reclaim)', () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp-secret';
    process.env.DELHIVERY_API_KEY = 'delhivery-token';
  });

  type StoredRow = InboxRow & { redriveSpec?: Record<string, unknown>; reclaimAttempts?: number };

  it('stores exactly the outbox message it writes on the inbox row, so a re-drive is identical', async () => {
    const { service, inbox, outboxCreate } = createService();

    await service.processPaymentWebhook(signature, payload, 'evt_spec_1');

    const row = [...inbox.rows.values()][0] as StoredRow | undefined;
    const outboxArgs = (outboxCreate.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>)[0]?.[0];
    if (!outboxArgs) throw new Error('expected an outbox write');
    expect(row?.reclaimAttempts).toBe(0);
    expect(row?.redriveSpec).toEqual({
      queueName: outboxArgs.data.queueName,
      jobName: outboxArgs.data.jobName,
      payload: outboxArgs.data.payload,
      jobId: outboxArgs.data.jobId
    });
    expect(outboxArgs.data.jobName).toBe('deduct-inventory');
  });

  it('gives payment-webhook outbox rows a deterministic per-event jobId', async () => {
    const failedPayload = Buffer.from(
      JSON.stringify({
        event: 'payment.failed',
        payload: { payment: { entity: { id: 'pay_failed_1', order_id: 'order_failed_1' } } }
      })
    );
    const failedSignature = createHmac('sha256', 'rzp-secret').update(failedPayload).digest('hex');
    const first = createService();
    const second = createService();

    await first.service.processPaymentWebhook(failedSignature, failedPayload, 'evt_failed_a');
    await second.service.processPaymentWebhook(failedSignature, failedPayload, 'evt_failed_b');

    const jobIdOf = (mock: typeof first.outboxCreate) =>
      (mock.mock.calls as unknown as Array<[{ data: { jobId?: string; jobName: string } }]>)[0]?.[0].data;
    const a = jobIdOf(first.outboxCreate);
    const b = jobIdOf(second.outboxCreate);
    expect(a?.jobName).toBe('payment-webhook');
    expect(a?.jobId).toMatch(/^payment-webhook-[0-9a-f]{24}$/);
    // Same event identity (event + payment) => same jobId, whatever the delivery id.
    expect(b?.jobId).toBe(a?.jobId);
  });

  it('leaves a re-drivable PROCESSING row behind when the process dies before the outbox write', async () => {
    const { service, redis, inbox, outboxCreate } = createService();
    // Simulate a crash right after the inbox claim: the delivery never progresses.
    vi.spyOn(redis, 'get').mockImplementation(() => new Promise<string | null>(() => undefined));

    void service.processPaymentWebhook(signature, payload, 'evt_crash_1');
    await vi.waitFor(() => expect(inbox.rows.size).toBe(1));

    const row = [...inbox.rows.values()][0] as StoredRow | undefined;
    expect(row?.status).toBe('PROCESSING');
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(row?.redriveSpec).toMatchObject({
      queueName: 'orderProcessing',
      jobName: 'deduct-inventory',
      payload: { event: 'payment.captured', providerOrderId: 'order_inbox_1', providerPaymentId: 'pay_inbox_1' }
    });
  });

  it('moves a shipping inbox row to ENQUEUED (with its redrive spec) after the outbox write', async () => {
    const { service, inbox, outboxCreate } = createService();
    const shippingPayload = Buffer.from(
      JSON.stringify({
        awb: 'awb_inbox_1',
        status: 'IN_TRANSIT',
        description: 'Shipment is moving',
        location: 'Hub A',
        occurredAt: new Date().toISOString()
      })
    );

    await service.processShippingWebhook('Token delhivery-token', shippingPayload);

    const row = [...inbox.rows.values()][0] as StoredRow | undefined;
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    expect(row?.status).toBe('ENQUEUED');
    expect(row?.redriveSpec).toMatchObject({
      queueName: 'shipping',
      jobName: 'update-shipment-status',
      payload: { awb: 'awb_inbox_1', status: 'IN_TRANSIT' }
    });
    expect(String(row?.redriveSpec?.jobId)).not.toContain(':');
  });
});
