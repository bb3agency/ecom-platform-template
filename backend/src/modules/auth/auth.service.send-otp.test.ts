import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { isAuthDevBypassEnabled } from '@common/auth/auth-dev-bypass';
import { AuthService } from './auth.service';

describe('AuthService sendOtp', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_DEV_BYPASS', 'false');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('MSG91_AUTH_KEY', 'msg91-auth-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('requires challenge token when turnstile secret is configured in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'turnstile-secret');
    const redisGet = vi.fn().mockResolvedValue(null);
    const redisSet = vi.fn().mockResolvedValue('OK');
    const fastify = {
      redis: {
        get: redisGet,
        set: redisSet,
        ttl: vi.fn().mockResolvedValue(-1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        del: vi.fn().mockResolvedValue(1)
      },
      queues: {
        notifications: {
          add: vi.fn().mockResolvedValue(undefined)
        }
      },
      prisma: {
        opsConfigSecret: { findMany: vi.fn().mockResolvedValue([]) },
        user: {
          findFirst: vi.fn().mockResolvedValue(null)
        },
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            storeName: 'Test Store',
            mobileOtpSignupEnabled: true,
            notifyEmailEnabled: true,
            notifySmsEnabled: true,
            notifyWhatsappEnabled: false,
            primaryNotificationChannels: null
          })
        }
      }
    } as unknown as FastifyInstance;
    const service = new AuthService(fastify);
    await expect(
      service.sendOtp(
        { phone: '9876543210', channel: 'sms' },
        { clientIp: '127.0.0.1', risk: { sessionId: 's-1', deviceFingerprint: 'd-1' } }
      )
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400
    });
  });

  it('skips turnstile in development even when TURNSTILE_SECRET_KEY is set', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'turnstile-secret');
    const notificationsAdd = vi.fn().mockResolvedValue(undefined);
    const fastify = {
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1)
      },
      queues: { notifications: { add: notificationsAdd } },
      prisma: {
        opsConfigSecret: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        storeSettings: { findUnique: vi.fn().mockResolvedValue({ storeName: 'Test Store', mobileOtpSignupEnabled: true }) }
      }
    } as unknown as FastifyInstance;
    const service = new AuthService(fastify);
    const result = await service.sendOtp({ phone: '9876543210', channel: 'sms' });
    expect(result.message).toBe('OTP sent successfully');
    expect(notificationsAdd).toHaveBeenCalled();
  });

  it('enqueues OTP via send-primary when cooldown and attempts allow', async () => {
    const redisGet = vi.fn().mockResolvedValue(null);
    const redisSet = vi.fn().mockResolvedValue('OK');
    const notificationsAdd = vi.fn().mockResolvedValue(undefined);

    const fastify = {
      redis: {
        get: redisGet,
        set: redisSet,
        ttl: vi.fn().mockResolvedValue(-1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        del: vi.fn().mockResolvedValue(1)
      },
      queues: {
        notifications: {
          add: notificationsAdd
        }
      },
      prisma: {
        opsConfigSecret: { findMany: vi.fn().mockResolvedValue([]) },
        user: {
          findFirst: vi.fn().mockResolvedValue({ email: 'customer@example.com' })
        },
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ storeName: 'Acme Shop' })
        }
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    const result = await service.sendOtp(
      { phone: '9876543210', channel: 'sms', turnstileToken: 'token-ok' },
      { clientIp: '127.0.0.1', risk: { sessionId: 's-1' } }
    );

    expect(result).toEqual({ message: 'OTP sent successfully' });
    expect(redisSet).toHaveBeenCalledWith('otp:9876543210', expect.any(String), 'EX', 300);
    expect(redisSet).toHaveBeenCalledWith('otp:cooldown:9876543210', '1', 'EX', 60);
    expect(notificationsAdd).toHaveBeenCalledWith(
      'send-sms',
      expect.objectContaining({
        phone: '9876543210',
        template: 'CustomerOtpVerification',
        data: expect.objectContaining({
          otp: expect.any(String),
          storeName: 'Acme Shop'
        })
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('otp-sms-9876543210-')
      })
    );
  });

  it('uses Our Store fallback when storeSettings is missing', async () => {
    const notificationsAdd = vi.fn().mockResolvedValue(undefined);
    const fastify = {
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1)
      },
      queues: { notifications: { add: notificationsAdd } },
      prisma: {
        opsConfigSecret: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        storeSettings: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce({ mobileOtpSignupEnabled: true })
            .mockResolvedValueOnce(null)
        }
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    await service.sendOtp({ phone: '9876543210', channel: 'sms' });

    expect(notificationsAdd).toHaveBeenCalledWith(
      'send-sms',
      expect.objectContaining({
        phone: '9876543210',
        template: 'CustomerOtpVerification',
        data: expect.objectContaining({ storeName: 'Our Store' })
      }),
      expect.any(Object)
    );
  });

  it('enforces ops-selected primary channel even if client requests a different channel', async () => {
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'true');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'wa-token');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', 'wa-phone-id');

    const notificationsAdd = vi.fn().mockResolvedValue(undefined);
    const fastify = {
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1)
      },
      queues: { notifications: { add: notificationsAdd } },
      prisma: {
        opsConfigSecret: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            storeName: 'Acme Shop',
            mobileOtpSignupEnabled: true,
            notifyEmailEnabled: false,
            notifySmsEnabled: true,
            notifyWhatsappEnabled: true,
            primaryNotificationChannels: { CustomerOtpVerification: 'WHATSAPP' }
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    await service.sendOtp({ phone: '9876543210', channel: 'sms' });

    expect(notificationsAdd).toHaveBeenCalledWith(
      'send-whatsapp',
      expect.objectContaining({
        phone: '9876543210',
        template: 'CustomerOtpVerification'
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('otp-whatsapp-9876543210-')
      })
    );
  });

  it('exposes effective customer OTP channel from ops config', async () => {
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'false');
    const fastify = {
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1)
      },
      queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
      prisma: {
        opsConfigSecret: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            notifyEmailEnabled: false,
            notifySmsEnabled: true,
            notifyWhatsappEnabled: false,
            primaryNotificationChannels: { CustomerOtpVerification: 'SMS' }
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    await expect(service.getCustomerOtpChannelConfig()).resolves.toEqual({
      channel: 'sms',
      availableChannels: ['sms']
    });
  });

  it('cleans redis OTP keys and throws when OTP enqueue fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });
    vi.stubGlobal('fetch', fetchMock);
    const redisGet = vi.fn().mockResolvedValue(null);
    const redisSet = vi.fn().mockResolvedValue('OK');
    const redisDel = vi.fn().mockResolvedValue(2);
    const notificationsAdd = vi.fn().mockRejectedValue(new Error('queue down'));

    const fastify = {
      redis: {
        get: redisGet,
        set: redisSet,
        del: redisDel,
        ttl: vi.fn().mockResolvedValue(-1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1)
      },
      queues: {
        notifications: {
          add: notificationsAdd
        }
      },
      prisma: {
        opsConfigSecret: { findMany: vi.fn().mockResolvedValue([]) },
        user: {
          findFirst: vi.fn().mockResolvedValue(null)
        },
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            storeName: 'Test Store',
            mobileOtpSignupEnabled: true,
            notifyEmailEnabled: true,
            notifySmsEnabled: true,
            notifyWhatsappEnabled: false,
            primaryNotificationChannels: null
          })
        }
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'turnstile-secret');
    await expect(service.sendOtp({ phone: '9876543210', channel: 'sms', turnstileToken: 'ok-token' }, { clientIp: '127.0.0.1' })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      statusCode: 502
    });
    expect(redisDel).toHaveBeenCalledWith(
      'otp:9876543210',
      expect.stringContaining('otp:cooldown:9876543210'),
      'otp:cooldown:9876543210'
    );
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it('skips notification queue and returns devOtp only when dev bypass is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_DEV_BYPASS', 'true');
    vi.stubEnv('AUTH_DEV_OTP', '000000');

    const notificationsAdd = vi.fn().mockResolvedValue(undefined);
    const fastify = {
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1)
      },
      queues: { notifications: { add: notificationsAdd } },
      prisma: {
        opsConfigSecret: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        storeSettings: { findUnique: vi.fn().mockResolvedValue({ storeName: 'Test Store', mobileOtpSignupEnabled: true }) }
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    const result = await service.sendOtp({ phone: '9876543210', channel: 'sms' });

    expect(isAuthDevBypassEnabled()).toBe(true);
    expect(result.devOtp).toBe('000000');
    expect(result.message).toContain('Development mode');
    expect(notificationsAdd).not.toHaveBeenCalled();
  });

  it('enqueues customer OTP in production even when AUTH_DEV_BYPASS=true is set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_DEV_BYPASS', 'true');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');

    const notificationsAdd = vi.fn().mockResolvedValue(undefined);
    const fastify = {
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1)
      },
      queues: { notifications: { add: notificationsAdd } },
      prisma: {
        opsConfigSecret: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        storeSettings: { findUnique: vi.fn().mockResolvedValue({ storeName: 'Test Store', mobileOtpSignupEnabled: true }) }
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    const result = await service.sendOtp({ phone: '9876543210', channel: 'sms' });

    expect(isAuthDevBypassEnabled()).toBe(false);
    expect('devOtp' in result).toBe(false);
    expect(result.message).toBe('OTP sent successfully');
    expect(notificationsAdd).toHaveBeenCalled();
  });

  it('rejects OTP for new phone numbers when mobile signup is disabled', async () => {
    const fastify = {
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        del: vi.fn(),
        ttl: vi.fn(),
        incr: vi.fn(),
        expire: vi.fn()
      },
      queues: { notifications: { add: vi.fn() } },
      prisma: {
        opsConfigSecret: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ mobileOtpSignupEnabled: false })
        }
      }
    } as unknown as FastifyInstance;

    const service = new AuthService(fastify);
    await expect(service.sendOtp({ phone: '9876543210', channel: 'sms' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Phone signup is not available'
    });
  });
});
