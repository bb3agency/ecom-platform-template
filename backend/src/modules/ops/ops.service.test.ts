import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR_CODES } from '@common/errors/error-codes';
import * as alertModule from '@modules/notifications/notification-failure-alert';
import { LOAD_SHED_MODE_KEY } from '@common/reliability/load-shed.guard';
import { encryptOpsConfigValue, maskSecretValue } from '@common/security/ops-config-crypto';
import { OpsService } from './ops.service';

// Helper to compute OTP hash the same way the service does
function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
}

function createOpsServiceHarness() {
  const redisGet = vi.fn();
  const redisIncr = vi.fn(async () => 1);
  const redisExpire = vi.fn(async () => 1);
  const redisDel = vi.fn(async () => 1);
  const redisSet = vi.fn(async () => 'OK');
  const redisEval = vi.fn(async () => 1);

  const opsUserInviteFindUnique = vi.fn();
  const opsUserInviteFindFirst = vi.fn(async (): Promise<unknown> => null);
  const opsUserInviteCreate = vi.fn();
  const opsUserInviteUpdate = vi.fn();
  const opsUserInviteUpdateMany = vi.fn(async () => ({ count: 1 }));
  const opsUserInviteFindMany = vi.fn();

  const userFindUnique = vi.fn();
  type MerchantAdminUserRow = {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    isBanned: boolean;
    isVerified: boolean;
    bannedAt: Date | null;
    bannedReason: string | null;
    createdAt: Date;
    adminPermissionGrants: Array<{ permission: string }>;
  };
  const userFindMany = vi.fn(async (): Promise<MerchantAdminUserRow[]> => []);
  const userCount = vi.fn(async () => 0);
  const userUpdateMany = vi.fn(async () => ({ count: 1 }));

  const refreshTokenUpdateMany = vi.fn(async () => ({ count: 0 }));

  const opsUserFindUnique = vi.fn();
  const opsUserFindFirst = vi.fn(async () => null);
  const opsUserCreate = vi.fn();
  const opsUserUpdateMany = vi.fn(async () => ({ count: 1 }));

  const opsOtpChallengeFindUnique = vi.fn();
  const opsOtpChallengeCreate = vi.fn();
  const opsOtpChallengeUpdate = vi.fn();
  const opsOtpChallengeUpdateMany = vi.fn(async () => ({ count: 1 }));

  const opsConfigSecretFindMany = vi.fn(async () => []);
  const opsConfigSecretUpsert = vi.fn();

  const opsAuditLogFindFirst = vi.fn(async () => null);
  const opsAuditLogCreate = vi.fn(async () => ({}));

  const fastify = {
    prisma: {
      user: {
        findUnique: userFindUnique,
        findMany: userFindMany,
        count: userCount,
        updateMany: userUpdateMany
      },
      refreshToken: {
        updateMany: refreshTokenUpdateMany
      },
      opsUserInvite: {
        findUnique: opsUserInviteFindUnique,
        findFirst: opsUserInviteFindFirst,
        create: opsUserInviteCreate,
        update: opsUserInviteUpdate,
        updateMany: opsUserInviteUpdateMany,
        findMany: opsUserInviteFindMany,
        count: vi.fn(async () => 0)
      },
      opsUser: {
        findUnique: opsUserFindUnique,
        findFirst: opsUserFindFirst,
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        create: opsUserCreate,
        update: vi.fn(async () => ({})),
        updateMany: opsUserUpdateMany
      },
      opsOtpChallenge: {
        findUnique: opsOtpChallengeFindUnique,
        create: opsOtpChallengeCreate,
        update: opsOtpChallengeUpdate,
        updateMany: opsOtpChallengeUpdateMany
      },
      opsConfigSecret: {
        findMany: opsConfigSecretFindMany,
        upsert: opsConfigSecretUpsert
      },
      opsAuditLog: {
        findFirst: opsAuditLogFindFirst,
        create: opsAuditLogCreate,
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0)
      },
      // Durable maintenance/load-shed state singleton — accessed by
      // setLoadShedModeDirect (writeMaintenanceState) and getLoadShedStatus
      // (readMaintenanceState). Default to "no row exists" so the service
      // initialises from the legacy 'normal' default.
      maintenanceState: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({}))
      }
    },
    redis: {
      get: redisGet,
      set: redisSet,
      del: redisDel,
      incr: redisIncr,
      expire: redisExpire,
      eval: redisEval
    },
    queues: {
      notifications: {
        add: vi.fn(async () => undefined)
      },
      cartCleanup: {
        add: vi.fn(async () => undefined)
      }
    },
    log: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(() => ({
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn()
      }))
    }
  } as unknown as FastifyInstance;

  return {
    service: new OpsService(fastify),
    fastify,
    mocks: {
      redisSet,
      redisGet,
      redisDel,
      redisIncr,
      redisExpire,
      redisEval,
      opsUserInviteFindUnique,
      opsUserInviteFindFirst,
      opsUserInviteCreate,
      opsUserInviteUpdate,
      opsUserInviteUpdateMany,
      opsUserInviteFindMany,
      opsUserFindUnique,
      opsUserUpdateMany,
      userFindUnique,
      userFindMany,
      userCount,
      userUpdateMany,
      refreshTokenUpdateMany,
      opsUserFindFirst,
      opsUserCreate,
      opsOtpChallengeFindUnique,
      opsOtpChallengeCreate,
      opsOtpChallengeUpdate,
      opsOtpChallengeUpdateMany,
      opsConfigSecretFindMany,
      opsConfigSecretUpsert,
      opsAuditLogFindFirst,
      opsAuditLogCreate,
      notificationsAdd: (fastify as unknown as { queues: { notifications: { add: ReturnType<typeof vi.fn> } } }).queues.notifications.add
    }
  };
}

describe('OpsService cross-table email collision guards', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.OPS_DB_ENCRYPTION_KEY = 'test-ops-db-encryption-key';
    process.env.OPS_DB_ENCRYPTION_KEY_VERSION = '1';
  });

  it('createOpsInvite rejects when email is already a customer/admin User', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'customer_1', email: 'shared@example.com' });

    await expect(
      service.createOpsInvite({
        inviteEmail: 'shared@example.com',
        inviteName: 'Ops Person',
        permissions: ['OPS_READ'],
        ipAllowlist: [],
        setupBaseUrl: 'https://example.com',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/invites',
        method: 'POST'
      })
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.CONFLICT });

    expect(mocks.opsUserInviteCreate).not.toHaveBeenCalled();
  });

  it('createOpsInvite rejects deactivated merchant admin email with merchant-invite guidance', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mocks.userFindUnique.mockResolvedValueOnce({
      role: 'ADMIN',
      isBanned: true
    });

    await expect(
      service.createOpsInvite({
        inviteEmail: 'merchant@example.com',
        inviteName: 'Ops Person',
        permissions: ['OPS_READ'],
        ipAllowlist: [],
        setupBaseUrl: 'https://example.com',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/invites',
        method: 'POST'
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.CONFLICT,
      message: expect.stringContaining('merchant admin invite')
    });

    expect(mocks.opsUserInviteCreate).not.toHaveBeenCalled();
  });

  it('createOpsInvite rejects when email already exists as an OpsUser', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mocks.userFindUnique.mockResolvedValueOnce(null);
    mocks.opsUserFindUnique.mockResolvedValueOnce({ id: 'ops_1', email: 'shared@example.com' });

    await expect(
      service.createOpsInvite({
        inviteEmail: 'shared@example.com',
        inviteName: 'Ops Person',
        permissions: ['OPS_READ'],
        ipAllowlist: [],
        setupBaseUrl: 'https://example.com',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/invites',
        method: 'POST'
      })
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.CONFLICT });

    expect(mocks.opsUserInviteCreate).not.toHaveBeenCalled();
  });
});

describe('OpsService failcase coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('AUTH_DEV_BYPASS', 'false');
    process.env.OPS_DB_ENCRYPTION_KEY = 'test-ops-db-encryption-key';
    process.env.OPS_DB_ENCRYPTION_KEY_VERSION = '1';
  });

  it('consumeOpsInvite rejects expired invites and marks them EXPIRED_CLEANED', async () => {
    const { service, mocks } = createOpsServiceHarness();

    mocks.opsUserInviteFindUnique.mockResolvedValue({
      id: 'invite_1',
      inviteEmail: 'ops@example.com',
      inviteName: 'Ops User',
      status: 'CREATED',
      expiresAt: new Date(Date.now() - 1_000),
      ipAllowlist: ['203.0.113.10/32'],
      permissions: ['OPS_READ']
    });

    await expect(
      service.consumeOpsInvite({
        inviteToken: 'expired-token',
        otp: '123456',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/invites/consume',
        method: 'POST'
      })
    ).rejects.toMatchObject({
      code: ERROR_CODES.TOKEN_EXPIRED,
      statusCode: 401
    });

    expect(mocks.opsUserInviteUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'EXPIRED_CLEANED' }
      })
    );
  });

  it('verifyEmailOtp marks challenge failed after max attempts', async () => {
    const { service, mocks } = createOpsServiceHarness();

    const expectedCodeHash = crypto.createHash('sha256').update('654321').digest('hex');
    mocks.opsOtpChallengeFindUnique.mockResolvedValue({
      id: 'challenge_1',
      opsUserId: 'ops_1',
      status: 'PENDING',
      codeHash: expectedCodeHash,
      expiresAt: new Date(Date.now() + 60_000),
      failedAttempts: 2
    });

    await expect(
      service.verifyEmailOtp({
        opsUserId: 'ops_1',
        challengeId: 'challenge_1',
        code: '123456',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/otp/verify',
        method: 'POST'
      })
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_CREDENTIALS,
      statusCode: 401
    });

    expect(mocks.opsOtpChallengeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'challenge_1', status: 'PENDING' },
      data: {
        failedAttempts: 3,
        status: 'FAILED'
      }
    });
  });

  it('verifyEmailOtp accepts OTP input with non-digit separators', async () => {
    const { service, mocks } = createOpsServiceHarness();

    const expectedCodeHash = crypto.createHash('sha256').update('654321').digest('hex');
    mocks.opsOtpChallengeFindUnique.mockResolvedValue({
      id: 'challenge_spaced',
      opsUserId: 'ops_1',
      action: 'config-save',
      status: 'PENDING',
      codeHash: expectedCodeHash,
      expiresAt: new Date(Date.now() + 60_000),
      failedAttempts: 0
    });
    mocks.opsOtpChallengeUpdateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.verifyEmailOtp({
        opsUserId: 'ops_1',
        challengeId: 'challenge_spaced',
        code: '654 321',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/config/save',
        method: 'POST'
      })
    ).resolves.toEqual({ verified: true });
  });

  it('verifyEmailOtp allows idempotent retry for already VERIFIED challenge when code still matches', async () => {
    const { service, mocks } = createOpsServiceHarness();

    const expectedCodeHash = crypto.createHash('sha256').update('654321').digest('hex');
    mocks.opsOtpChallengeFindUnique.mockResolvedValue({
      id: 'challenge_verified',
      opsUserId: 'ops_1',
      action: 'system-restart',
      status: 'VERIFIED',
      codeHash: expectedCodeHash,
      expiresAt: new Date(Date.now() + 60_000),
      failedAttempts: 0
    });

    await expect(
      service.verifyEmailOtp({
        opsUserId: 'ops_1',
        challengeId: 'challenge_verified',
        code: '654321',
        expectedAction: 'system-restart',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/system/restart',
        method: 'POST'
      })
    ).resolves.toEqual({ verified: true });

    // No status transition needed; we intentionally reuse the verified challenge.
    expect(mocks.opsOtpChallengeUpdateMany).not.toHaveBeenCalled();
  });

  it('saveConfigDraft upserts only runtime overlay keys from contract', async () => {
    const { service, mocks } = createOpsServiceHarness();

    vi.spyOn(service, 'verifyEmailOtp').mockResolvedValue({ verified: true });
    vi.spyOn(service, 'validateConfigDraft').mockResolvedValue({
      valid: true,
      domain: 'payments',
      checkedKeys: ['RAZORPAY_KEY_ID', 'DATABASE_URL'],
      errors: [],
      warnings: [],
      requiresRestart: true
    });

    mocks.opsConfigSecretUpsert.mockResolvedValue({});

    const result = await service.saveConfigDraft({
      opsUserId: 'ops_1',
      domain: 'payments',
      values: {
        RAZORPAY_KEY_ID: 'rzp_live_abc',
        DATABASE_URL: 'postgres://should-not-be-managed'
      },
      challengeId: 'challenge_1',
      otpCode: '123456',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/config/save',
      method: 'POST'
    });

    expect(mocks.opsConfigSecretUpsert).toHaveBeenCalledTimes(1);
    expect(result.savedKeys).toEqual(['RAZORPAY_KEY_ID']);
  });

  it('validateConfigDraft rejects bootstrap-only keys', async () => {
    const { service } = createOpsServiceHarness();

    const result = await service.validateConfigDraft({
      opsUserId: 'ops_1',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/config/validate',
      method: 'POST',
      domain: 'core',
      values: {
        DATABASE_URL: 'postgres://should-not-be-managed'
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'DATABASE_URL',
        code: 'BOOTSTRAP_KEY_NOT_DB_APPLICABLE'
      })
    ]));
  });

  it('validateConfigDraft allows partial batch without unrelated required keys', async () => {
    const { service } = createOpsServiceHarness();

    const result = await service.validateConfigDraft({
      opsUserId: 'ops_1',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/config/validate',
      method: 'POST',
      domain: 'notifications',
      values: {
        NOTIFY_EMAIL_ENABLED: 'true'
      },
      skipAuditLog: true
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('validateConfigDraft allows saving a provider selector without full dependency set', async () => {
    const { service } = createOpsServiceHarness();

    const result = await service.validateConfigDraft({
      opsUserId: 'ops_1',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/config/validate',
      method: 'POST',
      domain: 'payments',
      values: {
        PAYMENT_PROVIDER: 'razorpay'
      },
      skipAuditLog: true
    });

    expect(result.valid).toBe(true);
    expect(result.errors).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MISSING_REQUIRED_KEY' })])
    );
  });

  it('createOpsInvite fails fast when notification queue send fails', async () => {
    const { service, mocks } = createOpsServiceHarness();

    mocks.opsUserInviteCreate.mockResolvedValue({ id: 'invite_1' });
    mocks.notificationsAdd.mockRejectedValue(new Error('queue-down'));

    await expect(
      service.createOpsInvite({
        createdByOpsUserId: 'ops_1',
        inviteEmail: 'ops@example.com',
        inviteName: 'Ops User',
        permissions: ['OPS_READ'],
        ipAllowlist: ['203.0.113.10/32'],
        setupBaseUrl: 'https://client.com',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/invites',
        method: 'POST'
      })
    ).rejects.toThrow('queue-down');

    expect(mocks.opsUserInviteUpdate).not.toHaveBeenCalled();
  });

  it('cleanupExpiredInvites bootstraps system audit actor when invite creator missing', async () => {
    const { service, mocks } = createOpsServiceHarness();

    mocks.opsUserInviteFindMany.mockResolvedValue([
      {
        id: 'invite_1',
        inviteEmail: 'ops@example.com',
        createdByOpsUserId: null
      }
    ]);

    mocks.opsUserFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ops_system_1', email: 'ops-system@local.internal' });

    mocks.opsUserCreate.mockResolvedValue({ id: 'ops_system_1' });

    await service.cleanupExpiredInvites({
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/invites/cleanup-expired',
      method: 'POST'
    });

    expect(mocks.opsUserCreate).toHaveBeenCalled();
    expect(mocks.opsAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opsUserId: 'ops_system_1',
          actionType: 'INVITE_EXPIRED_CLEANED'
        })
      })
    );
  });

  it('createOpsInvite resolves concurrent ops-system actor creation race safely', async () => {
    const { service, mocks } = createOpsServiceHarness();

    mocks.opsUserFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ops_system_existing' });
    mocks.opsUserCreate.mockRejectedValueOnce(new Error('unique constraint violation'));
    mocks.opsUserInviteCreate.mockResolvedValueOnce({
      id: 'invite_1',
      inviteEmail: 'ops@example.com',
      inviteName: 'Ops User',
      inviteTokenHash: 'hash',
      setupBaseUrl: 'https://example.com',
      status: 'CREATED',
      permissions: ['OPS_READ'],
      ipAllowlist: ['127.0.0.1/32'],
      expiresAt: new Date(Date.now() + 60_000),
      createdByOpsUserId: null
    });
    mocks.opsUserInviteUpdate.mockResolvedValueOnce({
      id: 'invite_1',
      inviteEmail: 'ops@example.com',
      inviteName: 'Ops User',
      inviteTokenHash: 'hash',
      setupBaseUrl: 'https://example.com',
      status: 'EMAIL_SENT',
      permissions: ['OPS_READ'],
      ipAllowlist: ['127.0.0.1/32'],
      expiresAt: new Date(Date.now() + 60_000),
      createdByOpsUserId: null
    });

    await service.createOpsInvite({
      inviteEmail: 'ops@example.com',
      inviteName: 'Ops User',
      setupBaseUrl: 'https://example.com',
      permissions: ['OPS_READ'],
      ipAllowlist: ['127.0.0.1/32'],
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/invites',
      method: 'POST'
    });

    expect(mocks.opsAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opsUserId: 'ops_system_existing',
          actionType: 'INVITE_CREATED'
        })
      })
    );
  });

  it('withOpsAuditChainLock releases lock after successful execution', async () => {
    const { service, mocks } = createOpsServiceHarness();
    const maybeWithOpsAuditChainLock = Reflect.get(service as object, 'withOpsAuditChainLock');
    if (typeof maybeWithOpsAuditChainLock !== 'function') {
      throw new Error('withOpsAuditChainLock is not available');
    }
    const withOpsAuditChainLock = (
      maybeWithOpsAuditChainLock as (this: OpsService, fn: () => Promise<unknown>) => Promise<unknown>
    ).bind(service) as <T>(fn: () => Promise<T>) => Promise<T>;

    const result = await withOpsAuditChainLock(async () => 'ok');

    expect(result).toBe('ok');
    expect(mocks.redisSet).toHaveBeenCalled();
    expect(mocks.redisEval).toHaveBeenCalled();
  });

  it('listOpsUsers returns paginated ops users', async () => {
    const { service, fastify } = createOpsServiceHarness();
    const opsUsersFindMany = (fastify as unknown as { prisma: { opsUser: { findMany: ReturnType<typeof vi.fn> } } }).prisma.opsUser.findMany;
    const opsUsersCount = (fastify as unknown as { prisma: { opsUser: { count: ReturnType<typeof vi.fn> } } }).prisma.opsUser.count;
    opsUsersFindMany.mockResolvedValueOnce([{
      id: 'ops_1',
      email: 'ops@example.com',
      name: 'Ops User',
      permissions: ['OPS_READ'],
      mfaEnabled: false,
      isActive: true,
      ipAllowlist: ['127.0.0.1/32'],
      lastLoginAt: null,
      createdAt: new Date('2024-01-01')
    }]);
    opsUsersCount.mockResolvedValueOnce(1);

    const result = await service.listOpsUsers({ page: 1, limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.email).toBe('ops@example.com');
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
  });

  it('deactivateOpsUser rejects self-deactivation', async () => {
    const { service, mocks } = createOpsServiceHarness();
    // Mock verifyEmailOtp to succeed before self-deactivation check
    mocks.opsOtpChallengeFindUnique.mockResolvedValueOnce({
      id: 'challenge_1',
      opsUserId: 'ops_1',
      action: 'user-deactivate',
      codeHash: hashOtp('123456'),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000),
      failedAttempts: 0
    });
    mocks.opsOtpChallengeUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      service.deactivateOpsUser({
        targetOpsUserId: 'ops_1',
        requestorOpsUserId: 'ops_1',
        reason: 'test',
        challengeId: 'challenge_1',
        otpCode: '123456',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/users/ops_1/deactivate',
        method: 'POST'
      })
    ).rejects.toMatchObject({ statusCode: 403, code: ERROR_CODES.FORBIDDEN });
  });

  it('deactivateOpsUser deactivates target and writes audit log', async () => {
    const { service, mocks } = createOpsServiceHarness();
    // Mock verifyEmailOtp
    mocks.opsOtpChallengeFindUnique.mockResolvedValueOnce({
      id: 'challenge_1',
      opsUserId: 'ops_requestor',
      action: 'user-deactivate',
      codeHash: hashOtp('123456'),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000),
      failedAttempts: 0
    });
    mocks.opsOtpChallengeUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.opsUserFindUnique.mockResolvedValueOnce({
      id: 'ops_target',
      email: 'target@example.com',
      name: 'Target',
      isActive: true,
      permissions: ['OPS_READ']
    });

    const result = await service.deactivateOpsUser({
      targetOpsUserId: 'ops_target',
      requestorOpsUserId: 'ops_requestor',
      reason: 'Security incident',
      challengeId: 'challenge_1',
      otpCode: '123456',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/users/ops_target/deactivate',
      method: 'POST'
    });

    expect(result).toEqual({ opsUserId: 'ops_target', deactivated: true });
    expect(mocks.opsAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actionType: 'USER_DEACTIVATED' })
      })
    );
  });

  it('listMerchantAdminUsers returns paginated merchant admins', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mocks.userFindMany.mockResolvedValueOnce([{
      id: 'admin_1',
      email: 'merchant@example.com',
      firstName: 'Merchant',
      lastName: 'Admin',
      phone: null,
      isBanned: false,
      isVerified: true,
      bannedAt: null,
      bannedReason: null,
      createdAt: new Date('2024-01-01'),
      adminPermissionGrants: [{ permission: 'orders:read' }]
    }]);
    mocks.userCount.mockResolvedValueOnce(1);

    const result = await service.listMerchantAdminUsers({ page: 1, limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.email).toBe('merchant@example.com');
    expect(result.items[0]!.isActive).toBe(true);
    expect(result.items[0]!.permissions).toEqual(['orders:read']);
  });

  it('deactivateMerchantAdminUser deactivates admin and revokes refresh tokens', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mocks.opsOtpChallengeFindUnique.mockResolvedValueOnce({
      id: 'challenge_1',
      opsUserId: 'ops_requestor',
      action: 'admin-user-deactivate',
      codeHash: hashOtp('123456'),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000),
      failedAttempts: 0
    });
    mocks.opsOtpChallengeUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'admin_target',
      email: 'merchant@example.com',
      role: 'ADMIN',
      isBanned: false,
      firstName: 'Merchant',
      lastName: 'Admin'
    });

    const result = await service.deactivateMerchantAdminUser({
      targetAdminUserId: 'admin_target',
      requestorOpsUserId: 'ops_requestor',
      reason: 'Offboarding contractor',
      challengeId: 'challenge_1',
      otpCode: '123456',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/admin-users/admin_target/deactivate',
      method: 'POST'
    });

    expect(result).toEqual({ adminUserId: 'admin_target', deactivated: true });
    expect(mocks.userUpdateMany).toHaveBeenCalled();
    expect(mocks.refreshTokenUpdateMany).toHaveBeenCalled();
    expect(mocks.opsAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'USER_DEACTIVATED',
          summary: expect.objectContaining({ targetType: 'merchant_admin' })
        })
      })
    );
  });

  it('requestLoginOtp returns generic message for unknown email (anti-enumeration)', async () => {
    const { service, mocks } = createOpsServiceHarness();
    // First call: email lookup → not found. Second call: system user lookup → not found.
    mocks.opsUserFindUnique.mockResolvedValue(null);
    // resolveAuditActorOpsUserId will try to create the system actor on first bootstrap.
    mocks.opsUserCreate.mockResolvedValueOnce({ id: 'sys_actor' });

    const result = await service.requestLoginOtp({ email: 'unknown@example.com', requestIp: '127.0.0.1' });

    expect(result.message).toMatch(/OTP has been sent/);
    expect(mocks.notificationsAdd).not.toHaveBeenCalled();
  });

  it('requestLoginOtp sends OTP email for valid active ops user', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mocks.opsUserFindUnique.mockResolvedValueOnce({
      id: 'ops_1',
      email: 'ops@example.com',
      name: 'Ops User',
      isActive: true
    });
    mocks.redisSet.mockResolvedValue('OK');

    const result = await service.requestLoginOtp({ email: 'ops@example.com', requestIp: '127.0.0.1' });

    expect(result.message).toMatch(/OTP has been sent/);
    expect(mocks.notificationsAdd).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({ to: 'ops@example.com', template: 'OpsActionOtp' }),
      expect.any(Object)
    );
  });

  it('verifyLoginOtp throws on unknown or expired OTP', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mocks.redisGet.mockResolvedValueOnce(null);

    await expect(
      service.verifyLoginOtp({
        email: 'ops@example.com',
        otp: '123456',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/auth/login/verify-otp',
        method: 'POST'
      })
    ).rejects.toMatchObject({ statusCode: 401, code: ERROR_CODES.INVALID_CREDENTIALS });
  });

  it('verifyLoginOtp issues session token on correct OTP', async () => {
    const { service, mocks } = createOpsServiceHarness();
    const otp = '654321';
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    mocks.redisGet.mockResolvedValueOnce(`ops_1||${otpHash}`);
    mocks.opsUserFindUnique.mockResolvedValueOnce({
      id: 'ops_1',
      email: 'ops@example.com',
      name: 'Ops User',
      permissions: ['OPS_READ'],
      isActive: true,
      ipAllowlist: []
    });
    mocks.redisSet.mockResolvedValue('OK');

    const result = await service.verifyLoginOtp({
      email: 'ops@example.com',
      otp,
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/auth/login/verify-otp',
      method: 'POST'
    });

    expect(result.sessionToken).toMatch(/^opssess_/);
    expect(result.opsUserId).toBe('ops_1');
    expect(result.email).toBe('ops@example.com');
    expect(mocks.opsAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actionType: 'OPS_USER_LOGGED_IN' })
      })
    );
  });

  it('scheduleRestart queues job in cartCleanup and writes audit log', async () => {
    const { service, fastify, mocks } = createOpsServiceHarness();
    const cartCleanupAdd = (fastify as unknown as { queues: { cartCleanup: { add: ReturnType<typeof vi.fn> } } }).queues.cartCleanup.add;
    // Mock verifyEmailOtp
    mocks.opsOtpChallengeFindUnique.mockResolvedValueOnce({
      id: 'challenge_1',
      opsUserId: 'ops_1',
      action: 'system-restart',
      codeHash: hashOtp('123456'),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000),
      failedAttempts: 0
    });
    mocks.opsOtpChallengeUpdateMany.mockResolvedValueOnce({ count: 1 });

    const result = await service.scheduleRestart({
      opsUserId: 'ops_1',
      delayMinutes: 5,
      challengeId: 'challenge_1',
      otpCode: '123456',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/system/restart',
      method: 'POST'
    });

    expect(result.jobId).toMatch(/^ops-restart-/);
    expect(result.scheduledFor).toBeTruthy();
    expect(cartCleanupAdd).toHaveBeenCalledWith(
      'scheduled-process-restart',
      expect.objectContaining({ requestedBy: 'ops_1' }),
      expect.objectContaining({ delay: 5 * 60_000 })
    );
    expect(mocks.redisSet).toHaveBeenCalledWith(LOAD_SHED_MODE_KEY, 'emergency');
    expect(mocks.opsAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actionType: 'CONTAINER_RESTART' })
      })
    );
  });

  it('scheduleRestart wraps enqueue failure in structured AppError and rolls back load-shed', async () => {
    const { service, fastify, mocks } = createOpsServiceHarness();
    const cartCleanupAdd = (fastify as unknown as { queues: { cartCleanup: { add: ReturnType<typeof vi.fn> } } }).queues.cartCleanup.add;
    cartCleanupAdd.mockRejectedValueOnce(new Error('Redis ECONNREFUSED'));
    mocks.opsOtpChallengeFindUnique.mockResolvedValueOnce({
      id: 'challenge_2',
      opsUserId: 'ops_1',
      action: 'system-restart',
      codeHash: hashOtp('654321'),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000),
      failedAttempts: 0
    });
    mocks.opsOtpChallengeUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.redisGet.mockResolvedValueOnce('normal');

    const alertSpy = vi.spyOn(alertModule, 'sendTechnicalFailureAlert').mockResolvedValue(undefined);
    afterEach(() => vi.restoreAllMocks());

    await expect(
      service.scheduleRestart({
        opsUserId: 'ops_1',
        delayMinutes: 0,
        challengeId: 'challenge_2',
        otpCode: '654321',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/system/restart',
        method: 'POST'
      })
    ).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
      statusCode: 503,
      details: expect.objectContaining({
        hintKey: 'ops_restart_enqueue_failed',
        retryable: true
      })
    });

    expect(mocks.redisSet).toHaveBeenCalledWith(LOAD_SHED_MODE_KEY, 'emergency');
    expect(mocks.redisSet).toHaveBeenCalledWith(LOAD_SHED_MODE_KEY, 'normal');
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        failureStage: 'QUEUE_ENQUEUE',
        template: 'ScheduledRestartEnqueue',
        queueName: 'cart-cleanup'
      })
    );
  });

  it('createOpsInvite rejects when active invite already exists for email (Gap 8)', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mocks.userFindUnique.mockResolvedValueOnce(null);
    mocks.opsUserFindUnique.mockResolvedValueOnce(null);
    mocks.opsUserInviteFindFirst.mockResolvedValueOnce({
      id: 'existing_invite',
      inviteEmail: 'ops@example.com',
      status: 'CREATED'
    });

    await expect(
      service.createOpsInvite({
        inviteEmail: 'ops@example.com',
        inviteName: 'Ops Person',
        permissions: ['OPS_READ'],
        ipAllowlist: [],
        setupBaseUrl: 'https://example.com',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/invites',
        method: 'POST'
      })
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.CONFLICT });

    expect(mocks.opsUserInviteCreate).not.toHaveBeenCalled();
  });

  it('rejects createOpsInvite when setupBaseUrl points to loopback (SSRF guard)', async () => {
    const { service, mocks } = createOpsServiceHarness();

    await expect(
      service.createOpsInvite({
        inviteEmail: 'ops@example.com',
        inviteName: 'Ops Person',
        permissions: ['OPS_READ'],
        ipAllowlist: [],
        setupBaseUrl: 'https://127.0.0.1',
        requestIp: '127.0.0.1',
        requestPath: '/api/v1/ops/invites',
        method: 'POST'
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('not permitted')
    });

    expect(mocks.opsUserInviteCreate).not.toHaveBeenCalled();
  });

  it('cleanupExpiredInvites attributes audit log to actorOpsUserId when provided (Gap 2)', async () => {
    const { service, mocks } = createOpsServiceHarness();

    mocks.opsUserInviteFindMany.mockResolvedValue([
      { id: 'invite_a', inviteEmail: 'old@example.com', createdByOpsUserId: 'some_creator' }
    ]);
    mocks.opsUserFindUnique.mockResolvedValueOnce({ id: 'ops_actor', email: 'actor@example.com' });

    await service.cleanupExpiredInvites({
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/invites/cleanup-expired',
      method: 'POST',
      actorOpsUserId: 'ops_actor'
    });

    expect(mocks.opsAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opsUserId: 'ops_actor',
          actionType: 'INVITE_EXPIRED_CLEANED'
        })
      })
    );
  });

  it('requestLoginOtp writes FAILED audit log for unknown email without leaking info (Gap 3)', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mocks.opsUserFindUnique.mockResolvedValueOnce(null);
    mocks.opsUserCreate.mockResolvedValueOnce({ id: 'sys_actor' });

    const result = await service.requestLoginOtp({ email: 'ghost@example.com', requestIp: '10.0.0.1' });

    expect(result.message).toMatch(/OTP has been sent/);
    expect(mocks.notificationsAdd).not.toHaveBeenCalled();
    expect(mocks.opsAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'OTP_CHALLENGE_REQUESTED',
          actionStatus: 'FAILED'
        })
      })
    );
  });

  it('requestLoginOtp writes EXECUTED audit log for valid active ops user (Gap 3)', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mocks.opsUserFindUnique.mockResolvedValueOnce({
      id: 'ops_1',
      email: 'ops@example.com',
      name: 'Ops User',
      isActive: true
    });
    mocks.redisSet.mockResolvedValue('OK');

    await service.requestLoginOtp({ email: 'ops@example.com', requestIp: '10.0.0.1' });

    expect(mocks.opsAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opsUserId: 'ops_1',
          actionType: 'OTP_CHALLENGE_REQUESTED',
          actionStatus: 'EXECUTED'
        })
      })
    );
  });

  it('verifyLoginOtp session payload does NOT include ip field (Gap 1)', async () => {
    const { service, mocks } = createOpsServiceHarness();
    const otp = '999888';
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    mocks.redisGet.mockResolvedValueOnce(`ops_1||${otpHash}`);
    mocks.opsUserFindUnique.mockResolvedValueOnce({
      id: 'ops_1',
      email: 'ops@example.com',
      name: 'Ops User',
      permissions: ['OPS_READ'],
      isActive: true,
      ipAllowlist: []
    });
    mocks.redisSet.mockResolvedValue('OK');

    await service.verifyLoginOtp({
      email: 'ops@example.com',
      otp,
      requestIp: '10.0.0.1',
      requestPath: '/api/v1/ops/auth/login/verify-otp',
      method: 'POST'
    });

    const setCall = mocks.redisSet.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).startsWith('ops:browser-session:')
    ) as [string, string, ...unknown[]] | undefined;
    expect(setCall).toBeDefined();
    const sessionPayload = JSON.parse(setCall![1]) as Record<string, unknown>;
    expect(sessionPayload).not.toHaveProperty('ip');
    expect(sessionPayload).toHaveProperty('opsUserId', 'ops_1');
    expect(sessionPayload).toHaveProperty('email', 'ops@example.com');
  });

  it('withOpsAuditChainLock fails fast when lock cannot be acquired within timeout window', async () => {
    const { service, mocks } = createOpsServiceHarness();
    const maybeWithOpsAuditChainLock = Reflect.get(service as object, 'withOpsAuditChainLock');
    if (typeof maybeWithOpsAuditChainLock !== 'function') {
      throw new Error('withOpsAuditChainLock is not available');
    }
    const withOpsAuditChainLock = (
      maybeWithOpsAuditChainLock as (this: OpsService, fn: () => Promise<unknown>) => Promise<unknown>
    ).bind(service) as <T>(fn: () => Promise<T>) => Promise<T>;

    mocks.redisSet.mockResolvedValue(undefined as unknown as string);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(2_001);

    await expect(withOpsAuditChainLock(async () => 'never')).rejects.toMatchObject({
      message: 'Timed out acquiring ops audit chain lock',
      statusCode: 503,
      code: 'INTERNAL_ERROR'
    });
    expect(mocks.redisEval).not.toHaveBeenCalled();
  });

  it('revokeOpsInvite revokes pending invite after OTP verification', async () => {
    const { service, mocks } = createOpsServiceHarness();
    // Mock verifyEmailOtp
    mocks.opsOtpChallengeFindUnique.mockResolvedValueOnce({
      id: 'challenge_1',
      opsUserId: 'ops_1',
      action: 'invite-revoke',
      codeHash: hashOtp('123456'),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000),
      failedAttempts: 0
    });
    mocks.opsOtpChallengeUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.opsUserInviteFindUnique.mockResolvedValueOnce({
      id: 'invite_1',
      inviteEmail: 'newops@example.com',
      status: 'CREATED',
      expiresAt: new Date(Date.now() + 600000)
    });
    mocks.opsUserInviteUpdateMany.mockResolvedValueOnce({ count: 1 });

    const result = await service.revokeOpsInvite({
      inviteId: 'invite_1',
      revokerOpsUserId: 'ops_1',
      challengeId: 'challenge_1',
      otpCode: '123456',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/invites/invite_1/revoke',
      method: 'POST'
    });

    expect(result).toEqual({ inviteId: 'invite_1', revoked: true });
    expect(mocks.opsAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actionType: 'INVITE_REVOKED' })
      })
    );
  });

  it('setLoadShedModeDirect changes mode after OTP verification and writes audit log', async () => {
    const { service, mocks } = createOpsServiceHarness();
    // Mock verifyEmailOtp
    mocks.opsOtpChallengeFindUnique.mockResolvedValueOnce({
      id: 'challenge_1',
      opsUserId: 'ops_1',
      action: 'load-shed-change',
      codeHash: hashOtp('123456'),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000),
      failedAttempts: 0
    });
    mocks.opsOtpChallengeUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.redisSet.mockResolvedValue('OK');

    // Need to pass a Fastify request object for setLoadShedMode — must include server.redis.set
    const mockRequest = {
      id: 'req_1',
      server: { redis: { set: mocks.redisSet } }
    } as unknown as import('fastify').FastifyRequest;

    const result = await service.setLoadShedModeDirect({
      request: mockRequest,
      requesterId: 'ops_1',
      mode: 'reduced',
      reason: 'High traffic spike detected',
      challengeId: 'challenge_1',
      otpCode: '123456',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/load-shed',
      method: 'POST'
    });

    expect(result.mode).toBe('reduced');
    expect(result.updated).toBe(true);
    expect(mocks.opsAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actionType: 'LOAD_SHED_CHANGE' })
      })
    );
  });

  it('setLoadShedModeDirect(maintenance) starts pending phase + enqueues activation job', async () => {
    const { service, mocks, fastify } = createOpsServiceHarness();
    mocks.opsOtpChallengeFindUnique.mockResolvedValueOnce({
      id: 'challenge_1',
      opsUserId: 'ops_1',
      action: 'load-shed-change',
      codeHash: hashOtp('123456'),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000),
      failedAttempts: 0
    });
    mocks.opsOtpChallengeUpdateMany.mockResolvedValueOnce({ count: 1 });

    const cartCleanupAdd = (fastify as unknown as {
      queues: { cartCleanup: { add: ReturnType<typeof vi.fn> } };
    }).queues.cartCleanup.add;
    const maintenanceUpsert = (fastify as unknown as {
      prisma: { maintenanceState: { upsert: ReturnType<typeof vi.fn> } };
    }).prisma.maintenanceState.upsert;

    const mockRequest = {
      id: 'req_2',
      server: { redis: { set: mocks.redisSet } }
    } as unknown as import('fastify').FastifyRequest;

    const result = await service.setLoadShedModeDirect({
      request: mockRequest,
      requesterId: 'ops_1',
      mode: 'maintenance',
      reason: 'Planned downtime for DB migration',
      challengeId: 'challenge_1',
      otpCode: '123456',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/load-shed',
      method: 'POST'
    });

    expect(result.mode).toBe('maintenance');
    expect(result.phase).toBe('pending');
    expect(result.pendingUntil).not.toBeNull();
    // pendingUntil must be ~120s in the future (DEFAULT_MAINTENANCE_PENDING_WINDOW_MS)
    if (result.pendingUntil) {
      const diff = new Date(result.pendingUntil).getTime() - Date.now();
      expect(diff).toBeGreaterThan(115_000);
      expect(diff).toBeLessThan(125_000);
    }

    // Durable row was written with mode='maintenance', phase='pending'
    expect(maintenanceUpsert).toHaveBeenCalledTimes(1);
    const upsertCall = maintenanceUpsert.mock.calls[0];
    if (!upsertCall) throw new Error('maintenanceState.upsert was not called');
    const upsertArgs = upsertCall[0] as { create: { mode: string; phase: string | null } };
    expect(upsertArgs.create.mode).toBe('maintenance');
    expect(upsertArgs.create.phase).toBe('pending');

    // Activation job was enqueued with a delay of 120s
    expect(cartCleanupAdd).toHaveBeenCalledWith(
      'maintenance-activation',
      expect.objectContaining({ requestedBy: 'ops_1' }),
      expect.objectContaining({ delay: expect.any(Number) })
    );
    const enqueueCall = cartCleanupAdd.mock.calls[0];
    if (!enqueueCall) throw new Error('cartCleanup.add was not called');
    const enqueueOpts = enqueueCall[2] as { delay: number };
    expect(enqueueOpts.delay).toBeGreaterThan(115_000);
    expect(enqueueOpts.delay).toBeLessThan(125_000);
  });

  it('setLoadShedModeDirect(maintenance) loud-fails (log + tech alert) when cartCleanup queue is missing', async () => {
    // Regression: previously, a missing cartCleanup queue caused the
    // maintenance-activation enqueue to be silently skipped. The state row
    // was written, the operator's request returned success, but the worker
    // never picked up the cutover and the site sat in `pending` for the
    // full 7-min read-side self-heal grace. Now the missing-queue case
    // emits a loud log + tech alert so ops sees it immediately, while still
    // writing the durable state (read-side fast-promote will recover).
    const { service, mocks, fastify } = createOpsServiceHarness();
    mocks.opsOtpChallengeFindUnique.mockResolvedValueOnce({
      id: 'challenge_lf',
      opsUserId: 'ops_1',
      action: 'load-shed-change',
      codeHash: hashOtp('345678'),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      failedAttempts: 0
    });
    mocks.opsOtpChallengeUpdateMany.mockResolvedValueOnce({ count: 1 });

    // Remove the cartCleanup queue from fastify.queues to simulate a boot
    // where the BullMQ plugin failed to register.
    (fastify as unknown as { queues: Record<string, unknown> }).queues.cartCleanup = undefined;

    const logErrorSpy = vi.spyOn(fastify.log, 'error');
    const alertSpy = vi
      .spyOn(alertModule, 'sendTechnicalFailureAlert')
      .mockResolvedValue(undefined);

    const mockRequest = {
      id: 'req_lf',
      server: { redis: { set: mocks.redisSet } }
    } as unknown as import('fastify').FastifyRequest;

    const result = await service.setLoadShedModeDirect({
      request: mockRequest,
      requesterId: 'ops_1',
      mode: 'maintenance',
      reason: 'Loud-fail regression test',
      challengeId: 'challenge_lf',
      otpCode: '345678',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/load-shed',
      method: 'POST'
    });

    // Operator's intent is still recorded — the durable state was written.
    expect(result.mode).toBe('maintenance');
    expect(result.phase).toBe('pending');
    expect(result.pendingUntil).toBeTruthy();

    // Loud-fail: error logged + technical alert dispatched.
    expect(logErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ opsUserId: 'ops_1' }),
      expect.stringContaining('fastify.queues.cartCleanup is undefined')
    );
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        failureStage: 'QUEUE_ENQUEUE',
        template: 'MaintenanceActivationEnqueue',
        component: 'maintenance-activation'
      })
    );

    vi.restoreAllMocks();
  });

  it('setLoadShedModeDirect(normal) exits maintenance and clears phase/pendingUntil', async () => {
    const { service, mocks, fastify } = createOpsServiceHarness();
    mocks.opsOtpChallengeFindUnique.mockResolvedValueOnce({
      id: 'challenge_2',
      opsUserId: 'ops_1',
      action: 'load-shed-change',
      codeHash: hashOtp('234567'),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000),
      failedAttempts: 0
    });
    mocks.opsOtpChallengeUpdateMany.mockResolvedValueOnce({ count: 1 });

    // Existing maintenance/active row in DB.
    (fastify as unknown as {
      prisma: { maintenanceState: { findUnique: ReturnType<typeof vi.fn> } };
    }).prisma.maintenanceState.findUnique.mockResolvedValueOnce({
      mode: 'maintenance',
      phase: 'active',
      pendingUntil: null,
      activatedAt: new Date(),
      reason: 'previous',
      setByOpsUserId: 'ops_other',
      setAt: new Date(),
      updatedAt: new Date()
    });

    const maintenanceUpsert = (fastify as unknown as {
      prisma: { maintenanceState: { upsert: ReturnType<typeof vi.fn> } };
    }).prisma.maintenanceState.upsert;
    const cartCleanupAdd = (fastify as unknown as {
      queues: { cartCleanup: { add: ReturnType<typeof vi.fn> } };
    }).queues.cartCleanup.add;

    const mockRequest = {
      id: 'req_3',
      server: { redis: { set: mocks.redisSet } }
    } as unknown as import('fastify').FastifyRequest;

    const result = await service.setLoadShedModeDirect({
      request: mockRequest,
      requesterId: 'ops_1',
      mode: 'normal',
      reason: 'Maintenance window completed',
      challengeId: 'challenge_2',
      otpCode: '234567',
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/load-shed',
      method: 'POST'
    });

    expect(result.mode).toBe('normal');
    expect(result.phase).toBeNull();
    expect(result.pendingUntil).toBeNull();

    // Phase/pendingUntil/activatedAt are explicitly cleared on the upsert
    expect(maintenanceUpsert).toHaveBeenCalledTimes(1);
    const upsertCall = maintenanceUpsert.mock.calls[0];
    if (!upsertCall) throw new Error('maintenanceState.upsert was not called');
    const upsertArgs = upsertCall[0] as {
      update: { mode: string; phase: string | null; pendingUntil: Date | null; activatedAt: Date | null };
    };
    expect(upsertArgs.update.mode).toBe('normal');
    expect(upsertArgs.update.phase).toBeNull();
    expect(upsertArgs.update.pendingUntil).toBeNull();
    expect(upsertArgs.update.activatedAt).toBeNull();

    // No activation job enqueued when exiting maintenance.
    expect(cartCleanupAdd).not.toHaveBeenCalled();
  });

  it('getLoadShedStatus returns full snapshot (mode + phase + pendingUntil)', async () => {
    const { service, fastify } = createOpsServiceHarness();
    (fastify as unknown as {
      prisma: { maintenanceState: { findUnique: ReturnType<typeof vi.fn> } };
    }).prisma.maintenanceState.findUnique.mockResolvedValueOnce({
      mode: 'maintenance',
      phase: 'pending',
      pendingUntil: new Date('2030-01-01T00:02:00Z'),
      activatedAt: null,
      reason: 'planned',
      setByOpsUserId: 'ops_1',
      setAt: new Date('2030-01-01T00:00:00Z'),
      updatedAt: new Date('2030-01-01T00:00:00Z')
    });

    const snapshot = await service.getLoadShedStatus();
    expect(snapshot.mode).toBe('maintenance');
    expect(snapshot.phase).toBe('pending');
    expect(snapshot.pendingUntil).toBe('2030-01-01T00:02:00.000Z');
    expect(snapshot.reason).toBe('planned');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getStoredConfigSecrets — returns plaintextValue for EVERY active row
// (including real secrets — see ops.service.ts JSDoc for the deliberate
// operator-UX choice that overrides the generic admin-UI masking rule).
// ─────────────────────────────────────────────────────────────────────────────
describe('OpsService.getStoredConfigSecrets', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.OPS_DB_ENCRYPTION_KEY = 'test-ops-db-encryption-key';
    process.env.OPS_DB_ENCRYPTION_KEY_VERSION = '1';
  });

  type ConfigSecretRow = {
    domain: 'CORE' | 'PAYMENTS' | 'SHIPPING' | 'NOTIFICATIONS' | 'OPS_SECURITY';
    secretKey: string;
    encryptedValue: string;
    keyVersion: number;
    requiresRestart: boolean;
    updatedAt: Date;
  };

  function makeRow(domain: ConfigSecretRow['domain'], key: string, plain: string): ConfigSecretRow {
    return {
      domain,
      secretKey: key,
      encryptedValue: encryptOpsConfigValue(plain),
      keyVersion: 1,
      requiresRestart: true,
      updatedAt: new Date('2026-05-25T10:00:00.000Z')
    };
  }

  // Helper that casts to satisfy the harness's `never[]`-inferred mock default
  // — the harness intentionally defaults `opsConfigSecretFindMany` to
  // `vi.fn(async () => [])`, which narrows the generic to `never[]`. These
  // tests need to return real rows for assertions; the cast is bounded to
  // test code and remains type-safe via the `ConfigSecretRow` shape.
  function mockRows(mock: ReturnType<typeof vi.fn>, rows: ConfigSecretRow[]): void {
    mock.mockResolvedValueOnce(rows as unknown as never);
  }

  it('returns plaintextValue for non-secret keys (provider selectors, URLs, integer thresholds)', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mockRows(mocks.opsConfigSecretFindMany, [
      makeRow('SHIPPING', 'SHIPPING_PROVIDER', 'shiprocket'),
      makeRow('SHIPPING', 'SHIPROCKET_BASE_URL', 'https://apiv2.shiprocket.in/v1/external'),
      makeRow('SHIPPING', 'SHIPROCKET_WEBHOOK_MAX_SKEW_SECONDS', '300'),
      makeRow('SHIPPING', 'SHIPROCKET_PICKUP_PINCODE', '500001')
    ]);

    const items = await service.getStoredConfigSecrets('shipping');

    expect(items).toHaveLength(4);
    expect(items.find((i) => i.key === 'SHIPPING_PROVIDER')).toMatchObject({
      key: 'SHIPPING_PROVIDER',
      plaintextValue: 'shiprocket',
      maskedValue: expect.any(String)
    });
    expect(items.find((i) => i.key === 'SHIPROCKET_BASE_URL')).toMatchObject({
      plaintextValue: 'https://apiv2.shiprocket.in/v1/external'
    });
    expect(items.find((i) => i.key === 'SHIPROCKET_WEBHOOK_MAX_SKEW_SECONDS')).toMatchObject({
      plaintextValue: '300'
    });
    expect(items.find((i) => i.key === 'SHIPROCKET_PICKUP_PINCODE')).toMatchObject({
      plaintextValue: '500001'
    });
  });

  it('ALSO returns plaintextValue for real secret keys (passwords, tokens, API keys) — deliberate ops-UX policy', async () => {
    const { service, mocks } = createOpsServiceHarness();
    const secretPassword = 'super-secret-password-for-operator-to-see';
    const secretApiKey = 're_test_actual_api_key_value';
    const secretToken = 'shiprocket-webhook-bearer-token';

    mockRows(mocks.opsConfigSecretFindMany, [
      makeRow('SHIPPING', 'SHIPROCKET_PASSWORD', secretPassword),
      makeRow('NOTIFICATIONS', 'RESEND_API_KEY', secretApiKey),
      makeRow('SHIPPING', 'SHIPROCKET_WEBHOOK_TOKEN', secretToken)
    ]);

    const items = await service.getStoredConfigSecrets();

    const password = items.find((i) => i.key === 'SHIPROCKET_PASSWORD');
    const apiKey = items.find((i) => i.key === 'RESEND_API_KEY');
    const token = items.find((i) => i.key === 'SHIPROCKET_WEBHOOK_TOKEN');

    // maskedValue is still computed for every row (used by list/summary views).
    expect(password?.maskedValue).toBe(maskSecretValue(secretPassword));
    expect(apiKey?.maskedValue).toBe(maskSecretValue(secretApiKey));
    expect(token?.maskedValue).toBe(maskSecretValue(secretToken));

    // plaintextValue is ALSO returned for secrets — this is the deliberate
    // operator-UX policy. The Ops console is platform-operator-only behind
    // ops login + OTP + audit chain logging; masking secrets here would only
    // make the editor unusable without buying any real defense (anyone who
    // can reach this response already has ops:read on a backend that holds
    // OPS_DB_ENCRYPTION_KEY).
    expect(password?.plaintextValue).toBe(secretPassword);
    expect(apiKey?.plaintextValue).toBe(secretApiKey);
    expect(token?.plaintextValue).toBe(secretToken);
  });

  it('returns plaintextValue for the documented early-return non-secret keys (RAZORPAY_KEY_ID, RESEND_FROM, SHIPROCKET_EMAIL)', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mockRows(mocks.opsConfigSecretFindMany, [
      makeRow('PAYMENTS', 'RAZORPAY_KEY_ID', 'rzp_test_public_id_123'),
      makeRow('NOTIFICATIONS', 'RESEND_FROM', 'noreply@store.example.com'),
      makeRow('SHIPPING', 'SHIPROCKET_EMAIL', 'shipping-account@store.example.com')
    ]);

    const items = await service.getStoredConfigSecrets();

    expect(items.find((i) => i.key === 'RAZORPAY_KEY_ID')).toMatchObject({
      plaintextValue: 'rzp_test_public_id_123'
    });
    expect(items.find((i) => i.key === 'RESEND_FROM')).toMatchObject({
      plaintextValue: 'noreply@store.example.com'
    });
    expect(items.find((i) => i.key === 'SHIPROCKET_EMAIL')).toMatchObject({
      plaintextValue: 'shipping-account@store.example.com'
    });
  });

  it('returns BOTH plaintextValue and maskedValue for every secret-suffix pattern (_SECRET / _APP_SECRET / _PASSWORD / _AUTH_KEY)', async () => {
    const { service, mocks } = createOpsServiceHarness();
    const fixtures: Array<[Parameters<typeof makeRow>[0], string, string]> = [
      ['CORE', 'JWT_SECRET', 'jwt-signing-secret-32chars'],
      ['PAYMENTS', 'RAZORPAY_WEBHOOK_SECRET', 'razorpay-webhook-secret'],
      ['NOTIFICATIONS', 'META_WHATSAPP_APP_SECRET', 'whatsapp-app-secret'],
      ['NOTIFICATIONS', 'MSG91_AUTH_KEY', 'msg91-auth-key-12345']
    ];
    mockRows(
      mocks.opsConfigSecretFindMany,
      fixtures.map(([domain, key, value]) => makeRow(domain, key, value))
    );

    const items = await service.getStoredConfigSecrets();

    for (const [, key, value] of fixtures) {
      const item = items.find((i) => i.key === key);
      expect(item).toBeDefined();
      // Every row carries the plaintext value the operator entered.
      expect(item?.plaintextValue).toBe(value);
      // And the masked form alongside (used by list/summary views).
      expect(item?.maskedValue).toBe(maskSecretValue(value));
    }
  });

  it('correctly distinguishes _SECONDS suffix from _SECRET pattern (regression guard)', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mockRows(mocks.opsConfigSecretFindMany, [
      makeRow('SHIPPING', 'SHIPROCKET_WEBHOOK_MAX_SKEW_SECONDS', '300'),
      makeRow('SHIPPING', 'DELHIVERY_WEBHOOK_MAX_SKEW_SECONDS', '180')
    ]);

    const items = await service.getStoredConfigSecrets();

    // These end in _SECONDS — must NOT be confused with _SECRET and must
    // return plaintextValue so the operator sees the actual numeric value
    // in the Ops Config editor field.
    expect(items.find((i) => i.key === 'SHIPROCKET_WEBHOOK_MAX_SKEW_SECONDS')).toMatchObject({
      plaintextValue: '300'
    });
    expect(items.find((i) => i.key === 'DELHIVERY_WEBHOOK_MAX_SKEW_SECONDS')).toMatchObject({
      plaintextValue: '180'
    });
  });

  it('preserves domain filtering — domain parameter passed through to prisma query', async () => {
    const { service, mocks } = createOpsServiceHarness();
    mockRows(mocks.opsConfigSecretFindMany, []);

    await service.getStoredConfigSecrets('payments');

    expect(mocks.opsConfigSecretFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ domain: 'PAYMENTS' })
      })
    );
  });
});
