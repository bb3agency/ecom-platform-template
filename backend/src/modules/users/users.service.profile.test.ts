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
});
