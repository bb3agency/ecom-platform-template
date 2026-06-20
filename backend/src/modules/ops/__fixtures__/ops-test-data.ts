/**
 * Test data factories for ops module E2E and unit tests.
 * Provides deterministic, reusable test data with sensible defaults.
 */

import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { vi } from 'vitest';

export const testDataFactory = {
  /**
   * Creates a test ops user with both mandatory permissions (OPS_READ, OPS_WRITE).
   */
  opsUser: (overrides?: Record<string, any>) => ({
    id: `test_ops_${nanoid()}`,
    email: `test-ops-${Date.now()}@test.local`,
    name: 'Test Ops User',
    passwordHash: 'hashed_password_not_checked_in_tests',
    permissions: ['OPS_READ', 'OPS_WRITE'],
    mfaEnabled: false,
    ipAllowlist: ['127.0.0.1/32', '::1'],
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }),

  /**
   * Creates a test ops browser session cookie record.
   */
  opsBrowserSession: (overrides?: Record<string, any>) => ({
    id: `sess_${nanoid()}`,
    opsUserId: `test_ops_${nanoid()}`,
    cookieValue: crypto.randomBytes(32).toString('hex'),
    ipAddress: '127.0.0.1',
    userAgent: 'Test/1.0',
    expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour
    createdAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides
  }),

  /**
   * Creates a test OTP challenge for critical ops actions.
   * Note: codeHash is the SHA256 hash of a 6-digit code, never plaintext.
   */
  opsOtpChallenge: (overrides?: Record<string, any>) => {
    const code = crypto.randomInt(100000, 999999).toString();
    const codeHash = crypto.createHash('sha256').update(code.trim()).digest('hex');

    return {
      id: `challenge_${nanoid()}`,
      opsUserId: `test_ops_${nanoid()}`,
      action: 'config-save',
      codeHash,
      status: 'PENDING' as const,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      verifiedAt: null,
      failedAttempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      _testCode: code, // For test use only, never in real DB
      ...overrides
    };
  },

  /**
   * Creates a test encrypted config secret for Ops DB config storage.
   */
  opsConfigSecret: (overrides?: Record<string, any>) => {
    const plaintext = 'test-secret-key-' + nanoid();
    // Simple mock encryption: prepend version marker
    const encryptedValue = `v1:${Buffer.from(plaintext).toString('hex')}`;

    return {
      id: `secret_${nanoid()}`,
      opsUserId: `test_ops_${nanoid()}`,
      domain: 'payments',
      secretKey: 'RAZORPAY_KEY_ID',
      encryptedValue,
      keyVersion: 1,
      requiresRestart: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      _testPlaintext: plaintext, // For test use only
      ...overrides
    };
  },

  /**
   * Creates a test audit log entry with chain hash.
   */
  opsAuditLog: (overrides?: Record<string, any>) => {
    const id = `audit_${nanoid()}`;
    // Simplified chain: sha256(timestamp + id) for tests
    const chainHash = crypto
      .createHash('sha256')
      .update(`${Date.now()}:${id}`)
      .digest('hex');

    return {
      id,
      opsUserId: `test_ops_${nanoid()}`,
      actionType: 'ENV_UPDATE',
      actionStatus: 'EXECUTED',
      requestId: `req_${nanoid()}`,
      requestIp: '127.0.0.1',
      requestPath: '/api/v1/ops/config/save',
      method: 'POST',
      chainHash,
      previousChainHash: null,
      summary: {
        keysUpdated: ['RAZORPAY_KEY_ID'],
        domain: 'payments'
      },
      createdAt: new Date(),
      ...overrides
    };
  },

  /**
   * Creates a test invite token record (email + setup OTP).
   */
  opsInvite: (overrides?: Record<string, any>) => {
    const token = crypto.randomBytes(16).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    return {
      id: `invite_${nanoid()}`,
      createdByOpsUserId: `test_ops_${nanoid()}`,
      email: `newops-${Date.now()}@test.local`,
      tokenHash,
      status: 'PENDING' as const,
      permissions: ['OPS_READ', 'OPS_WRITE'],
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      consumedAt: null,
      consumedByOpsUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      _testToken: token, // For test use only
      ...overrides
    };
  },

  /**
   * Creates a test merchant admin user (for deactivation testing).
   */
  merchantAdminUser: (overrides?: Record<string, any>) => ({
    id: `admin_${nanoid()}`,
    clientId: 'test_client',
    email: `admin-${Date.now()}@example.com`,
    name: 'Test Admin User',
    passwordHash: 'hashed_password_not_checked_in_tests',
    isBanned: false,
    bannedAt: null,
    bannedReason: null,
    permissions: ['products:read', 'orders:read'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }),

  /**
   * Creates a test maintenance state record.
   */
  maintenanceState: (overrides?: Record<string, any>) => ({
    id: 'maintenance',
    mode: 'pending' as const,
    pendingUntil: new Date(Date.now() + 2 * 60 * 1000), // 2 minutes
    activatedAt: null,
    reason: 'Database migration in progress',
    createdBy: `test_ops_${nanoid()}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }),

  /**
   * Creates a mock request object for testing guards/handlers.
   */
  mockRequest: (overrides?: Record<string, any>) => ({
    id: `req_${nanoid()}`,
    path: '/api/v1/ops/config/overview',
    method: 'GET',
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'Test/1.0',
      'x-forwarded-for': '127.0.0.1'
    },
    opsUser: null,
    opsPermissions: ['OPS_READ'],
    raw: {
      req: { socket: { remoteAddress: '127.0.0.1' } }
    },
    ...overrides
  }),

  /**
   * Constants for OTP testing.
   */
  otpConstants: {
    validCode: '123456',
    invalidCode: '000000',
    expiredOtpTtlSeconds: 600, // 10 minutes
    maxAttempts: 3,
    codeFormat: /^\d{6}$/ // 6 digits
  },

  /**
   * Constants for rate limiting testing.
   */
  rateLimitConstants: {
    opsReadBaseLimit: 10,
    opsCriticalBaseLimit: 2,
    normalModeFactor: 1.0,
    reducedModeFactor: 0.5,
    emergencyModeFactor: 0.3,
    maintenanceModeFactor: 0.1,
    windowSeconds: 60
  },

  /**
   * Generates a valid encrypted config secret (used in integration tests).
   */
  generateEncryptedSecret: (plaintext: string): string => {
    // In tests: simple encryption is just hex encoding with version prefix
    // Real implementation uses AES-256-GCM
    return `v1:${Buffer.from(plaintext).toString('hex')}`;
  },

  /**
   * Generates a valid OTP code hash for verification testing.
   */
  generateOtpCodeHash: (code: string): string => {
    return crypto.createHash('sha256').update(code.trim()).digest('hex');
  },

  /**
   * Helper: Simulates time advancement for TTL testing.
   */
  advanceTime: (_milliseconds: number): void => {
    // In real tests, use jest.useFakeTimers() + jest.advanceTimersByTime()
    // This is a placeholder for documentation
    console.warn(
      'advanceTime called: use test framework (vitest) to mock time:',
      'vi.useFakeTimers(), vi.advanceTimersByTime()'
    );
  },

  /**
   * Helper: Creates a mock Redis client for testing (can be replaced with real Redis in E2E).
   */
  createMockRedis: () => {
    const store = new Map<string, any>();
    return {
      set: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
        return 'OK';
      }),
      get: vi.fn(async (key: string) => {
        return store.get(key) || null;
      }),
      del: vi.fn(async (key: string) => {
        const had = store.has(key);
        store.delete(key);
        return had ? 1 : 0;
      }),
      incr: vi.fn(async (key: string) => {
        const current = (store.get(key) as number) || 0;
        const next = current + 1;
        store.set(key, next);
        return next;
      }),
      expire: vi.fn(async (_key: string, _seconds: number) => {
        // Mock TTL (not enforced)
        return 1;
      }),
      flushdb: vi.fn(async () => {
        store.clear();
        return 'OK';
      })
    };
  }
};

/**
 * Quick reference: Common test scenarios
 */
export const testScenarios = {
  /**
   * Happy path: Ops user logs in, requests config save, provides correct OTP.
   */
  configSaveWithValidOtp: () => ({
    opsUser: testDataFactory.opsUser({ permissions: ['OPS_READ', 'OPS_WRITE'] }),
    challenge: testDataFactory.opsOtpChallenge({ action: 'config-save' }),
    auditLog: testDataFactory.opsAuditLog({
      actionType: 'ENV_UPDATE',
      actionStatus: 'EXECUTED'
    })
  }),

  /**
   * Sad path: User provides wrong OTP 3 times, challenge locks.
   */
  otpBruteForceLocking: () => ({
    opsUser: testDataFactory.opsUser(),
    challenge: testDataFactory.opsOtpChallenge({ status: 'PENDING' }),
    failedAttempts: [
      testDataFactory.opsAuditLog({ actionType: 'OTP_CHALLENGE_FAILED' }),
      testDataFactory.opsAuditLog({ actionType: 'OTP_CHALLENGE_FAILED' }),
      testDataFactory.opsAuditLog({ actionType: 'OTP_CHALLENGE_FAILED' })
    ]
  }),

  /**
   * Permission denied: OPS_READ user tries to edit config.
   */
  permissionDeniedReadOnly: () => ({
    opsUser: testDataFactory.opsUser({ permissions: ['OPS_READ'] }), // Only read
    auditLog: testDataFactory.opsAuditLog({
      actionType: 'ENV_UPDATE',
      actionStatus: 'FAILED',
      summary: { reason: 'Permission denied' }
    })
  }),

  /**
   * Rate limit exceeded: User fires 11+ requests in 60 seconds.
   */
  rateLimitExceeded: () => ({
    opsUser: testDataFactory.opsUser(),
    requests: Array.from({ length: 11 }, (_, i) =>
      testDataFactory.mockRequest({
        path: '/api/v1/ops/config/overview',
        requestNumber: i + 1
      })
    ),
    result: { statusCode: 429, code: 'RATE_LIMIT_EXCEEDED' }
  }),

  /**
   * Maintenance mode active: Storefront blocked, ops allowed.
   */
  maintenanceActive: () => ({
    maintenanceState: testDataFactory.maintenanceState({
      mode: 'active',
      pendingUntil: null,
      activatedAt: new Date()
    }),
    opsUser: testDataFactory.opsUser(),
    opsAllowed: true,
    storefrontBlocked: true
  })
};
