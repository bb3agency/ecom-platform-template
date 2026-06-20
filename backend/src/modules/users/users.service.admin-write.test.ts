import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { UsersService } from './users.service';

function makeUserFastify(overrides: Record<string, unknown> = {}): FastifyInstance {
  return {
    prisma: {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(null),
        ...overrides
      },
      refreshToken: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      userAdminNote: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(null)
      }
    },
    log: { info: vi.fn(), error: vi.fn() }
  } as unknown as FastifyInstance;
}

describe('UsersService adminBanUser', () => {
  it('throws 404 when user not found', async () => {
    const fastify = makeUserFastify();
    const service = new UsersService(fastify);

    await expect(service.adminBanUser('uid_1', 'spam', 'admin_1')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws 403 when trying to ban an ADMIN user', async () => {
    const fastify = makeUserFastify({
      findUnique: vi.fn().mockResolvedValue({ id: 'uid_1', isBanned: false, role: 'ADMIN' })
    });
    const service = new UsersService(fastify);

    await expect(service.adminBanUser('uid_1', 'reason', 'admin_1')).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it('throws 409 when user is already banned', async () => {
    const fastify = makeUserFastify({
      findUnique: vi.fn().mockResolvedValue({ id: 'uid_1', isBanned: true, role: 'CUSTOMER' })
    });
    const service = new UsersService(fastify);

    await expect(service.adminBanUser('uid_1', 'reason', 'admin_1')).rejects.toMatchObject({
      statusCode: 409
    });
  });

  it('returns ban result with timestamps when successful', async () => {
    const bannedAt = new Date('2026-01-01T00:00:00.000Z');
    const fastify = makeUserFastify({
      findUnique: vi.fn().mockResolvedValue({ id: 'uid_1', isBanned: false, role: 'CUSTOMER' }),
      update: vi.fn().mockResolvedValue({
        id: 'uid_1',
        isBanned: true,
        bannedAt,
        bannedReason: 'spam [admin:admin_1]'
      })
    });
    const service = new UsersService(fastify);

    const result = await service.adminBanUser('uid_1', 'spam', 'admin_1');

    expect(result.isBanned).toBe(true);
    expect(result.bannedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.bannedReason).toContain('spam');
    expect(fastify.prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'uid_1', revokedAt: null }
      })
    );
  });
});

describe('UsersService adminUnbanUser', () => {
  it('throws 404 when user not found', async () => {
    const fastify = makeUserFastify();
    const service = new UsersService(fastify);

    await expect(service.adminUnbanUser('uid_1', 'admin_1')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws 409 when user is not banned', async () => {
    const fastify = makeUserFastify({
      findUnique: vi.fn().mockResolvedValue({ id: 'uid_1', isBanned: false })
    });
    const service = new UsersService(fastify);

    await expect(service.adminUnbanUser('uid_1', 'admin_1')).rejects.toMatchObject({
      statusCode: 409
    });
  });

  it('returns isBanned false when successfully unbanned', async () => {
    const updateFn = vi.fn().mockResolvedValue({});
    const fastify = makeUserFastify({
      findUnique: vi.fn().mockResolvedValue({ id: 'uid_1', isBanned: true }),
      update: updateFn
    });
    const service = new UsersService(fastify);

    const result = await service.adminUnbanUser('uid_1', 'admin_1');

    expect(result.isBanned).toBe(false);
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isBanned: false, bannedAt: null, bannedReason: null })
      })
    );
  });
});

describe('UsersService adminListUserNotes', () => {
  it('throws 404 when user not found', async () => {
    const fastify = makeUserFastify();
    const service = new UsersService(fastify);

    await expect(service.adminListUserNotes('uid_1')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('returns empty array when no notes exist', async () => {
    const fastify = makeUserFastify({
      findUnique: vi.fn().mockResolvedValue({ id: 'uid_1' })
    });
    const service = new UsersService(fastify);

    const result = await service.adminListUserNotes('uid_1');

    expect(result).toEqual([]);
  });

  it('returns mapped notes sorted by createdAt desc', async () => {
    const note = {
      id: 'note_1',
      userId: 'uid_1',
      content: 'Suspicious activity',
      createdByAdminId: 'admin_1',
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    };
    const fastify = makeUserFastify({
      findUnique: vi.fn().mockResolvedValue({ id: 'uid_1' })
    });
    (fastify.prisma as unknown as { userAdminNote: { findMany: ReturnType<typeof vi.fn> } }).userAdminNote.findMany = vi.fn().mockResolvedValue([note]);
    const service = new UsersService(fastify);

    const result = await service.adminListUserNotes('uid_1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'note_1',
      content: 'Suspicious activity',
      createdByAdminId: 'admin_1'
    });
    expect(result[0]!.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('UsersService adminCreateUserNote', () => {
  it('throws 404 when user not found', async () => {
    const fastify = makeUserFastify();
    const service = new UsersService(fastify);

    await expect(service.adminCreateUserNote('uid_1', 'note content', 'admin_1')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('creates and returns the note', async () => {
    const createdNote = {
      id: 'note_1',
      userId: 'uid_1',
      content: 'note content',
      createdByAdminId: 'admin_1',
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    };
    const createFn = vi.fn().mockResolvedValue(createdNote);
    const fastify = makeUserFastify({
      findUnique: vi.fn().mockResolvedValue({ id: 'uid_1' })
    });
    (fastify.prisma as unknown as { userAdminNote: { create: ReturnType<typeof vi.fn> } }).userAdminNote.create = createFn;
    const service = new UsersService(fastify);

    const result = await service.adminCreateUserNote('uid_1', 'note content', 'admin_1');

    expect(result).toMatchObject({ id: 'note_1', content: 'note content' });
    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'uid_1', content: 'note content', createdByAdminId: 'admin_1' })
      })
    );
  });
});

describe('UsersService adminDeleteUserNote', () => {
  it('throws 404 when note not found', async () => {
    const fastify = makeUserFastify();
    const service = new UsersService(fastify);

    await expect(service.adminDeleteUserNote('uid_1', 'note_1')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws 404 when note belongs to a different user', async () => {
    const fastify = makeUserFastify();
    (fastify.prisma as unknown as { userAdminNote: { findUnique: ReturnType<typeof vi.fn> } }).userAdminNote.findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'note_1', userId: 'uid_OTHER' });
    const service = new UsersService(fastify);

    await expect(service.adminDeleteUserNote('uid_1', 'note_1')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('deletes and returns deleted confirmation', async () => {
    const deleteFn = vi.fn().mockResolvedValue({});
    const fastify = makeUserFastify();
    (fastify.prisma as unknown as { userAdminNote: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } }).userAdminNote.findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'note_1', userId: 'uid_1' });
    (fastify.prisma as unknown as { userAdminNote: { delete: ReturnType<typeof vi.fn> } }).userAdminNote.delete = deleteFn;
    const service = new UsersService(fastify);

    const result = await service.adminDeleteUserNote('uid_1', 'note_1');

    expect(result).toEqual({ deleted: true, noteId: 'note_1' });
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'note_1' } });
  });
});
