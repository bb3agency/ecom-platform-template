import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { isAuthDevBypassEnabled } from '@common/auth/auth-dev-bypass';
import { AuthService } from './auth.service';

function createHarness() {
  const notificationsAdd = vi.fn(async () => undefined);
  const userFindUnique = vi.fn(async () => ({
    id: 'admin_1',
    email: 'admin@example.com',
    role: 'ADMIN',
    passwordHash: bcrypt.hashSync('correctpass', 1),
    firstName: 'Admin',
    lastName: 'User',
    isVerified: true,
    isBanned: false,
    phone: null
  }));

  const fastify = {
    redis: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 1),
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
      ttl: vi.fn(async () => -1)
    },
    queues: { notifications: { add: notificationsAdd } },
    prisma: {
      user: { findUnique: userFindUnique, findFirst: vi.fn(async () => null) },
      adminPermissionGrant: { findMany: vi.fn(async () => []) },
      refreshToken: { create: vi.fn(async () => ({})) },
      storeSettings: {
        findUnique: vi.fn(async () => ({
          notifyEmailEnabled: true,
          notifySmsEnabled: false,
          notifyWhatsappEnabled: false,
          primaryNotificationChannels: { OtpVerification: 'EMAIL' }
        }))
      },
      opsConfigSecret: { findMany: vi.fn(async () => []) }
    },
    jwt: { sign: vi.fn().mockReturnValue('token') }
  } as unknown as FastifyInstance;

  return { service: new AuthService(fastify), mocks: { notificationsAdd } };
}

describe('AuthService production OTP paths (no dev bypass)', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_DEV_BYPASS', 'true');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requestAdminLoginOtp never returns devOtp when NODE_ENV is production', async () => {
    const { service, mocks } = createHarness();

    const result = await service.requestAdminLoginOtp({
      email: 'admin@example.com',
      password: 'correctpass',
      clientIp: '127.0.0.1'
    });

    expect(isAuthDevBypassEnabled()).toBe(false);
    expect('devOtp' in result).toBe(false);
    expect(mocks.notificationsAdd).toHaveBeenCalled();
    expect(result.message).toContain('an OTP has been sent');
    expect(mocks.notificationsAdd).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({ template: 'OtpVerification', to: 'admin@example.com' }),
      expect.any(Object)
    );
  });
});
