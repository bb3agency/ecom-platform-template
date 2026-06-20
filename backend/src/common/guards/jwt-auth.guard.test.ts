import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtAuthGuard, jwtVerifyGuard } from './jwt-auth.guard';

function buildRequest(input: {
  verifyResult?: { sub: string; role: 'CUSTOMER' | 'ADMIN'; sid?: string; permissions?: string[] };
  verifyThrows?: boolean;
  account?: { id: string; role: 'CUSTOMER' | 'ADMIN'; isBanned: boolean } | null;
}) {
  const findUnique = vi.fn(async () => input.account ?? null);
  const request = {
    jwtVerify: input.verifyThrows
      ? vi.fn(async () => {
          throw new Error('invalid');
        })
      : vi.fn(async () => input.verifyResult ?? { sub: 'user_1', role: 'CUSTOMER' as const }),
    server: {
      prisma: {
        user: { findUnique }
      }
    }
  } as unknown as FastifyRequest;

  return { request, findUnique };
}

describe('jwtAuthGuard', () => {
  it('throws when JWT verification fails', async () => {
    const { request } = buildRequest({ verifyThrows: true });
    await expect(jwtAuthGuard(request, {} as FastifyReply)).rejects.toMatchObject({
      statusCode: 401
    });
  });

  it('allows active customers after DB ban check', async () => {
    const { request, findUnique } = buildRequest({
      verifyResult: { sub: 'customer_1', role: 'CUSTOMER' },
      account: { id: 'customer_1', role: 'CUSTOMER', isBanned: false }
    });

    await expect(jwtAuthGuard(request, {} as FastifyReply)).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'customer_1' } })
    );
  });

  it('rejects banned customers', async () => {
    const { request } = buildRequest({
      verifyResult: { sub: 'customer_1', role: 'CUSTOMER' },
      account: { id: 'customer_1', role: 'CUSTOMER', isBanned: true }
    });

    await expect(jwtAuthGuard(request, {} as FastifyReply)).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringContaining('suspended')
    });
  });

  it('rejects missing customer accounts', async () => {
    const { request } = buildRequest({
      verifyResult: { sub: 'customer_1', role: 'CUSTOMER' },
      account: null
    });

    await expect(jwtAuthGuard(request, {} as FastifyReply)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Authentication required'
    });
  });

  it('rejects banned admin users', async () => {
    const { request } = buildRequest({
      verifyResult: { sub: 'admin_1', role: 'ADMIN' },
      account: { id: 'admin_1', role: 'ADMIN', isBanned: true }
    });

    await expect(jwtAuthGuard(request, {} as FastifyReply)).rejects.toMatchObject({
      statusCode: 401
    });
  });

  it('allows active admins', async () => {
    const { request } = buildRequest({
      verifyResult: { sub: 'admin_1', role: 'ADMIN' },
      account: { id: 'admin_1', role: 'ADMIN', isBanned: false }
    });

    await expect(jwtAuthGuard(request, {} as FastifyReply)).resolves.toBeUndefined();
  });
});

describe('jwtVerifyGuard', () => {
  it('verifies JWT without DB ban checks', async () => {
    const { request } = buildRequest({
      verifyResult: { sub: 'customer_1', role: 'CUSTOMER' },
      account: { id: 'customer_1', role: 'CUSTOMER', isBanned: true }
    });

    await expect(jwtVerifyGuard(request, {} as FastifyReply)).resolves.toBeUndefined();
  });
});
