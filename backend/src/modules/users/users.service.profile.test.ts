import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { UsersService } from './users.service';

describe('UsersService profile mutations', () => {
  it('patchMe rejects banned customers', async () => {
    const fastify = {
      prisma: {
        user: {
          findUnique: vi.fn().mockResolvedValue({ isBanned: true }),
          update: vi.fn()
        }
      }
    } as unknown as FastifyInstance;

    const service = new UsersService(fastify);
    await expect(service.patchMe('user_1', { firstName: 'New' })).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringContaining('suspended')
    });
    expect(fastify.prisma.user.update).not.toHaveBeenCalled();
  });

  function makeFastify(overrides: {
    me?: Record<string, unknown>;
    otherUserByLookup?: Record<string, unknown> | null;
  } = {}) {
    const me = overrides.me ?? { isBanned: false, email: 'me@example.com', phone: '9999999999' };
    const updated = {
      id: 'user_1',
      email: 'me@example.com',
      phone: '8888888888',
      firstName: 'Me',
      lastName: null,
      role: 'CUSTOMER',
      isVerified: true
    };
    const update = vi.fn().mockResolvedValue(updated);
    const fastify = {
      prisma: {
        user: {
          findUnique: vi.fn().mockResolvedValue(me),
          findFirst: vi.fn().mockResolvedValue(overrides.otherUserByLookup ?? null),
          update
        }
      }
    } as unknown as FastifyInstance;
    return { fastify, update };
  }

  it('patchMe sets a new phone number', async () => {
    const { fastify, update } = makeFastify();
    const service = new UsersService(fastify);

    await service.patchMe('user_1', { phone: '8888888888' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: '8888888888' }) })
    );
  });

  it('patchMe rejects a phone that belongs to another account (409)', async () => {
    const { fastify, update } = makeFastify({ otherUserByLookup: { id: 'other_user' } });
    const service = new UsersService(fastify);

    await expect(service.patchMe('user_1', { phone: '8888888888' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT'
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('patchMe removes the phone when the account still has an email', async () => {
    const { fastify, update } = makeFastify();
    const service = new UsersService(fastify);

    await service.patchMe('user_1', { phone: null });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: null }) })
    );
  });

  it('patchMe refuses to remove the phone when it is the only login identifier', async () => {
    const { fastify, update } = makeFastify({
      me: { isBanned: false, email: null, phone: '9999999999' }
    });
    const service = new UsersService(fastify);

    await expect(service.patchMe('user_1', { phone: null })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('email')
    });
    expect(update).not.toHaveBeenCalled();
  });
});
