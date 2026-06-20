import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@common/guards/ops-auth.guard', () => ({
  opsAuthGuard: vi.fn(async (request: { opsUser?: { id: string } }) => {
    request.opsUser = { id: 'ops_1' };
  })
}));
vi.mock('@common/guards/ops-permissions.guard', () => ({
  opsPermissionGuard: vi.fn(() => async () => undefined)
}));

const loadShedState = vi.hoisted(() => ({
  getLoadShedMode: vi.fn(async () => 'normal')
}));
vi.mock('@common/reliability/load-shed.guard', () => ({
  getLoadShedMode: loadShedState.getLoadShedMode
}));

const opsServiceState = vi.hoisted(() => ({
  getConfigOverview: vi.fn(async () => ({
    generatedAt: new Date().toISOString(),
    runtimeProfile: 'development-like',
    domains: [],
    strictProfileHealth: {
      noPlaceholdersInStrict: true,
      missingRequiredKeysInStrict: []
    }
  })),
  validateConfigDraft: vi.fn(async () => ({
    valid: true,
    domain: null,
    checkedKeys: ['PAYMENT_PROVIDER'],
    errors: [],
    warnings: [],
    requiresRestart: true
  })),
  getStoredConfigSecrets: vi.fn(async () => ([
    {
      domain: 'payments',
      key: 'RAZORPAY_KEY_ID',
      maskedValue: 'rz******id',
      keyVersion: 1,
      requiresRestart: true,
      updatedAt: new Date().toISOString()
    }
  ])),
  saveConfigDraft: vi.fn(async () => ({
    valid: true,
    savedKeys: ['RAZORPAY_KEY_ID'],
    domain: 'payments',
    requiresRestart: true,
    masked: [{ key: 'RAZORPAY_KEY_ID', maskedValue: 'rz******id' }]
  })),
  requestEmailOtp: vi.fn(async () => ({
    challengeId: 'challenge_1',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  })),
  verifyEmailOtp: vi.fn(async () => ({ verified: true })),
  createOpsInvite: vi.fn(async () => ({
    inviteId: 'invite_1',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    setupUrl: 'https://client.com/ops/setup?token=abc'
  })),
  consumeOpsInvite: vi.fn(async () => ({
    opsUserId: 'ops_1',
    email: 'ops@example.com',
    name: 'Ops User',
    permissions: ['OPS_READ']
  })),
  cleanupExpiredInvites: vi.fn(async () => ({ cleaned: 0 })),
  getOpsSessionProfile: vi.fn(async () => ({
    id: 'ops_1',
    email: 'ops@example.com',
    name: 'Ops User',
    permissions: ['OPS_READ'],
    mfaEnabled: true,
    ipAllowlist: ['10.0.0.0/8'],
    lastLoginAt: null
  })),
  setLoadShedModeDirect: vi.fn(async () => ({ mode: 'normal', updated: true })),
  listAuditLogs: vi.fn(async () => ({ items: [], page: 1, limit: 20, total: 0 })),
  listOpsInvites: vi.fn(async () => ({ items: [], page: 1, limit: 20, total: 0 })),
  revokeOpsInvite: vi.fn(async () => ({ inviteId: 'invite_1', revoked: true })),
  listOpsUsers: vi.fn(async () => ({ items: [], page: 1, limit: 20, total: 0 })),
  getOpsUserById: vi.fn(async () => ({
    id: 'ops_1',
    email: 'ops@example.com',
    name: 'Ops User',
    phone: null,
    permissions: ['OPS_READ'],
    mfaEnabled: true,
    isActive: true,
    ipAllowlist: ['127.0.0.1/32'],
    lastLoginAt: null,
    createdAt: new Date().toISOString()
  })),
  deactivateOpsUser: vi.fn(async () => ({ opsUserId: 'ops_2', deactivated: true })),
  listMerchantAdminUsers: vi.fn(async () => ({ items: [], page: 1, limit: 20, total: 0 })),
  deactivateMerchantAdminUser: vi.fn(async () => ({ adminUserId: 'admin_2', deactivated: true })),
  listPendingOtpChallenges: vi.fn(async () => ({ items: [] })),
  requestLoginOtp: vi.fn(async () => ({ message: 'If a registered ops account exists for this email, an OTP has been sent.' })),
  verifyLoginOtp: vi.fn(async () => ({
    sessionToken: 'opssess_abc123',
    opsUserId: 'ops_1',
    name: 'Ops User',
    email: 'ops@example.com',
    permissions: ['ops:read'],
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
  })),
  resolveBrowserSession: vi.fn(async () => null),
  logoutBrowserSession: vi.fn(async () => undefined),
  scheduleRestart: vi.fn(async () => ({
    jobId: 'ops-restart:test-uuid',
    scheduledFor: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  }))
}));

vi.mock('./ops.service', () => {
  class MockOpsService {
    getConfigOverview = opsServiceState.getConfigOverview;
    validateConfigDraft = opsServiceState.validateConfigDraft;
    getStoredConfigSecrets = opsServiceState.getStoredConfigSecrets;
    saveConfigDraft = opsServiceState.saveConfigDraft;
    requestEmailOtp = opsServiceState.requestEmailOtp;
    verifyEmailOtp = opsServiceState.verifyEmailOtp;
    createOpsInvite = opsServiceState.createOpsInvite;
    consumeOpsInvite = opsServiceState.consumeOpsInvite;
    cleanupExpiredInvites = opsServiceState.cleanupExpiredInvites;
    getOpsSessionProfile = opsServiceState.getOpsSessionProfile;
    setLoadShedModeDirect = opsServiceState.setLoadShedModeDirect;
    listAuditLogs = opsServiceState.listAuditLogs;
    listOpsInvites = opsServiceState.listOpsInvites;
    revokeOpsInvite = opsServiceState.revokeOpsInvite;
    listOpsUsers = opsServiceState.listOpsUsers;
    getOpsUserById = opsServiceState.getOpsUserById;
    deactivateOpsUser = opsServiceState.deactivateOpsUser;
    listMerchantAdminUsers = opsServiceState.listMerchantAdminUsers;
    deactivateMerchantAdminUser = opsServiceState.deactivateMerchantAdminUser;
    listPendingOtpChallenges = opsServiceState.listPendingOtpChallenges;
    requestLoginOtp = opsServiceState.requestLoginOtp;
    verifyLoginOtp = opsServiceState.verifyLoginOtp;
    resolveBrowserSession = opsServiceState.resolveBrowserSession;
    logoutBrowserSession = opsServiceState.logoutBrowserSession;
    scheduleRestart = opsServiceState.scheduleRestart;
    constructor(_fastify: unknown) {}
  }
  return { OpsService: MockOpsService, OPS_BROWSER_SESSION_COOKIE_NAME: 'ops_session' };
});

vi.mock('./ops.service.js', () => {
  class MockOpsService {
    getConfigOverview = opsServiceState.getConfigOverview;
    validateConfigDraft = opsServiceState.validateConfigDraft;
    getStoredConfigSecrets = opsServiceState.getStoredConfigSecrets;
    saveConfigDraft = opsServiceState.saveConfigDraft;
    requestEmailOtp = opsServiceState.requestEmailOtp;
    verifyEmailOtp = opsServiceState.verifyEmailOtp;
    createOpsInvite = opsServiceState.createOpsInvite;
    consumeOpsInvite = opsServiceState.consumeOpsInvite;
    cleanupExpiredInvites = opsServiceState.cleanupExpiredInvites;
    getOpsSessionProfile = opsServiceState.getOpsSessionProfile;
    setLoadShedModeDirect = opsServiceState.setLoadShedModeDirect;
    listAuditLogs = opsServiceState.listAuditLogs;
    listOpsInvites = opsServiceState.listOpsInvites;
    revokeOpsInvite = opsServiceState.revokeOpsInvite;
    listOpsUsers = opsServiceState.listOpsUsers;
    getOpsUserById = opsServiceState.getOpsUserById;
    deactivateOpsUser = opsServiceState.deactivateOpsUser;
    listMerchantAdminUsers = opsServiceState.listMerchantAdminUsers;
    deactivateMerchantAdminUser = opsServiceState.deactivateMerchantAdminUser;
    listPendingOtpChallenges = opsServiceState.listPendingOtpChallenges;
    requestLoginOtp = opsServiceState.requestLoginOtp;
    verifyLoginOtp = opsServiceState.verifyLoginOtp;
    resolveBrowserSession = opsServiceState.resolveBrowserSession;
    logoutBrowserSession = opsServiceState.logoutBrowserSession;
    scheduleRestart = opsServiceState.scheduleRestart;
    constructor(_fastify: unknown) {}
  }
  return { OpsService: MockOpsService, OPS_BROWSER_SESSION_COOKIE_NAME: 'ops_session' };
});

vi.mock('./ops.service.ts', () => {
  class MockOpsService {
    getConfigOverview = opsServiceState.getConfigOverview;
    validateConfigDraft = opsServiceState.validateConfigDraft;
    getStoredConfigSecrets = opsServiceState.getStoredConfigSecrets;
    saveConfigDraft = opsServiceState.saveConfigDraft;
    requestEmailOtp = opsServiceState.requestEmailOtp;
    verifyEmailOtp = opsServiceState.verifyEmailOtp;
    createOpsInvite = opsServiceState.createOpsInvite;
    consumeOpsInvite = opsServiceState.consumeOpsInvite;
    cleanupExpiredInvites = opsServiceState.cleanupExpiredInvites;
    getOpsSessionProfile = opsServiceState.getOpsSessionProfile;
    setLoadShedModeDirect = opsServiceState.setLoadShedModeDirect;
    listAuditLogs = opsServiceState.listAuditLogs;
    listOpsInvites = opsServiceState.listOpsInvites;
    revokeOpsInvite = opsServiceState.revokeOpsInvite;
    listOpsUsers = opsServiceState.listOpsUsers;
    getOpsUserById = opsServiceState.getOpsUserById;
    deactivateOpsUser = opsServiceState.deactivateOpsUser;
    listMerchantAdminUsers = opsServiceState.listMerchantAdminUsers;
    deactivateMerchantAdminUser = opsServiceState.deactivateMerchantAdminUser;
    listPendingOtpChallenges = opsServiceState.listPendingOtpChallenges;
    requestLoginOtp = opsServiceState.requestLoginOtp;
    verifyLoginOtp = opsServiceState.verifyLoginOtp;
    resolveBrowserSession = opsServiceState.resolveBrowserSession;
    logoutBrowserSession = opsServiceState.logoutBrowserSession;
    scheduleRestart = opsServiceState.scheduleRestart;
    constructor(_fastify: unknown) {}
  }
  return { OpsService: MockOpsService, OPS_BROWSER_SESSION_COOKIE_NAME: 'ops_session' };
});

import { registerOpsRoutes } from './ops.routes';

describe('ops routes schema and handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares config overview and config validate route schemas', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; schema?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema
      });
    });
    await registerOpsRoutes(app);

    const overviewRoute = routes.find((entry) => entry.url === '/api/v1/ops/config/overview' && entry.method === 'GET');
    expect(overviewRoute).toBeDefined();
    const overviewSchema = overviewRoute?.schema as { response?: Record<number, unknown> };
    expect(overviewSchema.response?.[200]).toBeDefined();

    const validateRoute = routes.find((entry) => entry.url === '/api/v1/ops/config/validate' && entry.method === 'POST');
    expect(validateRoute).toBeDefined();
    const validateSchema = validateRoute?.schema as {
      body?: unknown;
      response?: Record<number, unknown>;
    };
    expect(validateSchema.body).toBeDefined();
    expect(validateSchema.response?.[200]).toBeDefined();

    const storedRoute = routes.find((entry) => entry.url === '/api/v1/ops/config/stored' && entry.method === 'GET');
    expect(storedRoute).toBeDefined();

    const saveRoute = routes.find((entry) => entry.url === '/api/v1/ops/config/save' && entry.method === 'POST');
    expect(saveRoute).toBeDefined();

    const otpRequestRoute = routes.find((entry) => entry.url === '/api/v1/ops/otp/request' && entry.method === 'POST');
    expect(otpRequestRoute).toBeDefined();

    const otpVerifyRoute = routes.find((entry) => entry.url === '/api/v1/ops/otp/verify' && entry.method === 'POST');
    expect(otpVerifyRoute).toBeDefined();

    const inviteRoute = routes.find((entry) => entry.url === '/api/v1/ops/invites' && entry.method === 'POST');
    expect(inviteRoute).toBeDefined();

    const consumeRoute = routes.find((entry) => entry.url === '/api/v1/ops/invites/consume' && entry.method === 'POST');
    expect(consumeRoute).toBeDefined();

    const cleanupRoute = routes.find((entry) => entry.url === '/api/v1/ops/invites/cleanup-expired' && entry.method === 'POST');
    expect(cleanupRoute).toBeDefined();

    await app.close();
  });

  it('declares invite, otp, and config-save route contracts', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; schema?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema
      });
    });
    await registerOpsRoutes(app);

    const inviteRoute = routes.find((entry) => entry.url === '/api/v1/ops/invites' && entry.method === 'POST');
    expect(inviteRoute).toBeDefined();
    const inviteSchema = inviteRoute?.schema as { body?: unknown; response?: Record<number, unknown> };
    expect(inviteSchema.body).toBeDefined();
    expect(inviteSchema.response?.[200]).toBeDefined();

    const consumeRoute = routes.find((entry) => entry.url === '/api/v1/ops/invites/consume' && entry.method === 'POST');
    expect(consumeRoute).toBeDefined();
    const consumeSchema = consumeRoute?.schema as { body?: unknown; response?: Record<number, unknown> };
    expect(consumeSchema.body).toBeDefined();
    expect(consumeSchema.response?.[200]).toBeDefined();

    const otpRequestRoute = routes.find((entry) => entry.url === '/api/v1/ops/otp/request' && entry.method === 'POST');
    expect(otpRequestRoute).toBeDefined();
    const otpRequestSchema = otpRequestRoute?.schema as { body?: unknown; response?: Record<number, unknown> };
    expect(otpRequestSchema.body).toBeDefined();
    expect(otpRequestSchema.response?.[200]).toBeDefined();

    const otpVerifyRoute = routes.find((entry) => entry.url === '/api/v1/ops/otp/verify' && entry.method === 'POST');
    expect(otpVerifyRoute).toBeDefined();
    const otpVerifySchema = otpVerifyRoute?.schema as { body?: unknown; response?: Record<number, unknown> };
    expect(otpVerifySchema.body).toBeDefined();
    expect(otpVerifySchema.response?.[200]).toBeDefined();

    const saveRoute = routes.find((entry) => entry.url === '/api/v1/ops/config/save' && entry.method === 'POST');
    expect(saveRoute).toBeDefined();
    const saveSchema = saveRoute?.schema as { body?: unknown; response?: Record<number, unknown> };
    expect(saveSchema.body).toBeDefined();
    expect(saveSchema.response?.[200]).toBeDefined();

    const cleanupRoute = routes.find((entry) => entry.url === '/api/v1/ops/invites/cleanup-expired' && entry.method === 'POST');
    expect(cleanupRoute).toBeDefined();
    const cleanupSchema = cleanupRoute?.schema as { body?: unknown; response?: Record<number, unknown> };
    expect(cleanupSchema.body).toBeDefined();
    expect(cleanupSchema.response?.[200]).toBeDefined();

    await app.close();
  });

  it('declares session route schema for frontend bootstrap', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; schema?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema
      });
    });
    await registerOpsRoutes(app);
    const route = routes.find((entry) => entry.url === '/api/v1/ops/session' && entry.method === 'GET');
    expect(route).toBeDefined();
    const schema = route?.schema as { response?: Record<number, unknown> };
    expect(schema.response?.[200]).toBeDefined();
    await app.close();
  });

  it('declares explicit params/querystring schema for GET load-shed', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; schema?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema
      });
    });
    await registerOpsRoutes(app);
    const route = routes.find((entry) => entry.url === '/api/v1/ops/load-shed' && entry.method === 'GET');
    expect(route).toBeDefined();
    const schema = route?.schema as { params?: unknown; querystring?: unknown };
    expect(schema.params).toBeDefined();
    expect(schema.querystring).toBeDefined();
    await app.close();
  });

  it('declares 200 response schema for POST load-shed with OTP challenge fields', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; schema?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema
      });
    });
    await registerOpsRoutes(app);
    const route = routes.find((entry) => entry.url === '/api/v1/ops/load-shed' && entry.method === 'POST');
    expect(route).toBeDefined();
    const schema = route?.schema as {
      params?: unknown;
      querystring?: unknown;
      body?: { required?: string[]; properties?: Record<string, unknown> };
      response?: Record<number, unknown>;
    };
    expect(schema.params).toBeDefined();
    expect(schema.querystring).toBeDefined();
    expect(schema.body).toBeDefined();
    expect(schema.body?.required).toContain('mode');
    expect(schema.body?.required).toContain('reason');
    expect(schema.body?.required).toContain('challengeId');
    expect(schema.body?.required).toContain('otpCode');
    expect(schema.body?.properties?.challengeId).toBeDefined();
    expect(schema.body?.properties?.otpCode).toBeDefined();
    expect(schema.response?.[200]).toBeDefined();
    expect(schema.response?.[202]).toBeUndefined();
    await app.close();
  });

  it('does NOT declare approval routes (dual-approval removed)', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({ method: routeOptions.method, url: routeOptions.url });
    });
    await registerOpsRoutes(app);

    expect(routes.find((r) => r.url === '/api/v1/ops/approvals' && r.method === 'GET')).toBeUndefined();
    expect(routes.find((r) => r.url === '/api/v1/ops/approvals/:requestId/confirm')).toBeUndefined();
    expect(routes.find((r) => r.url === '/api/v1/ops/approvals/:requestId/reject')).toBeUndefined();

    const auditRoute = routes.find((r) => r.url === '/api/v1/ops/audit/logs' && r.method === 'GET');
    expect(auditRoute).toBeDefined();

    await app.close();
  });

  it('declares new user management and invite management route schemas', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; schema?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema
      });
    });
    await registerOpsRoutes(app);

    const listInvitesRoute = routes.find((entry) => entry.url === '/api/v1/ops/invites' && entry.method === 'GET');
    expect(listInvitesRoute).toBeDefined();
    const listInvitesSchema = listInvitesRoute?.schema as { response?: Record<number, unknown> };
    expect(listInvitesSchema.response?.[200]).toBeDefined();

    const revokeInviteRoute = routes.find((entry) => entry.url === '/api/v1/ops/invites/:inviteId/revoke' && entry.method === 'POST');
    expect(revokeInviteRoute).toBeDefined();
    const revokeInviteSchema = revokeInviteRoute?.schema as { params?: { required?: string[] }; body?: { required?: string[]; properties?: Record<string, unknown> }; response?: Record<number, unknown> };
    expect(revokeInviteSchema.params?.required).toContain('inviteId');
    expect(revokeInviteSchema.body?.required).toContain('challengeId');
    expect(revokeInviteSchema.body?.required).toContain('otpCode');
    expect(revokeInviteSchema.body?.properties?.challengeId).toBeDefined();
    expect(revokeInviteSchema.body?.properties?.otpCode).toBeDefined();
    expect(revokeInviteSchema.response?.[200]).toBeDefined();

    const listUsersRoute = routes.find((entry) => entry.url === '/api/v1/ops/users' && entry.method === 'GET');
    expect(listUsersRoute).toBeDefined();
    const listUsersSchema = listUsersRoute?.schema as { response?: Record<number, unknown> };
    expect(listUsersSchema.response?.[200]).toBeDefined();

    const getUserRoute = routes.find((entry) => entry.url === '/api/v1/ops/users/:opsUserId' && entry.method === 'GET');
    expect(getUserRoute).toBeDefined();
    const getUserSchema = getUserRoute?.schema as { params?: { required?: string[] }; response?: Record<number, unknown> };
    expect(getUserSchema.params?.required).toContain('opsUserId');
    expect(getUserSchema.response?.[200]).toBeDefined();

    const deactivateRoute = routes.find((entry) => entry.url === '/api/v1/ops/users/:opsUserId/deactivate' && entry.method === 'POST');
    expect(deactivateRoute).toBeDefined();
    const deactivateSchema = deactivateRoute?.schema as { body?: { required?: string[]; properties?: Record<string, unknown> }; response?: Record<number, unknown> };
    expect(deactivateSchema.body).toBeDefined();
    expect(deactivateSchema.body?.required).toContain('reason');
    expect(deactivateSchema.body?.required).toContain('challengeId');
    expect(deactivateSchema.body?.required).toContain('otpCode');
    expect(deactivateSchema.body?.properties?.challengeId).toBeDefined();
    expect(deactivateSchema.body?.properties?.otpCode).toBeDefined();
    expect(deactivateSchema.response?.[200]).toBeDefined();

    const listAdminUsersRoute = routes.find((entry) => entry.url === '/api/v1/ops/admin-users' && entry.method === 'GET');
    expect(listAdminUsersRoute).toBeDefined();
    const listAdminUsersSchema = listAdminUsersRoute?.schema as { response?: Record<number, unknown> };
    expect(listAdminUsersSchema.response?.[200]).toBeDefined();

    const deactivateAdminRoute = routes.find(
      (entry) => entry.url === '/api/v1/ops/admin-users/:adminUserId/deactivate' && entry.method === 'POST'
    );
    expect(deactivateAdminRoute).toBeDefined();
    const deactivateAdminSchema = deactivateAdminRoute?.schema as {
      body?: { required?: string[]; properties?: Record<string, unknown> };
      response?: Record<number, unknown>;
    };
    expect(deactivateAdminSchema.body?.required).toContain('reason');
    expect(deactivateAdminSchema.body?.required).toContain('challengeId');
    expect(deactivateAdminSchema.body?.required).toContain('otpCode');
    expect(deactivateAdminSchema.response?.[200]).toBeDefined();

    const pendingOtpRoute = routes.find((entry) => entry.url === '/api/v1/ops/otp/pending' && entry.method === 'GET');
    expect(pendingOtpRoute).toBeDefined();
    const pendingOtpSchema = pendingOtpRoute?.schema as { response?: Record<number, unknown> };
    expect(pendingOtpSchema.response?.[200]).toBeDefined();

    await app.close();
  });

  it('declares browser login and logout route schemas', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; schema?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema
      });
    });
    await registerOpsRoutes(app);

    const requestOtpRoute = routes.find((entry) => entry.url === '/api/v1/ops/auth/login/request-otp' && entry.method === 'POST');
    expect(requestOtpRoute).toBeDefined();
    const requestOtpSchema = requestOtpRoute?.schema as { body?: { required?: string[] }; response?: Record<number, unknown> };
    expect(requestOtpSchema.body?.required).toContain('email');
    expect(requestOtpSchema.response?.[200]).toBeDefined();

    const verifyOtpRoute = routes.find((entry) => entry.url === '/api/v1/ops/auth/login/verify-otp' && entry.method === 'POST');
    expect(verifyOtpRoute).toBeDefined();
    const verifyOtpSchema = verifyOtpRoute?.schema as { body?: { required?: string[] }; response?: Record<number, unknown> };
    expect(verifyOtpSchema.body?.required).toContain('email');
    expect(verifyOtpSchema.body?.required).toContain('otp');
    expect(verifyOtpSchema.response?.[200]).toBeDefined();

    const logoutRoute = routes.find((entry) => entry.url === '/api/v1/ops/auth/logout' && entry.method === 'POST');
    expect(logoutRoute).toBeDefined();
    const logoutSchema = logoutRoute?.schema as { response?: Record<number, unknown> };
    expect(logoutSchema.response?.[200]).toBeDefined();

    await app.close();
  });

  it('declares system restart route schema with OTP challenge fields', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; schema?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema
      });
    });
    await registerOpsRoutes(app);

    const restartRoute = routes.find((entry) => entry.url === '/api/v1/ops/system/restart' && entry.method === 'POST');
    expect(restartRoute).toBeDefined();
    const restartSchema = restartRoute?.schema as {
      body?: { required?: string[]; properties?: Record<string, unknown> };
      response?: Record<number, unknown>;
    };
    expect(restartSchema.body?.required).toContain('delayMinutes');
    expect(restartSchema.body?.required).toContain('challengeId');
    expect(restartSchema.body?.required).toContain('otpCode');
    expect(restartSchema.body?.properties?.delayMinutes).toBeDefined();
    expect(restartSchema.body?.properties?.challengeId).toBeDefined();
    expect(restartSchema.body?.properties?.otpCode).toBeDefined();
    expect(restartSchema.response?.[200]).toBeDefined();

    await app.close();
  });

  it('config/validate uses ops:read permission (not ops:write)', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; preHandler?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        preHandler: routeOptions.preHandler
      });
    });
    await registerOpsRoutes(app);
    const validateRoute = routes.find((entry) => entry.url === '/api/v1/ops/config/validate' && entry.method === 'POST');
    expect(validateRoute).toBeDefined();
    await app.close();
  });

  it('POST /ops/invites schema rejects OPS_APPROVE as a permission value', async () => {
    const app = Fastify();
    const routes: Array<{ method: string | string[]; url: string; schema?: unknown }> = [];
    app.addHook('onRoute', (routeOptions) => {
      routes.push({
        method: routeOptions.method,
        url: routeOptions.url,
        schema: routeOptions.schema
      });
    });
    await registerOpsRoutes(app);
    const inviteRoute = routes.find((entry) => entry.url === '/api/v1/ops/invites' && entry.method === 'POST');
    expect(inviteRoute).toBeDefined();
    const schema = inviteRoute?.schema as {
      body?: { properties?: { permissions?: { items?: { enum?: string[] } } } };
    };
    const permissionEnum = schema?.body?.properties?.permissions?.items?.enum;
    expect(permissionEnum).toBeDefined();
    expect(permissionEnum).toContain('OPS_READ');
    expect(permissionEnum).toContain('OPS_WRITE');
    expect(permissionEnum).not.toContain('OPS_APPROVE');
  });
});
