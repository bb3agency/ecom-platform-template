import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AuthService } from './auth.service';

vi.mock('@modules/notifications/notification-failure-alert', () => ({
  sendTechnicalFailureAlert: vi.fn().mockResolvedValue(undefined),
  sendNotificationFailureAlert: vi.fn().mockResolvedValue(undefined)
}));

import { sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';

function buildMockPrisma(userEmail: string | null, overrides?: Record<string, unknown>) {
  const tokenRecords: Array<{ id: string; userId: string; tokenHash: string; expiresAt: Date }> = [];
  const users: Array<{ id: string; email: string | null; passwordHash: string }> = userEmail
    ? [{ id: 'user_1', email: userEmail, passwordHash: 'old-hash' }]
    : [];

  const mockPrisma = {
    user: {
      findUnique: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        if ('email' in where && where.email === userEmail) {
          return Promise.resolve(users[0] ?? null);
        }
        if ('id' in where && where.id === 'user_1') {
          return Promise.resolve(users[0] ?? null);
        }
        return Promise.resolve(null);
      }),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        if (users[0]) {
          users[0].passwordHash = String(data.passwordHash);
        }
        return Promise.resolve(users[0]);
      })
    },
    passwordResetToken: {
      deleteMany: vi.fn(() => {
        tokenRecords.length = 0;
        return Promise.resolve({ count: 0 });
      }),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const record = {
          id: 'prt_1',
          userId: String(data.userId),
          tokenHash: String(data.tokenHash),
          expiresAt: data.expiresAt as Date
        };
        tokenRecords.push(record);
        return Promise.resolve(record);
      }),
      findUnique: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = tokenRecords.find((r) => r.tokenHash === where.tokenHash);
        return Promise.resolve(found ?? null);
      }),
      delete: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const idx = tokenRecords.findIndex((r) => r.id === where.id);
        if (idx !== -1) tokenRecords.splice(idx, 1);
        return Promise.resolve({ count: 1 });
      })
    },
    refreshToken: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    opsUser: { findMany: vi.fn().mockResolvedValue([]) },
    adminInvite: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides
  };

  return {
    ...mockPrisma,
    $transaction: vi.fn(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) => {
      return cb(mockPrisma);
    })
  };
}

describe('AuthService requestPasswordReset', () => {
  beforeEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.stubEnv('STOREFRONT_URL', 'https://store.example.com');
    vi.mocked(sendTechnicalFailureAlert).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stores token hash in DB and enqueues PasswordReset email when user exists', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const prismaMock = buildMockPrisma('user@example.com');

    const fastify = {
      prisma: prismaMock,
      queues: {
        notifications: { add }
      },
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1)
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    const result = await service.requestPasswordReset({ email: 'user@example.com' });

    expect(result.message).toContain('If the account exists');
    expect(prismaMock.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user_1' } });
    expect(prismaMock.passwordResetToken.create).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({
        to: 'user@example.com',
        template: 'PasswordReset',
        data: expect.objectContaining({
          email: 'user@example.com',
          userId: 'user_1',
          resetUrl: expect.stringContaining('/reset-password?token=')
        })
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('password-reset-user_1-')
      })
    );
  });

  it('returns generic success when token DB write fails', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const prismaMock = buildMockPrisma('user@example.com');
    prismaMock.passwordResetToken.create = vi.fn().mockRejectedValue(new Error('DB down'));

    const fastify = {
      prisma: prismaMock,
      queues: {
        notifications: { add }
      },
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1)
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    const result = await service.requestPasswordReset({ email: 'user@example.com' });

    expect(result).toEqual({
      message: 'If the account exists, a password reset email has been queued.'
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('returns generic success when user does not exist', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const prismaMock = buildMockPrisma(null);

    const fastify = {
      prisma: prismaMock,
      queues: {
        notifications: { add }
      },
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1)
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    const result = await service.requestPasswordReset({ email: 'missing@example.com' });

    expect(result).toEqual({
      message: 'If the account exists, a password reset email has been queued.'
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('returns generic success without enqueue when STOREFRONT_URL is missing', async () => {
    vi.stubEnv('STOREFRONT_URL', '');
    const add = vi.fn().mockResolvedValue(undefined);
    const prismaMock = buildMockPrisma('user@example.com');

    const fastify = {
      prisma: prismaMock,
      queues: {
        notifications: { add }
      },
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1)
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    const result = await service.requestPasswordReset({ email: 'user@example.com' });

    expect(result.message).toContain('If the account exists');
    expect(add).not.toHaveBeenCalled();
    expect(sendTechnicalFailureAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'PasswordReset',
        errorMessage: expect.stringContaining('STOREFRONT_URL')
      })
    );
  });
});

describe('AuthService resetPassword', () => {
  beforeEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it('resets password when token is valid', async () => {
    const tokenHash = 'abc123hash';
    const prismaMock = buildMockPrisma('user@example.com');
    prismaMock.passwordResetToken.findUnique = vi.fn().mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000)
    });

    const fastify = {
      prisma: prismaMock,
      queues: { notifications: { add: vi.fn() } },
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1)
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    const result = await service.resetPassword({ token: 'rawtoken', password: 'NewPass123!', confirmPassword: 'NewPass123!' });

    expect(result.message).toContain('Password has been reset successfully');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: expect.objectContaining({ passwordHash: expect.any(String) })
    });
    expect(prismaMock.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user_1' } });
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
  });

  it('throws INVALID_CREDENTIALS when token not found', async () => {
    const prismaMock = buildMockPrisma('user@example.com');

    const fastify = {
      prisma: prismaMock,
      queues: { notifications: { add: vi.fn() } },
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1)
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    await expect(
      service.resetPassword({ token: 'badtoken', password: 'NewPass123!', confirmPassword: 'NewPass123!' })
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      statusCode: 401
    });
  });

  it('throws TOKEN_EXPIRED when token is expired and deletes it', async () => {
    const prismaMock = buildMockPrisma('user@example.com');
    prismaMock.passwordResetToken.findUnique = vi.fn().mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      tokenHash: 'oldhash',
      expiresAt: new Date(Date.now() - 60_000)
    });

    const fastify = {
      prisma: prismaMock,
      queues: { notifications: { add: vi.fn() } },
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1)
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    await expect(
      service.resetPassword({ token: 'expiredtoken', password: 'NewPass123!', confirmPassword: 'NewPass123!' })
    ).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
      statusCode: 401
    });
    expect(prismaMock.passwordResetToken.delete).toHaveBeenCalledWith({ where: { id: 'prt_1' } });
  });

  it('throws VALIDATION_ERROR when password is too short', async () => {
    const prismaMock = buildMockPrisma('user@example.com');
    prismaMock.passwordResetToken.findUnique = vi.fn().mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000)
    });

    const fastify = {
      prisma: prismaMock,
      queues: { notifications: { add: vi.fn() } },
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1)
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    await expect(
      service.resetPassword({ token: 'sometoken', password: 'short', confirmPassword: 'short' })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400
    });
  });

  it('throws VALIDATION_ERROR when password and confirmPassword do not match', async () => {
    const prismaMock = buildMockPrisma('user@example.com');
    prismaMock.passwordResetToken.findUnique = vi.fn().mockResolvedValue({
      id: 'prt_1',
      userId: 'user_1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000)
    });

    const fastify = {
      prisma: prismaMock,
      queues: { notifications: { add: vi.fn() } },
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1)
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    await expect(
      service.resetPassword({ token: 'sometoken', password: 'NewPass123!', confirmPassword: 'Different123!' })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400
    });
  });
});
