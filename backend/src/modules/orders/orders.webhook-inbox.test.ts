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
