import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { idempotencyOnSend, idempotencyPreHandler } from './idempotency';

type IdempotencyRequest = Parameters<typeof idempotencyPreHandler>[0];
type IdempotencyReply = Parameters<typeof idempotencyPreHandler>[1];
type IdempotencyOnSendReply = Parameters<typeof idempotencyOnSend>[1];

function createRequest(overrides?: Partial<Record<string, unknown>>) {
  const state = {
    existingRecord: null as null | Record<string, unknown>,
    createdRecordId: 'idem_1'
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
  return { request, prisma, state };
}

describe('idempotency middleware', () => {
  const expectedHash = createHash('sha256').update(JSON.stringify({ orderId: 'ord_1' })).digest('hex');

  it('replays completed responses for duplicate payload', async () => {
    const { request, state } = createRequest();
    state.existingRecord = {
      id: 'idem_existing',
      requestHash: expectedHash,
      status: 'COMPLETED',
      responsePayload: { ok: true },
      responseStatus: 201
    };
    const reply = {
      header: vi.fn(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn()
    } as unknown as IdempotencyReply;

    await idempotencyPreHandler(request, reply);

    expect(reply.header).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith({ ok: true });
  });

  it('moves FAILED records back to PROCESSING for same payload', async () => {
    const { request, prisma, state } = createRequest();
    state.existingRecord = {
      id: 'idem_failed',
      requestHash: expectedHash,
      status: 'FAILED'
    };
    const reply = {
      header: vi.fn(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn()
    } as unknown as IdempotencyReply;

    await idempotencyPreHandler(request, reply);

    expect(prisma.idempotencyRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'idem_failed' },
        data: expect.objectContaining({ status: 'PROCESSING' })
      })
    );
  });

  it('marks 5xx responses as FAILED', async () => {
    const { request, prisma } = createRequest();
    request.idempotencyContext = { id: 'idem_x', route: '/api/v1/orders' };
    const reply = { statusCode: 502 } as unknown as IdempotencyOnSendReply;

    await idempotencyOnSend(request, reply, JSON.stringify({ ok: false }));

    expect(prisma.idempotencyRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'idem_x' },
        data: expect.objectContaining({ status: 'FAILED', responseStatus: 502 })
      })
    );
  });
});
