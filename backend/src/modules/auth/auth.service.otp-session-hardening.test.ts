import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

const PHONE = '9876543210';
const OTP = '123456';
const OTP_HASH = crypto.createHash('sha256').update(OTP).digest('hex');
const REFRESH_SECRET = 'otp-session-hardening-refresh-secret';

function createHarness(options: { userRole?: Role; otpStored?: boolean } = {}) {
  const store = new Map<string, string>();
  if (options.otpStored !== false) {
    store.set(`otp:${PHONE}`, OTP_HASH);
  }
  const redis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) removed += 1;
      }
      return removed;
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
    ttl: vi.fn(async () => -1)
  };
  const user =
    options.userRole === undefined
      ? null
      : {
          id: options.userRole === Role.ADMIN ? 'admin-1' : 'customer-1',
          email: 'person@example.com',
          phone: PHONE,
          firstName: 'P',
          lastName: 'Q',
          role: options.userRole,
          isVerified: true,
          isBanned: false,
          passwordHash: 'x'
        };
  const notificationsAdd = vi.fn(async () => undefined);
  const refreshCreate = vi.fn(async () => undefined);
  const refreshUpdateMany = vi.fn(async () => ({ count: 1 }));
  const refreshFindMany = vi.fn(async () => []);
  const fastify = {
    redis,
    queues: { notifications: { add: notificationsAdd } },
    prisma: {
      opsConfigSecret: { findMany: vi.fn(async () => []) },
      user: {
        findFirst: vi.fn(async () => user),
        findUnique: vi.fn(async () => user),
        updateMany: vi.fn(async () => ({ count: 0 }))
      },
      storeSettings: {
        findUnique: vi.fn(async () => ({ storeName: 'Shop', mobileOtpSignupEnabled: true }))
      },
      refreshToken: {
        create: refreshCreate,
        updateMany: refreshUpdateMany,
        findMany: refreshFindMany,
        findUnique: vi.fn()
      },
      adminPermissionGrant: { findMany: vi.fn(async () => []) }
    },
    jwt: { sign: vi.fn(() => 'access-token') }
  } as unknown as FastifyInstance;
  return { service: new AuthService(fastify), store, redis, notificationsAdd, refreshCreate, refreshUpdateMany, refreshFindMany };
}

describe('AuthService customer OTP hardening', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_DEV_BYPASS', 'false');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('MSG91_AUTH_KEY', 'msg91-auth-key');
    vi.stubEnv('JWT_REFRESH_SECRET', REFRESH_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects verify-otp for an ADMIN phone with a valid code and issues no tokens', async () => {
    const h = createHarness({ userRole: Role.ADMIN });

    await expect(
      h.service.verifyOtp({ phone: PHONE, otp: OTP }, { clientIp: '10.0.0.1' })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    expect(h.refreshCreate).not.toHaveBeenCalled();
    // The failed attempt is recorded against the customer audience lockout counter.
    expect(h.redis.incr).toHaveBeenCalledWith(expect.stringContaining(PHONE));
  });

  it('never delivers a send-otp code to an ADMIN phone, but answers like a normal send', async () => {
    const h = createHarness({ userRole: Role.ADMIN, otpStored: false });

    const result = await h.service.sendOtp({ phone: PHONE, channel: 'sms' }, { clientIp: '10.0.0.1' });

    expect(result).toEqual({ message: 'OTP sent successfully' });
    expect(h.store.has(`otp:${PHONE}`)).toBe(false);
    expect(h.notificationsAdd).not.toHaveBeenCalled();
  });

  it('still issues tokens for a CUSTOMER with a valid code and clears the phone failure counter', async () => {
    const h = createHarness({ userRole: Role.CUSTOMER });
    h.store.set(`otp:verify-fails:${PHONE}`, '1');

    const result = await h.service.verifyOtp({ phone: PHONE, otp: OTP }, { clientIp: '10.0.0.1' });

    expect(result.accessToken).toBe('access-token');
    expect(h.store.has(`otp:verify-fails:${PHONE}`)).toBe(false);
  });

  it('burns the OTP after 3 wrong guesses even when the attacker rotates IP, device and session headers', async () => {
    const h = createHarness({ userRole: Role.CUSTOMER });

    for (let i = 0; i < 3; i += 1) {
      await expect(
        h.service.verifyOtp(
          { phone: PHONE, otp: '000000' },
          { clientIp: `10.0.0.${i}`, risk: { deviceFingerprint: `dev-${i}`, sessionId: `sess-${i}` } }
        )
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }

    expect(h.store.has(`otp:${PHONE}`)).toBe(false);
    // The correct code no longer works once burned.
    await expect(h.service.verifyOtp({ phone: PHONE, otp: OTP }, { clientIp: '10.0.0.9' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS'
    });
  });

  it('burns the OTP after 3 wrong guesses on the phone signup path too', async () => {
    const h = createHarness();

    for (let i = 0; i < 3; i += 1) {
      await expect(
        h.service.verifyOtpAndSignup({ phone: PHONE, otp: '000000' }, { clientIp: `10.1.0.${i}` })
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }

    expect(h.store.has(`otp:${PHONE}`)).toBe(false);
  });

  it('refuses send-otp while the phone-level failure limit is reached, whatever the client headers', async () => {
    const h = createHarness({ userRole: Role.CUSTOMER, otpStored: false });
    h.store.set(`otp:verify-fails:${PHONE}`, '3');

    await expect(
      h.service.sendOtp(
        { phone: PHONE, channel: 'sms' },
        { clientIp: '10.9.9.9', risk: { deviceFingerprint: 'fresh-device', sessionId: 'fresh-session' } }
      )
    ).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 });
    expect(h.notificationsAdd).not.toHaveBeenCalled();
  });
});

describe('AuthService refresh token hashing + logout', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_REFRESH_SECRET', REFRESH_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stores a SHA-256 hash that covers the whole refresh JWT', async () => {
    const h = createHarness({ userRole: Role.CUSTOMER });

    const result = await h.service.verifyOtp({ phone: PHONE, otp: OTP }, { clientIp: '10.0.0.1' });

    const created = (h.refreshCreate.mock.calls[0] as unknown as [{ data: { tokenHash: string } }])[0];
    const expected = `sha256:${crypto.createHash('sha256').update(result.refreshToken).digest('hex')}`;
    expect(created.data.tokenHash).toBe(expected);
  });

  it('demonstrates the bcrypt 72-byte collision the fix removes (two tokens, same user)', async () => {
    const a = jwt.sign({ sub: 'customer-1', role: Role.CUSTOMER, sid: 'sess-old', jti: 'jti-a' }, REFRESH_SECRET);
    const b = jwt.sign({ sub: 'customer-1', role: Role.CUSTOMER, sid: 'sess-new', jti: 'jti-b' }, REFRESH_SECRET);
    expect(await bcrypt.compare(b, bcrypt.hashSync(a, 4))).toBe(true);
  });

  it('logout revokes the session named in the signed cookie, not the first bcrypt-matching row', async () => {
    const h = createHarness({ userRole: Role.CUSTOMER });
    const liveToken = jwt.sign(
      { sub: 'customer-1', role: Role.CUSTOMER, sid: 'sess-live', jti: 'jti-live' },
      REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    await h.service.logout('customer-1', liveToken, 'sess-live');

    expect(h.refreshFindMany).not.toHaveBeenCalled();
    expect(h.refreshUpdateMany).toHaveBeenCalledTimes(1);
    expect(h.refreshUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'customer-1', sessionId: 'sess-live', revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
  });

  it('logout ignores a forged or foreign cookie and falls back to the access-token session', async () => {
    const h = createHarness({ userRole: Role.CUSTOMER });
    const forged = jwt.sign({ sub: 'customer-1', sid: 'sess-victim', jti: 'x' }, 'wrong-secret');
    const foreign = jwt.sign({ sub: 'someone-else', sid: 'sess-other', jti: 'y' }, REFRESH_SECRET);

    await h.service.logout('customer-1', forged, 'sess-current');
    await h.service.logout('customer-1', foreign, 'sess-current');

    expect(h.refreshUpdateMany).toHaveBeenCalledTimes(2);
    for (const call of h.refreshUpdateMany.mock.calls as unknown as Array<[{ where: unknown }]>) {
      expect(call[0].where).toEqual({ userId: 'customer-1', sessionId: 'sess-current', revokedAt: null });
    }
  });
});
