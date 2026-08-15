import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { UsersService } from './users.service';
import { hashIdentifierOtp, identifierChangeKey } from './identifier-change';

/**
 * Regression suite for pentest F-1 (2026-08-15, High): mass assignment on
 * PATCH /users/me let anyone holding a stolen access token rebind the account's
 * email and phone to attacker-controlled values, redirecting password reset and
 * OTP recovery — full account takeover.
 *
 * The security property these tests defend: an identifier can only change when
 * the caller proves control of the identifier ALREADY on the account.
 */

type RedisStub = {
  store: Map<string, string>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
};

function makeRedis(seed: Record<string, string> = {}): RedisStub {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      keys.forEach((key) => store.delete(key));
      return keys.length;
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1)
  };
}

function makeFastify(options: {
  me?: Record<string, unknown> | null;
  conflictingUser?: Record<string, unknown> | null;
  redis?: RedisStub;
} = {}) {
  const me = options.me === undefined
    ? { isBanned: false, email: 'me@example.com', phone: '9999999999' }
    : options.me;
  const updated = {
    id: 'user_1',
    email: 'me@example.com',
    phone: '9999999999',
    firstName: 'Me',
    lastName: null,
    role: 'CUSTOMER',
    isVerified: true
  };
  const update = vi.fn().mockResolvedValue(updated);
  const revokeMany = vi.fn().mockResolvedValue({ count: 2 });
  const outboxCreate = vi.fn().mockResolvedValue({});
  const redis = options.redis ?? makeRedis();
  const fastify = {
    prisma: {
      user: {
        findUnique: vi.fn().mockResolvedValue(me),
        findFirst: vi.fn().mockResolvedValue(options.conflictingUser ?? null),
        update
      },
      storeSettings: { findUnique: vi.fn().mockResolvedValue({ storeName: 'Test Store' }) },
      refreshToken: { updateMany: revokeMany },
      outboxMessage: { create: outboxCreate }
    },
    redis,
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
  } as unknown as FastifyInstance;
  return { fastify, update, revokeMany, outboxCreate, redis };
}

describe('patchMe — identifiers are not writable (F-1)', () => {
  it('rejects banned customers', async () => {
    const { fastify, update } = makeFastify({ me: { isBanned: true } });
    const service = new UsersService(fastify);
    await expect(service.patchMe('user_1', { firstName: 'New' })).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringContaining('suspended')
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('updates names', async () => {
    const { fastify, update } = makeFastify();
    const service = new UsersService(fastify);
    await service.patchMe('user_1', { firstName: 'Ada', lastName: 'Lovelace' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { firstName: 'Ada', lastName: 'Lovelace' } })
    );
  });

  it('NEVER writes email or phone, even when they are smuggled into the payload', async () => {
    // The route schema (additionalProperties: false) rejects these first; this
    // asserts the service itself refuses to rebind, so a future schema slip
    // cannot silently reopen the takeover path.
    const { fastify, update } = makeFastify();
    const service = new UsersService(fastify);

    await service.patchMe('user_1', {
      firstName: 'Ada',
      email: 'attacker-controlled@example.com',
      phone: '8999999999'
    } as never);

    const written = update.mock.calls[0]?.[0]?.data ?? {};
    expect(written).not.toHaveProperty('email');
    expect(written).not.toHaveProperty('phone');
    expect(written).toEqual({ firstName: 'Ada' });
  });
});

describe('requestIdentifierChange — proves control of the CURRENT identifier', () => {
  it('sends a code to the existing email and to the new address', async () => {
    const { fastify, outboxCreate, redis } = makeFastify();
    const service = new UsersService(fastify);

    const result = await service.requestIdentifierChange('user_1', {
      type: 'email',
      newValue: 'New.Address@Example.com'
    });

    // Two codes: one to the account's current email, one to the new address.
    expect(outboxCreate).toHaveBeenCalledTimes(2);
    const recipients = outboxCreate.mock.calls.map((call) => call[0].data.payload.to);
    expect(recipients).toEqual(['me@example.com', 'new.address@example.com']);
    // Nothing is written yet, and the response only exposes masked targets.
    expect(fastify.prisma.user.update).not.toHaveBeenCalled();
    expect(result.currentTargetMasked).not.toContain('me@example.com');
    expect(result.currentTargetMasked).toContain('@example.com');
    expect(redis.store.has(identifierChangeKey('user_1', 'email'))).toBe(true);
  });

  it('confirms via SMS when a phone-only account adds an email', async () => {
    const { fastify, outboxCreate } = makeFastify({
      me: { isBanned: false, email: null, phone: '9999999999' }
    });
    const service = new UsersService(fastify);

    await service.requestIdentifierChange('user_1', { type: 'email', newValue: 'first@example.com' });

    expect(outboxCreate.mock.calls[0]?.[0].data.jobName).toBe('send-sms');
    expect(outboxCreate.mock.calls[0]?.[0].data.payload.phone).toBe('9999999999');
  });

  it('rejects a value already bound to another account (409)', async () => {
    const { fastify } = makeFastify({ conflictingUser: { id: 'other_user' } });
    const service = new UsersService(fastify);
    await expect(
      service.requestIdentifierChange('user_1', { type: 'phone', newValue: '8888888888' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('rejects removing the phone when it is the only way back in', async () => {
    const { fastify } = makeFastify({ me: { isBanned: false, email: null, phone: '9999999999' } });
    const service = new UsersService(fastify);
    await expect(
      service.requestIdentifierChange('user_1', { type: 'phone', newValue: null })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('email') });
  });

  it('rejects a no-op change and email removal', async () => {
    const { fastify } = makeFastify();
    const service = new UsersService(fastify);
    await expect(
      service.requestIdentifierChange('user_1', { type: 'email', newValue: 'me@example.com' })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.requestIdentifierChange('user_1', { type: 'email', newValue: null })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rate-limits repeat requests (429)', async () => {
    const { fastify } = makeFastify();
    const service = new UsersService(fastify);
    await service.requestIdentifierChange('user_1', { type: 'email', newValue: 'a@example.com' });
    await expect(
      service.requestIdentifierChange('user_1', { type: 'email', newValue: 'b@example.com' })
    ).rejects.toMatchObject({ statusCode: 429 });
  });
});

describe('verifyIdentifierChange — commits only with BOTH codes', () => {
  function seedChallenge(currentOtp: string, newOtp: string | null, newValue: string | null) {
    return makeRedis({
      [identifierChangeKey('user_1', 'email')]: JSON.stringify({
        type: 'email',
        newValue,
        currentOtpHash: hashIdentifierOtp(currentOtp),
        ...(newOtp ? { newOtpHash: hashIdentifierOtp(newOtp) } : {}),
        currentTargetMasked: 'me••@example.com',
        newTargetMasked: 'ne••@example.com',
        createdAtIso: new Date().toISOString()
      })
    });
  }

  it('rebinds the identifier and revokes every session', async () => {
    const redis = seedChallenge('111111', '222222', 'new@example.com');
    const { fastify, update, revokeMany } = makeFastify({ redis });
    const service = new UsersService(fastify);

    await service.verifyIdentifierChange('user_1', {
      type: 'email',
      currentOtp: '111111',
      newOtp: '222222'
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { email: 'new@example.com' } })
    );
    // Remediation #7: an attacker riding a stolen token loses it too.
    expect(revokeMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_1', revokedAt: null } })
    );
    expect(redis.store.has(identifierChangeKey('user_1', 'email'))).toBe(false);
  });

  it('THE ATTACK: knowing only the new-address code is not enough', async () => {
    // The attacker controls the new mailbox, so they can read that code — but not
    // the one sent to the victim's existing address. This must fail.
    const redis = seedChallenge('111111', '222222', 'attacker@example.com');
    const { fastify, update } = makeFastify({ redis });
    const service = new UsersService(fastify);

    await expect(
      service.verifyIdentifierChange('user_1', {
        type: 'email',
        currentOtp: '000000',
        newOtp: '222222'
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('locks out after repeated wrong codes', async () => {
    const redis = seedChallenge('111111', '222222', 'new@example.com');
    const { fastify, update } = makeFastify({ redis });
    const service = new UsersService(fastify);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.verifyIdentifierChange('user_1', { type: 'email', currentOtp: '999999', newOtp: '222222' })
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(
      service.verifyIdentifierChange('user_1', { type: 'email', currentOtp: '111111', newOtp: '222222' })
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a missing or expired challenge', async () => {
    const { fastify } = makeFastify({ redis: makeRedis() });
    const service = new UsersService(fastify);
    await expect(
      service.verifyIdentifierChange('user_1', { type: 'email', currentOtp: '111111', newOtp: '222222' })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('expired') });
  });

  it('re-checks the conflict at commit time (409)', async () => {
    const redis = seedChallenge('111111', '222222', 'new@example.com');
    const { fastify, update } = makeFastify({ redis, conflictingUser: { id: 'other_user' } });
    const service = new UsersService(fastify);

    await expect(
      service.verifyIdentifierChange('user_1', { type: 'email', currentOtp: '111111', newOtp: '222222' })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(update).not.toHaveBeenCalled();
  });
});
