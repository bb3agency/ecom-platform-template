import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { UsersService } from './users.service';

function makeFastify(user: Record<string, unknown> | null) {
  const update = vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    email: (user as Record<string, unknown> | null)?.email ?? null,
    phone: (user as Record<string, unknown> | null)?.phone ?? null,
    orderNotificationsEnabled: args.data.orderNotificationsEnabled,
    orderNotificationChannels: args.data.orderNotificationChannels
  }));
  const fastify = {
    prisma: {
      user: {
        findUnique: vi.fn().mockResolvedValue(user),
        update
      }
    }
  } as unknown as FastifyInstance;
  return { fastify, update };
}

describe('UsersService admin notification preferences', () => {
  it('returns own prefs with contact points for the UI', async () => {
    const { fastify } = makeFastify({
      email: 'admin@example.com',
      phone: '9888800001',
      orderNotificationsEnabled: true,
      orderNotificationChannels: ['EMAIL', 'WHATSAPP']
    });
    const service = new UsersService(fastify);
    await expect(service.getAdminNotificationPreferences('admin_1')).resolves.toEqual({
      enabled: true,
      channels: ['EMAIL', 'WHATSAPP'],
      email: 'admin@example.com',
      phone: '9888800001'
    });
  });

  it('saves enabled prefs with deduped channels', async () => {
    const { fastify, update } = makeFastify({ email: 'admin@example.com', phone: '9888800001' });
    const service = new UsersService(fastify);
    const result = await service.updateAdminNotificationPreferences('admin_1', {
      enabled: true,
      channels: ['EMAIL', 'EMAIL', 'SMS']
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'admin_1' },
        data: { orderNotificationsEnabled: true, orderNotificationChannels: ['EMAIL', 'SMS'] }
      })
    );
    expect(result.enabled).toBe(true);
    expect(result.channels).toEqual(['EMAIL', 'SMS']);
  });

  it('rejects enabling with zero channels', async () => {
    const { fastify } = makeFastify({ email: 'admin@example.com', phone: null });
    const service = new UsersService(fastify);
    await expect(
      service.updateAdminNotificationPreferences('admin_1', { enabled: true, channels: [] })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects WhatsApp/SMS channels when the admin has no phone on file', async () => {
    const { fastify } = makeFastify({ email: 'admin@example.com', phone: null });
    const service = new UsersService(fastify);
    await expect(
      service.updateAdminNotificationPreferences('admin_1', { enabled: true, channels: ['WHATSAPP'] })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('phone')
    });
  });

  it('allows disabling regardless of channels/contacts', async () => {
    const { fastify, update } = makeFastify({ email: null, phone: null });
    const service = new UsersService(fastify);
    const result = await service.updateAdminNotificationPreferences('admin_1', {
      enabled: false,
      channels: []
    });
    expect(update).toHaveBeenCalled();
    expect(result.enabled).toBe(false);
  });
});
