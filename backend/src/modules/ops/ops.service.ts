import crypto from 'crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { getAuthDevOtp, isAuthDevBypassEnabled } from '@common/auth/auth-dev-bypass';
import { assertTurnstileToken } from '@common/auth/turnstile-verify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { invalidateLoadShedProcessCache, LOAD_SHED_MODE_KEY, setLoadShedMode, setLoadShedModeViaRedis } from '@common/reliability/load-shed.guard';
import {
  DEFAULT_MAINTENANCE_PENDING_WINDOW_MS,
  invalidateMaintenanceProcessCache,
  readMaintenanceState,
  writeMaintenanceState,
  type LoadShedModeWithMaintenance,
  type MaintenancePhase,
  type MaintenanceStatePrismaLike,
  type MaintenanceStateRedisLike,
  type MaintenanceStateRecord
} from '@common/reliability/maintenance-state';
import { decryptOpsConfigValue, encryptOpsConfigValue, maskSecretValue, resolveOpsEncryptionKeyVersion } from '@common/security/ops-config-crypto';
import { validateSetupBaseUrl } from '@common/security/setup-base-url';
import { sendNotificationFailureAlert, sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';
import {
  findMissingStrictOpsConfigKeys,
  isOpsConfigBootstrapKey,
  isOpsConfigMutableKey,
  isOpsConfigRuntimeOverlayKey,
  OPS_CONFIG_OVERVIEW_GROUPS,
  OpsConfigDomain,
  resolveOpsConfigDomainForKey
} from './ops-config-contract';
import { normalizeOpsOtpCode } from './ops-otp-code.js';

type LoadShedMode = LoadShedModeWithMaintenance;

/**
 * Public-facing snapshot of the durable maintenance/load-shed state. Returned
 * from `GET /api/v1/ops/load-shed` and the public
 * `GET /api/v1/maintenance/status` route so the frontend banner can render
 * a countdown and the Ops console can label the current phase.
 */
export interface LoadShedStatusSnapshot {
  mode: LoadShedMode;
  phase: MaintenancePhase | null;
  pendingUntil: string | null;
  activatedAt: string | null;
  reason: string | null;
}

type OpsActionTypeValue =
  | 'LOAD_SHED_CHANGE'
  | 'ENV_READ'
  | 'ENV_UPDATE'
  | 'CONTAINER_RESTART'
  | 'DB_BACKUP'
  | 'DB_RESTORE'
  | 'FEATURE_FLAG_TOGGLE'
  | 'INVITE_CREATED'
  | 'INVITE_CONSUMED'
  | 'INVITE_EXPIRED_CLEANED'
  | 'INVITE_REVOKED'
  | 'OTP_CHALLENGE_REQUESTED'
  | 'OTP_CHALLENGE_VERIFIED'
  | 'OTP_CHALLENGE_FAILED'
  | 'USER_DEACTIVATED'
  | 'OPS_USER_LOGGED_IN'
  | 'OPS_USER_LOGGED_OUT';

type OpsActionStatusValue = 'EXECUTED' | 'FAILED';

type OpsConfigValidationInputValue = string | number | boolean | null | undefined;

type OpsConfigValidationIssue = {
  key: string;
  code: string;
  message: string;
};

const DEVELOPMENT_LIKE_NODE_ENVS = new Set(['development', 'test']);


const OPS_AUDIT_CHAIN_LOCK_KEY = 'ops:audit:chain:lock';
const OPS_AUDIT_CHAIN_LOCK_WAIT_TIMEOUT_MS = 2_000;
const OPS_AUDIT_CHAIN_LOCK_TTL_MS = 5_000;
const OPS_AUDIT_CHAIN_LOCK_RETRY_DELAY_MS = 50;
const OPS_INVITE_TTL_MS = 10 * 60 * 1000;
const OPS_OTP_TTL_MS = 10 * 60 * 1000;
const OPS_OTP_MAX_ATTEMPTS = 3;

export const OPS_CRITICAL_OTP_ACTIONS = [
  'config-save',
  'load-shed-change',
  'user-deactivate',
  'admin-user-deactivate',
  'system-restart',
  'invite-revoke'
] as const;

export type OpsCriticalOtpAction = (typeof OPS_CRITICAL_OTP_ACTIONS)[number];

const OPS_CRITICAL_OTP_ACTION_SET = new Set<string>(OPS_CRITICAL_OTP_ACTIONS);
const OPS_INVITE_SETUP_OTP_TTL_SECONDS = 5 * 60;
const OPS_INVITE_SETUP_OTP_MAX_ATTEMPTS = 3;
const MANDATORY_OPS_PERMISSIONS: Array<'OPS_READ' | 'OPS_WRITE'> = ['OPS_READ', 'OPS_WRITE'];

function enforceMandatoryOpsPermissions(current: string[] | undefined): Array<'OPS_READ' | 'OPS_WRITE'> {
  const normalized = new Set((current ?? []).map((permission) => permission.trim().toUpperCase()));
  for (const required of MANDATORY_OPS_PERMISSIONS) {
    normalized.add(required);
  }
  return [...MANDATORY_OPS_PERMISSIONS].filter((permission) => normalized.has(permission));
}

function getLoginOtpTtlSeconds(): number {
  const raw = Number(process.env.OPS_LOGIN_OTP_TTL_SECONDS ?? 300);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 300;
}

function getBrowserSessionTtlSeconds(): number {
  const raw = Number(process.env.OPS_BROWSER_SESSION_TTL_SECONDS ?? 3600);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3600;
}

const OPS_LOGIN_OTP_MAX_ATTEMPTS = 5;
export const OPS_BROWSER_SESSION_COOKIE_NAME = 'ops_session';
const OPS_BROWSER_SESSION_REDIS_PREFIX = 'ops:browser-session:';

type OpsOtpChallengeStatus = 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'FAILED';

type OpsAuditLogRecord = {
  id: string;
  requestId: string;
  actionType: OpsActionTypeValue;
  actionStatus: OpsActionStatusValue;
  requestPath: string;
  method: string;
  summary?: unknown;
  createdAt: Date;
  chainHash: string;
};

type OpsUserProfileRecord = {
  id: string;
  email: string;
  phone?: string | null;
  name: string;
  permissions: string[];
  mfaEnabled: boolean;
  ipAllowlist: string[];
  lastLoginAt: Date | null;
  isActive: boolean;
  createdAt?: Date;
};

type OpsUserInviteStatus = 'CREATED' | 'EMAIL_SENT' | 'CONSUMED' | 'EXPIRED_CLEANED' | 'CANCELLED';

type OpsUserInviteRecord = {
  id: string;
  inviteEmail: string;
  inviteName: string;
  inviteTokenHash: string;
  setupBaseUrl: string;
  status: OpsUserInviteStatus;
  permissions: string[];
  ipAllowlist: string[];
  expiresAt: Date;
  createdAt: Date;
  createdByOpsUserId: string | null;
};

type OpsOtpChallengeRecord = {
  id: string;
  opsUserId: string;
  action: string;
  codeHash: string;
  status: OpsOtpChallengeStatus;
  expiresAt: Date;
  failedAttempts: number;
};

type MerchantAdminUserListRecord = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  isBanned: boolean;
  isVerified: boolean;
  bannedAt: Date | null;
  bannedReason: string | null;
  createdAt: Date;
  adminPermissionGrants: Array<{ permission: string }>;
};

type MerchantAdminUserTargetRecord = {
  id: string;
  email: string | null;
  role: string;
  isBanned: boolean;
  firstName: string | null;
  lastName: string | null;
};

type OpsPrismaLike = {
  user: {
    findMany(args: {
      where: { role: 'ADMIN'; isBanned?: boolean };
      orderBy?: { createdAt: 'asc' | 'desc' };
      skip?: number;
      take?: number;
      select?: Record<string, unknown>;
    }): Promise<MerchantAdminUserListRecord[]>;
    count(args: { where: { role: 'ADMIN'; isBanned?: boolean } }): Promise<number>;
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<MerchantAdminUserTargetRecord | null>;
    updateMany(args: {
      where: { id: string; role: 'ADMIN'; isBanned: boolean };
      data: { isBanned: boolean; bannedAt: Date; bannedReason: string };
    }): Promise<{ count: number }>;
  };
  refreshToken: {
    updateMany(args: {
      where: { userId: string; revokedAt: null };
      data: { revokedAt: Date };
    }): Promise<{ count: number }>;
  };
  opsUser: {
    findUnique(args: {
      where: { id?: string; email?: string };
      select?: {
        id?: true;
        email?: true;
        name?: true;
        permissions?: true;
        mfaEnabled?: true;
        ipAllowlist?: true;
        lastLoginAt?: true;
        isActive?: true;
        phone?: true;
        createdAt?: true;
      };
    }): Promise<OpsUserProfileRecord | null>;
    findFirst(args: {
      where: { phone?: string };
      select?: { id?: true };
    }): Promise<{ id: string } | null>;
    findMany(args: {
      where?: Record<string, unknown>;
      orderBy?: { createdAt: 'asc' | 'desc' };
      skip?: number;
      take?: number;
      select?: Record<string, boolean>;
    }): Promise<OpsUserProfileRecord[]>;
    count(args: { where?: Record<string, unknown> }): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<OpsUserProfileRecord>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<OpsUserProfileRecord>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  opsUserInvite: {
    create(args: { data: Record<string, unknown> }): Promise<OpsUserInviteRecord>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<OpsUserInviteRecord>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    findUnique(args: { where: { inviteTokenHash?: string; id?: string } }): Promise<OpsUserInviteRecord | null>;
    findFirst(args: { where: Record<string, unknown> }): Promise<OpsUserInviteRecord | null>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: { createdAt: 'asc' | 'desc' };
      skip?: number;
      take?: number;
    }): Promise<OpsUserInviteRecord[]>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
  opsOtpChallenge: {
    create(args: { data: Record<string, unknown> }): Promise<OpsOtpChallengeRecord>;
    findUnique(args: { where: { id: string } }): Promise<OpsOtpChallengeRecord | null>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: { createdAt: 'asc' | 'desc' };
    }): Promise<OpsOtpChallengeRecord[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<OpsOtpChallengeRecord>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  opsConfigSecret: {
    findMany(args: {
      where: {
        isActive: true;
        domain?: 'CORE' | 'PAYMENTS' | 'SHIPPING' | 'NOTIFICATIONS' | 'OPS_SECURITY';
      };
      orderBy: Array<{ domain: 'asc' | 'desc' } | { secretKey: 'asc' | 'desc' }>;
    }): Promise<Array<{
      domain: string;
      secretKey: string;
      encryptedValue: string;
      keyVersion: number;
      requiresRestart: boolean;
      updatedAt: Date;
    }>>;
    upsert(args: {
      where: { domain_secretKey: { domain: string; secretKey: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  opsAuditLog: {
    findFirst(args: { orderBy: { createdAt: 'desc' }; select: { chainHash: true } }): Promise<OpsAuditLogRecord | null>;
    create(args: {
      data: {
        opsUserId: string;
        actionType: OpsActionTypeValue;
        actionStatus: OpsActionStatusValue;
        requestId: string;
        requestIp: string;
        requestPath: string;
        method: string;
        previousState?: unknown;
        newState?: unknown;
        summary?: unknown;
        chainHash: string;
        previousChainHash?: string;
        approvedByOpsUserId?: string;
      };
    }): Promise<unknown>;
    findMany(args: {
      where?: { actionStatus?: OpsActionStatusValue; actionType?: OpsActionTypeValue; opsUserId?: string };
      orderBy?: { createdAt: 'asc' | 'desc' };
      skip?: number;
      take?: number;
      select: {
        id: true;
        requestId: true;
        actionType: true;
        actionStatus: true;
        requestPath: true;
        method: true;
        summary: true;
        createdAt: true;
      };
    }): Promise<Array<Omit<OpsAuditLogRecord, 'chainHash'>>>;
    count(args: { where?: { actionStatus?: OpsActionStatusValue; actionType?: OpsActionTypeValue; opsUserId?: string } }): Promise<number>;
  };
};

function hashChain(previous: string, payload: unknown): string {
  return crypto.createHash('sha256').update(`${previous}:${JSON.stringify(payload)}`).digest('hex');
}

function getNormalizedNodeEnv(): string {
  return (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
}

function isProductionLikeProfile(nodeEnv: string = getNormalizedNodeEnv()): boolean {
  return !DEVELOPMENT_LIKE_NODE_ENVS.has(nodeEnv);
}

function isPlaceholderValue(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return (
    normalized.startsWith('replace_with_') ||
    normalized.startsWith('change_me') ||
    normalized.startsWith('<')
  );
}

function normalizeConfigValue(value: OpsConfigValidationInputValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function hashOpaqueToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}



function toPrismaOpsConfigDomain(domain: OpsConfigDomain): 'CORE' | 'PAYMENTS' | 'SHIPPING' | 'NOTIFICATIONS' | 'OPS_SECURITY' {
  if (domain === 'core' || domain === 'media') return 'CORE';
  if (domain === 'payments') return 'PAYMENTS';
  if (domain === 'shipping') return 'SHIPPING';
  if (domain === 'notifications') return 'NOTIFICATIONS';
  return 'OPS_SECURITY';
}

export class OpsService {
  constructor(private readonly fastify: FastifyInstance) {}

  private setupPayloadKey(inviteTokenHash: string): string {
    return `ops-invite:setup:payload:${inviteTokenHash}`;
  }

  private setupOtpKey(inviteTokenHash: string): string {
    return `ops-invite:setup:otp:${inviteTokenHash}`;
  }

  private setupAttemptKey(inviteTokenHash: string): string {
    return `ops-invite:setup:attempts:${inviteTokenHash}`;
  }

  private async resolveActiveOpsInviteOrThrow(inviteToken: string) {
    const prisma = this.prisma();
    const inviteTokenHash = hashOpaqueToken(inviteToken.trim());
    const invite = await prisma.opsUserInvite.findUnique({ where: { inviteTokenHash } });
    if (!invite) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Ops invite is invalid or already consumed', 404);
    }
    if (!['CREATED', 'EMAIL_SENT'].includes(invite.status)) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Ops invite is no longer active', 409);
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      // Atomic CAS: only mark EXPIRED_CLEANED if still active (prevents races).
      // Use updateMany so the audit trail is preserved; hard-delete would erase history.
      await prisma.opsUserInvite.updateMany({
        where: { id: invite.id, status: { in: ['CREATED', 'EMAIL_SENT'] } },
        data: { status: 'EXPIRED_CLEANED' }
      });
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, 'Ops invite has expired', 401);
    }
    return { invite, inviteTokenHash };
  }

  private async resolveAuditActorOpsUserId(preferredOpsUserId?: string): Promise<string> {
    if (preferredOpsUserId) {
      return preferredOpsUserId;
    }
    const prisma = this.prisma();
    const existing = await prisma.opsUser.findUnique({ where: { email: 'ops-system@local.internal' } });
    if (existing) {
      return existing.id;
    }
    try {
      const created = await prisma.opsUser.create({
        data: {
          email: 'ops-system@local.internal',
          name: 'Ops System',
          mfaEnabled: false,
          mfaSecretEncrypted: null,
          permissions: enforceMandatoryOpsPermissions(['OPS_WRITE'])
        }
      });

      return created.id;
    } catch {
      const concurrentExisting = await prisma.opsUser.findUnique({ where: { email: 'ops-system@local.internal' } });
      if (concurrentExisting) {
        return concurrentExisting.id;
      }
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Unable to resolve ops system audit actor', 500);
    }
  }

  private async withOpsAuditChainLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockToken = crypto.randomUUID();
    const startedAt = Date.now();

    while (true) {
      const acquired = await this.fastify.redis.set(
        OPS_AUDIT_CHAIN_LOCK_KEY,
        lockToken,
        'PX',
        OPS_AUDIT_CHAIN_LOCK_TTL_MS,
        'NX'
      );
      if (acquired === 'OK') {
        break;
      }
      if (Date.now() - startedAt >= OPS_AUDIT_CHAIN_LOCK_WAIT_TIMEOUT_MS) {
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Timed out acquiring ops audit chain lock', 503, {
          kind: 'transient',
          hintKey: 'ops_audit_chain_lock_timeout',
          retryable: true,
          retryAfterSeconds: 1,
          remediation: 'Retry the operation. If contention persists, inspect Redis health and lock latency.'
        });
      }
      await new Promise((resolve) => setTimeout(resolve, OPS_AUDIT_CHAIN_LOCK_RETRY_DELAY_MS));
    }

    try {
      return await fn();
    } finally {
      await this.fastify.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        OPS_AUDIT_CHAIN_LOCK_KEY,
        lockToken
      );
    }
  }

  async getOpsSessionProfile(opsUserId: string): Promise<{
    id: string;
    email: string;
    name: string;
    permissions: string[];
    mfaEnabled: boolean;
    ipAllowlist: string[];
    lastLoginAt: string | null;
  }> {
    const opsUser = await this.prisma().opsUser.findUnique({
      where: { id: opsUserId },
      select: {
        id: true,
        email: true,
        name: true,
        permissions: true,
        mfaEnabled: true,
        ipAllowlist: true,
        lastLoginAt: true
      }
    });

    if (!opsUser) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Ops user not found', 404);
    }
    const permissions = enforceMandatoryOpsPermissions(opsUser.permissions);
    if (
      permissions.length !== opsUser.permissions.length ||
      permissions.some((permission) => !opsUser.permissions.includes(permission))
    ) {
      await this.prisma().opsUser.update({
        where: { id: opsUser.id },
        data: { permissions }
      });
    }

    return {
      id: opsUser.id,
      email: opsUser.email,
      name: opsUser.name,
      permissions,
      mfaEnabled: opsUser.mfaEnabled,
      ipAllowlist: opsUser.ipAllowlist,
      lastLoginAt: opsUser.lastLoginAt ? opsUser.lastLoginAt.toISOString() : null
    };
  }

  async getStoredConfigSecrets(domain?: OpsConfigDomain): Promise<Array<{
    domain: OpsConfigDomain;
    key: string;
    maskedValue: string;
    /**
     * Plaintext stored value — present for **every** active DB-overlay row,
     * including real cryptographic secrets (`_SECRET`, `_TOKEN`, `_PASSWORD`,
     * `_API_KEY`, `_AUTH_KEY`, `_APP_SECRET`, signed approval tokens, ops
     * cookie secret).
     *
     * SECURITY POSTURE (deliberate operator-UX choice): the Ops console is
     * the platform-operator surface, behind ops login + email OTP for writes,
     * with fail-closed `ops:read`/`ops:write` permissions and tamper-evident
     * audit chain logging. It is **not** a customer or merchant-admin UI.
     * Returning every stored value in plaintext lets the operator see and
     * edit what is actually saved (e.g. rotate `RAZORPAY_KEY_SECRET` while
     * verifying the current value), instead of having to keep an external
     * vault in sync to know what was last persisted.
     *
     * This intentionally overrides the generic frontend rule "never show
     * plaintext secrets in admin UI" because that rule targets merchant
     * admin / customer surfaces, not the platform-operator console. Anyone
     * who can reach this response already has full encryption-key access
     * (`OPS_DB_ENCRYPTION_KEY`) via the backend they authenticated to, so
     * masking the value at the HTTP boundary buys no real defense — it only
     * makes the editor unusable.
     *
     * `maskedValue` is still returned alongside for any consumer that wants
     * the masked form (e.g. audit log summary, list views).
     *
     * `isOpsConfigSecretKey()` (in ops-config-contract.ts) is **still used**
     * — it controls UI rendering (password-type input + eye-toggle) and may
     * gate future audit hooks — but it no longer gates plaintext disclosure
     * over the wire.
     */
    plaintextValue: string;
    keyVersion: number;
    requiresRestart: boolean;
    updatedAt: string;
  }>> {
    const prisma = this.prisma();
    const rows = await prisma.opsConfigSecret.findMany({
      where: {
        isActive: true,
        ...(domain ? { domain: toPrismaOpsConfigDomain(domain) } : {})
      },
      orderBy: [{ domain: 'asc' }, { secretKey: 'asc' }]
    });

    const domainMap: Record<string, OpsConfigDomain> = {
      CORE: 'core',
      PAYMENTS: 'payments',
      SHIPPING: 'shipping',
      NOTIFICATIONS: 'notifications',
      OPS_SECURITY: 'opsSecurity'
    };

    const mediaKeys = new Set(
      OPS_CONFIG_OVERVIEW_GROUPS.find((group) => group.domain === 'media')?.items.map((item) => item.key) ?? []
    );

    return rows.map((row: {
      domain: string;
      secretKey: string;
      encryptedValue: string;
      keyVersion: number;
      requiresRestart: boolean;
      updatedAt: Date;
    }) => {
      const decrypted = decryptOpsConfigValue(row.encryptedValue);
      return {
        domain: mediaKeys.has(row.secretKey) ? 'media' : (domainMap[row.domain] ?? 'core'),
        key: row.secretKey,
        maskedValue: maskSecretValue(decrypted),
        plaintextValue: decrypted,
        keyVersion: row.keyVersion,
        requiresRestart: row.requiresRestart,
        updatedAt: row.updatedAt.toISOString()
      };
    });
  }

  async createOpsInvite(input: {
    createdByOpsUserId?: string;
    inviteEmail: string;
    inviteName: string;
    permissions?: Array<'OPS_READ' | 'OPS_WRITE'>;
    ipAllowlist?: string[];
    setupBaseUrl: string;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{ inviteId: string; expiresAt: string; setupUrl: string }> {
    validateSetupBaseUrl(input.setupBaseUrl);
    const prisma = this.prisma();
    const inviteEmail = input.inviteEmail.trim().toLowerCase();
    const inviteName = input.inviteName.trim();
    if (!inviteEmail || !inviteEmail.includes('@')) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Valid invite email is required', 400);
    }
    if (!inviteName) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invite name is required', 400);
    }
    const existingUser = await this.fastify.prisma.user.findUnique({
      where: { email: inviteEmail },
      select: { role: true, isBanned: true }
    });
    if (existingUser) {
      if (existingUser.role === 'ADMIN' && existingUser.isBanned) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'Email belongs to a deactivated merchant admin. Use a merchant admin invite (below) to restore access.',
          409
        );
      }
      throw new AppError(ERROR_CODES.CONFLICT, 'Email is already in use by a customer or admin account', 409);
    }
    const existingOpsUser = await prisma.opsUser.findUnique({ where: { email: inviteEmail } });
    if (existingOpsUser) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Ops user already exists for invite email', 409);
    }
    const existingActiveInvite = await prisma.opsUserInvite.findFirst({
      where: { inviteEmail, status: { in: ['CREATED', 'EMAIL_SENT'] } }
    });
    if (existingActiveInvite) {
      throw new AppError(ERROR_CODES.CONFLICT, 'An active ops invite already exists for this email', 409);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const inviteTokenHash = hashOpaqueToken(token);
    const expiresAt = new Date(Date.now() + OPS_INVITE_TTL_MS);
    const permissions = enforceMandatoryOpsPermissions(input.permissions);

    const invite = await prisma.opsUserInvite.create({
      data: {
        inviteEmail,
        inviteName,
        inviteTokenHash,
        setupBaseUrl: input.setupBaseUrl,
        status: 'CREATED',
        permissions,
        ipAllowlist: input.ipAllowlist ?? [],
        expiresAt,
        ...(input.createdByOpsUserId ? { createdByOpsUserId: input.createdByOpsUserId } : {})
      }
    });

    const setupUrl = `${input.setupBaseUrl.replace(/\/$/, '')}/ops/setup?token=${encodeURIComponent(token)}`;

    const inviteJobId = `ops-invite:${invite.id}:${Date.now()}`;
    try {
      await this.fastify.queues.notifications.add('send-email', {
        to: inviteEmail,
        template: 'OpsInviteSetup',
        data: {
          email: inviteEmail,
          inviteName,
          setupUrl,
          expiresAt: expiresAt.toISOString()
        }
      }, { jobId: inviteJobId });
    } catch (error) {
      await sendNotificationFailureAlert({
        prisma: this.fastify.prisma,
        template: 'OpsInviteSetup',
        channel: 'EMAIL',
        recipient: inviteEmail,
        errorMessage: error instanceof Error ? error.message : 'Unable to enqueue ops invite email',
        failureStage: 'QUEUE_ENQUEUE',
        queueName: 'notifications',
        jobName: 'send-email',
        jobId: inviteJobId
      });
      throw error;
    }

    const sentResult = await prisma.opsUserInvite.updateMany({
      where: { id: invite.id, status: 'CREATED' },
      data: { status: 'EMAIL_SENT' }
    });
    if (sentResult.count === 0) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Ops invite state changed concurrently before email sent marker', 409);
    }

    const actorOpsUserId = await this.resolveAuditActorOpsUserId(input.createdByOpsUserId);
    await this.appendAuditLog({
      opsUserId: actorOpsUserId,
      actionType: 'INVITE_CREATED',
      actionStatus: 'EXECUTED',
      requestId: `invite-create:${invite.id}`,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      summary: {
        inviteId: invite.id,
        inviteEmail,
        expiresAt: expiresAt.toISOString()
      }
    });

    return {
      inviteId: invite.id,
      expiresAt: expiresAt.toISOString(),
      setupUrl
    };
  }

  async sendInviteSetupOtp(input: {
    inviteToken: string;
    name: string;
    phone?: string;
  }): Promise<{ message: string; expiresAt: string }> {
    const prisma = this.prisma();
    const { invite, inviteTokenHash } = await this.resolveActiveOpsInviteOrThrow(input.inviteToken);

    const setupName = input.name.trim();
    if (!setupName) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Name is required', 400);
    }
    const setupPhone = input.phone?.trim() || null;

    const existingUserByEmail = await this.fastify.prisma.user.findUnique({ where: { email: invite.inviteEmail } });
    if (existingUserByEmail) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Email is already in use by a customer or admin account', 409);
    }
    const existingByEmail = await prisma.opsUser.findUnique({ where: { email: invite.inviteEmail } });
    if (existingByEmail) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Ops user already exists for invite email', 409);
    }

    if (setupPhone) {
      const existingByPhone = await prisma.opsUser.findFirst({ where: { phone: setupPhone } });
      if (existingByPhone) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Ops user already exists for invite phone number', 409);
      }
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = hashOpaqueToken(otp);

    const ttlSeconds = Math.max(1, Math.floor((invite.expiresAt.getTime() - Date.now()) / 1000));
    const payloadKey = this.setupPayloadKey(inviteTokenHash);
    const otpKey = this.setupOtpKey(inviteTokenHash);
    const attemptKey = this.setupAttemptKey(inviteTokenHash);

    await this.fastify.redis.set(payloadKey, JSON.stringify({ name: setupName, phone: setupPhone }), 'EX', ttlSeconds);
    await this.fastify.redis.set(otpKey, otpHash, 'EX', Math.min(OPS_INVITE_SETUP_OTP_TTL_SECONDS, ttlSeconds));
    await this.fastify.redis.del(attemptKey);

    const setupOtpJobId = `ops-invite-setup-otp:${invite.id}:${Date.now()}`;
    try {
      await this.fastify.queues.notifications.add('send-email', {
        to: invite.inviteEmail,
        template: 'OpsActionOtp',
        data: {
          name: setupName,
          action: 'ops-invite-setup',
          code: otp,
          expiresAt: invite.expiresAt.toISOString()
        }
      }, { jobId: setupOtpJobId });
    } catch (error) {
      await sendNotificationFailureAlert({
        prisma: this.fastify.prisma,
        template: 'OpsActionOtp',
        channel: 'EMAIL',
        recipient: invite.inviteEmail,
        errorMessage: error instanceof Error ? error.message : 'Unable to enqueue ops setup OTP',
        failureStage: 'QUEUE_ENQUEUE',
        queueName: 'notifications',
        jobName: 'send-email',
        jobId: setupOtpJobId
      });
      throw error;
    }

    return {
      message: 'OTP sent successfully',
      expiresAt: invite.expiresAt.toISOString()
    };
  }

  async consumeOpsInvite(input: {
    inviteToken: string;
    otp: string;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{
    opsUserId: string;
    email: string;
    name: string;
    permissions: string[];
  }> {
    const prisma = this.prisma();
    const { invite, inviteTokenHash } = await this.resolveActiveOpsInviteOrThrow(input.inviteToken);

    const payloadKey = this.setupPayloadKey(inviteTokenHash);
    const otpKey = this.setupOtpKey(inviteTokenHash);
    const attemptKey = this.setupAttemptKey(inviteTokenHash);

    const payloadRaw = await this.fastify.redis.get(payloadKey);
    if (!payloadRaw) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Setup OTP verification is required before account creation', 400);
    }
    const setupPayload = JSON.parse(payloadRaw) as { name: string; phone: string | null };

    const storedOtpHash = await this.fastify.redis.get(otpKey);
    if (!storedOtpHash) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired OTP', 401);
    }

    const normalizedSetupOtp = normalizeOpsOtpCode(input.otp);
    if (normalizedSetupOtp.length !== 6) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'OTP must be exactly 6 digits', 400, {
        kind: 'validation',
        hintKey: 'ops_otp_invalid_format'
      });
    }
    const incomingOtpHash = hashOpaqueToken(normalizedSetupOtp);
    if (incomingOtpHash !== storedOtpHash) {
      const attempts = await this.fastify.redis.incr(attemptKey);
      if (attempts === 1) {
        await this.fastify.redis.expire(attemptKey, OPS_INVITE_SETUP_OTP_TTL_SECONDS);
      }
      if (attempts >= OPS_INVITE_SETUP_OTP_MAX_ATTEMPTS) {
        await this.fastify.redis.del(otpKey, payloadKey, attemptKey);
      }
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired OTP', 401, {
        kind: 'auth',
        hintKey: 'ops_otp_invalid',
        attemptsRemaining: Math.max(0, OPS_INVITE_SETUP_OTP_MAX_ATTEMPTS - attempts),
        retryable: attempts < OPS_INVITE_SETUP_OTP_MAX_ATTEMPTS
      });
    }

    const existingUserByEmail = await this.fastify.prisma.user.findUnique({ where: { email: invite.inviteEmail } });
    if (existingUserByEmail) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Email is already in use by a customer or admin account', 409);
    }
    const existing = await prisma.opsUser.findUnique({ where: { email: invite.inviteEmail } });
    if (existing) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Ops user already exists for invite email', 409);
    }

    if (setupPayload.phone) {
      const existingByPhone = await prisma.opsUser.findFirst({ where: { phone: setupPayload.phone } });
      if (existingByPhone) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Ops user already exists for invite phone number', 409);
      }
    }

    // Use $transaction to atomically create the ops user and consume the invite.
    // Without this, a CAS race could leave a dangling opsUser record.
    const transactablePrisma = this.fastify.prisma as unknown as {
      $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
    };

    const opsUser = await transactablePrisma.$transaction(async (tx) => {
      const permissions = enforceMandatoryOpsPermissions(invite.permissions);
      const createdUser = await (tx as typeof prisma).opsUser.create({
        data: {
          email: invite.inviteEmail,
          phone: setupPayload.phone ?? null,
          name: setupPayload.name,
          mfaEnabled: false,
          mfaSecretEncrypted: null,
          ipAllowlist: invite.ipAllowlist,
          permissions
        }
      });

      // Atomic CAS: only consume if still active (prevents races with concurrent consumption)
      const consumeResult = await (tx as typeof prisma).opsUserInvite.updateMany({
        where: { id: invite.id, status: { in: ['CREATED', 'EMAIL_SENT'] } },
        data: { status: 'CONSUMED', consumedAt: new Date() }
      });
      if (consumeResult.count === 0) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Ops invite is no longer active or was already consumed', 409);
      }

      return createdUser;
    });

    await this.fastify.redis.del(otpKey, payloadKey, attemptKey);

    await this.appendAuditLog({
      opsUserId: opsUser.id,
      actionType: 'INVITE_CONSUMED',
      actionStatus: 'EXECUTED',
      requestId: `invite-consume:${invite.id}`,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      summary: {
        inviteId: invite.id,
        inviteEmail: invite.inviteEmail
      }
    });

    return {
      opsUserId: opsUser.id,
      email: opsUser.email,
      name: opsUser.name,
      permissions: opsUser.permissions
    };
  }

  async requestEmailOtp(input: {
    opsUserId: string;
    action: string;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{ challengeId: string; expiresAt: string }> {
    if (!OPS_CRITICAL_OTP_ACTION_SET.has(input.action)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Unsupported OTP action', 400);
    }

    const prisma = this.prisma();
    const opsUser = await prisma.opsUser.findUnique({ where: { id: input.opsUserId } });
    if (!opsUser || !opsUser.isActive) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Ops user not found', 404);
    }
    const code = crypto.randomInt(100000, 999999).toString();
    const codeHash = hashOpaqueToken(code);
    const expiresAt = new Date(Date.now() + OPS_OTP_TTL_MS);
    const challenge = await prisma.opsOtpChallenge.create({
      data: {
        opsUserId: opsUser.id,
        action: input.action,
        codeHash,
        status: 'PENDING',
        expiresAt
      }
    });

    const opsOtpJobId = `ops-otp:${challenge.id}:${Date.now()}`;
    try {
      await this.fastify.queues.notifications.add('send-email', {
        to: opsUser.email,
        template: 'OpsActionOtp',
        data: {
          name: opsUser.name,
          action: input.action,
          code,
          expiresAt: expiresAt.toISOString()
        }
      }, { jobId: opsOtpJobId });
    } catch (error) {
      await sendNotificationFailureAlert({
        prisma: this.fastify.prisma,
        template: 'OpsActionOtp',
        channel: 'EMAIL',
        recipient: opsUser.email,
        errorMessage: error instanceof Error ? error.message : 'Unable to enqueue ops action OTP email',
        failureStage: 'QUEUE_ENQUEUE',
        queueName: 'notifications',
        jobName: 'send-email',
        jobId: opsOtpJobId
      });
      throw error;
    }

    await this.appendAuditLog({
      opsUserId: opsUser.id,
      actionType: 'OTP_CHALLENGE_REQUESTED',
      actionStatus: 'EXECUTED',
      requestId: `otp-request:${challenge.id}`,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      summary: {
        challengeId: challenge.id,
        action: input.action,
        expiresAt: expiresAt.toISOString()
      }
    });

    return {
      challengeId: challenge.id,
      expiresAt: expiresAt.toISOString()
    };
  }

  async verifyEmailOtp(input: {
    opsUserId: string;
    challengeId: string;
    code: string;
    expectedAction?: OpsCriticalOtpAction;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{ verified: true }> {
    const prisma = this.prisma();
    const challenge = await prisma.opsOtpChallenge.findUnique({ where: { id: input.challengeId } });
    if (!challenge || challenge.opsUserId !== input.opsUserId) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'OTP challenge not found', 404);
    }
    if (input.expectedAction && challenge.action !== input.expectedAction) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'OTP challenge action mismatch', 403);
    }
    const normalizedCode = normalizeOpsOtpCode(input.code);
    if (normalizedCode.length !== 6) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'OTP must be exactly 6 digits', 400, {
        kind: 'validation',
        hintKey: 'ops_otp_invalid_format'
      });
    }
    const incomingHash = hashOpaqueToken(normalizedCode);
    // Idempotent retry path: if OTP was already VERIFIED by an earlier request
    // (for example, verification succeeded but a downstream step failed), allow
    // one-click retries with the same still-unexpired code instead of forcing a
    // fresh OTP request. This is safe because the user must still provide the
    // same correct code hash and have a valid ops session.
    if (challenge.status === 'VERIFIED') {
      if (challenge.expiresAt.getTime() >= Date.now() && incomingHash === challenge.codeHash) {
        return { verified: true };
      }
      throw new AppError(
        ERROR_CODES.CONFLICT,
        `OTP challenge is not pending (current status: ${challenge.status}). Request a fresh OTP and retry.`,
        409,
        {
          kind: 'business_rule',
          hintKey: 'ops_otp_challenge_not_pending',
          retryable: false,
          remediation: 'Click "Send OTP to email" to request a new code, then retry the action.',
          currentStatus: challenge.status
        }
      );
    }
    if (challenge.status !== 'PENDING') {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        `OTP challenge is not pending (current status: ${challenge.status}). Request a fresh OTP and retry.`,
        409,
        {
          kind: 'business_rule',
          hintKey: 'ops_otp_challenge_not_pending',
          retryable: false,
          remediation: 'Click "Send OTP to email" to request a new code, then retry the action.',
          currentStatus: challenge.status
        }
      );
    }
    if (challenge.expiresAt.getTime() < Date.now()) {
      // Atomic CAS: only mark expired if still pending (prevents races)
      await prisma.opsOtpChallenge.updateMany({
        where: { id: challenge.id, status: 'PENDING' },
        data: { status: 'EXPIRED' }
      });
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, 'OTP challenge expired', 401, {
        kind: 'auth',
        hintKey: 'ops_otp_expired',
        retryable: false,
        remediation: 'Click "Send OTP to email" to request a new code, then retry the action.'
      });
    }

    if (incomingHash !== challenge.codeHash) {
      const attempts = challenge.failedAttempts + 1;
      // Atomic CAS: only update if still PENDING (prevents races with concurrent expiry).
      await prisma.opsOtpChallenge.updateMany({
        where: { id: challenge.id, status: 'PENDING' },
        data: {
          failedAttempts: attempts,
          ...(attempts >= OPS_OTP_MAX_ATTEMPTS ? { status: 'FAILED' as OpsOtpChallengeStatus } : {})
        }
      });

      await this.appendAuditLog({
        opsUserId: input.opsUserId,
        actionType: 'OTP_CHALLENGE_FAILED',
        actionStatus: 'FAILED',
        requestId: `otp-failed:${challenge.id}:${attempts}`,
        requestIp: input.requestIp,
        requestPath: input.requestPath,
        method: input.method,
        summary: {
          challengeId: challenge.id,
          failedAttempts: attempts
        }
      });

      const attemptsRemaining = Math.max(0, OPS_OTP_MAX_ATTEMPTS - attempts);
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid OTP code', 401, {
        kind: 'auth',
        hintKey: 'ops_otp_invalid',
        attemptsRemaining,
        retryable: attemptsRemaining > 0,
        remediation:
          attemptsRemaining > 0
            ? 'Check the latest email for the 6-digit code and try again.'
            : 'Maximum attempts reached. Click "Send OTP to email" to request a new code.'
      });
    }

    // Atomic CAS: only verify if still pending (prevents races with concurrent verification)
    const verifyResult = await prisma.opsOtpChallenge.updateMany({
      where: { id: challenge.id, status: 'PENDING' },
      data: { status: 'VERIFIED', verifiedAt: new Date() }
    });
    if (verifyResult.count === 0) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'OTP challenge was concurrently consumed. Request a fresh OTP and retry.',
        409,
        {
          kind: 'business_rule',
          hintKey: 'ops_otp_challenge_consumed_concurrently',
          retryable: false,
          remediation: 'Click "Send OTP to email" to request a new code, then retry the action.'
        }
      );
    }

    await this.appendAuditLog({
      opsUserId: input.opsUserId,
      actionType: 'OTP_CHALLENGE_VERIFIED',
      actionStatus: 'EXECUTED',
      requestId: `otp-verified:${challenge.id}`,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      summary: {
        challengeId: challenge.id
      }
    });

    return { verified: true };
  }

  async saveConfigDraft(input: {
    opsUserId: string;
    domain?: OpsConfigDomain;
    values: Record<string, OpsConfigValidationInputValue>;
    challengeId: string;
    otpCode: string;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{
    valid: boolean;
    savedKeys: string[];
    domain: OpsConfigDomain;
    requiresRestart: boolean;
    masked: Array<{ key: string; maskedValue: string }>;
  }> {
    const prisma = this.prisma();
    await this.verifyEmailOtp({
      opsUserId: input.opsUserId,
      challengeId: input.challengeId,
      code: input.otpCode,
      expectedAction: 'config-save',
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method
    });

    const validation = await this.validateConfigDraft({
      opsUserId: input.opsUserId,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      ...(input.domain ? { domain: input.domain } : {}),
      values: input.values,
      skipAuditLog: true
    });
    if (!validation.valid) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Config draft failed validation', 400, {
        errors: validation.errors,
        warnings: validation.warnings
      });
    }

    const keyVersion = resolveOpsEncryptionKeyVersion();
    const savedKeys: string[] = [];
    const masked: Array<{ key: string; maskedValue: string }> = [];
    let primaryDomain: OpsConfigDomain | null = input.domain ?? null;

    for (const [key, value] of Object.entries(input.values)) {
      if (!isOpsConfigRuntimeOverlayKey(key)) {
        continue;
      }

      const resolvedDomain = input.domain ?? resolveOpsConfigDomainForKey(key);
      if (!resolvedDomain) {
        continue;
      }
      if (input.domain && resolvedDomain !== input.domain) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Key ${key} does not belong to domain ${input.domain}`, 400);
      }

      primaryDomain = primaryDomain ?? resolvedDomain;
      const prismaDomain = toPrismaOpsConfigDomain(resolvedDomain);
      const normalized = normalizeConfigValue(value);

      if (!normalized) {
        await prisma.opsConfigSecret.updateMany({
          where: {
            domain: prismaDomain,
            secretKey: key,
            isActive: true
          },
          data: {
            isActive: false,
            opsUserId: input.opsUserId
          }
        });
        savedKeys.push(key);
        masked.push({ key, maskedValue: '••••••••' });
        continue;
      }

      await prisma.opsConfigSecret.upsert({
        where: {
          domain_secretKey: {
            domain: prismaDomain,
            secretKey: key
          }
        },
        create: {
          opsUserId: input.opsUserId,
          domain: prismaDomain,
          secretKey: key,
          encryptedValue: encryptOpsConfigValue(normalized),
          keyVersion,
          requiresRestart: true,
          isActive: true
        },
        update: {
          opsUserId: input.opsUserId,
          encryptedValue: encryptOpsConfigValue(normalized),
          keyVersion,
          requiresRestart: true,
          isActive: true
        }
      });
      savedKeys.push(key);
      masked.push({ key, maskedValue: maskSecretValue(normalized) });
    }

    const responseDomain = primaryDomain ?? input.domain ?? 'core';

    await this.appendAuditLog({
      opsUserId: input.opsUserId,
      actionType: 'ENV_UPDATE',
      actionStatus: 'EXECUTED',
      requestId: `config-save:${crypto.randomUUID()}`,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      summary: {
        domain: responseDomain,
        savedKeys,
        requiresRestart: true,
        dbBacked: true
      }
    });

    return {
      valid: true,
      savedKeys,
      domain: responseDomain,
      requiresRestart: true,
      masked
    };
  }

  async cleanupExpiredInvites(input: {
    requestIp: string;
    requestPath: string;
    method: string;
    actorOpsUserId?: string;
  }): Promise<{ cleaned: number }> {
    const prisma = this.prisma();
    const expired = await prisma.opsUserInvite.findMany({
      where: {
        status: { in: ['CREATED', 'EMAIL_SENT'] },
        expiresAt: { lt: new Date() }
      }
    });

    if (expired.length > 0) {
      await prisma.opsUserInvite.updateMany({
        where: {
          id: {
            in: expired.map((invite: { id: string }) => invite.id)
          },
          status: { in: ['CREATED', 'EMAIL_SENT'] }
        },
        data: { status: 'EXPIRED_CLEANED' }
      });
    }

    const resolvedActorId = await this.resolveAuditActorOpsUserId(input.actorOpsUserId);
    for (const invite of expired) {
      await this.appendAuditLog({
        opsUserId: resolvedActorId,
        actionType: 'INVITE_EXPIRED_CLEANED',
        actionStatus: 'EXECUTED',
        requestId: `invite-cleanup:${invite.id}`,
        requestIp: input.requestIp,
        requestPath: input.requestPath,
        method: input.method,
        summary: {
          inviteId: invite.id,
          inviteEmail: invite.inviteEmail
        }
      });
    }

    return { cleaned: expired.length };
  }

  async getConfigOverview(input: {
    opsUserId: string;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{
    generatedAt: string;
    runtimeProfile: 'development-like' | 'production-like';
    domains: Array<{
      domain: OpsConfigDomain;
      label: string;
      items: Array<{
        key: string;
        present: boolean;
        placeholder: boolean;
        mutableViaOps: boolean;
        requiresRestart: boolean;
        runtimeSource?: 'env-bootstrap' | 'db-overlay';
        note?: string;
      }>;
    }>;
    strictProfileHealth: {
      noPlaceholdersInStrict: boolean;
      missingRequiredKeysInStrict: string[];
    };
  }> {
    const profile = isProductionLikeProfile() ? 'production-like' : 'development-like';
    const strictMissing = profile === 'production-like' ? findMissingStrictOpsConfigKeys(process.env) : [];
    const strictPlaceholderViolations =
      profile === 'production-like'
        ? strictMissing.filter((key) => {
            const value = process.env[key];
            return value !== undefined && isPlaceholderValue(value);
          })
        : [];

    await this.appendAuditLog({
      opsUserId: input.opsUserId,
      actionType: 'ENV_READ',
      actionStatus: 'EXECUTED',
      requestId: `config-overview:${crypto.randomUUID()}`,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      summary: { runtimeProfile: profile, strictMissingCount: strictMissing.length }
    });

    return {
      generatedAt: new Date().toISOString(),
      runtimeProfile: profile,
      domains: OPS_CONFIG_OVERVIEW_GROUPS.map((group) => ({
        domain: group.domain,
        label: group.label,
        items: group.items.map((item) => {
          const value = process.env[item.key];
          return {
            key: item.key,
            present: Boolean(value && value.trim().length > 0),
            placeholder: isPlaceholderValue(value),
            mutableViaOps: item.mutableViaOps,
            requiresRestart: item.requiresRestart,
            ...(item.runtimeSource ? { runtimeSource: item.runtimeSource } : {}),
            ...(item.note ? { note: item.note } : {})
          };
        })
      })),
      strictProfileHealth: {
        noPlaceholdersInStrict: strictPlaceholderViolations.length === 0,
        missingRequiredKeysInStrict: strictMissing
      }
    };
  }

  async validateConfigDraft(input: {
    opsUserId: string;
    requestIp: string;
    requestPath: string;
    method: string;
    domain?: OpsConfigDomain;
    values: Record<string, OpsConfigValidationInputValue>;
    skipAuditLog?: boolean;
  }): Promise<{
    valid: boolean;
    domain: OpsConfigDomain | null;
    checkedKeys: string[];
    errors: OpsConfigValidationIssue[];
    warnings: OpsConfigValidationIssue[];
    requiresRestart: boolean;
  }> {
    const errors: OpsConfigValidationIssue[] = [];
    const warnings: OpsConfigValidationIssue[] = [];
    const checkedKeys = Object.keys(input.values);

    if (checkedKeys.length === 0) {
      errors.push({
        key: 'values',
        code: 'EMPTY_DRAFT',
        message: 'At least one config key must be provided for validation.'
      });
    }

    const bootstrapKeys = checkedKeys.filter((key) => isOpsConfigBootstrapKey(key));
    for (const key of bootstrapKeys) {
      errors.push({
        key,
        code: 'BOOTSTRAP_KEY_NOT_DB_APPLICABLE',
        message: `${key} must be configured in the deployment environment and cannot be activated from DB-backed ops config.`
      });
    }

    const unknownKeys = checkedKeys.filter((key) => !isOpsConfigBootstrapKey(key) && !isOpsConfigMutableKey(key));
    for (const key of unknownKeys) {
      errors.push({
        key,
        code: 'KEY_NOT_ALLOWLISTED',
        message: `${key} is not allowlisted for ops config validation.`
      });
    }

    const draftEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const [key, value] of Object.entries(input.values)) {
      draftEnv[key] = normalizeConfigValue(value);
      if (isPlaceholderValue(draftEnv[key])) {
        warnings.push({
          key,
          code: 'PLACEHOLDER_VALUE',
          message: `${key} looks like a placeholder value.`
        });
      }
    }

    const strictProfile = isProductionLikeProfile();

    // Validate only keys in this save batch — full go-live requirements stay on /health/ready.
    if (checkedKeys.includes('PAYMENT_PROVIDER')) {
      const paymentProvider = (draftEnv.PAYMENT_PROVIDER ?? '').trim().toLowerCase();
      if (paymentProvider && !['razorpay', 'cod', 'noop'].includes(paymentProvider)) {
        errors.push({
          key: 'PAYMENT_PROVIDER',
          code: 'UNSUPPORTED_PROVIDER',
          message: `Unsupported PAYMENT_PROVIDER: ${paymentProvider}`
        });
      } else if (strictProfile && paymentProvider === 'noop') {
        errors.push({
          key: 'PAYMENT_PROVIDER',
          code: 'NOOP_BLOCKED_IN_STRICT_PROFILE',
          message: 'PAYMENT_PROVIDER=noop is not allowed in production-like profiles.'
        });
      }
    }

    // SHIPPING_PROVIDER validation removed — mutableViaOps: false means it cannot appear
    // in a config draft. Routing auto-detects from credentials (resolveDualShippingRuntime).

    if (checkedKeys.includes('SMS_PROVIDER')) {
      const smsProvider = (draftEnv.SMS_PROVIDER ?? '').trim().toLowerCase();
      if (smsProvider && !['msg91', 'fast2sms', 'noop'].includes(smsProvider)) {
        errors.push({
          key: 'SMS_PROVIDER',
          code: 'UNSUPPORTED_PROVIDER',
          message: `Unsupported SMS_PROVIDER: ${smsProvider}`
        });
      }
    }

    if (checkedKeys.includes('MEDIA_STORAGE_PROVIDER')) {
      const mediaProvider = (draftEnv.MEDIA_STORAGE_PROVIDER ?? '').trim().toLowerCase();
      if (mediaProvider && !['local', 'r2', 'cloudflare-r2'].includes(mediaProvider)) {
        errors.push({
          key: 'MEDIA_STORAGE_PROVIDER',
          code: 'UNSUPPORTED_PROVIDER',
          message: `Unsupported MEDIA_STORAGE_PROVIDER: ${mediaProvider}`
        });
      } else if (strictProfile && mediaProvider === 'local') {
        warnings.push({
          key: 'MEDIA_STORAGE_PROVIDER',
          code: 'LOCAL_MEDIA_IN_STRICT_PROFILE',
          message: 'MEDIA_STORAGE_PROVIDER=local is intended for development; use r2 in production.'
        });
      }
    }

    for (const key of checkedKeys) {
      if (isOpsConfigBootstrapKey(key) || !isOpsConfigMutableKey(key)) {
        continue;
      }
      const value = (draftEnv[key] ?? '').trim();
      if (!value) {
        continue;
      }
      if (strictProfile && isPlaceholderValue(value)) {
        errors.push({
          key,
          code: 'PLACEHOLDER_BLOCKED_IN_STRICT_PROFILE',
          message: `${key} cannot use placeholder values in production-like profiles.`
        });
      }
    }

    const result = {
      valid: errors.length === 0,
      domain: input.domain ?? null,
      checkedKeys,
      errors,
      warnings,
      requiresRestart: checkedKeys.length > 0
    };

    if (!input.skipAuditLog) {
      await this.appendAuditLog({
        opsUserId: input.opsUserId,
        actionType: 'ENV_READ',
        actionStatus: result.valid ? 'EXECUTED' : 'FAILED',
        requestId: crypto.randomUUID(),
        requestIp: input.requestIp,
        requestPath: input.requestPath,
        method: input.method,
        summary: {
          dryRun: true,
          domain: input.domain ?? null,
          checkedKeys,
          errors: errors.length,
          warnings: warnings.length
        }
      });
    }

    return result;
  }

  /**
   * Lists ops user invites, optionally filtered by status.
   * @param query - Optional status filter and pagination params.
   * @returns Paginated list of invites with metadata.
   */
  async listOpsInvites(query: {
    status?: OpsUserInviteStatus;
    page?: number;
    limit?: number;
  }): Promise<{
    items: Array<{
      id: string;
      inviteEmail: string;
      inviteName: string;
      status: OpsUserInviteStatus;
      permissions: string[];
      ipAllowlist: string[];
      expiresAt: string;
      createdAt: string;
      createdByOpsUserId: string | null;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = query.status ? { status: query.status } : {};

    const [items, total] = await Promise.all([
      this.prisma().opsUserInvite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      this.prisma().opsUserInvite.count({ where })
    ]);

    return {
      items: items.map((invite) => ({
        id: invite.id,
        inviteEmail: invite.inviteEmail,
        inviteName: invite.inviteName,
        status: invite.status,
        permissions: invite.permissions,
        ipAllowlist: invite.ipAllowlist,
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
        createdByOpsUserId: invite.createdByOpsUserId ?? null
      })),
      page,
      limit,
      total
    };
  }

  /**
   * Revokes an active ops invite by ID, preventing it from being consumed.
   * @param input - Invite ID, revoking ops user, and audit context.
   * @returns The revoked invite ID and new status.
   */
  async revokeOpsInvite(input: {
    inviteId: string;
    revokerOpsUserId: string;
    challengeId: string;
    otpCode: string;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{ inviteId: string; revoked: true }> {
    await this.verifyEmailOtp({
      opsUserId: input.revokerOpsUserId,
      challengeId: input.challengeId,
      code: input.otpCode,
      expectedAction: 'invite-revoke',
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method
    });

    const prisma = this.prisma();
    const invite = await prisma.opsUserInvite.findUnique({ where: { id: input.inviteId } });

    if (!invite) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Ops invite not found', 404);
    }
    if (!['CREATED', 'EMAIL_SENT'].includes(invite.status)) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Ops invite is no longer active and cannot be revoked', 409);
    }

    const revokeResult = await prisma.opsUserInvite.updateMany({
      where: { id: input.inviteId, status: { in: ['CREATED', 'EMAIL_SENT'] } },
      data: { status: 'CANCELLED' }
    });
    if (revokeResult.count === 0) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Ops invite was concurrently consumed or revoked', 409);
    }

    await this.appendAuditLog({
      opsUserId: input.revokerOpsUserId,
      actionType: 'INVITE_REVOKED',
      actionStatus: 'EXECUTED',
      requestId: `invite-revoke:${input.inviteId}`,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      summary: {
        inviteId: input.inviteId,
        inviteEmail: invite.inviteEmail
      }
    });

    return { inviteId: input.inviteId, revoked: true };
  }

  /**
   * Lists ops users with optional active/inactive filter and pagination.
   * @param query - Optional isActive filter and pagination params.
   * @returns Paginated list of ops user summaries.
   */
  async listOpsUsers(query: {
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{
    items: Array<{
      id: string;
      email: string;
      name: string;
      permissions: string[];
      mfaEnabled: boolean;
      isActive: boolean;
      ipAllowlist: string[];
      lastLoginAt: string | null;
      createdAt: string;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = query.isActive !== undefined ? { isActive: query.isActive } : {};

    const [items, total] = await Promise.all([
      this.prisma().opsUser.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          permissions: true,
          mfaEnabled: true,
          isActive: true,
          ipAllowlist: true,
          lastLoginAt: true,
          createdAt: true
        }
      }),
      this.prisma().opsUser.count({ where })
    ]);

    return {
      items: items.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        permissions: enforceMandatoryOpsPermissions(u.permissions),
        mfaEnabled: u.mfaEnabled,
        isActive: u.isActive,
        ipAllowlist: u.ipAllowlist,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        createdAt: u.createdAt ? u.createdAt.toISOString() : new Date(0).toISOString()
      })),
      page,
      limit,
      total
    };
  }

  /**
   * Returns full profile for a single ops user by ID.
   * @param opsUserId - The ops user's UUID.
   * @returns Full profile including permissions, MFA status, and IP allowlist.
   */
  async getOpsUserById(opsUserId: string): Promise<{
    id: string;
    email: string;
    name: string;
    phone: string | null;
    permissions: string[];
    mfaEnabled: boolean;
    isActive: boolean;
    ipAllowlist: string[];
    lastLoginAt: string | null;
    createdAt: string;
  }> {
    const opsUser = await this.prisma().opsUser.findUnique({
      where: { id: opsUserId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        permissions: true,
        mfaEnabled: true,
        isActive: true,
        ipAllowlist: true,
        lastLoginAt: true,
        createdAt: true
      }
    });

    if (!opsUser) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Ops user not found', 404);
    }

    return {
      id: opsUser.id,
      email: opsUser.email,
      name: opsUser.name,
      phone: opsUser.phone ?? null,
      permissions: enforceMandatoryOpsPermissions(opsUser.permissions),
      mfaEnabled: opsUser.mfaEnabled,
      isActive: opsUser.isActive,
      ipAllowlist: opsUser.ipAllowlist,
      lastLoginAt: opsUser.lastLoginAt ? opsUser.lastLoginAt.toISOString() : null,
      createdAt: opsUser.createdAt ? opsUser.createdAt.toISOString() : new Date(0).toISOString()
    };
  }

  /**
   * Deactivates an ops user. All session guards perform a live isActive DB check,
   * so any existing sessions are immediately rejected. Cannot deactivate self.
   * @param input - Target user ID, requestor ID, and audit context.
   * @returns Deactivation confirmation.
   */
  async deactivateOpsUser(input: {
    targetOpsUserId: string;
    requestorOpsUserId: string;
    reason: string;
    challengeId: string;
    otpCode: string;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{ opsUserId: string; deactivated: true }> {
    await this.verifyEmailOtp({
      opsUserId: input.requestorOpsUserId,
      challengeId: input.challengeId,
      code: input.otpCode,
      expectedAction: 'user-deactivate',
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method
    });

    if (input.targetOpsUserId === input.requestorOpsUserId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Ops user cannot deactivate their own account', 403);
    }

    const target = await this.prisma().opsUser.findUnique({ where: { id: input.targetOpsUserId } });
    if (!target) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Ops user not found', 404);
    }
    if (!target.isActive) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Ops user is already deactivated', 409);
    }

    // Atomic CAS: only deactivate if still active (prevents races with concurrent deactivation)
    const deactivateResult = await this.prisma().opsUser.updateMany({
      where: { id: input.targetOpsUserId, isActive: true },
      data: { isActive: false }
    });
    if (deactivateResult.count === 0) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Ops user was concurrently deactivated', 409);
    }

    await this.appendAuditLog({
      opsUserId: input.requestorOpsUserId,
      actionType: 'USER_DEACTIVATED',
      actionStatus: 'EXECUTED',
      requestId: `user-deactivate:${input.targetOpsUserId}:${crypto.randomUUID()}`,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      summary: {
        targetOpsUserId: input.targetOpsUserId,
        targetEmail: target.email,
        reason: input.reason
      }
    });

    return { opsUserId: input.targetOpsUserId, deactivated: true };
  }

  /**
   * Lists merchant admin accounts (User.role = ADMIN) for the ops control plane.
   * @param query - Optional active filter (maps to !isBanned) and pagination.
   */
  async listMerchantAdminUsers(query: {
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{
    items: Array<{
      id: string;
      email: string;
      name: string;
      permissions: string[];
      isActive: boolean;
      isVerified: boolean;
      phone: string | null;
      createdAt: string;
      deactivatedAt: string | null;
      deactivatedReason: string | null;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: { role: 'ADMIN'; isBanned?: boolean } = { role: 'ADMIN' };
    if (query.isActive !== undefined) {
      where.isBanned = !query.isActive;
    }

    const [items, total] = await Promise.all([
      this.prisma().user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          isBanned: true,
          isVerified: true,
          bannedAt: true,
          bannedReason: true,
          createdAt: true,
          adminPermissionGrants: {
            select: { permission: true }
          }
        }
      }),
      this.prisma().user.count({ where })
    ]);

    return {
      items: items.map((user) => {
        const nameParts = [user.firstName, user.lastName].filter((part): part is string => Boolean(part?.trim()));
        const name = nameParts.join(' ').trim() || user.email || 'Merchant admin';
        return {
          id: user.id,
          email: user.email ?? '',
          name,
          permissions: user.adminPermissionGrants.map((grant) => grant.permission),
          isActive: !user.isBanned,
          isVerified: user.isVerified,
          phone: user.phone,
          createdAt: user.createdAt.toISOString(),
          deactivatedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
          deactivatedReason: user.bannedReason
        };
      }),
      page,
      limit,
      total
    };
  }

  /**
   * Deactivates a merchant admin (sets isBanned, revokes refresh sessions).
   * Login and token refresh fail closed while deactivated. Re-onboard via merchant admin invite (reactivates same user id; audit history retained).
   */
  async deactivateMerchantAdminUser(input: {
    targetAdminUserId: string;
    requestorOpsUserId: string;
    reason: string;
    challengeId: string;
    otpCode: string;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{ adminUserId: string; deactivated: true }> {
    await this.verifyEmailOtp({
      opsUserId: input.requestorOpsUserId,
      challengeId: input.challengeId,
      code: input.otpCode,
      expectedAction: 'admin-user-deactivate',
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method
    });

    const target = await this.prisma().user.findUnique({
      where: { id: input.targetAdminUserId },
      select: {
        id: true,
        email: true,
        role: true,
        isBanned: true,
        firstName: true,
        lastName: true
      }
    });
    if (!target || target.role !== 'ADMIN') {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Merchant admin user not found', 404);
    }
    if (target.isBanned) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Merchant admin is already deactivated', 409);
    }

    const deactivateResult = await this.prisma().user.updateMany({
      where: { id: input.targetAdminUserId, role: 'ADMIN', isBanned: false },
      data: {
        isBanned: true,
        bannedAt: new Date(),
        bannedReason: `[ops:deactivate] ${input.reason.trim()}`
      }
    });
    if (deactivateResult.count === 0) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Merchant admin was concurrently deactivated', 409);
    }

    await this.prisma().refreshToken.updateMany({
      where: { userId: input.targetAdminUserId, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    const nameParts = [target.firstName, target.lastName].filter((part): part is string => Boolean(part?.trim()));
    const displayName = nameParts.join(' ').trim() || target.email || 'Merchant admin';

    await this.appendAuditLog({
      opsUserId: input.requestorOpsUserId,
      actionType: 'USER_DEACTIVATED',
      actionStatus: 'EXECUTED',
      requestId: `admin-user-deactivate:${input.targetAdminUserId}:${crypto.randomUUID()}`,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      summary: {
        targetType: 'merchant_admin',
        targetAdminUserId: input.targetAdminUserId,
        targetEmail: target.email,
        targetName: displayName,
        reason: input.reason
      }
    });

    return { adminUserId: input.targetAdminUserId, deactivated: true };
  }

  /**
   * Returns pending OTP challenges for the requesting ops user.
   * Used to surface challenge state when the user suspects their OTP email was lost.
   * @param opsUserId - The ops user requesting visibility.
   * @returns List of pending challenges with action label and expiry.
   */
  async listPendingOtpChallenges(opsUserId: string): Promise<{
    items: Array<{
      id: string;
      action: string;
      expiresAt: string;
    }>;
  }> {
    const challenges = await this.prisma().opsOtpChallenge.findMany({
      where: {
        opsUserId,
        status: 'PENDING',
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    return {
      items: challenges.map((c) => ({
        id: c.id,
        action: c.action,
        expiresAt: c.expiresAt.toISOString()
      }))
    };
  }

  private prisma(): OpsPrismaLike {
    return this.fastify.prisma as unknown as OpsPrismaLike;
  }

  async setLoadShedModeDirect(input: {
    request: FastifyRequest;
    requesterId: string;
    mode: LoadShedMode;
    reason: string;
    challengeId: string;
    otpCode: string;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{ mode: LoadShedMode; updated: true; phase: MaintenancePhase | null; pendingUntil: string | null }> {
    await this.verifyEmailOtp({
      opsUserId: input.requesterId,
      challengeId: input.challengeId,
      code: input.otpCode,
      expectedAction: 'load-shed-change',
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method
    });

    const prisma = this.fastify.prisma as unknown as MaintenanceStatePrismaLike;
    const redis = (this.fastify.redis as unknown) as MaintenanceStateRedisLike;
    const previous = await readMaintenanceState({ prisma, redis });

    // Build the next durable record. 'maintenance' is a multi-step transition
    // (pending → activation job → active); every other mode is a direct flip.
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let nextRecord: Omit<MaintenanceStateRecord, 'updatedAt'>;
    let activationJobId: string | null = null;

    if (input.mode === 'maintenance') {
      // Honour an existing 'active' state — flipping maintenance to maintenance
      // is a no-op (keeps the original pendingUntil/activatedAt).
      if (previous.mode === 'maintenance' && previous.phase === 'active') {
        nextRecord = {
          mode: 'maintenance',
          phase: 'active',
          pendingUntil: previous.pendingUntil,
          activatedAt: previous.activatedAt ?? nowIso,
          reason: input.reason,
          setByOpsUserId: input.requesterId,
          setAt: nowIso
        };
      } else {
        // Fresh maintenance request — start a pending window. The
        // cart-cleanup worker handles the `maintenance-activation` job
        // after the warning timer + queue + payment drain completes.
        const pendingUntilIso = new Date(nowMs + DEFAULT_MAINTENANCE_PENDING_WINDOW_MS).toISOString();
        nextRecord = {
          mode: 'maintenance',
          phase: 'pending',
          pendingUntil: pendingUntilIso,
          activatedAt: null,
          reason: input.reason,
          setByOpsUserId: input.requesterId,
          setAt: nowIso
        };
        activationJobId = `maintenance-activation:${nowMs}`;
      }
    } else {
      // Exiting maintenance (or staying in normal/reduced/emergency). Clear
      // phase/pendingUntil/activatedAt unconditionally so a stale activation
      // job (if it ever lands after we exit) doesn't flip us back to active.
      nextRecord = {
        mode: input.mode,
        phase: null,
        pendingUntil: null,
        activatedAt: null,
        reason: input.reason,
        setByOpsUserId: input.requesterId,
        setAt: nowIso
      };
    }

    // Persist to Postgres first (source of truth), then refresh Redis cache
    // + in-process memo. We deliberately keep the legacy Redis-only key
    // (`ops:load_shed:mode`) in sync via `setLoadShedMode` so any code path
    // still consulting it directly sees a consistent mode string.
    await writeMaintenanceState({ prisma, redis, record: nextRecord, now: () => nowMs });
    try {
      await setLoadShedMode(input.request, nextRecord.mode);
    } catch {
      // Best-effort — the durable write already succeeded. The mode is
      // resolved from the maintenance state cache on the next request.
    }
    invalidateLoadShedProcessCache();
    invalidateMaintenanceProcessCache();

    // For maintenance transitions that need an activation job, enqueue it
    // after the durable write succeeds. The worker drains queues + payments
    // and then flips phase → 'active'. We use a delay equal to the warning
    // window so the worker only starts draining at the cutover moment.
    //
    // Why we do NOT throw if the queue is unavailable: the operator's intent
    // is already recorded in the durable `MaintenanceState` row. Failing the
    // request now would tell ops "your maintenance didn't take effect" when
    // in fact it did (the row says so). Instead we log loudly + send a tech
    // alert + let the read-side self-heal in `maintenance-state.ts` recover.
    // The new BullMQ-aware fast-promote (post-2026-05-26 fix) makes that
    // recovery effectively instant on the next read instead of waiting the
    // full `MAINTENANCE_ACTIVATION_GRACE_MS` window.
    if (input.mode === 'maintenance' && nextRecord.phase === 'pending' && activationJobId) {
      const cartCleanupQueue = this.fastify.queues?.cartCleanup;
      if (!cartCleanupQueue) {
        // LOUD-FAIL: queue plugin didn't register at boot but the process
        // kept running. Previously this branch silently no-op'd and the
        // operator only noticed when the storefront didn't cut over for
        // ~7 minutes. Now we make the failure observable immediately.
        this.fastify.log.error(
          { opsUserId: input.requesterId, activationJobId },
          '[setLoadShedModeDirect] fastify.queues.cartCleanup is undefined — maintenance-activation NOT enqueued. Read-side fast-promote will flip phase=active on the next request reaching readMaintenanceState (no 7-min wait). Investigate src/common/plugins/bullmq.plugin.ts boot path.'
        );
        void sendTechnicalFailureAlert({
          prisma: this.fastify.prisma,
          template: 'MaintenanceActivationEnqueue',
          channel: 'UNKNOWN',
          recipient: 'ops-maintenance',
          errorMessage:
            'Maintenance set successfully (durable state written) but the cart-cleanup BullMQ queue is unavailable on this backend instance. The maintenance-activation job was NOT enqueued. The read-side fast-promote path will activate the cutover on the next request, but the queue plugin should be investigated — without it, no future maintenance window will drain in-flight payments/jobs cleanly.',
          failureStage: 'QUEUE_ENQUEUE',
          domain: 'ops',
          component: 'maintenance-activation'
        });
      } else {
        try {
          await cartCleanupQueue.add(
            'maintenance-activation',
            {
              requestedBy: input.requesterId,
              reason: input.reason,
              pendingUntil: nextRecord.pendingUntil
            },
            { jobId: activationJobId, delay: DEFAULT_MAINTENANCE_PENDING_WINDOW_MS }
          );
        } catch (enqueueErr) {
          // Enqueue failure does not roll back the durable state — the read
          // path's fast-promote will recover. We still alert ops so they know
          // the activation has to be retried manually.
          this.fastify.log.error(
            { err: enqueueErr, opsUserId: input.requesterId, activationJobId },
            '[setLoadShedModeDirect] maintenance-activation enqueue failed; read-side fast-promote will recover'
          );
          void sendTechnicalFailureAlert({
            prisma: this.fastify.prisma,
            template: 'MaintenanceActivationEnqueue',
            channel: 'UNKNOWN',
            recipient: input.requesterId,
            errorMessage:
              enqueueErr instanceof Error ? enqueueErr.message : 'Unable to enqueue maintenance-activation',
            failureStage: 'QUEUE_ENQUEUE',
            domain: 'ops',
            component: 'maintenance-activation'
          });
        }
      }
    }

    const requestId = crypto.randomUUID();
    await this.appendAuditLog({
      opsUserId: input.requesterId,
      actionType: 'LOAD_SHED_CHANGE',
      actionStatus: 'EXECUTED',
      requestId,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      previousState: { mode: previous.mode, phase: previous.phase },
      newState: { mode: nextRecord.mode, phase: nextRecord.phase, pendingUntil: nextRecord.pendingUntil },
      summary: { reason: input.reason }
    });

    return {
      mode: nextRecord.mode,
      updated: true,
      phase: nextRecord.phase,
      pendingUntil: nextRecord.pendingUntil
    };
  }

  /**
   * Returns the current load-shed/maintenance snapshot for both the Ops
   * console (`GET /api/v1/ops/load-shed`) and the public storefront banner
   * (`GET /api/v1/maintenance/status`). Reads through the durable state
   * helper so it survives Redis loss.
   */
  async getLoadShedStatus(): Promise<LoadShedStatusSnapshot> {
    const prisma = this.fastify.prisma as unknown as MaintenanceStatePrismaLike;
    const redis = (this.fastify.redis as unknown) as MaintenanceStateRedisLike;
    const record = await readMaintenanceState({ prisma, redis });
    return {
      mode: record.mode,
      phase: record.phase,
      pendingUntil: record.pendingUntil,
      activatedAt: record.activatedAt,
      reason: record.reason
    };
  }

  async listAuditLogs(query: {
    actionStatus?: OpsActionStatusValue;
    actionType?: OpsActionTypeValue;
    opsUserId?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    items: Array<{
      id: string;
      requestId: string;
      actionType: OpsActionTypeValue;
      actionStatus: OpsActionStatusValue;
      requestPath: string;
      method: string;
      summary: unknown;
      createdAt: string;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: { actionStatus?: OpsActionStatusValue; actionType?: OpsActionTypeValue; opsUserId?: string } = {};
    if (query.actionStatus) where.actionStatus = query.actionStatus;
    if (query.actionType) where.actionType = query.actionType as OpsActionTypeValue;
    if (query.opsUserId) where.opsUserId = query.opsUserId;

    const [items, total] = await Promise.all([
      this.prisma().opsAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          requestId: true,
          actionType: true,
          actionStatus: true,
          requestPath: true,
          method: true,
          summary: true,
          createdAt: true
        }
      }),
      this.prisma().opsAuditLog.count({ where })
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        requestId: item.requestId,
        actionType: item.actionType,
        actionStatus: item.actionStatus,
        requestPath: item.requestPath,
        method: item.method,
        summary: item.summary,
        createdAt: item.createdAt.toISOString()
      })),
      page,
      limit,
      total
    };
  }

  /**
   * Step 1 of browser login: send a 6-digit OTP to the ops user's registered email.
   * The OTP hash is stored in Redis only (never DB). Returns same message regardless
   * of whether the email exists to prevent user enumeration.
   */
  async requestLoginOtp(input: {
    email: string;
    requestIp: string;
    turnstileToken?: string;
  }): Promise<{ message: string; expiresAt: string; devOtp?: string }> {
    await assertTurnstileToken({
      clientIp: input.requestIp,
      ...(input.turnstileToken ? { turnstileToken: input.turnstileToken } : {})
    });

    const email = input.email.trim().toLowerCase();
    const prisma = this.prisma();
    const opsUser = await prisma.opsUser.findUnique({ where: { email } });

    const ttl = getLoginOtpTtlSeconds();

    if (!opsUser || !opsUser.isActive) {
      // Blind audit: record the failed attempt using system actor to preserve anti-enumeration
      // (same response regardless — attacker cannot distinguish found vs not-found)
      const systemActorId = await this.resolveAuditActorOpsUserId(undefined);
      await this.appendAuditLog({
        opsUserId: systemActorId,
        actionType: 'OTP_CHALLENGE_REQUESTED',
        actionStatus: 'FAILED',
        requestId: `ops-login-otp-notfound:${hashOpaqueToken(email)}:${Date.now()}`,
        requestIp: input.requestIp,
        requestPath: '/api/v1/ops/auth/login/request-otp',
        method: 'POST',
        summary: { reason: 'account_not_found_or_inactive' }
      });
      return {
        message: 'If a registered ops account exists for this email, an OTP has been sent.',
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString()
      };
    }
    const otpKey = `ops:login-otp:${hashOpaqueToken(email)}`;
    const attemptKey = `ops:login-otp-attempts:${hashOpaqueToken(email)}`;

    if (isAuthDevBypassEnabled()) {
      const devOtp = getAuthDevOtp();
      const devOtpHash = hashOpaqueToken(devOtp);
      await this.fastify.redis.set(otpKey, `${opsUser.id}||${devOtpHash}`, 'EX', ttl);
      await this.fastify.redis.del(attemptKey);
      await this.appendAuditLog({
        opsUserId: opsUser.id,
        actionType: 'OTP_CHALLENGE_REQUESTED',
        actionStatus: 'EXECUTED',
        requestId: `ops-login-otp-dev:${opsUser.id}:${Date.now()}`,
        requestIp: input.requestIp,
        requestPath: '/api/v1/ops/auth/login/request-otp',
        method: 'POST',
        summary: { channel: 'dev-bypass', action: 'ops-login' }
      });
      return {
        message: `Development mode: use OTP ${devOtp} (no email sent).`,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        devOtp
      };
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = hashOpaqueToken(otp);

    await this.fastify.redis.set(otpKey, `${opsUser.id}||${otpHash}`, 'EX', ttl);
    await this.fastify.redis.del(attemptKey);

    const jobId = `ops-login-otp-${opsUser.id}-${Date.now()}`;
    try {
      await this.fastify.queues.notifications.add('send-email', {
        to: opsUser.email,
        template: 'OpsActionOtp',
        data: {
          name: opsUser.name,
          action: 'ops-login',
          code: otp,
          expiresAt: new Date(Date.now() + ttl * 1000).toISOString()
        }
      }, { jobId });
    } catch (error) {
      await sendNotificationFailureAlert({
        prisma: this.fastify.prisma,
        template: 'OpsActionOtp',
        channel: 'EMAIL',
        recipient: opsUser.email,
        errorMessage: error instanceof Error ? error.message : 'Unable to enqueue ops login OTP email',
        failureStage: 'QUEUE_ENQUEUE',
        queueName: 'notifications',
        jobName: 'send-email',
        jobId
      });
      throw error;
    }

    await this.appendAuditLog({
      opsUserId: opsUser.id,
      actionType: 'OTP_CHALLENGE_REQUESTED',
      actionStatus: 'EXECUTED',
      requestId: jobId,
      requestIp: input.requestIp,
      requestPath: '/api/v1/ops/auth/login/request-otp',
      method: 'POST',
      summary: { channel: 'email', action: 'ops-login' }
    });

    return {
      message: 'If a registered ops account exists for this email, an OTP has been sent.',
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString()
    };
  }

  /**
   * Step 2 of browser login: verify the OTP and issue a short-lived httpOnly session token.
   * The token is stored hashed in Redis with TTL. Never touches DB or localStorage.
   * Returns the plaintext token for the route handler to set as a cookie.
   */
  async verifyLoginOtp(input: {
    email: string;
    otp: string;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{
    sessionToken: string;
    opsUserId: string;
    name: string;
    email: string;
    permissions: string[];
    expiresAt: string;
  }> {
    const email = input.email.trim().toLowerCase();
    const otpKey = `ops:login-otp:${hashOpaqueToken(email)}`;
    const attemptKey = `ops:login-otp-attempts:${hashOpaqueToken(email)}`;

    const stored = await this.fastify.redis.get(otpKey);
    if (!stored) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired login OTP', 401, {
        kind: 'auth',
        hintKey: 'ops_login_otp_invalid'
      });
    }

    const separatorIndex = stored.indexOf('||');
    const opsUserId = separatorIndex > 0 ? stored.slice(0, separatorIndex) : undefined;
    const storedOtpHash = separatorIndex > 0 ? stored.slice(separatorIndex + 2) : undefined;
    if (!opsUserId || !storedOtpHash) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired login OTP', 401, {
        kind: 'auth',
        hintKey: 'ops_login_otp_invalid'
      });
    }

    const normalizedOtp = normalizeOpsOtpCode(input.otp);
    if (normalizedOtp.length !== 6) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'OTP must be exactly 6 digits', 400, {
        kind: 'validation',
        hintKey: 'ops_otp_invalid_format'
      });
    }
    const incomingHash = hashOpaqueToken(normalizedOtp);
    if (incomingHash !== storedOtpHash) {
      const attempts = await this.fastify.redis.incr(attemptKey);
      if (attempts === 1) {
        await this.fastify.redis.expire(attemptKey, getLoginOtpTtlSeconds());
      }
      if (attempts >= OPS_LOGIN_OTP_MAX_ATTEMPTS) {
        await this.fastify.redis.del(otpKey, attemptKey);
      }
      // Audit the failed OTP attempt against the ops user id extracted from the stored token
      const systemActorId = await this.resolveAuditActorOpsUserId(opsUserId);
      await this.appendAuditLog({
        opsUserId: systemActorId,
        actionType: 'OTP_CHALLENGE_FAILED',
        actionStatus: 'FAILED',
        requestId: `ops-login-otp-fail:${opsUserId}:${Date.now()}`,
        requestIp: input.requestIp,
        requestPath: input.requestPath,
        method: input.method,
        summary: { reason: 'invalid_otp', remainingAttempts: Math.max(0, OPS_LOGIN_OTP_MAX_ATTEMPTS - attempts) }
      });
      const attemptsRemaining = Math.max(0, OPS_LOGIN_OTP_MAX_ATTEMPTS - attempts);
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired login OTP', 401, {
        kind: 'auth',
        hintKey: 'ops_login_otp_invalid',
        attemptsRemaining,
        retryable: attemptsRemaining > 0
      });
    }

    await this.fastify.redis.del(otpKey, attemptKey);

    const prisma = this.prisma();
    const opsUser = await prisma.opsUser.findUnique({ where: { id: opsUserId } });
    if (!opsUser || !opsUser.isActive) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Ops account is inactive or not found', 401);
    }
    const permissions = enforceMandatoryOpsPermissions(opsUser.permissions);
    if (
      permissions.length !== opsUser.permissions.length ||
      permissions.some((permission) => !opsUser.permissions.includes(permission))
    ) {
      await prisma.opsUser.update({
        where: { id: opsUser.id },
        data: { permissions }
      });
    }

    const sessionToken = `opssess_${crypto.randomBytes(32).toString('base64url')}`;
    const sessionTokenHash = hashOpaqueToken(sessionToken);
    const sessionTtl = getBrowserSessionTtlSeconds();
    const sessionKey = `${OPS_BROWSER_SESSION_REDIS_PREFIX}${sessionTokenHash}`;

    await this.fastify.redis.set(sessionKey, JSON.stringify({
      opsUserId: opsUser.id,
      email: opsUser.email,
      name: opsUser.name,
      permissions
    }), 'EX', sessionTtl);

    await prisma.opsUser.updateMany({
      where: { id: opsUser.id, isActive: true },
      data: { lastLoginAt: new Date() }
    });

    await this.appendAuditLog({
      opsUserId: opsUser.id,
      actionType: 'OPS_USER_LOGGED_IN',
      actionStatus: 'EXECUTED',
      requestId: `ops-login:${opsUser.id}:${Date.now()}`,
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method,
      summary: { loginMethod: 'browser-otp', email: opsUser.email }
    });

    return {
      sessionToken,
      opsUserId: opsUser.id,
      name: opsUser.name,
      email: opsUser.email,
      permissions,
      expiresAt: new Date(Date.now() + sessionTtl * 1000).toISOString()
    };
  }

  /**
   * Resolves an ops browser session token from Redis. Returns null if not found/expired.
   * Used by opsAuthGuard to validate cookie-based sessions.
   */
  async resolveBrowserSession(sessionToken: string): Promise<{
    opsUserId: string;
    email: string;
    name: string;
    permissions: string[];
  } | null> {
    const sessionTokenHash = hashOpaqueToken(sessionToken);
    const sessionKey = `${OPS_BROWSER_SESSION_REDIS_PREFIX}${sessionTokenHash}`;
    const raw = await this.fastify.redis.get(sessionKey);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as {
        opsUserId: string;
        email: string;
        name: string;
        permissions: string[];
      };
    } catch {
      return null;
    }
  }

  /**
   * Queues a process restart via BullMQ cartCleanup queue.
   * delayMinutes=0 means "restart now" (fires as soon as the job is picked up).
   * Any positive value delays the job by that many minutes.
   * The job persists in Redis — it survives the ops user logging out.
   * PM2 / Docker restarts the process after process.exit(0).
   */
  async scheduleRestart(input: {
    opsUserId: string;
    delayMinutes: number;
    challengeId: string;
    otpCode: string;
    requestIp: string;
    requestPath: string;
    method: string;
  }): Promise<{ jobId: string; scheduledFor: string }> {
    await this.verifyEmailOtp({
      opsUserId: input.opsUserId,
      challengeId: input.challengeId,
      code: input.otpCode,
      expectedAction: 'system-restart',
      requestIp: input.requestIp,
      requestPath: input.requestPath,
      method: input.method
    });

    const delayMs = Math.max(0, Math.floor(input.delayMinutes)) * 60_000;
    const scheduledFor = new Date(Date.now() + delayMs).toISOString();
    // BullMQ custom job ids must not contain ":".
    const jobId = `ops-restart-${crypto.randomUUID()}`;

    // Guard against a missing cart-cleanup queue (BullMQ plugin failed to
    // register at boot but the process kept running).
    const cartCleanupQueue = this.fastify.queues?.cartCleanup;
    if (!cartCleanupQueue) {
      this.fastify.log.error(
        { opsUserId: input.opsUserId, jobId },
        '[scheduleRestart] cart-cleanup queue is not available on fastify.queues'
      );
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        'Restart queue is not available. The backend is missing the cart-cleanup BullMQ queue.',
        503,
        {
          kind: 'transient',
          hintKey: 'ops_restart_queue_unavailable',
          retryable: true,
          retryAfterSeconds: 5,
          remediation: 'Restart backend container, verify BullMQ + Redis are healthy, then retry.'
        }
      );
    }

    // Snapshot the current load-shed mode so we can roll back if a downstream
    // step (audit write, enqueue) fails after we flip to 'emergency'.
    let previousModeRaw: string | null = null;
    try {
      const raw = await Promise.resolve(this.fastify.redis.get(LOAD_SHED_MODE_KEY));
      previousModeRaw = typeof raw === 'string' ? raw : null;
    } catch {
      previousModeRaw = null;
    }
    const normalizedPrevious = previousModeRaw?.trim().toLowerCase();
    const previousMode: LoadShedMode =
      normalizedPrevious === 'reduced' || normalizedPrevious === 'emergency' ? normalizedPrevious : 'normal';

    // Set load-shed to emergency immediately so checkout mutations receive a
    // clean 503 ("Emergency degraded mode") rather than a connection-refused 502
    // during the Fastify drain window when the container restarts.
    try {
      await setLoadShedModeViaRedis(this.fastify.redis, 'emergency');
    } catch (loadShedErr) {
      this.fastify.log.error(
        { err: loadShedErr, opsUserId: input.opsUserId, jobId },
        '[scheduleRestart] failed to set load-shed mode to emergency'
      );
      void sendTechnicalFailureAlert({
        prisma: this.fastify.prisma,
        template: 'ScheduledRestartLoadShed',
        channel: 'UNKNOWN',
        recipient: input.opsUserId,
        errorMessage: loadShedErr instanceof Error ? loadShedErr.message : 'Unable to set load-shed mode to emergency',
        failureStage: 'CORE_LOGIC',
        domain: 'ops',
        component: 'scheduleRestart',
        jobId
      });
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        'Unable to schedule restart right now because load-shed state could not be updated.',
        503,
        {
          kind: 'transient',
          hintKey: 'ops_restart_load_shed_set_failed',
          retryable: true,
          retryAfterSeconds: 2,
          remediation:
            'Check Redis connectivity (docker compose ps redis) and retry. If issue persists, restart backend/workers and verify /health.'
        }
      );
    }

    // Audit intent BEFORE enqueue — if the queue call fails, the audit record still proves
    // the restart was requested. The cart-cleanup worker handles 'scheduled-process-restart'.
    try {
      await this.appendAuditLog({
        opsUserId: input.opsUserId,
        actionType: 'CONTAINER_RESTART',
        actionStatus: 'EXECUTED',
        requestId: jobId,
        requestIp: input.requestIp,
        requestPath: input.requestPath,
        method: input.method,
        summary: { delayMinutes: input.delayMinutes, scheduledFor, jobId, stage: 'REQUESTED' }
      });
    } catch (auditErr) {
      this.fastify.log.error(
        { err: auditErr, opsUserId: input.opsUserId, jobId },
        '[scheduleRestart] appendAuditLog (REQUESTED) failed'
      );
      try {
        await setLoadShedModeViaRedis(this.fastify.redis, previousMode);
      } catch (rollbackErr) {
        this.fastify.log.error(
          { err: rollbackErr, opsUserId: input.opsUserId, jobId, previousMode },
          '[scheduleRestart] failed to roll back load-shed after audit failure'
        );
      }
      if (auditErr instanceof AppError) {
        throw auditErr;
      }
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Unable to write restart audit record: ${auditErr instanceof Error ? auditErr.message : 'unknown error'}`,
        503,
        {
          kind: 'transient',
          hintKey: 'ops_restart_audit_failed',
          retryable: true,
          retryAfterSeconds: 2,
          remediation:
            'Check Postgres connectivity (docker compose ps postgres) and retry. Inspect backend logs for the underlying Prisma error.'
        }
      );
    }

    try {
      await cartCleanupQueue.add(
        'scheduled-process-restart',
        { requestedBy: input.opsUserId, scheduledFor },
        { jobId, delay: delayMs }
      );
    } catch (enqueueErr) {
      this.fastify.log.error(
        { err: enqueueErr, opsUserId: input.opsUserId, jobId },
        '[scheduleRestart] cart-cleanup queue.add(scheduled-process-restart) failed'
      );
      try {
        await setLoadShedModeViaRedis(this.fastify.redis, previousMode);
      } catch (rollbackErr) {
        this.fastify.log.error(
          { err: rollbackErr, opsUserId: input.opsUserId, jobId, previousMode },
          '[scheduleRestart] failed to roll back load-shed after enqueue failure'
        );
      }
      void sendTechnicalFailureAlert({
        prisma: this.fastify.prisma,
        template: 'ScheduledRestartEnqueue',
        channel: 'UNKNOWN',
        recipient: input.opsUserId,
        errorMessage: enqueueErr instanceof Error ? enqueueErr.message : 'Unable to enqueue scheduled-process-restart job',
        failureStage: 'QUEUE_ENQUEUE',
        domain: 'ops',
        component: 'scheduleRestart',
        queueName: 'cart-cleanup',
        jobName: 'scheduled-process-restart',
        jobId
      });
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Unable to schedule restart job: ${enqueueErr instanceof Error ? enqueueErr.message : 'queue service unavailable'}.`,
        503,
        {
          kind: 'transient',
          hintKey: 'ops_restart_enqueue_failed',
          retryable: true,
          retryAfterSeconds: 2,
          remediation: 'Ensure Redis and workers are healthy (docker compose ps), then retry scheduling restart from Ops → System.'
        }
      );
    }

    try {
      await this.appendAuditLog({
        opsUserId: input.opsUserId,
        actionType: 'CONTAINER_RESTART',
        actionStatus: 'EXECUTED',
        requestId: `${jobId}:enqueued`,
        requestIp: input.requestIp,
        requestPath: input.requestPath,
        method: input.method,
        summary: { delayMinutes: input.delayMinutes, scheduledFor, jobId, stage: 'ENQUEUED' }
      });
    } catch (auditErr) {
      // Job is already enqueued — do NOT roll back. The worker will still
      // execute the restart and the earlier REQUESTED audit row proves intent.
      this.fastify.log.error(
        { err: auditErr, opsUserId: input.opsUserId, jobId },
        '[scheduleRestart] appendAuditLog (ENQUEUED) failed after successful enqueue — proceeding'
      );
      void sendTechnicalFailureAlert({
        prisma: this.fastify.prisma,
        template: 'ScheduledRestartEnqueue',
        channel: 'UNKNOWN',
        recipient: input.opsUserId,
        errorMessage: auditErr instanceof Error ? auditErr.message : 'Unable to record ENQUEUED audit row',
        failureStage: 'CORE_LOGIC',
        domain: 'ops',
        component: 'scheduleRestart',
        jobId
      });
    }

    return { jobId, scheduledFor };
  }

  /**
   * Destroys the browser session token in Redis — called by POST /ops/auth/logout.
   */
  async logoutBrowserSession(sessionToken: string, requestIp: string, requestPath: string, method: string, opsUserId: string): Promise<void> {
    const sessionTokenHash = hashOpaqueToken(sessionToken);
    const sessionKey = `${OPS_BROWSER_SESSION_REDIS_PREFIX}${sessionTokenHash}`;
    await this.fastify.redis.del(sessionKey);
    await this.appendAuditLog({
      opsUserId,
      actionType: 'OPS_USER_LOGGED_OUT',
      actionStatus: 'EXECUTED',
      requestId: `ops-logout:${opsUserId}:${Date.now()}`,
      requestIp,
      requestPath,
      method,
      summary: { loginMethod: 'browser-otp', action: 'logout' }
    });
  }

  private async appendAuditLog(input: {
    opsUserId: string;
    actionType: OpsActionTypeValue;
    actionStatus: OpsActionStatusValue;
    requestId: string;
    requestIp: string;
    requestPath: string;
    method: string;
    previousState?: unknown;
    newState?: unknown;
    summary?: unknown;
  }): Promise<void> {
    await this.withOpsAuditChainLock(async () => {
      const previous = await this.prisma().opsAuditLog.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { chainHash: true }
      });
      const previousChainHash = previous?.chainHash ?? 'GENESIS';
      const chainHash = hashChain(previousChainHash, {
        requestId: input.requestId,
        actionStatus: input.actionStatus,
        requestPath: input.requestPath,
        method: input.method,
        previousState: input.previousState,
        newState: input.newState,
        summary: input.summary
      });

      await this.prisma().opsAuditLog.create({
        data: {
          opsUserId: input.opsUserId,
          actionType: input.actionType,
          actionStatus: input.actionStatus,
          requestId: input.requestId,
          requestIp: input.requestIp,
          requestPath: input.requestPath,
          method: input.method,
          ...(input.previousState !== undefined ? { previousState: input.previousState } : {}),
          ...(input.newState !== undefined ? { newState: input.newState } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          chainHash,
          previousChainHash
        }
      });
    });
  }
}
