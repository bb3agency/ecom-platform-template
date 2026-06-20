import { describe, expect, it, vi } from 'vitest';
import { idempotencyOnSend, idempotencyPreHandler } from './idempotency';

type IdempotencyRequest = Parameters<typeof idempotencyPreHandler>[0];
type IdempotencyReply = Parameters<typeof idempotencyPreHandler>[1];
type IdempotencyOnSendReply = Parameters<typeof idempotencyOnSend>[1];

function createRequest(overrides?: Partial<Record<string, unknown>>) {
  const state = {
    existingRecord: null as null | Record<string, unknown>,
    createdRecordId: 'idem_new'
  };
  const prisma = {
    idempotencyRecord: {
      findUnique: vi.fn(async () => state.existingRecord),
      update: vi.fn(async () => undefined),
      upsert: vi.fn(async () => ({ id: state.createdRecordId }))
    }
  };
  const request = {
    method: 'POST',
    ip: '127.0.0.1',
    routeOptions: { url: '/api/v1/orders' },
    url: '/api/v1/orders',
    body: { orderId: 'ord_1' },
    headers: { 'idempotency-key': 'key_1' },
    user: undefined,
    server: { prisma },
    ...overrides
  } as unknown as IdempotencyRequest;

  return { request, prisma };
}

describe('idempotency security invariants', () => {
  it('hashes scope key for authenticated users', async () => {
    const { request, prisma } = createRequest({
      user: { sub: 'user_42', role: 'CUSTOMER' }
    });
    const reply = {
      header: vi.fn(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn()
    } as unknown as IdempotencyReply;

    await idempotencyPreHandler(request, reply);

    const [upsertCall] = (prisma.idempotencyRecord.upsert.mock.calls as unknown as Array<[any]>);
    expect(upsertCall).toBeDefined();
    const upsertArgs = upsertCall![0];
    expect(upsertArgs.create.scopeKey).toMatch(/^user:/);
    expect(upsertArgs.create.scopeKey).not.toContain('user_42');
  });

  it('redacts sensitive fields before storing replay payload', async () => {
    const { request, prisma } = createRequest();
    request.idempotencyContext = { id: 'idem_1', route: '/api/v1/orders' };
    const reply = { statusCode: 200 } as unknown as IdempotencyOnSendReply;

    await idempotencyOnSend(
      request,
      reply,
      JSON.stringify({
        ok: true,
        token: 'abc',
        nested: { authorization: 'secret-value' }
      })
    );

    const [updateCall] = (prisma.idempotencyRecord.update.mock.calls as unknown as Array<[any]>);
    expect(updateCall).toBeDefined();
    const updateArgs = updateCall![0];
    expect(updateArgs.data.responsePayload).toMatchObject({
      ok: true,
      token: '[REDACTED]',
      nested: { authorization: '[REDACTED]' }
    });
  });
});
