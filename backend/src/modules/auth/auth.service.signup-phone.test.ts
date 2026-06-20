import crypto from 'crypto';
import { Role } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService verifyOtpAndSignup', () => {
  const redisGet = vi.fn();
  const redisIncr = vi.fn();
  const redisExpire = vi.fn();
  const redisDel = vi.fn();
  const userFindFirst = vi.fn();
  const userFindUnique = vi.fn();
  const userCreate = vi.fn();
  const opsUserFindUnique = vi.fn();
  const refreshTokenCreate = vi.fn();
  const jwtSign = vi.fn();
  const storeSettingsFindUnique = vi.fn();

  function buildService(): AuthService {
    process.env.JWT_REFRESH_SECRET = 'refresh-secret-for-tests';
    storeSettingsFindUnique.mockResolvedValue({ mobileOtpSignupEnabled: true });
    const fastify = {
      redis: {
        get: redisGet,
        incr: redisIncr,
        expire: redisExpire,
        del: redisDel
      },
      prisma: {
        user: {
          findFirst: userFindFirst,
          findUnique: userFindUnique,
          create: userCreate
        },
        opsUser: {
          findUnique: opsUserFindUnique
        },
        refreshToken: {
          create: refreshTokenCreate
        },
        storeSettings: {
          findUnique: storeSettingsFindUnique
        }
      },
      jwt: {
        sign: jwtSign
      }
    } as unknown as FastifyInstance;

    return new AuthService(fastify);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    redisGet.mockResolvedValue(crypto.createHash('sha256').update('123456').digest('hex'));
    redisIncr.mockResolvedValue(1);
    redisExpire.mockResolvedValue(1);
    redisDel.mockResolvedValue(2);
    userFindFirst.mockResolvedValue(null);
    userFindUnique.mockResolvedValue(null);
    opsUserFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({
      id: 'user_1',
      email: null,
      phone: '9999999999',
      firstName: 'Customer',
      lastName: 'User',
      role: Role.CUSTOMER,
      isVerified: true
    });
    refreshTokenCreate.mockResolvedValue(undefined);
    jwtSign.mockReturnValue('access-token');
  });

  it('creates a customer from phone OTP with optional profile omitted', async () => {
    const service = buildService();
    const result = await service.verifyOtpAndSignup({
      phone: '9999999999',
      otp: '123456'
    });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: '9999999999',
          role: Role.CUSTOMER,
          isVerified: true
        })
      })
    );
    expect(refreshTokenCreate).toHaveBeenCalledTimes(1);
    expect(redisDel).toHaveBeenCalledWith('otp:9999999999', expect.stringContaining('otp:attempts:9999999999:'));
    expect(result.accessToken).toBe('access-token');
    expect(result.user.phone).toBe('9999999999');
  });

  it('rejects signup when phone already exists', async () => {
    userFindFirst.mockResolvedValueOnce({ id: 'existing_user' });
    const service = buildService();

    await expect(
      service.verifyOtpAndSignup({
        phone: '9999999999',
        otp: '123456'
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('rejects verifyOtpAndSignup when email is already used by an ops account', async () => {
    opsUserFindUnique.mockResolvedValueOnce({ id: 'ops_1', email: 'ops@example.com' });
    const service = buildService();

    await expect(
      service.verifyOtpAndSignup({
        phone: '9999999999',
        otp: '123456',
        email: 'ops@example.com'
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('rejects phone signup when mobileOtpSignupEnabled is false', async () => {
    storeSettingsFindUnique.mockResolvedValueOnce({ mobileOtpSignupEnabled: false });
    const service = buildService();

    await expect(
      service.verifyOtpAndSignup({
        phone: '9999999999',
        otp: '123456'
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Phone signup is not available'
    });
    expect(userCreate).not.toHaveBeenCalled();
  });
});

describe('AuthService register cross-table email collision', () => {
  const redisGet = vi.fn();
  const redisIncr = vi.fn();
  const redisExpire = vi.fn();
  const redisDel = vi.fn();
  const userFindFirst = vi.fn();
  const opsUserFindUnique = vi.fn();
  const userCreate = vi.fn();
  const refreshTokenCreate = vi.fn();
  const jwtSign = vi.fn();

  function buildService(): AuthService {
    process.env.JWT_REFRESH_SECRET = 'refresh-secret-for-tests';
    const fastify = {
      redis: { get: redisGet, incr: redisIncr, expire: redisExpire, del: redisDel },
      prisma: {
        user: { findFirst: userFindFirst, findUnique: vi.fn(), create: userCreate },
        opsUser: { findUnique: opsUserFindUnique },
        refreshToken: { create: refreshTokenCreate }
      },
      jwt: { sign: jwtSign }
    } as unknown as FastifyInstance;
    return new AuthService(fastify);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    redisGet.mockResolvedValue(null);
    redisIncr.mockResolvedValue(1);
    redisExpire.mockResolvedValue(1);
    redisDel.mockResolvedValue(1);
    userFindFirst.mockResolvedValue(null);
    opsUserFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: 'user_1', email: 'customer@example.com', phone: '9999999999', firstName: 'C', lastName: 'U', role: Role.CUSTOMER, isVerified: true });
    refreshTokenCreate.mockResolvedValue(undefined);
    jwtSign.mockReturnValue('access-token');
  });

  it('rejects register when email is already used by an ops account', async () => {
    opsUserFindUnique.mockResolvedValueOnce({ id: 'ops_1', email: 'ops@example.com' });
    const service = buildService();

    await expect(
      service.register({
        firstName: 'Customer',
        lastName: 'User',
        phone: '9999999999',
        email: 'ops@example.com',
        password: 'SecurePassword123'
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(userCreate).not.toHaveBeenCalled();
  });
});
