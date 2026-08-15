import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { AuthService } from './auth.service';

function createFastifyMock() {
  const redisTtl = vi.fn(async () => -1);
  const redisDel = vi.fn(async () => 1);
  const redisSet = vi.fn(async () => 'OK');
  const redisGet = vi.fn<() => Promise<string | null>>(async () => null);
  const redisIncr = vi.fn(async () => 1);
  const redisExpire = vi.fn(async () => 1);
  const userFindUnique = vi.fn();
  const userUpdate = vi.fn();
  const refreshCreate = vi.fn();
  const refreshFindUnique = vi.fn();
  const refreshUpdate = vi.fn();
  const refreshUpdateMany = vi.fn(async () => ({ count: 1 }));
  const jwtSign = vi.fn(() => 'access-token');

  return {
    fastify: {
      redis: {
        ttl: redisTtl,
        del: redisDel,
        set: redisSet,
        get: redisGet,
        incr: redisIncr,
        expire: redisExpire
      },
      prisma: {
        user: {
          findUnique: userFindUnique,
          update: userUpdate
        },
        refreshToken: {
          create: refreshCreate,
          findUnique: refreshFindUnique,
          update: refreshUpdate,
          updateMany: refreshUpdateMany
        },
        adminPermissionGrant: {
          findMany: vi.fn(async () => [])
        }
      },
      jwt: {
        sign: jwtSign
      }
    } as unknown as FastifyInstance,
    mocks: {
      redisTtl,
      redisDel,
      redisSet,
      redisGet,
      redisIncr,
      redisExpire,
      userFindUnique,
      userUpdate,
      refreshCreate,
      refreshFindUnique,
      refreshUpdate,
      refreshUpdateMany,
      jwtSign
    }
  };
}

describe('AuthService refresh hardening + logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.JWT_SECRET = 'test-jwt-secret';
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it('returns generic invalid credentials for admin account on customer login path', async () => {
    const { fastify, mocks } = createFastifyMock();
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin-2',
      email: 'admin2@example.com',
      phone: null,
      passwordHash: bcrypt.hashSync('password-123', 10),
      firstName: 'Admin',
      lastName: 'Two',
      role: Role.ADMIN,
      isVerified: true
    });
    const service = new AuthService(fastify);

    await expect(
      service.login(
        { identifier: 'admin2@example.com', password: 'password-123' },
        { clientIp: '127.0.0.1', audience: 'customer' }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
  });

  it('revokes refresh session family on device mismatch', async () => {
    const { fastify, mocks } = createFastifyMock();
    const refreshToken = jwt.sign(
      { sub: 'admin-1', role: Role.ADMIN, jti: 'jti-1', sid: 'session-1' },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: '7d' }
    );
    mocks.refreshFindUnique.mockResolvedValue({
      id: 'rt-1',
      userId: 'admin-1',
      jti: 'jti-1',
      sessionId: 'session-1',
      tokenHash: bcrypt.hashSync(refreshToken, 10),
      deviceKeyHash: 'different-device-hash',
      consumedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000)
    });
    const service = new AuthService(fastify);

    await expect(
      service.refresh(refreshToken, {
        clientIp: '127.0.0.1',
        risk: { sessionId: 'session-1', deviceFingerprint: 'device-a', tlsFingerprint: 'tls-a', userAgent: 'ua-a' }
      })
    ).rejects.toMatchObject({ code: 'UNAUTHORISED', statusCode: 401 });

    expect(mocks.refreshUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'admin-1',
          sessionId: 'session-1',
          revokedAt: null
        })
      })
    );
  });

  it('rotates refresh token on valid single-use refresh', async () => {
    const { fastify, mocks } = createFastifyMock();
    const refreshToken = jwt.sign(
      { sub: 'admin-1', role: Role.ADMIN, jti: 'jti-1', sid: 'session-1' },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: '7d' }
    );
    // Refresh tokens are bound to the User-Agent only (not client IP) so a network
    // change does not revoke the session — see deriveDeviceKeyHash.
    const deviceKeyHash = crypto
      .createHash('sha256')
      .update('ua|ua-a')
      .digest('hex');
    mocks.refreshFindUnique.mockResolvedValue({
      id: 'rt-1',
      userId: 'admin-1',
      jti: 'jti-1',
      sessionId: 'session-1',
      tokenHash: bcrypt.hashSync(refreshToken, 10),
      deviceKeyHash,
      consumedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000)
    });
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      phone: null,
      passwordHash: bcrypt.hashSync('password-123', 10),
      firstName: 'Admin',
      lastName: 'User',
      role: Role.ADMIN,
      isVerified: true
    });
    const service = new AuthService(fastify);

    const result = await service.refresh(refreshToken, {
      clientIp: '127.0.0.1',
      risk: { sessionId: 'session-1', deviceFingerprint: 'device-a', tlsFingerprint: 'tls-a', userAgent: 'ua-a' }
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(mocks.refreshUpdateMany).toHaveBeenCalledWith({
      where: { id: 'rt-1', consumedAt: null },
      data: { consumedAt: expect.any(Date) }
    });
    expect(mocks.refreshCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 'session-1',
          deviceKeyHash
        })
      })
    );
  });

  it('keeps the session alive when the client IP changes but the User-Agent is unchanged', async () => {
    // Session-persistence regression: mobile carriers rotate the egress IP between
    // login and refresh. IP must NOT be part of the device binding, so this refresh
    // succeeds instead of revoking the session ("logged out on reload" on mobile).
    const { fastify, mocks } = createFastifyMock();
    const refreshToken = jwt.sign(
      { sub: 'admin-1', role: Role.ADMIN, jti: 'jti-ip', sid: 'session-ip' },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: '7d' }
    );
    const deviceKeyHash = crypto.createHash('sha256').update('ua|ua-a').digest('hex');
    mocks.refreshFindUnique.mockResolvedValue({
      id: 'rt-ip',
      userId: 'admin-1',
      jti: 'jti-ip',
      sessionId: 'session-ip',
      tokenHash: bcrypt.hashSync(refreshToken, 10),
      deviceKeyHash,
      consumedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000)
    });
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      phone: null,
      passwordHash: bcrypt.hashSync('password-123', 10),
      firstName: 'Admin',
      lastName: 'User',
      role: Role.ADMIN,
      isVerified: true
    });
    const service = new AuthService(fastify);

    // Login IP was 127.0.0.1; refresh arrives from a different carrier IP.
    const result = await service.refresh(refreshToken, {
      clientIp: '203.0.113.42',
      risk: { sessionId: 'session-ip', userAgent: 'ua-a' }
    });

    expect(result.accessToken).toBe('access-token');
    expect(mocks.refreshUpdateMany).toHaveBeenCalledWith({
      where: { id: 'rt-ip', consumedAt: null },
      data: { consumedAt: expect.any(Date) }
    });
    // The session-family revoke (device mismatch path) must NOT have fired.
    expect(mocks.refreshUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.anything() }) })
    );
  });

  it('allows a just-consumed refresh token within the 60s reuse grace (concurrent tabs/requests)', async () => {
    // Single-use rotation + a shared httpOnly cookie: parallel requests present the
    // SAME token; only the first CAS-consumes it. Hard-rejecting the rest logged
    // the whole session out mid-use. A token consumed seconds ago (same device,
    // hash verified) must still mint tokens.
    const { fastify, mocks } = createFastifyMock();
    const refreshToken = jwt.sign(
      { sub: 'admin-1', role: Role.ADMIN, jti: 'jti-grace', sid: 'session-grace' },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: '7d' }
    );
    mocks.refreshFindUnique.mockResolvedValue({
      id: 'rt-grace',
      userId: 'admin-1',
      jti: 'jti-grace',
      sessionId: 'session-grace',
      tokenHash: bcrypt.hashSync(refreshToken, 10),
      deviceKeyHash: crypto.createHash('sha256').update('ua|ua-a').digest('hex'),
      consumedAt: new Date(Date.now() - 5_000), // consumed 5s ago by a parallel request
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000)
    });
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      phone: null,
      passwordHash: bcrypt.hashSync('password-123', 10),
      firstName: 'Admin',
      lastName: 'User',
      role: Role.ADMIN,
      isVerified: true
    });
    const service = new AuthService(fastify);

    const result = await service.refresh(refreshToken, {
      clientIp: '127.0.0.1',
      risk: { sessionId: 'session-grace', userAgent: 'ua-a' }
    });

    expect(result.accessToken).toBe('access-token');
    // Grace path must NOT re-consume (no CAS on an already-consumed row).
    expect(mocks.refreshUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'rt-grace' }) })
    );
  });

  it('rejects a refresh token consumed beyond the reuse grace window', async () => {
    const { fastify, mocks } = createFastifyMock();
    const refreshToken = jwt.sign(
      { sub: 'admin-1', role: Role.ADMIN, jti: 'jti-stale', sid: 'session-stale' },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: '7d' }
    );
    mocks.refreshFindUnique.mockResolvedValue({
      id: 'rt-stale',
      userId: 'admin-1',
      jti: 'jti-stale',
      sessionId: 'session-stale',
      tokenHash: bcrypt.hashSync(refreshToken, 10),
      deviceKeyHash: crypto.createHash('sha256').update('ua|ua-a').digest('hex'),
      consumedAt: new Date(Date.now() - 5 * 60_000), // consumed 5 minutes ago = replay
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000)
    });
    const service = new AuthService(fastify);

    await expect(
      service.refresh(refreshToken, {
        clientIp: '127.0.0.1',
        risk: { sessionId: 'session-stale', userAgent: 'ua-a' }
      })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  /**
   * Pentest F-2 (2026-08-15): a rotated refresh token was still accepted on replay.
   * Rotation was implemented, but a deliberate concurrency grace let a just-consumed
   * token mint again — and, more importantly, a replay outside that grace merely
   * 401'd instead of treating the token as leaked. RFC 9700 §4.14.2 requires
   * revoking the whole family so a thief who rotated first cannot keep the session.
   */
  describe('refresh token reuse detection (F-2)', () => {
    const deviceKeyHash = crypto.createHash('sha256').update('ua|ua-a').digest('hex');

    function consumedTokenRecord(consumedAtMsAgo: number, token: string) {
      return {
        id: 'rt-reuse',
        userId: 'admin-1',
        jti: 'jti-reuse',
        sessionId: 'session-reuse',
        tokenHash: bcrypt.hashSync(token, 10),
        deviceKeyHash,
        consumedAt: new Date(Date.now() - consumedAtMsAgo),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000)
      };
    }

    function makeToken() {
      return jwt.sign(
        { sub: 'admin-1', role: Role.ADMIN, jti: 'jti-reuse', sid: 'session-reuse' },
        process.env.JWT_REFRESH_SECRET as string,
        { expiresIn: '7d' }
      );
    }

    const refreshContext = {
      clientIp: '127.0.0.1',
      risk: { sessionId: 'session-reuse', deviceFingerprint: 'device-a', tlsFingerprint: 'tls-a', userAgent: 'ua-a' }
    };

    it('rejects a replayed token and revokes the whole session family', async () => {
      const { fastify, mocks } = createFastifyMock();
      const token = makeToken();
      // Consumed 60s ago — comfortably outside the 10s concurrency grace, so this
      // is a replay, not a parallel tab.
      mocks.refreshFindUnique.mockResolvedValue(consumedTokenRecord(60_000, token));
      const service = new AuthService(fastify);

      await expect(service.refresh(token, refreshContext)).rejects.toMatchObject({
        code: 'UNAUTHORISED',
        statusCode: 401
      });

      // The substantive fix: the family is revoked, so the thief's newer token dies too.
      expect(mocks.refreshUpdateMany).toHaveBeenCalledWith({
        where: { userId: 'admin-1', sessionId: 'session-reuse', revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      });
    });

    it('still allows a parallel refresh inside the short concurrency grace', async () => {
      // Multiple tabs bursting 401-retries share one cookie; hard-rejecting them
      // logged real users out. Within the grace this must succeed WITHOUT revoking.
      const { fastify, mocks } = createFastifyMock();
      const token = makeToken();
      mocks.refreshFindUnique.mockResolvedValue(consumedTokenRecord(1_000, token));
      mocks.userFindUnique.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
        phone: null,
        passwordHash: bcrypt.hashSync('password-123', 10),
        firstName: 'Admin',
        lastName: 'User',
        role: Role.ADMIN,
        isVerified: true
      });
      const service = new AuthService(fastify);

      const result = await service.refresh(token, refreshContext);

      expect(result.accessToken).toBe('access-token');
      const revokeCalls = mocks.refreshUpdateMany.mock.calls as unknown as Array<
        [{ data?: { revokedAt?: unknown } } | undefined]
      >;
      const revokedFamily = revokeCalls.some(([args]) => args?.data?.revokedAt !== undefined);
      expect(revokedFamily).toBe(false);
    });

    it('revokes the family when a token is replayed after logout revoked it', async () => {
      const { fastify, mocks } = createFastifyMock();
      const token = makeToken();
      mocks.refreshFindUnique.mockResolvedValue({
        ...consumedTokenRecord(60_000, token),
        revokedAt: new Date()
      });
      const service = new AuthService(fastify);

      await expect(service.refresh(token, refreshContext)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('revokes the family when the CAS race is lost outside the grace', async () => {
      const { fastify, mocks } = createFastifyMock();
      const token = makeToken();
      // Passes the pre-check (not yet consumed) but loses the atomic CAS, and the
      // winner consumed it long ago → the same reuse signal via the race path.
      mocks.refreshFindUnique
        .mockResolvedValueOnce({ ...consumedTokenRecord(0, token), consumedAt: null })
        .mockResolvedValueOnce({ consumedAt: new Date(Date.now() - 60_000) });
      mocks.refreshUpdateMany.mockResolvedValue({ count: 0 });
      const service = new AuthService(fastify);

      await expect(service.refresh(token, refreshContext)).rejects.toMatchObject({ statusCode: 401 });
      expect(mocks.refreshUpdateMany).toHaveBeenCalledWith({
        where: { userId: 'admin-1', sessionId: 'session-reuse', revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      });
    });
  });

  it('revokes all active sessions when logout is called without refresh token', async () => {
    const { fastify, mocks } = createFastifyMock();
    const service = new AuthService(fastify);
    const result = await service.logout('admin-1');
    expect(result.message).toContain('Logged out');
    expect(mocks.refreshUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'admin-1',
          revokedAt: null
        })
      })
    );
  });
});
