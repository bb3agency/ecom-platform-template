import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AuthService } from './auth.service';

function stableHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createHarness(overrides: {
  userRecord?: Record<string, unknown> | null;
  redisGetValue?: string | null;
} = {}) {
  const userRecord = overrides.userRecord !== undefined
    ? overrides.userRecord
    : {
        id: 'admin_1',
        email: 'admin@example.com',
        role: 'ADMIN',
        passwordHash: bcrypt.hashSync('correctpass', 1),
        firstName: 'Admin',
        lastName: 'User',
        isVerified: true
      };

  const userFindUnique = vi.fn().mockResolvedValue(userRecord);
  const redisGet = vi.fn().mockResolvedValue(overrides.redisGetValue ?? null);
  const redisSet = vi.fn().mockResolvedValue('OK');
  const redisDel = vi.fn().mockResolvedValue(1);
  const redisIncr = vi.fn().mockResolvedValue(1);
  const redisExpire = vi.fn().mockResolvedValue(1);
  const notificationsAdd = vi.fn().mockResolvedValue(undefined);
  const permGrantFindMany = vi.fn().mockResolvedValue([]);
  const refreshCreate = vi.fn().mockResolvedValue({ id: 'rt_1' });
  const refreshFindUnique = vi.fn().mockResolvedValue(null);
  const refreshUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const storeSettingsFindUnique = vi.fn().mockResolvedValue({
    notifyEmailEnabled: true,
    notifySmsEnabled: false,
    notifyWhatsappEnabled: false,
    primaryNotificationChannels: { OtpVerification: 'EMAIL' }
  });

  const fastify = {
    redis: {
      get: redisGet,
      set: redisSet,
      del: redisDel,
      incr: redisIncr,
      expire: redisExpire,
      ttl: vi.fn().mockResolvedValue(-1)
    },
    queues: { notifications: { add: notificationsAdd } },
    prisma: {
      user: { findUnique: userFindUnique, findFirst: vi.fn().mockResolvedValue(null) },
      adminPermissionGrant: { findMany: permGrantFindMany },
      refreshToken: {
        create: refreshCreate,
        findUnique: refreshFindUnique,
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: refreshUpdateMany
      },
      storeSettings: { findUnique: storeSettingsFindUnique },
      opsConfigSecret: { findMany: vi.fn().mockResolvedValue([]) }
    },
    jwt: { sign: vi.fn().mockReturnValue('signed-token') }
  } as unknown as FastifyInstance;

  return {
    service: new AuthService(fastify),
    mocks: {
      userFindUnique,
      redisGet,
      redisSet,
      redisDel,
      redisIncr,
      redisExpire,
      notificationsAdd,
      permGrantFindMany,
      refreshCreate,
      refreshFindUnique,
      refreshUpdateMany,
      storeSettingsFindUnique
    }
  };
}

describe('AuthService.requestAdminLoginOtp', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_DEV_BYPASS', 'false');
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'true');
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubEnv('RESEND_FROM', 'Test <onboarding@resend.dev>');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns devOtp and skips notification queue when AUTH_DEV_BYPASS is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_DEV_BYPASS', 'true');
    vi.stubEnv('AUTH_DEV_OTP', '000000');

    const { service, mocks } = createHarness();

    const result = await service.requestAdminLoginOtp({
      email: 'admin@example.com',
      password: 'correctpass',
      clientIp: '127.0.0.1'
    });

    expect(result.devOtp).toBe('000000');
    expect(result.message).toContain('Development mode');
    expect(mocks.notificationsAdd).not.toHaveBeenCalled();
  });

  it('returns generic message and sends OTP email on valid admin credentials', async () => {
    const { service, mocks } = createHarness();

    const result = await service.requestAdminLoginOtp({
      email: 'admin@example.com',
      password: 'correctpass',
      clientIp: '127.0.0.1'
    });

    expect(result.message).toContain('OTP has been sent');
    expect(result.expiresAt).toBeTruthy();
    expect(mocks.redisSet).toHaveBeenCalledWith(
      expect.stringContaining('auth:admin:login-otp:'),
      expect.stringContaining('admin_1||'),
      'EX',
      300
    );
    expect(mocks.notificationsAdd).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({ template: 'OtpVerification', to: 'admin@example.com' }),
      expect.any(Object)
    );
  });

  it('prefers email for admin login OTP even when store primary channel is SMS', async () => {
    const { service, mocks } = createHarness({
      userRecord: {
        id: 'admin_1',
        email: 'admin@example.com',
        phone: '+911234567890',
        role: 'ADMIN',
        passwordHash: bcrypt.hashSync('correctpass', 1),
        firstName: 'Admin',
        lastName: 'User',
        isVerified: true
      }
    });
    mocks.storeSettingsFindUnique.mockResolvedValue({
      notifyEmailEnabled: true,
      notifySmsEnabled: true,
      notifyWhatsappEnabled: false,
      primaryNotificationChannels: { OtpVerification: 'SMS' }
    });
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('MSG91_AUTH_KEY', 'msg91-key');

    await service.requestAdminLoginOtp({
      email: 'admin@example.com',
      password: 'correctpass',
      clientIp: '127.0.0.1'
    });

    expect(mocks.notificationsAdd).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({ template: 'OtpVerification', to: 'admin@example.com' }),
      expect.any(Object)
    );
  });

  it('fans admin login OTP to BOTH email and WhatsApp when OTP_WHATSAPP_ENABLED and admin has a phone', async () => {
    const { service, mocks } = createHarness({
      userRecord: {
        id: 'admin_1',
        email: 'admin@example.com',
        phone: '+911234567890',
        role: 'ADMIN',
        passwordHash: bcrypt.hashSync('correctpass', 1),
        firstName: 'Admin',
        lastName: 'User',
        isVerified: true
      }
    });
    mocks.storeSettingsFindUnique.mockResolvedValue({
      notifyEmailEnabled: true,
      notifySmsEnabled: false,
      notifyWhatsappEnabled: true,
      primaryNotificationChannels: { OtpVerification: ['EMAIL', 'WHATSAPP'] }
    });
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'true');
    vi.stubEnv('OTP_WHATSAPP_ENABLED', 'true');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'meta-token');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', 'pnid');

    await service.requestAdminLoginOtp({
      email: 'admin@example.com',
      password: 'correctpass',
      clientIp: '127.0.0.1'
    });

    expect(mocks.notificationsAdd).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({ template: 'OtpVerification', to: 'admin@example.com' }),
      expect.any(Object)
    );
    expect(mocks.notificationsAdd).toHaveBeenCalledWith(
      'send-whatsapp',
      expect.objectContaining({ template: 'OtpVerification', phone: '+911234567890' }),
      expect.any(Object)
    );
  });

  it('does NOT send WhatsApp OTP to an admin without a phone number (email only)', async () => {
    // Default admin userRecord has no `phone`.
    const { service, mocks } = createHarness();
    mocks.storeSettingsFindUnique.mockResolvedValue({
      notifyEmailEnabled: true,
      notifySmsEnabled: false,
      notifyWhatsappEnabled: true,
      primaryNotificationChannels: { OtpVerification: ['EMAIL', 'WHATSAPP'] }
    });
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'true');
    vi.stubEnv('OTP_WHATSAPP_ENABLED', 'true');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'meta-token');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', 'pnid');

    await service.requestAdminLoginOtp({
      email: 'admin@example.com',
      password: 'correctpass',
      clientIp: '127.0.0.1'
    });

    expect(mocks.notificationsAdd).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({ template: 'OtpVerification', to: 'admin@example.com' }),
      expect.any(Object)
    );
    expect(mocks.notificationsAdd).not.toHaveBeenCalledWith(
      'send-whatsapp',
      expect.anything(),
      expect.anything()
    );
  });

  it('returns generic message without sending OTP when user is not found (anti-enumeration)', async () => {
    const { service, mocks } = createHarness({ userRecord: null });

    const result = await service.requestAdminLoginOtp({
      email: 'noone@example.com',
      password: 'anypass',
      clientIp: '127.0.0.1'
    });

    expect(result.message).toContain('OTP has been sent');
    expect(mocks.notificationsAdd).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();
  });

  it('returns generic message without sending OTP when user is CUSTOMER role (anti-enumeration)', async () => {
    const { service, mocks } = createHarness({
      userRecord: {
        id: 'cust_1',
        email: 'customer@example.com',
        role: 'CUSTOMER',
        passwordHash: bcrypt.hashSync('correctpass', 1)
      }
    });

    const result = await service.requestAdminLoginOtp({
      email: 'customer@example.com',
      password: 'correctpass',
      clientIp: '127.0.0.1'
    });

    expect(result.message).toContain('OTP has been sent');
    expect(result.expiresAt).toBeTruthy();
    expect(mocks.notificationsAdd).not.toHaveBeenCalled();
  });

  it('rejects OTP request when password is wrong for a known admin', async () => {
    const { service, mocks } = createHarness();

    await expect(
      service.requestAdminLoginOtp({
        email: 'admin@example.com',
        password: 'wrongpass',
        clientIp: '127.0.0.1'
      })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });

    expect(mocks.notificationsAdd).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();
  });

  it('rejects OTP request when admin is deactivated (isBanned)', async () => {
    const { service, mocks } = createHarness({
      userRecord: {
        id: 'admin_1',
        email: 'admin@example.com',
        role: 'ADMIN',
        passwordHash: bcrypt.hashSync('correctpass', 1),
        isBanned: true,
        isVerified: true
      }
    });

    await expect(
      service.requestAdminLoginOtp({
        email: 'admin@example.com',
        password: 'correctpass',
        clientIp: '127.0.0.1'
      })
    ).rejects.toMatchObject({ code: 'UNAUTHORISED', statusCode: 401 });

    expect(mocks.notificationsAdd).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();
  });
});

describe('AuthService.verifyAdminLoginOtp', () => {
  it('issues tokens on correct dev OTP without Redis when AUTH_DEV_BYPASS is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_DEV_BYPASS', 'true');
    vi.stubEnv('AUTH_DEV_OTP', '000000');

    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

    const { service, mocks } = createHarness({ redisGetValue: null });

    const result = await service.verifyAdminLoginOtp({
      email: 'admin@example.com',
      otp: '000000',
      clientIp: '127.0.0.1'
    });

    expect(result).toHaveProperty('accessToken');
    expect(mocks.redisDel).toHaveBeenCalled();

    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    vi.unstubAllEnvs();
  });

  it('throws on missing OTP in Redis (expired or not requested)', async () => {
    const { service } = createHarness({ redisGetValue: null });

    await expect(
      service.verifyAdminLoginOtp({ email: 'admin@example.com', otp: '123456', clientIp: '127.0.0.1' })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
  });

  it('throws and increments attempts on wrong OTP', async () => {
    const email = 'admin@example.com';
    const storedOtpHash = crypto.createHash('sha256').update('111111').digest('hex');
    const stored = `admin_1||${storedOtpHash}`;

    const { service, mocks } = createHarness({ redisGetValue: stored });

    await expect(
      service.verifyAdminLoginOtp({ email, otp: '999999', clientIp: '127.0.0.1' })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });

    expect(mocks.redisIncr).toHaveBeenCalledWith(
      expect.stringContaining(`auth:admin:login-otp-attempts:${stableHash(email)}`)
    );
  });

  it('issues tokens on correct OTP and deletes Redis keys', async () => {
    const email = 'admin@example.com';
    const otp = '654321';
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const stored = `admin_1||${otpHash}`;

    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

    const { service, mocks } = createHarness({ redisGetValue: stored });

    const result = await service.verifyAdminLoginOtp({ email, otp, clientIp: '127.0.0.1' });

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(mocks.redisDel).toHaveBeenCalledWith(
      expect.stringContaining('auth:admin:login-otp:'),
      expect.stringContaining('auth:admin:login-otp-attempts:')
    );

    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
  });

  it('issues refresh token bound to the User-Agent only and rotates it on refresh', async () => {
    const email = 'admin@example.com';
    const otp = '654321';
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const stored = `admin_1||${otpHash}`;
    const userAgent = 'vitest-admin-browser';
    const clientIp = '203.0.113.10';
    const risk = {
      sessionId: 'admin-session-1',
      deviceFingerprint: 'ignored-fingerprint',
      tlsFingerprint: 'ignored-tls',
      userAgent
    };

    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

    const { service, mocks } = createHarness({ redisGetValue: stored });
    const issued = await service.verifyAdminLoginOtp({
      email,
      otp,
      clientIp,
      risk
    });

    expect(issued.refreshToken).toEqual(expect.any(String));
    expect(mocks.refreshCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deviceKeyHash: crypto.createHash('sha256').update(`ua|${userAgent}`).digest('hex')
        })
      })
    );

    const createData = (mocks.refreshCreate.mock.calls[0]?.[0] as {
      data: { tokenHash: string; jti: string; sessionId: string; deviceKeyHash: string };
    }).data;
    mocks.refreshFindUnique.mockResolvedValue({
      id: 'rt-1',
      userId: 'admin_1',
      jti: createData.jti,
      sessionId: createData.sessionId,
      tokenHash: createData.tokenHash,
      deviceKeyHash: createData.deviceKeyHash,
      consumedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000)
    });
    mocks.refreshUpdateMany.mockResolvedValue({ count: 1 });
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin_1',
      email,
      role: 'ADMIN',
      passwordHash: bcrypt.hashSync('correctpass', 1),
      isBanned: false,
      isVerified: true
    });

    const rotated = await service.refresh(issued.refreshToken, { clientIp, risk });
    expect(rotated.accessToken).toEqual(expect.any(String));
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);

    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
  });

  it('rejects OTP verification when admin is deactivated (isBanned)', async () => {
    const email = 'admin@example.com';
    const otp = '654321';
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const stored = `admin_1||${otpHash}`;

    const { service, mocks } = createHarness({
      redisGetValue: stored,
      userRecord: {
        id: 'admin_1',
        email,
        role: 'ADMIN',
        passwordHash: bcrypt.hashSync('correctpass', 1),
        isBanned: true,
        isVerified: true
      }
    });

    await expect(
      service.verifyAdminLoginOtp({ email, otp, clientIp: '127.0.0.1' })
    ).rejects.toMatchObject({ code: 'UNAUTHORISED', statusCode: 401 });

    expect(mocks.redisDel).toHaveBeenCalled();
  });
});
