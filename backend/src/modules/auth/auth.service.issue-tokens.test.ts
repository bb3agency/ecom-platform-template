import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { AuthService } from './auth.service';

function buildAuthFastify(user: Record<string, unknown>) {
  const userUpdateMany = vi.fn(async () => ({ count: 1 }));
  const refreshCreate = vi.fn(async () => ({}));

  const fastify = {
    redis: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 1),
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
      ttl: vi.fn(async () => -1)
    },
    prisma: {
      user: {
        findUnique: vi.fn(async () => user),
        updateMany: userUpdateMany
      },
      refreshToken: {
        create: refreshCreate
      },
      adminPermissionGrant: {
        findMany: vi.fn(async () => [])
      }
    },
    jwt: {
      sign: vi.fn(() => 'access-token')
    }
  } as unknown as FastifyInstance;

  return { fastify, userUpdateMany, refreshCreate };
}

describe('AuthService issueTokensForUser customer isVerified backfill', () => {
  const password = 'Secret123!';

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-minimum-length';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-minimum-length';
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it('backfills isVerified for legacy customers on login', async () => {
    const { fastify, userUpdateMany } = buildAuthFastify({
      id: 'user_1',
      email: 'legacy@example.com',
      phone: '9999999999',
      firstName: 'Legacy',
      lastName: 'User',
      role: Role.CUSTOMER,
      isVerified: false,
      isBanned: false,
      passwordHash: bcrypt.hashSync(password, 4)
    });

    const service = new AuthService(fastify);
    const result = await service.login(
      { identifier: 'legacy@example.com', password },
      { clientIp: '127.0.0.1', audience: 'customer', skipClearOnSuccess: true }
    );

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user_1', isVerified: false },
      data: { isVerified: true }
    });
    expect(result.user.isVerified).toBe(true);
  });

  it('rejects banned customers before issuing tokens', async () => {
    const { fastify, userUpdateMany } = buildAuthFastify({
      id: 'user_2',
      email: 'banned@example.com',
      phone: '8888888888',
      firstName: 'Banned',
      lastName: 'User',
      role: Role.CUSTOMER,
      isVerified: true,
      isBanned: true,
      passwordHash: bcrypt.hashSync(password, 4)
    });

    const service = new AuthService(fastify);
    await expect(
      service.login(
        { identifier: 'banned@example.com', password },
        { clientIp: '127.0.0.1', audience: 'customer', skipClearOnSuccess: true }
      )
    ).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringContaining('suspended')
    });
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});
