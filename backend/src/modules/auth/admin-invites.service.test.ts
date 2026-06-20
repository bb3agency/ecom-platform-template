import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AdminInvitesService } from './admin-invites.service';

function createHarness() {
  const adminUserInviteCreate = vi.fn(async () => ({ id: 'invite_1' }));
  const adminUserInviteUpdate = vi.fn(async () => ({ id: 'invite_1' }));
  const adminUserInviteFindUnique = vi.fn();
  const adminUserInviteFindFirst = vi.fn(async (): Promise<unknown> => null);
  const adminUserInviteFindMany = vi.fn(async (): Promise<unknown[]> => []);
  const adminUserInviteCount = vi.fn(async () => 0);
  const adminUserInviteUpdateMany = vi.fn(async () => ({ count: 2 }));
  const userFindUnique = vi.fn<() => Promise<unknown>>(async () => null);
  const userFindFirst = vi.fn<() => Promise<unknown>>(async () => null);
  const opsUserFindUnique = vi.fn();
  const storeSettingsFindUnique = vi.fn(async (): Promise<unknown> => null);
  const redisGet = vi.fn();
  const redisSet = vi.fn(async () => 'OK');
  const redisDel = vi.fn(async () => 1);
  const redisIncr = vi.fn(async () => 1);
  const redisExpire = vi.fn(async () => 1);
  const txUserCreate = vi.fn(async () => ({
    id: 'admin_1',
    email: 'merchant@example.com',
    firstName: 'Merchant',
    lastName: 'Owner'
  }));
  const txUserUpdate = vi.fn(async () => ({
    id: 'admin_deactivated',
    email: 'merchant@example.com',
    firstName: 'Merchant',
    lastName: 'Owner'
  }));
  const txGrantCreateMany = vi.fn(async () => ({ count: 3 }));
  const txGrantDeleteMany = vi.fn(async () => ({ count: 2 }));
  const txInviteUpdateMany = vi.fn(async () => ({ count: 1 }));
  const transaction = vi.fn(
    async (
      callback: (tx: {
        user: { create: typeof txUserCreate; update: typeof txUserUpdate };
        adminPermissionGrant: {
          createMany: typeof txGrantCreateMany;
          deleteMany: typeof txGrantDeleteMany;
        };
        adminUserInvite: { updateMany: typeof txInviteUpdateMany };
      }) => Promise<unknown>
    ) =>
      callback({
        user: { create: txUserCreate, update: txUserUpdate },
        adminPermissionGrant: { createMany: txGrantCreateMany, deleteMany: txGrantDeleteMany },
        adminUserInvite: { updateMany: txInviteUpdateMany }
      })
  );
  const notificationsAdd = vi.fn(async () => ({ id: 'job_1' }));
  const logInfo = vi.fn();
  const fastify = {
    log: { info: logInfo, warn: vi.fn(), error: vi.fn() },
    prisma: {
      user: { findUnique: userFindUnique, findFirst: userFindFirst },
      opsUser: { findUnique: opsUserFindUnique },
      adminUserInvite: {
        create: adminUserInviteCreate,
        update: adminUserInviteUpdate,
        findUnique: adminUserInviteFindUnique,
        findFirst: adminUserInviteFindFirst,
        findMany: adminUserInviteFindMany,
        count: adminUserInviteCount,
        updateMany: adminUserInviteUpdateMany
      },
      storeSettings: { findUnique: storeSettingsFindUnique },
      $transaction: transaction
    },
    queues: {
      notifications: { add: notificationsAdd }
    },
    redis: {
      get: redisGet,
      set: redisSet,
      del: redisDel,
      incr: redisIncr,
      expire: redisExpire
    }
  } as unknown as ConstructorParameters<typeof AdminInvitesService>[0];
  return {
    service: new AdminInvitesService(fastify),
    mocks: {
      adminUserInviteCreate,
      adminUserInviteUpdate,
      adminUserInviteFindUnique,
      adminUserInviteFindFirst,
      adminUserInviteFindMany,
      adminUserInviteCount,
      adminUserInviteUpdateMany,
      userFindUnique,
      userFindFirst,
      opsUserFindUnique,
      storeSettingsFindUnique,
      redisGet,
      redisSet,
      redisDel,
      redisIncr,
      redisExpire,
      txUserCreate,
      txUserUpdate,
      txGrantCreateMany,
      txGrantDeleteMany,
      txInviteUpdateMany,
      transaction,
      notificationsAdd
    }
  };
}

describe('AdminInvitesService', () => {
  it('creates merchant admin invites with explicitly provided permissions and admin setup URL', async () => {
    const { service, mocks } = createHarness();

    const result = await service.createAdminInvite({
      createdByOpsUserId: 'ops_1',
      inviteEmail: 'Merchant@Example.com',
      inviteName: 'Merchant Owner',
      setupBaseUrl: 'https://client.example.com',
      permissions: ['products:write', 'orders:read']
    });

    expect(result.setupUrl).toContain('/admin/setup?token=');
    expect(result.permissions).toContain('products:write');
    expect(result.permissions).toContain('orders:read');
    expect(result.permissions).not.toContain('ops:read');
    expect(mocks.adminUserInviteCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        inviteEmail: 'merchant@example.com',
        inviteName: 'Merchant Owner',
        status: 'CREATED',
        createdByOpsUserId: 'ops_1'
      })
    }));
    expect(mocks.notificationsAdd).toHaveBeenCalledWith('send-email', expect.objectContaining({
      to: 'merchant@example.com',
      template: 'AdminInviteSetup'
    }), expect.any(Object));
    expect(mocks.adminUserInviteUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'invite_1', status: 'CREATED' }),
        data: { status: 'EMAIL_SENT' }
      })
    );
  });

  it('rejects developer/disallowed permissions in merchant admin invites', async () => {
    const { service } = createHarness();

    await expect(service.createAdminInvite({
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      setupBaseUrl: 'https://client.example.com',
      permissions: ['products:read', 'ops:read']
    })).rejects.toThrow('Permission is not allowed for merchant admin invite: ops:read');

    await expect(service.createAdminInvite({
      inviteEmail: 'merchant2@example.com',
      inviteName: 'Merchant Owner 2',
      setupBaseUrl: 'https://client.example.com',
      permissions: ['products:read', 'queues:inspect']
    })).rejects.toThrow('Permission is not allowed for merchant admin invite: queues:inspect');
  });

  it('consumes an active invite by creating an admin user and permission grants once', async () => {
    const { service, mocks } = createHarness();
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      status: 'EMAIL_SENT',
      permissions: ['products:read', 'orders:read'],
      expiresAt: new Date(Date.now() + 60_000)
    });

    const inviteTokenHash = crypto.createHash('sha256').update('token_1234567890').digest('hex');
    const otpHash = crypto.createHash('sha256').update('123456').digest('hex');
    mocks.redisGet.mockImplementation(async (key: string) => {
      if (key === `admin-invite:setup:payload:${inviteTokenHash}`) {
        return JSON.stringify({
          name: 'Merchant Owner',
          phone: '+911234567890',
          passwordHash: 'stored-password-hash'
        });
      }
      if (key === `admin-invite:setup:otp:${inviteTokenHash}`) {
        return otpHash;
      }
      return null;
    });

    const result = await service.consumeAdminInvite({
      inviteToken: 'token_1234567890',
      otp: '123456'
    });

    expect(result).toEqual({
      adminUserId: 'admin_1',
      email: 'merchant@example.com',
      name: 'Merchant Owner',
      permissions: ['products:read', 'orders:read']
    });
    expect(mocks.txUserCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'merchant@example.com',
        phone: '+911234567890',
        passwordHash: 'stored-password-hash',
        firstName: 'Merchant',
        lastName: 'Owner',
        role: 'ADMIN',
        isVerified: true
      })
    });
    expect(mocks.txGrantCreateMany).toHaveBeenCalledWith({
      data: [
        { userId: 'admin_1', permission: 'products:read' },
        { userId: 'admin_1', permission: 'orders:read' }
      ],
      skipDuplicates: true
    });
    expect(mocks.txInviteUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'invite_1' }),
        data: expect.objectContaining({ status: 'CONSUMED' })
      })
    );
  });

  it('marks expired invites as expired and fails closed', async () => {
    const { service, mocks } = createHarness();
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      status: 'EMAIL_SENT',
      permissions: ['products:read'],
      expiresAt: new Date(Date.now() - 60_000)
    });

    await expect(service.consumeAdminInvite({
      inviteToken: 'token_1234567890',
      otp: '123456'
    })).rejects.toThrow('Admin invite has expired');
    expect(mocks.adminUserInviteUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'invite_1' }),
        data: { status: 'EXPIRED_CLEANED' }
      })
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('sendSetupOtp accepts name + password without phone and stores null phone in Redis', async () => {
    const { service, mocks } = createHarness();
    mocks.storeSettingsFindUnique.mockResolvedValue({
      notifyEmailEnabled: true,
      notifySmsEnabled: false,
      notifyWhatsappEnabled: false,
      primaryNotificationChannels: { OtpVerification: 'EMAIL' }
    });
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      status: 'EMAIL_SENT',
      permissions: ['products:read'],
      expiresAt: new Date(Date.now() + 60_000)
    });

    const result = await service.sendSetupOtp({
      inviteToken: 'token_1234567890',
      name: 'Merchant Owner',
      password: 'securepassword'
    });

    expect(result.message).toBe('OTP sent successfully');
    const redisSetCall = mocks.redisSet.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('payload')
    ) as [string, string, ...unknown[]] | undefined;
    expect(redisSetCall).toBeDefined();
    const stored = JSON.parse(redisSetCall![1]) as { name: string; phone: string | null };
    expect(stored.name).toBe('Merchant Owner');
    expect(stored.phone).toBeNull();
    expect(mocks.notificationsAdd).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({ template: 'OtpVerification', to: 'merchant@example.com' }),
      expect.any(Object)
    );
  });

  it('sendSetupOtp rejects when name is missing', async () => {
    const { service, mocks } = createHarness();
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      status: 'EMAIL_SENT',
      permissions: ['products:read'],
      expiresAt: new Date(Date.now() + 60_000)
    });

    await expect(
      service.sendSetupOtp({
        inviteToken: 'token_1234567890',
        name: '   ',
        password: 'securepassword'
      })
    ).rejects.toThrow('Name is required');
  });

  it('sendSetupOtp stores phone when provided and checks uniqueness', async () => {
    const { service, mocks } = createHarness();
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      status: 'EMAIL_SENT',
      permissions: ['products:read'],
      expiresAt: new Date(Date.now() + 60_000)
    });
    mocks.userFindFirst.mockResolvedValueOnce({ id: 'other_user', phone: '+911234567890' } as unknown as null);

    await expect(
      service.sendSetupOtp({
        inviteToken: 'token_1234567890',
        name: 'Merchant Owner',
        password: 'securepassword',
        phone: '+911234567890'
      })
    ).rejects.toThrow('User already exists for invite phone number');
  });

  it('sendSetupOtp sends SMS when admin OTP channel resolves to sms', async () => {
    const { service, mocks } = createHarness();
    mocks.storeSettingsFindUnique.mockResolvedValue({
      notifyEmailEnabled: true,
      notifySmsEnabled: true,
      notifyWhatsappEnabled: false,
      primaryNotificationChannels: { OtpVerification: 'SMS' }
    });
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('MSG91_AUTH_KEY', 'msg91-key');
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      status: 'EMAIL_SENT',
      permissions: ['products:read'],
      expiresAt: new Date(Date.now() + 60_000)
    });

    await service.sendSetupOtp({
      inviteToken: 'token_1234567890',
      name: 'Merchant Owner',
      password: 'securepassword',
      phone: '+911234567890'
    });

    expect(mocks.notificationsAdd).toHaveBeenCalledWith(
      'send-sms',
      expect.objectContaining({ phone: '+911234567890', template: 'OtpVerification' }),
      expect.any(Object)
    );
    vi.unstubAllEnvs();
  });

  it('listAdminInvites returns paginated invite lifecycle', async () => {
    const { service, mocks } = createHarness();
    mocks.adminUserInviteFindMany.mockResolvedValue([
      {
        id: 'invite_1',
        inviteEmail: 'merchant@example.com',
        inviteName: 'Merchant Owner',
        status: 'EMAIL_SENT',
        permissions: ['products:read'],
        expiresAt: new Date('2026-05-28T00:00:00.000Z'),
        createdAt: new Date('2026-05-27T00:00:00.000Z'),
        createdByOpsUserId: 'ops_1',
        consumedAt: null
      }
    ]);
    mocks.adminUserInviteCount.mockResolvedValue(1);

    const result = await service.listAdminInvites({ limit: 10, page: 1 });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      status: 'EMAIL_SENT'
    });
  });

  it('revokeAdminInvite marks active invite as cancelled', async () => {
    const { service, mocks } = createHarness();
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      status: 'EMAIL_SENT',
      consumedAt: null
    });
    mocks.adminUserInviteUpdateMany.mockResolvedValueOnce({ count: 1 });

    const result = await service.revokeAdminInvite({ inviteId: 'invite_1', revokerOpsUserId: 'ops_1' });

    expect(result).toEqual({ inviteId: 'invite_1', revoked: true });
    expect(mocks.adminUserInviteUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'invite_1', status: { in: ['CREATED', 'EMAIL_SENT'] } },
        data: { status: 'CANCELLED' }
      })
    );
  });

  it('consumeAdminInvite creates admin user with null phone when phone was not provided at setup', async () => {
    const { service, mocks } = createHarness();
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      status: 'EMAIL_SENT',
      permissions: ['products:read'],
      expiresAt: new Date(Date.now() + 60_000)
    });

    const inviteTokenHash = crypto.createHash('sha256').update('token_1234567890').digest('hex');
    const otpHash = crypto.createHash('sha256').update('123456').digest('hex');
    mocks.redisGet.mockImplementation(async (key: string) => {
      if (key === `admin-invite:setup:payload:${inviteTokenHash}`) {
        return JSON.stringify({ name: 'Merchant Owner', phone: null, passwordHash: 'hashed-pw' });
      }
      if (key === `admin-invite:setup:otp:${inviteTokenHash}`) {
        return otpHash;
      }
      return null;
    });

    await service.consumeAdminInvite({ inviteToken: 'token_1234567890', otp: '123456' });

    expect(mocks.txUserCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ phone: null })
    });
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });

  it('cleans up expired active merchant admin invites', async () => {
    const { service, mocks } = createHarness();

    await expect(service.cleanupExpiredAdminInvites()).resolves.toEqual({ cleaned: 2 });
    expect(mocks.adminUserInviteUpdateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['CREATED', 'EMAIL_SENT'] },
        expiresAt: { lt: expect.any(Date) }
      },
      data: { status: 'EXPIRED_CLEANED' }
    });
  });

  it('rejects createAdminInvite when email already belongs to an ops account', async () => {
    const { service, mocks } = createHarness();
    mocks.opsUserFindUnique.mockResolvedValueOnce({ id: 'ops_1', email: 'shared@example.com' });

    await expect(
      service.createAdminInvite({
        inviteEmail: 'shared@example.com',
        inviteName: 'Merchant Owner',
        setupBaseUrl: 'https://client.example.com',
        permissions: ['products:read']
      })
    ).rejects.toThrow('Email is already in use by an ops account');

    expect(mocks.adminUserInviteCreate).not.toHaveBeenCalled();
  });

  it('rejects ops:read and ops:write in merchant admin invites', async () => {
    const { service } = createHarness();

    await expect(service.createAdminInvite({
      inviteEmail: 'developer@example.com',
      inviteName: 'Dev Admin',
      setupBaseUrl: 'https://client.example.com',
      permissions: ['products:read', 'ops:read']
    })).rejects.toThrow('Permission is not allowed for merchant admin invite: ops:read');

    await expect(service.createAdminInvite({
      inviteEmail: 'developer2@example.com',
      inviteName: 'Dev Admin 2',
      setupBaseUrl: 'https://client.example.com',
      permissions: ['products:read', 'ops:write']
    })).rejects.toThrow('Permission is not allowed for merchant admin invite: ops:write');
  });

  it('allows createAdminInvite for a deactivated merchant admin email', async () => {
    const { service, mocks } = createHarness();
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'admin_deactivated',
      role: 'ADMIN',
      isBanned: true
    });
    mocks.opsUserFindUnique.mockResolvedValueOnce(null);

    const result = await service.createAdminInvite({
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      setupBaseUrl: 'https://client.example.com',
      permissions: ['products:read']
    });

    expect(result.setupUrl).toContain('/admin/setup?token=');
    expect(mocks.adminUserInviteCreate).toHaveBeenCalled();
  });

  it('rejects createAdminInvite when email belongs to a customer account', async () => {
    const { service, mocks } = createHarness();
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'customer_1',
      role: 'CUSTOMER',
      isBanned: false
    });

    await expect(
      service.createAdminInvite({
        inviteEmail: 'customer@example.com',
        inviteName: 'Not Admin',
        setupBaseUrl: 'https://client.example.com',
        permissions: ['products:read']
      })
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('customer account') });

    expect(mocks.adminUserInviteCreate).not.toHaveBeenCalled();
  });

  it('sendSetupOtp allows reusing phone number on the same deactivated admin account', async () => {
    const { service, mocks } = createHarness();
    mocks.storeSettingsFindUnique.mockResolvedValue({
      notifyEmailEnabled: true,
      notifySmsEnabled: false,
      notifyWhatsappEnabled: false,
      primaryNotificationChannels: { OtpVerification: 'EMAIL' }
    });
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      status: 'EMAIL_SENT',
      permissions: ['products:read'],
      expiresAt: new Date(Date.now() + 60_000)
    });
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin_deactivated',
      role: 'ADMIN',
      isBanned: true
    });
    mocks.userFindFirst.mockResolvedValue({ id: 'admin_deactivated', phone: '+911234567890' });
    mocks.opsUserFindUnique.mockResolvedValue(null);

    await expect(
      service.sendSetupOtp({
        inviteToken: 'token_1234567890',
        name: 'Merchant Owner',
        password: 'securepassword',
        phone: '+911234567890'
      })
    ).resolves.toMatchObject({ message: 'OTP sent successfully' });
  });

  it('sendSetupOtp allows phone belonging to a different deactivated merchant admin', async () => {
    const { service, mocks } = createHarness();
    mocks.storeSettingsFindUnique.mockResolvedValue({
      notifyEmailEnabled: true,
      notifySmsEnabled: false,
      notifyWhatsappEnabled: false,
      primaryNotificationChannels: { OtpVerification: 'EMAIL' }
    });
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      status: 'EMAIL_SENT',
      permissions: ['products:read'],
      expiresAt: new Date(Date.now() + 60_000)
    });
    // Email matches a deactivated admin
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin_deactivated',
      role: 'ADMIN',
      isBanned: true
    });
    // But phone belongs to a DIFFERENT deactivated admin
    mocks.userFindFirst.mockResolvedValue({
      id: 'other_deactivated_admin',
      role: 'ADMIN',
      isBanned: true,
      phone: '+911234567890'
    });
    mocks.opsUserFindUnique.mockResolvedValue(null);

    await expect(
      service.sendSetupOtp({
        inviteToken: 'token_1234567890',
        name: 'Merchant Owner',
        password: 'securepassword',
        phone: '+911234567890'
      })
    ).resolves.toMatchObject({ message: 'OTP sent successfully' });
  });

  it('sendSetupOtp allows deactivated merchant admin email before consume', async () => {
    const { service, mocks } = createHarness();
    mocks.storeSettingsFindUnique.mockResolvedValue({
      notifyEmailEnabled: true,
      notifySmsEnabled: false,
      notifyWhatsappEnabled: false,
      primaryNotificationChannels: { OtpVerification: 'EMAIL' }
    });
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      status: 'EMAIL_SENT',
      permissions: ['products:read'],
      expiresAt: new Date(Date.now() + 60_000)
    });
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin_deactivated',
      role: 'ADMIN',
      isBanned: true
    });
    mocks.opsUserFindUnique.mockResolvedValue(null);

    const result = await service.sendSetupOtp({
      inviteToken: 'token_1234567890',
      name: 'Merchant Owner',
      password: 'securepassword'
    });

    expect(result.message).toBe('OTP sent successfully');
    expect(mocks.redisSet).toHaveBeenCalled();
  });

  it('rejects createAdminInvite when an active merchant admin uses the email', async () => {
    const { service, mocks } = createHarness();
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'admin_active',
      role: 'ADMIN',
      isBanned: false
    });

    await expect(
      service.createAdminInvite({
        inviteEmail: 'merchant@example.com',
        inviteName: 'Merchant Owner',
        setupBaseUrl: 'https://client.example.com',
        permissions: ['products:read']
      })
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('active merchant admin') });

    expect(mocks.adminUserInviteCreate).not.toHaveBeenCalled();
  });

  it('reactivates a deactivated merchant admin when invite setup is consumed', async () => {
    const { service, mocks } = createHarness();
    mocks.adminUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'merchant@example.com',
      inviteName: 'Merchant Owner',
      status: 'EMAIL_SENT',
      permissions: ['products:read', 'orders:read'],
      expiresAt: new Date(Date.now() + 60_000)
    });
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin_deactivated',
      role: 'ADMIN',
      isBanned: true
    });
    mocks.opsUserFindUnique.mockResolvedValue(null);

    const inviteTokenHash = crypto.createHash('sha256').update('token_reactivate').digest('hex');
    const otpHash = crypto.createHash('sha256').update('123456').digest('hex');
    mocks.redisGet.mockImplementation(async (key: string) => {
      if (key === `admin-invite:setup:payload:${inviteTokenHash}`) {
        return JSON.stringify({
          name: 'Merchant Owner',
          phone: null,
          passwordHash: 'new-password-hash'
        });
      }
      if (key === `admin-invite:setup:otp:${inviteTokenHash}`) {
        return otpHash;
      }
      return null;
    });

    const result = await service.consumeAdminInvite({
      inviteToken: 'token_reactivate',
      otp: '123456'
    });

    expect(result.adminUserId).toBe('admin_deactivated');
    expect(mocks.txUserCreate).not.toHaveBeenCalled();
    expect(mocks.txUserUpdate).toHaveBeenCalledWith({
      where: { id: 'admin_deactivated' },
      data: expect.objectContaining({
        isBanned: false,
        bannedAt: null,
        bannedReason: null,
        passwordHash: 'new-password-hash'
      })
    });
    expect(mocks.txGrantDeleteMany).toHaveBeenCalledWith({ where: { userId: 'admin_deactivated' } });
  });

  it('rejects createAdminInvite when active invite already exists for email (Gap 9)', async () => {
    const { service, mocks } = createHarness();
    mocks.opsUserFindUnique.mockResolvedValueOnce(null);
    mocks.adminUserInviteFindFirst.mockResolvedValueOnce({
      id: 'existing_1',
      inviteEmail: 'merchant@example.com',
      status: 'EMAIL_SENT'
    });

    await expect(
      service.createAdminInvite({
        inviteEmail: 'merchant@example.com',
        inviteName: 'Merchant Owner',
        setupBaseUrl: 'https://client.example.com',
        permissions: ['products:read']
      })
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mocks.adminUserInviteCreate).not.toHaveBeenCalled();
  });

  it('rejects createAdminInvite when setupBaseUrl points to localhost (SSRF guard)', async () => {
    const { service, mocks } = createHarness();

    await expect(
      service.createAdminInvite({
        inviteEmail: 'merchant@example.com',
        inviteName: 'Merchant Owner',
        setupBaseUrl: 'https://127.0.0.1',
        permissions: ['products:read']
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('not permitted')
    });

    expect(mocks.adminUserInviteCreate).not.toHaveBeenCalled();
  });
});
