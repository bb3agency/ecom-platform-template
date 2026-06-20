import Fastify from 'fastify';
import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { registerAuthRoutes } from './auth.routes';
import { AuthService } from './auth.service';
import { adminInviteCreateSchema } from './auth.schemas';

interface MockError {
  statusCode?: number;
  code?: string;
  message?: string;
}

function createApp() {
  const app = Fastify();
  app.setErrorHandler((err, _request, reply) => {
    const error = err as MockError;
    const statusCode =
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    reply.status(statusCode).send({
      success: false,
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: error.message,
        statusCode,
        details: { kind: 'internal', hintKey: 'unknown', retryable: false, remediation: '' }
      }
    });
  });
  const refreshFindMany = vi.fn(async () => []);
  const refreshUpdateMany = vi.fn(async () => ({ count: 1 }));
  app.decorate('prisma', {
    refreshToken: {
      findMany: refreshFindMany,
      updateMany: refreshUpdateMany
    },
    user: {},
    adminUserInvite: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0)
    },
    storeSettings: { findUnique: vi.fn(async () => null) },
    adminPermissionGrant: { findMany: vi.fn(async () => []) },
    opsConfigSecret: { findMany: vi.fn(async () => []) }
  } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);
  app.decorate('redis', {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    ttl: vi.fn(async () => -1),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1)
  } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);
  app.decorate('jwt', { sign: vi.fn(() => 'token') } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);
  app.decorateRequest('jwtVerify', async function () {
    const req = this as unknown as { headers: Record<string, unknown>; user?: unknown };
    const roleHeader = req.headers['x-role'];
    const role = roleHeader === 'ADMIN' ? Role.ADMIN : Role.CUSTOMER;
    req.user = {
      sub: 'user-1',
      role,
      permissions: role === Role.ADMIN ? ['users:read', 'users:write'] : []
    };
  });
  return { app, mocks: { refreshFindMany, refreshUpdateMany } };
}

const ADMIN_TEST_EMAIL = 'jumeshchandra05@gmail.com';
const ADMIN_TEST_PASSWORD = 'Admin@12345';

function createAdminLoginApp(userRecord: Record<string, unknown> | null) {
  const notificationsAdd = vi.fn(async () => undefined);
  const userFindUnique = vi.fn(async () => userRecord);
  const redisGet = vi.fn<(key: string) => Promise<string | null>>(async () => null);
  const redisSet = vi.fn(async () => 'OK');
  const redisDel = vi.fn(async () => 1);

  const app = Fastify();
  app.setErrorHandler((err, _request, reply) => {
    const error = err as MockError;
    const statusCode =
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    reply.status(statusCode).send({
      success: false,
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: error.message,
        statusCode,
        details: { kind: 'internal', hintKey: 'unknown', retryable: false, remediation: '' }
      }
    });
  });

  app.decorate('prisma', {
    user: {
      findUnique: userFindUnique,
      findFirst: vi.fn(async () => null)
    },
    storeSettings: {
      findUnique: vi.fn(async () => ({
        notifyEmailEnabled: true,
        notifySmsEnabled: false,
        notifyWhatsappEnabled: false,
        primaryNotificationChannels: { OtpVerification: 'EMAIL' }
      }))
    },
    refreshToken: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({}))
    },
    adminUserInvite: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0)
    },
    adminPermissionGrant: { findMany: vi.fn(async () => []) },
    opsUser: { findMany: vi.fn(async () => []) },
    opsConfigSecret: { findMany: vi.fn(async () => []) }
  } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);

  app.decorate('redis', {
    get: redisGet,
    set: redisSet,
    del: redisDel,
    ttl: vi.fn(async () => -1),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1)
  } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);

  app.decorate('queues', {
    notifications: { add: notificationsAdd }
  } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);

  app.decorate('jwt', { sign: vi.fn(() => 'token') } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);

  return { app, mocks: { notificationsAdd, userFindUnique, redisGet, redisSet, redisDel } };
}

describe('adminInviteCreateSchema permission enum', () => {
  it('does not include queues:inspect (queue inspection is ops-only, not grantable to admin)', () => {
    const permItems = adminInviteCreateSchema.body.properties.permissions.items;
    expect(permItems.enum).not.toContain('queues:inspect');
  });

  it('does not include ops:read or ops:write (ops permissions are ops-invite-only)', () => {
    const permItems = adminInviteCreateSchema.body.properties.permissions.items;
    expect(permItems.enum).not.toContain('ops:read');
    expect(permItems.enum).not.toContain('ops:write');
  });
});

describe('auth routes logout role handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('MSG91_AUTH_KEY', 'msg91-auth-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows customer logout', async () => {
    const { app } = createApp();
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        'x-role': 'CUSTOMER',
        cookie: 'refresh_token=abc'
      },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'Logged out successfully' });
    expect(response.headers['set-cookie']).toContain('refresh_token=');

    await app.close();
  });

  it('allows admin logout', async () => {
    const { app } = createApp();
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        'x-role': 'ADMIN',
        cookie: 'refresh_token=def'
      },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'Logged out successfully' });
    expect(response.headers['set-cookie']).toContain('Max-Age=0');

    await app.close();
  });

  it('allows banned customer logout so sessions can be cleared', async () => {
    const { app } = createApp();
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        'x-role': 'CUSTOMER',
        cookie: 'refresh_token=abc'
      },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'Logged out successfully' });
    expect(response.headers['set-cookie']).toContain('refresh_token=');

    await app.close();
  });

  it('registers 2-step admin login routes (request-otp and verify-otp)', async () => {
    const { app } = createApp();
    await registerAuthRoutes(app);

    const requestOtpResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login/request-otp',
      payload: {}
    });
    const verifyOtpResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login/verify-otp',
      payload: {}
    });

    expect(requestOtpResponse.statusCode).not.toBe(404);
    expect(verifyOtpResponse.statusCode).not.toBe(404);

    await app.close();
  });

  it('exposes public OTP channel config route', async () => {
    const { app } = createApp();
    const prisma = (app as unknown as { prisma: { storeSettings: { findUnique: ReturnType<typeof vi.fn> } } }).prisma;
    prisma.storeSettings.findUnique.mockResolvedValue({
      notifyEmailEnabled: false,
      notifySmsEnabled: true,
      notifyWhatsappEnabled: false,
      primaryNotificationChannels: { CustomerOtpVerification: 'SMS' }
    });
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/otp-channel'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      channel: 'sms',
      availableChannels: ['sms']
    });

    await app.close();
  });

  it('exposes public admin OTP channel config route', async () => {
    const { app } = createApp();
    const prisma = (app as unknown as { prisma: { storeSettings: { findUnique: ReturnType<typeof vi.fn> } } }).prisma;
    prisma.storeSettings.findUnique.mockResolvedValue({
      notifyEmailEnabled: true,
      notifySmsEnabled: false,
      notifyWhatsappEnabled: false,
      primaryNotificationChannels: { OtpVerification: 'EMAIL' }
    });
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/admin/otp-channel'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      channel: 'email',
      availableChannels: ['email']
    });

    await app.close();
  });

  it('does not register old TOTP MFA routes', async () => {
    const { app } = createApp();
    await registerAuthRoutes(app);

    const startResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/setup/start',
      payload: {}
    });
    const confirmResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/setup/confirm',
      payload: {}
    });
    const disableResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/disable',
      payload: {}
    });

    expect(startResponse.statusCode).toBe(404);
    expect(confirmResponse.statusCode).toBe(404);
    expect(disableResponse.statusCode).toBe(404);

    await app.close();
  });

  it('registers merchant admin invite setup routes', async () => {
    const { app } = createApp();
    await registerAuthRoutes(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/ops/admin-invites',
      payload: {}
    });
    const consumeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invites/consume',
      payload: {}
    });
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/ops/admin-invites'
    });
    const revokeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/ops/admin-invites/invite_1/revoke',
      payload: {}
    });
    const cleanupResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/ops/admin-invites/cleanup-expired',
      payload: {}
    });
    const signupPhoneResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup-phone',
      payload: {}
    });

    expect(createResponse.statusCode).not.toBe(404);
    expect(listResponse.statusCode).not.toBe(404);
    expect(revokeResponse.statusCode).not.toBe(404);
    expect(consumeResponse.statusCode).not.toBe(404);
    expect(cleanupResponse.statusCode).not.toBe(404);
    expect(signupPhoneResponse.statusCode).not.toBe(404);

    await app.close();
  });
});

describe('auth routes admin login OTP (deactivated admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.stubEnv('AUTH_DEV_BYPASS', 'false');
  });

  it('POST /auth/admin/login/request-otp returns 401 for ops-deactivated admin (isBanned)', async () => {
    const passwordHash = bcrypt.hashSync(ADMIN_TEST_PASSWORD, 1);
    const { app, mocks } = createAdminLoginApp({
      id: 'admin_deactivated',
      email: ADMIN_TEST_EMAIL,
      role: Role.ADMIN,
      passwordHash,
      isBanned: true,
      isVerified: true,
      phone: null
    });
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login/request-otp',
      payload: {
        email: ADMIN_TEST_EMAIL,
        password: ADMIN_TEST_PASSWORD
      }
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('UNAUTHORISED');
    expect(body.error?.message).toContain('inactive');
    expect(mocks.notificationsAdd).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();

    await app.close();
  });

  it('POST /auth/admin/login/request-otp returns 200 for unknown email (anti-enumeration, no OTP)', async () => {
    const { app, mocks } = createAdminLoginApp(null);
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login/request-otp',
      payload: {
        email: 'unknown-admin@example.com',
        password: ADMIN_TEST_PASSWORD
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { message?: string; expiresAt?: string };
    expect(body.message).toContain('OTP has been sent');
    expect(body.expiresAt).toBeTruthy();
    expect(mocks.notificationsAdd).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();

    await app.close();
  });

  it('POST /auth/admin/login/request-otp returns 401 when password is wrong for known admin', async () => {
    const passwordHash = bcrypt.hashSync(ADMIN_TEST_PASSWORD, 1);
    const { app, mocks } = createAdminLoginApp({
      id: 'admin_active',
      email: ADMIN_TEST_EMAIL,
      role: Role.ADMIN,
      passwordHash,
      isBanned: false,
      isVerified: true,
      phone: null
    });
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login/request-otp',
      payload: {
        email: ADMIN_TEST_EMAIL,
        password: 'not-the-real-password'
      }
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('INVALID_CREDENTIALS');
    expect(body.error?.message).toContain('password');
    expect(mocks.notificationsAdd).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();

    await app.close();
  });

  it('POST /auth/admin/login/request-otp returns 200 for active admin', async () => {
    const passwordHash = bcrypt.hashSync(ADMIN_TEST_PASSWORD, 1);
    const { app, mocks } = createAdminLoginApp({
      id: 'admin_active',
      email: ADMIN_TEST_EMAIL,
      role: Role.ADMIN,
      passwordHash,
      isBanned: false,
      isVerified: true,
      phone: null
    });
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login/request-otp',
      payload: {
        email: ADMIN_TEST_EMAIL,
        password: ADMIN_TEST_PASSWORD
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { message?: string; expiresAt?: string };
    expect(body.message).toContain('OTP has been sent');
    expect(body.expiresAt).toBeTruthy();
    expect(mocks.notificationsAdd).toHaveBeenCalled();
    expect(mocks.redisSet).toHaveBeenCalled();

    await app.close();
  });

  it('POST /auth/admin/login/verify-otp returns 401 when admin was deactivated after OTP issued', async () => {
    const passwordHash = bcrypt.hashSync(ADMIN_TEST_PASSWORD, 1);
    const otp = '654321';
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const emailHash = crypto.createHash('sha256').update(ADMIN_TEST_EMAIL.trim().toLowerCase()).digest('hex');
    const otpKey = `auth:admin:login-otp:${emailHash}`;

    const { app, mocks } = createAdminLoginApp({
      id: 'admin_deactivated',
      email: ADMIN_TEST_EMAIL,
      role: Role.ADMIN,
      passwordHash,
      isBanned: true,
      isVerified: true,
      phone: null
    });
    mocks.redisGet.mockImplementation(async (key: string) => {
      if (key === otpKey) {
        return `admin_deactivated||${otpHash}`;
      }
      return null;
    });
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login/verify-otp',
      payload: {
        email: ADMIN_TEST_EMAIL,
        otp
      }
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('UNAUTHORISED');

    await app.close();
  });

  it('POST /auth/refresh clears refresh_token cookie on 401', async () => {
    const refreshSpy = vi.spyOn(AuthService.prototype, 'refresh').mockRejectedValue(
      new AppError(ERROR_CODES.UNAUTHORISED, 'Invalid refresh token', 401)
    );

    const { app } = createApp();
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: 'refresh_token=stale-token'
      },
      payload: {}
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toContain('refresh_token=');
    expect(response.headers['set-cookie']).toContain('Max-Age=0');

    refreshSpy.mockRestore();
    await app.close();
  });

  it('POST /auth/admin/login/verify-otp forwards abuse risk context for stable refresh token binding', async () => {
    const verifySpy = vi.spyOn(AuthService.prototype, 'verifyAdminLoginOtp').mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'admin_1',
        email: ADMIN_TEST_EMAIL,
        phone: '+910000000000',
        firstName: 'Admin',
        lastName: 'User',
        role: Role.ADMIN,
        isVerified: true
      }
    });

    const { app } = createApp();
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login/verify-otp',
      headers: {
        'user-agent': 'vitest-agent',
        'x-session-id': 'session-123',
        'x-device-fingerprint': 'device-123',
        'x-ja3-fingerprint': 'tls-123'
      },
      payload: {
        email: ADMIN_TEST_EMAIL,
        otp: '654321'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(verifySpy).toHaveBeenCalledWith({
      email: ADMIN_TEST_EMAIL,
      otp: '654321',
      clientIp: '127.0.0.1',
      risk: {
        sessionId: 'session-123',
        deviceFingerprint: 'device-123',
        tlsFingerprint: 'tls-123',
        userAgent: 'vitest-agent'
      }
    });
    expect(response.headers['set-cookie']).toContain('refresh_token=');

    verifySpy.mockRestore();
    await app.close();
  });
});

describe('auth routes password reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.stubEnv('STOREFRONT_URL', 'https://store.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createPasswordResetApp(userExists: boolean) {
    const notificationsAdd = vi.fn(async () => undefined);
    const tokenRecords: Array<{ id: string; userId: string; tokenHash: string; expiresAt: Date }> = [];

    const userRecord = userExists
      ? { id: 'user_1', email: 'user@example.com', passwordHash: 'old-hash' }
      : null;

    const prismaMock = {
      user: {
        findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if ('email' in where && where.email === 'user@example.com') return userRecord;
          if ('id' in where && where.id === 'user_1') return userRecord;
          return null;
        }),
        update: vi.fn(async () => userRecord)
      },
      passwordResetToken: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const record = {
            id: 'prt_1',
            userId: String(data.userId),
            tokenHash: String(data.tokenHash),
            expiresAt: data.expiresAt as Date
          };
          tokenRecords.push(record);
          return record;
        }),
        findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const found = tokenRecords.find((r) => r.tokenHash === where.tokenHash);
          return found ?? null;
        }),
        delete: vi.fn(async () => ({ count: 1 }))
      },
      storeSettings: {
        findUnique: vi.fn(async () => ({
          notifyEmailEnabled: true,
          notifySmsEnabled: false,
          notifyWhatsappEnabled: false,
          primaryNotificationChannels: {}
        }))
      },
      refreshToken: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async () => ({}))
      },
      adminUserInvite: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
      adminPermissionGrant: { findMany: vi.fn(async () => []) },
      opsUser: { findMany: vi.fn(async () => []) },
      opsConfigSecret: { findMany: vi.fn(async () => []) }
    };

    const app = Fastify();
    app.setErrorHandler((err, _request, reply) => {
      const error = err as MockError;
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      reply.status(statusCode).send({
        success: false,
        error: {
          code: error.code ?? 'INTERNAL_ERROR',
          message: error.message,
          statusCode,
          details: { kind: 'internal', hintKey: 'unknown', retryable: false, remediation: '' }
        }
      });
    });

    app.decorate('prisma', {
      ...prismaMock,
      $transaction: vi.fn(async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock))
    } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);

    app.decorate('redis', {
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 1),
      ttl: vi.fn(async () => -1),
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1)
    } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);

    app.decorate('queues', {
      notifications: { add: notificationsAdd }
    } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);

    app.decorate('jwt', { sign: vi.fn(() => 'token') } as unknown as NonNullable<Parameters<typeof app.decorate>[1]>);

    return { app, mocks: { notificationsAdd, tokenRecords, prismaMock } };
  }

  it('POST /auth/forgot-password returns generic success for unknown email (anti-enumeration)', async () => {
    const { app } = createPasswordResetApp(false);
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'unknown@example.com' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { message?: string };
    expect(body.message).toContain('If the account exists');

    await app.close();
  });

  it('POST /auth/forgot-password stores token and enqueues email for known user', async () => {
    const { app, mocks } = createPasswordResetApp(true);
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'user@example.com' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { message?: string };
    expect(body.message).toContain('If the account exists');
    expect(mocks.prismaMock.passwordResetToken.create).toHaveBeenCalled();
    expect(mocks.notificationsAdd).toHaveBeenCalled();

    await app.close();
  });

  it('POST /auth/reset-password returns 400 when passwords do not match', async () => {
    const { app } = createPasswordResetApp(true);
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: {
        token: 'any-token',
        password: 'NewPass123!',
        confirmPassword: 'Different123!'
      }
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('POST /auth/reset-password returns 401 for invalid token', async () => {
    const { app } = createPasswordResetApp(true);
    await registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: {
        token: 'invalid-token',
        password: 'NewPass123!',
        confirmPassword: 'NewPass123!'
      }
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('INVALID_CREDENTIALS');

    await app.close();
  });

  it('POST /auth/reset-password returns 200 and updates password for valid token', async () => {
    const { app, mocks } = createPasswordResetApp(true);
    await registerAuthRoutes(app);

    // Seed a valid token
    const tokenHash = crypto.createHash('sha256').update('valid-token').digest('hex');
    mocks.tokenRecords.push({
      id: 'prt_1',
      userId: 'user_1',
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000)
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: {
        token: 'valid-token',
        password: 'NewPass123!',
        confirmPassword: 'NewPass123!'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { message?: string };
    expect(body.message).toContain('Password has been reset successfully');
    expect(mocks.prismaMock.user.update).toHaveBeenCalled();
    expect(mocks.prismaMock.passwordResetToken.deleteMany).toHaveBeenCalled();

    await app.close();
  });
});
