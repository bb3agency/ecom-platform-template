import { Prisma, PrismaClient, Role, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import {
  getAuthDevOtp,
  isAuthDevBypassEnabled,
  isDevelopmentLikeNodeEnv,
  withDevOtpField
} from '@common/auth/auth-dev-bypass';
import { isTurnstileVerificationEnabled } from '@common/auth/auth-turnstile';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { recordAuthAbuseEscalation, recordAuthChallenge, recordAuthRiskSignal } from '@common/observability/metrics';
import { normalizeOtpCode } from '@common/auth/otp-code.js';
import { resolveAdminPermissions } from '@common/auth/admin-permissions';
import { resolveNotificationRuntimeConfig } from '@common/notifications/notification-runtime-config';
import {
  assertOtpChannelDeliverable,
  resolveOtpChannelForTemplate,
  resolveOtpDeliveryChannels
} from '@common/notifications/otp-deliverability';
import { sendNotificationFailureAlert, sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';
import { OtpChannel } from './otp-channel';

type PublicUser = {
  id: string;
  email: string | null;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  isVerified: boolean;
};

type RegisterInput = {
  firstName: string;
  lastName: string;
  /** Optional for email-based registration. Required implicitly for OTP signup (separate endpoint). */
  phone?: string | null;
  email: string;
  password: string;
  turnstileToken?: string;
};

type LoginInput = {
  /** Accepts either an email address or a phone number. */
  identifier: string;
  password: string;
  turnstileToken?: string;
};

type CheckIdentifierInput = {
  identifier: string;
};

type OtpInput = {
  phone: string;
  channel?: OtpChannel;
  email?: string;
  turnstileToken?: string;
};

type ForgotPasswordInput = {
  email: string;
  turnstileToken?: string;
};

type ResetPasswordInput = {
  token: string;
  password: string;
  confirmPassword: string;
};

type VerifyOtpInput = {
  phone: string;
  otp: string;
};

type VerifyOtpSignupInput = {
  phone: string;
  otp: string;
  firstName?: string;
  lastName?: string;
  email?: string;
};

type AuthResult = {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
};

const OTP_TTL_SECONDS = 5 * 60;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 3;
const OTP_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_BYTES = 24;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_LOCK_BASE_SECONDS = 5 * 60;
const LOGIN_LOCK_MAX_SECONDS = 60 * 60;
const CHALLENGE_ATTEMPT_WINDOW_SECONDS = 10 * 60;
const CHALLENGE_LOCK_THRESHOLD = 3;
const CHALLENGE_LOCK_SECONDS = 15 * 60;
const RISK_SIGNAL_WINDOW_SECONDS = 60;
const RISK_BURST_THRESHOLD = 12;

type LoginContext = {
  clientIp?: string;
  audience?: AuthAudience;
  skipClearOnSuccess?: boolean;
  risk?: AbuseRiskContext;
};

type AuthAudience = 'customer' | 'admin';
type AbuseRiskContext = {
  sessionId?: string;
  deviceFingerprint?: string;
  tlsFingerprint?: string;
  userAgent?: string;
};

type TokenIssueContext = {
  sessionId: string;
  deviceKeyHash: string;
};

function sanitizeUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone ?? '',
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isVerified: user.isVerified
  };
}

function resolveOtpForHash(rawOtp: string): string {
  const normalized = normalizeOtpCode(rawOtp);
  if (normalized.length !== 6) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'OTP must be exactly 6 digits', 400, {
      kind: 'validation',
      hintKey: 'otp_invalid_format'
    });
  }
  return normalized;
}

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function stableHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class AuthService {
  constructor(private readonly fastify: FastifyInstance) {}

  async getCustomerOtpChannelConfig(): Promise<{ channel: OtpChannel; availableChannels: OtpChannel[] }> {
    const settings = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: 'default' },
      select: {
        notifyEmailEnabled: true,
        notifySmsEnabled: true,
        notifyWhatsappEnabled: true,
        primaryNotificationChannels: true
      }
    });
    const runtime = await resolveNotificationRuntimeConfig(this.fastify.prisma);
    const storeFlags = settings
      ? {
          emailEnabled: settings.notifyEmailEnabled,
          smsEnabled: settings.notifySmsEnabled,
          whatsappEnabled: settings.notifyWhatsappEnabled
        }
      : undefined;
    const resolved = resolveOtpChannelForTemplate({
      templateKey: 'CustomerOtpVerification',
      storeFlags,
      primaryChannels: settings?.primaryNotificationChannels,
      runtime
    });
    return { channel: resolved.channel, availableChannels: resolved.availableChannels };
  }

  async getAdminOtpChannelConfig(): Promise<{ channel: OtpChannel; availableChannels: OtpChannel[] }> {
    const settings = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: 'default' },
      select: {
        notifyEmailEnabled: true,
        notifySmsEnabled: true,
        notifyWhatsappEnabled: true,
        primaryNotificationChannels: true
      }
    });
    const runtime = await resolveNotificationRuntimeConfig(this.fastify.prisma);
    const storeFlags = settings
      ? {
          emailEnabled: settings.notifyEmailEnabled,
          smsEnabled: settings.notifySmsEnabled,
          whatsappEnabled: settings.notifyWhatsappEnabled
        }
      : undefined;
    const resolved = resolveOtpChannelForTemplate({
      templateKey: 'OtpVerification',
      storeFlags,
      primaryChannels: settings?.primaryNotificationChannels,
      runtime,
      preferEmail: true
    });
    return { channel: resolved.channel, availableChannels: resolved.availableChannels };
  }

  private resolveRefreshSecret(): string {
    const secret = process.env.JWT_REFRESH_SECRET?.trim();
    if (!secret) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'JWT_REFRESH_SECRET is not configured', 500);
    }
    return secret;
  }

  /**
   * Binds refresh tokens to the device's User-Agent only.
   *
   * Client IP is deliberately NOT part of this binding. Mobile carriers rotate the
   * egress IP constantly (carrier-grade NAT, cell↔Wi-Fi handoff, VPN), and office
   * networks load-balance across multiple egress IPs. Including the IP meant a mere
   * network change between login and the next refresh produced a device mismatch,
   * which revokes the WHOLE session (see `refresh`) — the exact "logged out on reload /
   * works on desktop, drops on mobile" session-persistence failure. IP is still
   * captured as a soft abuse/risk signal elsewhere; it is just not a hard trust anchor
   * for session continuity. Client-supplied fingerprint headers remain ignored for
   * binding (spoofable), so the bcrypt token hash stays the primary stolen-cookie defense.
   */
  private deriveDeviceKeyHash(context?: LoginContext): string {
    const userAgent = context?.risk?.userAgent?.trim() || 'unknown-agent';
    return stableHash(`ua|${userAgent}`);
  }

  private deriveTokenIssueContext(context?: LoginContext): TokenIssueContext {
    const sessionSource = context?.risk?.sessionId?.trim() || crypto.randomUUID();
    return {
      sessionId: sessionSource.slice(0, 128),
      deviceKeyHash: this.deriveDeviceKeyHash(context)
    };
  }

  private async enqueueOutboxMessage(
    queueName: 'notifications',
    jobName: string,
    payload: Record<string, unknown>,
    jobId?: string
  ): Promise<void> {
    // BullMQ does not allow colons in jobIds. Sanitize by replacing with hyphens.
    const sanitizedJobId = jobId ? jobId.replace(/:/g, '-') : undefined;

    const outboxDelegate = (this.fastify as { prisma?: PrismaClient }).prisma?.outboxMessage;
    if (outboxDelegate) {
      await outboxDelegate.create({
        data: {
          queueName,
          jobName,
          payload: payload as Prisma.InputJsonValue,
          ...(sanitizedJobId ? { jobId: sanitizedJobId } : {})
        }
      });
      return;
    }

    await this.fastify.queues[queueName].add(jobName, payload, sanitizedJobId ? { jobId: sanitizedJobId } : undefined);
  }

  private async validateAuthChallenge(args: {
    action: 'login' | 'register' | 'forgot-password' | 'send-otp';
    token?: string;
    clientIp?: string;
    subject?: string;
    risk?: AbuseRiskContext;
  }): Promise<void> {
    if (args.clientIp) {
      await this.assertChallengeNotTemporarilyBlocked(args.action, args.subject ?? 'anonymous', args.clientIp);
      const riskLock = await this.observeRiskSignals(args.action, args.subject ?? 'anonymous', args.clientIp, args.risk);
      if (riskLock !== null) {
        throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Suspicious challenge traffic detected. Try again later.', 429, {
          retryAfterSeconds: riskLock
        });
      }
    }
    if (!isTurnstileVerificationEnabled()) {
      recordAuthChallenge(args.action, 'skipped');
      return;
    }
    const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
    if (!secret) {
      recordAuthChallenge(args.action, 'skipped');
      return;
    }
    if (!args.token) {
      recordAuthChallenge(args.action, 'failed');
      if (args.clientIp) {
        const lockSeconds = await this.registerChallengeFailure(args.action, args.subject ?? 'anonymous', args.clientIp);
        if (lockSeconds !== null) {
          throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many challenge failures. Try again later.', 429, {
            retryAfterSeconds: lockSeconds
          });
        }
      }
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Challenge token is required', 400);
    }

    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          secret,
          response: args.token,
          ...(args.clientIp ? { remoteip: args.clientIp } : {})
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        recordAuthChallenge(args.action, 'error');
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Challenge verification is unavailable', 502);
      }
      const payload = (await response.json()) as { success?: boolean };
      if (!payload.success) {
        recordAuthChallenge(args.action, 'failed');
        if (args.clientIp) {
          const lockSeconds = await this.registerChallengeFailure(args.action, args.subject ?? 'anonymous', args.clientIp);
          if (lockSeconds !== null) {
            throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many challenge failures. Try again later.', 429, {
              retryAfterSeconds: lockSeconds
            });
          }
        }
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Challenge verification failed', 400);
      }
      if (args.clientIp) {
        await this.clearChallengeFailures(args.action, args.subject ?? 'anonymous', args.clientIp);
      }
      recordAuthChallenge(args.action, 'passed');
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      recordAuthChallenge(args.action, 'error');
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Challenge verification is unavailable', 502);
    }
  }

  private normalizeCredentialIdentifier(identifier: string): string {
    return identifier.trim().toLowerCase();
  }

  private getChallengeAttemptKeys(
    action: 'login' | 'register' | 'forgot-password' | 'send-otp',
    subject: string,
    clientIp: string
  ): { attemptsKey: string; lockKey: string } {
    const normalized = this.normalizeCredentialIdentifier(subject);
    const base = `auth:challenge:${action}:${normalized}:${clientIp}`;
    return {
      attemptsKey: `${base}:count`,
      lockKey: `${base}:lock`
    };
  }

  private async observeRiskSignals(
    action: 'login' | 'register' | 'forgot-password' | 'send-otp',
    subject: string,
    clientIp: string,
    risk?: AbuseRiskContext
  ): Promise<number | null> {
    const normalizedSubject = this.normalizeCredentialIdentifier(subject);
    const minuteBucket = Math.floor(Date.now() / 60000);
    const burstKey = `auth:risk:burst:${action}:${normalizedSubject}:${clientIp}:${minuteBucket}`;
    const burstCount = await this.fastify.redis.incr(burstKey);
    if (burstCount === 1) {
      await this.fastify.redis.expire(burstKey, RISK_SIGNAL_WINDOW_SECONDS + 30);
    }

    const signals: Array<{ name: 'session' | 'device' | 'tls_fingerprint' | 'user_agent'; value: string | undefined }> = [
      { name: 'session', value: risk?.sessionId },
      { name: 'device', value: risk?.deviceFingerprint },
      { name: 'tls_fingerprint', value: risk?.tlsFingerprint },
      { name: 'user_agent', value: risk?.userAgent }
    ];

    for (const signal of signals) {
      if (!signal.value?.trim()) {
        recordAuthRiskSignal(action, signal.name, 'missing');
        continue;
      }
      recordAuthRiskSignal(action, signal.name, 'observed');
    }

    const suspiciousSignals = signals.filter((signal) => !signal.value?.trim()).length;
    if (suspiciousSignals >= 2 || burstCount > RISK_BURST_THRESHOLD) {
      recordAuthRiskSignal(action, 'burst_anomaly', 'suspicious');
    } else {
      recordAuthRiskSignal(action, 'burst_anomaly', 'observed');
    }

    if (burstCount > RISK_BURST_THRESHOLD) {
      const { lockKey } = this.getChallengeAttemptKeys(action, subject, clientIp);
      await this.fastify.redis.set(lockKey, '1', 'EX', CHALLENGE_LOCK_SECONDS);
      recordAuthAbuseEscalation(action, 'temporary_block', 'blocked');
      return CHALLENGE_LOCK_SECONDS;
    }

    return null;
  }

  private async assertChallengeNotTemporarilyBlocked(
    action: 'login' | 'register' | 'forgot-password' | 'send-otp',
    subject: string,
    clientIp: string
  ): Promise<void> {
    const { lockKey } = this.getChallengeAttemptKeys(action, subject, clientIp);
    const ttl = await this.fastify.redis.ttl(lockKey);
    if (ttl > 0) {
      recordAuthAbuseEscalation(action, 'temporary_block', 'blocked');
      throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many challenge failures. Try again later.', 429, {
        retryAfterSeconds: ttl
      });
    }
  }

  private async clearChallengeFailures(
    action: 'login' | 'register' | 'forgot-password' | 'send-otp',
    subject: string,
    clientIp: string
  ): Promise<void> {
    const { attemptsKey, lockKey } = this.getChallengeAttemptKeys(action, subject, clientIp);
    await this.fastify.redis.del(attemptsKey, lockKey);
    recordAuthAbuseEscalation(action, 'challenge', 'cleared');
  }

  private async registerChallengeFailure(
    action: 'login' | 'register' | 'forgot-password' | 'send-otp',
    subject: string,
    clientIp: string
  ): Promise<number | null> {
    const { attemptsKey, lockKey } = this.getChallengeAttemptKeys(action, subject, clientIp);
    const failures = await this.fastify.redis.incr(attemptsKey);
    if (failures === 1) {
      await this.fastify.redis.expire(attemptsKey, CHALLENGE_ATTEMPT_WINDOW_SECONDS);
    }
    recordAuthAbuseEscalation(action, 'challenge', 'observed');
    if (failures < CHALLENGE_LOCK_THRESHOLD) {
      return null;
    }
    await this.fastify.redis.set(lockKey, '1', 'EX', CHALLENGE_LOCK_SECONDS);
    recordAuthAbuseEscalation(action, 'temporary_block', 'blocked');
    return CHALLENGE_LOCK_SECONDS;
  }

  private getAuthAttemptKeys(identifier: string, clientIp: string, audience: AuthAudience): {
    attemptsKey: string;
    lockKey: string;
  } {
    const normalized = this.normalizeCredentialIdentifier(identifier);
    const base = `auth:attempts:${audience}:${normalized}:${clientIp}`;
    return {
      attemptsKey: `${base}:count`,
      lockKey: `${base}:lock`
    };
  }

  private async resolveActiveLockSeconds(
    identifier: string,
    clientIp: string,
    audience: AuthAudience
  ): Promise<number | null> {
    const { lockKey } = this.getAuthAttemptKeys(identifier, clientIp, audience);
    const ttl = await this.fastify.redis.ttl(lockKey);
    if (ttl <= 0) {
      return null;
    }
    return ttl;
  }

  private async assertAuthNotTemporarilyLocked(
    identifier: string,
    clientIp: string,
    audience: AuthAudience
  ): Promise<void> {
    const retryAfterSeconds = await this.resolveActiveLockSeconds(identifier, clientIp, audience);
    if (retryAfterSeconds !== null) {
      throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many attempts. Try again later.', 429, {
        retryAfterSeconds
      });
    }
  }

  private async clearFailedAuthAttempts(identifier: string, clientIp: string, audience: AuthAudience): Promise<void> {
    const { attemptsKey, lockKey } = this.getAuthAttemptKeys(identifier, clientIp, audience);
    await this.fastify.redis.del(attemptsKey, lockKey);
  }

  private async registerFailedAuthAttempt(
    identifier: string,
    clientIp: string,
    audience: AuthAudience
  ): Promise<number | null> {
    const { attemptsKey, lockKey } = this.getAuthAttemptKeys(identifier, clientIp, audience);
    const failures = await this.fastify.redis.incr(attemptsKey);
    if (failures === 1) {
      await this.fastify.redis.expire(attemptsKey, LOGIN_ATTEMPT_WINDOW_SECONDS);
    }

    if (failures < LOGIN_LOCK_THRESHOLD) {
      return null;
    }

    const lockLevel = failures - LOGIN_LOCK_THRESHOLD;
    const lockSeconds = Math.min(LOGIN_LOCK_BASE_SECONDS * 2 ** lockLevel, LOGIN_LOCK_MAX_SECONDS);
    await this.fastify.redis.set(lockKey, '1', 'EX', lockSeconds);
    return lockSeconds;
  }

  private getOtpScope(input: { phone: string }, context?: LoginContext): string {
    const clientIp = context?.clientIp?.trim() || 'unknown-ip';
    const device = context?.risk?.deviceFingerprint?.trim() || 'unknown-device';
    const session = context?.risk?.sessionId?.trim() || 'unknown-session';
    return `${input.phone}:${clientIp}:${device}:${session}`;
  }

  async register(input: RegisterInput, context?: { clientIp?: string; risk?: AbuseRiskContext }): Promise<AuthResult> {
    const emailNorm = input.email.trim().toLowerCase();
    await this.validateAuthChallenge({
      action: 'register',
      ...(input.turnstileToken ? { token: input.turnstileToken } : {}),
      ...(context?.clientIp ? { clientIp: context.clientIp } : {}),
      subject: emailNorm,
      ...(context?.risk ? { risk: context.risk } : {})
    });
    const phoneNorm = input.phone?.trim() || null;
    const whereOrClauses: Array<{ email?: string; phone?: string }> = [{ email: emailNorm }];
    if (phoneNorm) {
      whereOrClauses.push({ phone: phoneNorm });
    }
    const existingUser = await this.fastify.prisma.user.findFirst({
      where: { OR: whereOrClauses }
    });
    if (existingUser) {
      throw new AppError(ERROR_CODES.CONFLICT, 'User already exists', 409);
    }

    const existingOpsUser = await this.fastify.prisma.opsUser.findUnique({ where: { email: emailNorm } });
    if (existingOpsUser) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Email is already in use', 409);
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.fastify.prisma.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: phoneNorm,
        email: emailNorm,
        passwordHash,
        isVerified: true
      }
    });

    return this.issueTokensForUser(
      user,
      this.deriveTokenIssueContext({
        audience: 'customer',
        ...(context?.clientIp ? { clientIp: context.clientIp } : {}),
        ...(context?.risk ? { risk: context.risk } : {})
      })
    );
  }

  async sendOtp(
    input: OtpInput,
    context?: { clientIp?: string; risk?: AbuseRiskContext }
  ): Promise<{ message: string; devOtp?: string }> {
    await this.validateAuthChallenge({
      action: 'send-otp',
      ...(input.turnstileToken ? { token: input.turnstileToken } : {}),
      ...(context?.clientIp ? { clientIp: context.clientIp } : {}),
      subject: input.phone,
      ...(context?.risk ? { risk: context.risk } : {})
    });
    const otpScope = this.getOtpScope(input, context);
    const cooldownKey = `otp:cooldown:${otpScope}`;
    const globalCooldownKey = `otp:cooldown:${input.phone}`;
    const attemptsKey = `otp:attempts:${otpScope}`;
    const otpKey = `otp:${input.phone}`;

    const cooldownActive = await this.fastify.redis.get(cooldownKey) ?? await this.fastify.redis.get(globalCooldownKey);
    if (cooldownActive) {
      throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'OTP recently sent. Try again shortly.', 429);
    }

    const attempts = Number((await this.fastify.redis.get(attemptsKey)) ?? '0');
    if (attempts >= OTP_MAX_ATTEMPTS) {
      throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'OTP attempt limit exceeded', 429);
    }

    const existingUser = await this.fastify.prisma.user.findFirst({
      where: { phone: input.phone },
      select: { id: true }
    });
    if (!existingUser) {
      const signupSettings = await this.fastify.prisma.storeSettings.findUnique({
        where: { singletonKey: 'default' },
        select: { mobileOtpSignupEnabled: true }
      });
      if (!signupSettings?.mobileOtpSignupEnabled) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Phone signup is not available', 400);
      }
    }

    if (isAuthDevBypassEnabled()) {
      const devOtp = getAuthDevOtp();
      const devOtpHash = hashOtp(devOtp);
      await this.fastify.redis.set(otpKey, devOtpHash, 'EX', OTP_TTL_SECONDS);
      await this.fastify.redis.set(cooldownKey, '1', 'EX', OTP_RESEND_SECONDS);
      await this.fastify.redis.set(globalCooldownKey, '1', 'EX', OTP_RESEND_SECONDS);
      return withDevOtpField(
        { message: `Development mode: use OTP ${devOtp} (no SMS/email sent).` },
        devOtp
      );
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const customerEmail = input.email?.trim().toLowerCase() || undefined;
    const storeSettings = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: 'default' },
      select: {
        storeName: true,
        notifyEmailEnabled: true,
        notifySmsEnabled: true,
        notifyWhatsappEnabled: true,
        primaryNotificationChannels: true
      }
    });
    const runtime = await resolveNotificationRuntimeConfig(this.fastify.prisma);
    const storeFlags = storeSettings
      ? {
          emailEnabled: storeSettings.notifyEmailEnabled,
          smsEnabled: storeSettings.notifySmsEnabled,
          whatsappEnabled: storeSettings.notifyWhatsappEnabled
        }
      : undefined;
    const { channels, primaryChannel, toggles } = resolveOtpDeliveryChannels({
      templateKey: 'CustomerOtpVerification',
      storeFlags,
      primaryChannels: storeSettings?.primaryNotificationChannels,
      runtime
    });
    assertOtpChannelDeliverable(primaryChannel, toggles, runtime);

    let recipientEmail: string | undefined;
    if (customerEmail) {
      recipientEmail = customerEmail;
    } else {
      const existingUser = await this.fastify.prisma.user.findFirst({
        where: { phone: input.phone },
        select: { email: true }
      });
      recipientEmail = existingUser?.email ?? undefined;
    }

    // Email is a hard requirement only when it is the primary channel; when email is merely an
    // additional fan-out channel (e.g. WhatsApp is primary), a missing address just drops email.
    if (primaryChannel === 'email' && !recipientEmail) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Email is required for email OTP delivery', 400);
    }
    const deliveryChannels = channels.filter((ch) => ch !== 'email' || Boolean(recipientEmail));

    await this.fastify.redis.set(otpKey, otpHash, 'EX', OTP_TTL_SECONDS);
    await this.fastify.redis.set(cooldownKey, '1', 'EX', OTP_RESEND_SECONDS);
    await this.fastify.redis.set(globalCooldownKey, '1', 'EX', OTP_RESEND_SECONDS);

    const storeName = (storeSettings?.storeName ?? '').trim() || 'Our Store';

    let currentChannel: OtpChannel = primaryChannel;
    try {
      for (const ch of deliveryChannels) {
        currentChannel = ch;
        if (ch === 'email') {
          await this.enqueueOutboxMessage(
            'notifications',
            'send-email',
            {
              to: recipientEmail!,
              template: 'CustomerOtpVerification',
              data: { otp, storeName }
            },
            `otp:email:${input.phone}:${Date.now()}`
          );
        } else if (ch === 'sms') {
          await this.enqueueOutboxMessage(
            'notifications',
            'send-sms',
            {
              phone: input.phone,
              template: 'CustomerOtpVerification',
              data: { otp, storeName }
            },
            `otp:sms:${input.phone}:${Date.now()}`
          );
        } else {
          await this.enqueueOutboxMessage(
            'notifications',
            'send-whatsapp',
            {
              phone: input.phone,
              template: 'CustomerOtpVerification',
              data: { otp, storeName }
            },
            `otp:whatsapp:${input.phone}:${Date.now()}`
          );
        }
      }
    } catch (error) {
      await sendNotificationFailureAlert({
        prisma: this.fastify.prisma,
        template: 'CustomerOtpVerification',
        channel: currentChannel.toUpperCase() as 'SMS' | 'WHATSAPP' | 'EMAIL',
        recipient: currentChannel === 'email' ? (recipientEmail ?? input.phone) : input.phone,
        errorMessage: error instanceof Error ? error.message : 'Unable to enqueue OTP delivery',
        failureStage: 'QUEUE_ENQUEUE',
        queueName: 'notifications',
        jobName: currentChannel === 'email' ? 'send-email' : currentChannel === 'sms' ? 'send-sms' : 'send-whatsapp'
      });
      await this.fastify.redis.del(otpKey, cooldownKey, globalCooldownKey);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Unable to enqueue OTP delivery', 502);
    }

    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(input: VerifyOtpInput, context?: LoginContext): Promise<AuthResult> {
    const otpKey = `otp:${input.phone}`;
    const otpScope = this.getOtpScope(input, context);
    const attemptsKey = `otp:attempts:${otpScope}`;

    const storedHash = await this.fastify.redis.get(otpKey);
    if (!storedHash) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired OTP', 401);
    }

    const incomingHash = hashOtp(resolveOtpForHash(input.otp));
    if (incomingHash !== storedHash) {
      const attemptCount = await this.fastify.redis.incr(attemptsKey);
      if (attemptCount === 1) {
        await this.fastify.redis.expire(attemptsKey, OTP_ATTEMPT_WINDOW_SECONDS);
      }
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired OTP', 401, {
        kind: 'auth',
        hintKey: 'otp_invalid'
      });
    }

    await this.fastify.redis.del(otpKey, attemptsKey);

    const user = await this.fastify.prisma.user.findFirst({
      where: { phone: input.phone }
    });
    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'No user found for the phone number', 404);
    }

    return this.issueTokensForUser(user, this.deriveTokenIssueContext(context));
  }

  async verifyOtpAndSignup(input: VerifyOtpSignupInput, context?: LoginContext): Promise<AuthResult> {
    const otpKey = `otp:${input.phone}`;
    const otpScope = this.getOtpScope(input, context);
    const attemptsKey = `otp:attempts:${otpScope}`;

    const storedHash = await this.fastify.redis.get(otpKey);
    if (!storedHash) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired OTP', 401);
    }

    const incomingHash = hashOtp(resolveOtpForHash(input.otp));
    if (incomingHash !== storedHash) {
      const attemptCount = await this.fastify.redis.incr(attemptsKey);
      if (attemptCount === 1) {
        await this.fastify.redis.expire(attemptsKey, OTP_ATTEMPT_WINDOW_SECONDS);
      }
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired OTP', 401, {
        kind: 'auth',
        hintKey: 'otp_invalid'
      });
    }

    const signupSettings = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: 'default' },
      select: { mobileOtpSignupEnabled: true }
    });
    if (!signupSettings?.mobileOtpSignupEnabled) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Phone signup is not available', 400);
    }

    const trimmedEmail = input.email?.trim().toLowerCase();
    const existingByPhone = await this.fastify.prisma.user.findFirst({ where: { phone: input.phone } });
    if (existingByPhone) {
      throw new AppError(ERROR_CODES.CONFLICT, 'User already exists for the phone number', 409);
    }

    if (trimmedEmail) {
      const existingByEmail = await this.fastify.prisma.user.findUnique({ where: { email: trimmedEmail } });
      if (existingByEmail) {
        throw new AppError(ERROR_CODES.CONFLICT, 'User already exists for the email', 409);
      }
      const existingOpsUser = await this.fastify.prisma.opsUser.findUnique({ where: { email: trimmedEmail } });
      if (existingOpsUser) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Email is already in use', 409);
      }
    }

    const profileFirstName = input.firstName?.trim();
    const profileLastName = input.lastName?.trim();
    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);

    const user = await this.fastify.prisma.user.create({
      data: {
        phone: input.phone,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        ...(profileFirstName ? { firstName: profileFirstName } : {}),
        ...(profileLastName ? { lastName: profileLastName } : {}),
        passwordHash,
        role: Role.CUSTOMER,
        isVerified: true
      }
    });

    await this.fastify.redis.del(otpKey, attemptsKey);
    return this.issueTokensForUser(user, this.deriveTokenIssueContext(context));
  }

  async requestPasswordReset(
    input: ForgotPasswordInput,
    context?: { clientIp?: string; risk?: AbuseRiskContext }
  ): Promise<{ message: string }> {
    const genericResponse = { message: 'If the account exists, a password reset email has been queued.' };
    try {
      await this.validateAuthChallenge({
        action: 'forgot-password',
        ...(input.turnstileToken ? { token: input.turnstileToken } : {}),
        ...(context?.clientIp ? { clientIp: context.clientIp } : {}),
        subject: input.email,
        ...(context?.risk ? { risk: context.risk } : {})
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        throw error;
      }
      return genericResponse;
    }

    let user: User | null = null;
    const emailNorm = input.email.trim().toLowerCase();
    try {
      user = await this.fastify.prisma.user.findUnique({
        where: { email: emailNorm }
      });
    } catch {
      return genericResponse;
    }

    if (user) {
      const resetToken = crypto.randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('hex');
      const tokenHash = stableHash(resetToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

      try {
        await this.fastify.prisma.passwordResetToken.deleteMany({
          where: { userId: user.id }
        });
        await this.fastify.prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt
          }
        });
      } catch {
        return genericResponse;
      }

      const storefrontUrl = process.env.STOREFRONT_URL?.trim();
      if (!storefrontUrl) {
        try {
          await sendTechnicalFailureAlert({
            prisma: this.fastify.prisma,
            template: 'PasswordReset',
            channel: 'EMAIL',
            recipient: user.email ?? input.email,
            errorMessage: 'STOREFRONT_URL is not configured — password reset email skipped',
            failureStage: 'CORE_LOGIC',
            domain: 'auth',
            component: 'requestPasswordReset'
          });
        } catch {
          // Alert failures must never block the password-reset response.
        }
        return genericResponse;
      }
      const resetUrl = `${storefrontUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
      const jobId = `password-reset-${user.id}-${Date.now()}`;
      try {
        await this.enqueueOutboxMessage('notifications', 'send-email', {
          to: user.email,
          template: 'PasswordReset',
          data: {
            email: user.email,
            userId: user.id,
            resetToken,
            resetUrl
          }
        }, jobId);
      } catch (error) {
        try {
          await sendNotificationFailureAlert({
            prisma: this.fastify.prisma,
            template: 'PasswordReset',
            channel: 'EMAIL',
            recipient: user.email ?? input.email,
            errorMessage: error instanceof Error ? error.message : 'Unable to enqueue password reset email',
            failureStage: 'QUEUE_ENQUEUE',
            queueName: 'notifications',
            jobName: 'send-email',
            jobId
          });
        } catch {
          // Notification alert failures must never break password-reset request flow.
        }
      }
    }

    return genericResponse;
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    if (input.password !== input.confirmPassword) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Passwords do not match', 400);
    }
    if (input.password.length < 8 || input.password.length > 128) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Password must be 8–128 characters', 400);
    }

    const trimmedToken = input.token.trim();
    const tokenHash = stableHash(trimmedToken);

    const tokenRecord = await this.fastify.prisma.passwordResetToken.findUnique({
      where: { tokenHash }
    });

    if (!tokenRecord) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired reset token', 401);
    }

    if (tokenRecord.expiresAt < new Date()) {
      await this.fastify.prisma.passwordResetToken.delete({
        where: { id: tokenRecord.id }
      });
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, 'Reset token has expired', 401);
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    await this.fastify.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: tokenRecord.userId },
        data: { passwordHash }
      });
      await tx.passwordResetToken.deleteMany({
        where: { userId: tokenRecord.userId }
      });
      // Revoke all active refresh sessions so existing logins cannot continue
      // with a compromised (pre-reset) password.
      await tx.refreshToken.updateMany({
        where: { userId: tokenRecord.userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    });

    return { message: 'Password has been reset successfully' };
  }

  /**
   * Lightweight identifier check used by login forms.
   * Returns whether a phone number or email address belongs to a registered user.
   * Deliberately does NOT reveal any account details beyond existence.
   */
  async checkIdentifier(input: CheckIdentifierInput): Promise<{
    exists: boolean;
    identifierType: 'phone' | 'email';
    hasPhone: boolean;
  }> {
    const raw = input.identifier.trim();
    const identifierType: 'phone' | 'email' = raw.includes('@') ? 'email' : 'phone';

    if (identifierType === 'email') {
      const user = await this.fastify.prisma.user.findUnique({
        where: { email: raw.toLowerCase() },
        select: { id: true, phone: true }
      });
      return {
        exists: !!user,
        identifierType,
        hasPhone: !!user?.phone
      };
    } else {
      const user = await this.fastify.prisma.user.findFirst({
        where: { phone: raw },
        select: { id: true, phone: true }
      });
      return {
        exists: !!user,
        identifierType,
        hasPhone: !!user?.phone
      };
    }
  }

  async login(input: LoginInput, context?: LoginContext): Promise<AuthResult> {
    const clientIp = context?.clientIp ?? 'unknown';
    const audience = context?.audience ?? 'customer';

    // Normalise identifier: lowercase for email, keep as-is for phone.
    const raw = input.identifier.trim();
    const isEmail = raw.includes('@');
    const identifierNorm = isEmail ? raw.toLowerCase() : raw;

    if (audience === 'customer') {
      await this.validateAuthChallenge({
        action: 'login',
        ...(input.turnstileToken ? { token: input.turnstileToken } : {}),
        clientIp,
        subject: identifierNorm,
        ...(context?.risk ? { risk: context.risk } : {})
      });
    }
    await this.assertAuthNotTemporarilyLocked(identifierNorm, clientIp, audience);

    // Look up user by email or phone depending on what was entered.
    const user = isEmail
      ? await this.fastify.prisma.user.findUnique({ where: { email: identifierNorm } })
      : await this.fastify.prisma.user.findFirst({ where: { phone: identifierNorm } });

    if (!user) {
      const retryAfterSeconds = await this.registerFailedAuthAttempt(identifierNorm, clientIp, audience);
      if (retryAfterSeconds !== null) {
        throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many attempts. Try again later.', 429, {
          retryAfterSeconds
        });
      }
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials', 401);
    }

    // Guard: passwordHash should always be set, but handle the null case gracefully.
    if (!user.passwordHash) {
      const retryAfterSeconds = await this.registerFailedAuthAttempt(identifierNorm, clientIp, audience);
      if (retryAfterSeconds !== null) {
        throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many attempts. Try again later.', 429, {
          retryAfterSeconds
        });
      }
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials', 401);
    }

    const validPassword = await bcrypt.compare(input.password, user.passwordHash);
    if (!validPassword) {
      const retryAfterSeconds = await this.registerFailedAuthAttempt(identifierNorm, clientIp, audience);
      if (retryAfterSeconds !== null) {
        throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many attempts. Try again later.', 429, {
          retryAfterSeconds
        });
      }
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials', 401);
    }
    if (user.role === Role.ADMIN && audience === 'customer') {
      const retryAfterSeconds = await this.registerFailedAuthAttempt(identifierNorm, clientIp, audience);
      if (retryAfterSeconds !== null) {
        throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many attempts. Try again later.', 429, {
          retryAfterSeconds
        });
      }
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials', 401);
    }

    if (!context?.skipClearOnSuccess) {
      await this.clearFailedAuthAttempts(identifierNorm, clientIp, audience);
    }
    return this.issueTokensForUser(user, this.deriveTokenIssueContext(context));
  }

  private static readonly ADMIN_LOGIN_OTP_TTL_SECONDS = 5 * 60;
  private static readonly ADMIN_LOGIN_OTP_MAX_ATTEMPTS = 5;

  /**
   * Step 1 of admin login: verify email + password, then send a 6-digit OTP to the admin's email.
   * Unknown email / non-admin role: generic success (anti-enumeration).
   * Known admin with wrong password or deactivated account: 401 (no OTP issued).
   */
  async requestAdminLoginOtp(input: {
    email: string;
    password: string;
    clientIp: string;
    turnstileToken?: string;
    risk?: AbuseRiskContext;
  }): Promise<{ message: string; expiresAt: string; devOtp?: string }> {
    const clientIp = input.clientIp ?? 'unknown';
    const emailNorm = input.email.trim().toLowerCase();
    const emailHash = stableHash(emailNorm);
    const otpKey = `auth:admin:login-otp:${emailHash}`;
    const attemptKey = `auth:admin:login-otp-attempts:${emailHash}`;
    const fallbackExpiresAt = new Date(Date.now() + AuthService.ADMIN_LOGIN_OTP_TTL_SECONDS * 1000).toISOString();
    await this.validateAuthChallenge({
      action: 'login',
      ...(input.turnstileToken ? { token: input.turnstileToken } : {}),
      clientIp,
      subject: input.email,
      ...(input.risk ? { risk: input.risk } : {})
    });
    await this.assertAuthNotTemporarilyLocked(input.email, clientIp, 'admin');

    const user = await this.fastify.prisma.user.findUnique({ where: { email: emailNorm } });
    const genericMessage = 'If a registered admin account exists for this email, an OTP has been sent.';

    if (!user || user.role !== Role.ADMIN) {
      await this.registerFailedAuthAttempt(input.email, clientIp, 'admin');
      await this.fastify.redis.del(otpKey, attemptKey);
      return { message: genericMessage, expiresAt: fallbackExpiresAt };
    }

    const validPassword = await bcrypt.compare(input.password, user.passwordHash);
    if (!validPassword) {
      await this.registerFailedAuthAttempt(input.email, clientIp, 'admin');
      await this.fastify.redis.del(otpKey, attemptKey);
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Incorrect password', 401);
    }

    if (user.isBanned) {
      await this.registerFailedAuthAttempt(input.email, clientIp, 'admin');
      await this.fastify.redis.del(otpKey, attemptKey);
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Admin account not found or inactive', 401);
    }

    const expiresAt = new Date(Date.now() + AuthService.ADMIN_LOGIN_OTP_TTL_SECONDS * 1000).toISOString();

    if (isAuthDevBypassEnabled()) {
      const devOtp = getAuthDevOtp();
      const devOtpHash = hashOtp(devOtp);
      await this.fastify.redis.set(otpKey, `${user.id}||${devOtpHash}`, 'EX', AuthService.ADMIN_LOGIN_OTP_TTL_SECONDS);
      await this.fastify.redis.del(attemptKey);
      const ciKey = `auth:admin:login-otp:ci-plaintext:${emailHash}`;
      await this.fastify.redis.set(ciKey, devOtp, 'EX', AuthService.ADMIN_LOGIN_OTP_TTL_SECONDS);
      return withDevOtpField(
        {
          message: `Development mode: use OTP ${devOtp} (no email/SMS sent).`,
          expiresAt
        },
        devOtp
      );
    }

    const runtime = await resolveNotificationRuntimeConfig(this.fastify.prisma);
    const storeSettingsForFlags = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: 'default' },
      select: {
        notifyEmailEnabled: true,
        notifySmsEnabled: true,
        notifyWhatsappEnabled: true,
        primaryNotificationChannels: true
      }
    });
    const adminStoreFlags = storeSettingsForFlags
      ? {
          emailEnabled: storeSettingsForFlags.notifyEmailEnabled,
          smsEnabled: storeSettingsForFlags.notifySmsEnabled,
          whatsappEnabled: storeSettingsForFlags.notifyWhatsappEnabled
        }
      : undefined;
    // Admin login OTP prefers email, and (when OTP_WHATSAPP_ENABLED is on AND the admin has a
    // phone number) ALSO fans the same OTP out to WhatsApp — identical mechanism to the customer
    // flow (same OTP, one hash, verified identically).
    const { channels, primaryChannel, toggles } = resolveOtpDeliveryChannels({
      templateKey: 'OtpVerification',
      storeFlags: adminStoreFlags,
      primaryChannels: storeSettingsForFlags?.primaryNotificationChannels,
      runtime,
      preferEmail: true
    });
    assertOtpChannelDeliverable(primaryChannel, toggles, runtime);

    const otp = generateOtp();
    const otpHash = hashOtp(otp);

    await this.fastify.redis.set(otpKey, `${user.id}||${otpHash}`, 'EX', AuthService.ADMIN_LOGIN_OTP_TTL_SECONDS);
    await this.fastify.redis.del(attemptKey);

    if (isDevelopmentLikeNodeEnv()) {
      const ciKey = `auth:admin:login-otp:ci-plaintext:${emailHash}`;
      await this.fastify.redis.set(ciKey, otp, 'EX', AuthService.ADMIN_LOGIN_OTP_TTL_SECONDS);
    }

    // SMS/WhatsApp need the admin's phone. A hard error only if the PRIMARY channel needs a phone
    // the admin lacks; a phone-less admin just doesn't get the extra WhatsApp/SMS copy (email still sends).
    if (primaryChannel !== 'email' && !user.phone) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `Admin phone number is required for ${primaryChannel.toUpperCase()} OTP delivery`,
        400
      );
    }
    const deliveryChannels = channels.filter((ch) => ch === 'email' || Boolean(user.phone));

    let currentChannel: OtpChannel = primaryChannel;
    try {
      for (const ch of deliveryChannels) {
        currentChannel = ch;
        const jobId = `admin-login-otp-${ch}-${user.id}-${Date.now()}`;
        if (ch === 'email') {
          await this.fastify.queues.notifications.add(
            'send-email',
            { to: user.email, template: 'OtpVerification', data: { otp } },
            { jobId }
          );
        } else if (ch === 'sms') {
          await this.fastify.queues.notifications.add(
            'send-sms',
            { phone: user.phone!, template: 'OtpVerification', data: { otp } },
            { jobId }
          );
        } else {
          await this.fastify.queues.notifications.add(
            'send-whatsapp',
            { phone: user.phone!, template: 'OtpVerification', data: { otp } },
            { jobId }
          );
        }
      }
    } catch (error) {
      await sendNotificationFailureAlert({
        prisma: this.fastify.prisma,
        template: 'OtpVerification',
        channel: currentChannel.toUpperCase() as 'SMS' | 'WHATSAPP' | 'EMAIL',
        recipient: currentChannel === 'email' ? (user.email ?? input.email) : (user.phone ?? input.email),
        errorMessage: error instanceof Error ? error.message : 'Unable to enqueue admin login OTP',
        failureStage: 'QUEUE_ENQUEUE',
        queueName: 'notifications',
        jobName: currentChannel === 'email' ? 'send-email' : currentChannel === 'sms' ? 'send-sms' : 'send-whatsapp',
        jobId: `admin-login-otp-${currentChannel}-${user.id}`
      });
      throw error;
    }

    return { message: genericMessage, expiresAt };
  }

  /**
   * Step 2 of admin login: verify the OTP and issue JWT access + refresh tokens.
   */
  async verifyAdminLoginOtp(input: {
    email: string;
    otp: string;
    clientIp: string;
    risk?: AbuseRiskContext;
  }): Promise<AuthResult> {
    const emailNorm = input.email.trim().toLowerCase();
    const otpKey = `auth:admin:login-otp:${stableHash(emailNorm)}`;
    const attemptKey = `auth:admin:login-otp-attempts:${stableHash(emailNorm)}`;

    if (isAuthDevBypassEnabled() && normalizeOtpCode(input.otp) === getAuthDevOtp()) {
      const user = await this.fastify.prisma.user.findUnique({ where: { email: emailNorm } });
      if (!user || user.role !== Role.ADMIN || user.isBanned) {
        throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired login OTP', 401);
      }
      await this.fastify.redis.del(otpKey, attemptKey);
      await this.clearFailedAuthAttempts(input.email, input.clientIp, 'admin');
      return this.issueTokensForUser(
        user,
        this.deriveTokenIssueContext({
          clientIp: input.clientIp,
          audience: 'admin',
          ...(input.risk ? { risk: input.risk } : {})
        })
      );
    }

    const stored = await this.fastify.redis.get(otpKey);
    if (!stored) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired login OTP', 401);
    }

    const separatorIndex = stored.indexOf('||');
    const userId = separatorIndex > 0 ? stored.slice(0, separatorIndex) : undefined;
    const storedOtpHash = separatorIndex > 0 ? stored.slice(separatorIndex + 2) : undefined;
    if (!userId || !storedOtpHash) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired login OTP', 401);
    }

    const incomingHash = hashOtp(resolveOtpForHash(input.otp));
    if (incomingHash !== storedOtpHash) {
      const attempts = await this.fastify.redis.incr(attemptKey);
      if (attempts === 1) {
        await this.fastify.redis.expire(attemptKey, AuthService.ADMIN_LOGIN_OTP_TTL_SECONDS);
      }
      if (attempts >= AuthService.ADMIN_LOGIN_OTP_MAX_ATTEMPTS) {
        await this.fastify.redis.del(otpKey, attemptKey);
      }
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired login OTP', 401, {
        kind: 'auth',
        hintKey: 'admin_login_otp_invalid'
      });
    }

    await this.fastify.redis.del(otpKey, attemptKey);

    const user = await this.fastify.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== Role.ADMIN) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Admin account not found or inactive', 401);
    }
    if (user.isBanned) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Admin account not found or inactive', 401);
    }

    await this.clearFailedAuthAttempts(input.email, input.clientIp, 'admin');
    return this.issueTokensForUser(
      user,
      this.deriveTokenIssueContext({
        clientIp: input.clientIp,
        audience: 'admin',
        ...(input.risk ? { risk: input.risk } : {})
      })
    );
  }

  async refresh(refreshToken: string, context?: LoginContext): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: { sub: string; role: Role; jti: string; sid: string; permissions?: string[] };
    try {
      payload = jwt.verify(
        refreshToken,
        this.resolveRefreshSecret(),
        {
          algorithms: ['HS256']
        }
      ) as { sub: string; role: Role; jti: string; sid: string; permissions?: string[] };
    } catch {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Invalid refresh token', 401);
    }

    const tokenRecord = await this.fastify.prisma.refreshToken.findUnique({
      where: { jti: payload.jti }
    });
    if (
      !tokenRecord ||
      tokenRecord.userId !== payload.sub ||
      tokenRecord.expiresAt <= new Date() ||
      tokenRecord.revokedAt !== null ||
      tokenRecord.consumedAt !== null ||
      tokenRecord.sessionId !== payload.sid
    ) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Invalid refresh token', 401);
    }
    const deviceContext = this.deriveTokenIssueContext(context);
    const isMatch = await bcrypt.compare(refreshToken, tokenRecord.tokenHash);
    if (!isMatch || tokenRecord.deviceKeyHash !== deviceContext.deviceKeyHash) {
      await this.fastify.prisma.refreshToken.updateMany({
        where: {
          userId: payload.sub,
          sessionId: payload.sid,
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      });
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Invalid refresh token', 401);
    }
    // Atomic CAS: only consume if not already consumed (prevents races with concurrent refresh)
    const consumeResult = await this.fastify.prisma.refreshToken.updateMany({
      where: { id: tokenRecord.id, consumedAt: null },
      data: { consumedAt: new Date() }
    });
    if (consumeResult.count === 0) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'Refresh token already consumed', 401);
    }

    const user = await this.fastify.prisma.user.findUnique({
      where: { id: payload.sub }
    });
    if (!user) {
      throw new AppError(ERROR_CODES.UNAUTHORISED, 'User not found', 401);
    }
    // Ban check handled inside issueTokensForUser for all roles

    const issued = await this.issueTokensForUser(user, {
      sessionId: payload.sid,
      deviceKeyHash: tokenRecord.deviceKeyHash
    });
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken
    };
  }

  async logout(userId: string, refreshToken?: string, sessionId?: string): Promise<{ message: string }> {
    if (refreshToken) {
      const tokenRecords = await this.fastify.prisma.refreshToken.findMany({
        where: { userId }
      });

      for (const record of tokenRecords) {
        const matches = await bcrypt.compare(refreshToken, record.tokenHash);
        if (matches) {
          await this.fastify.prisma.refreshToken.updateMany({
            where: { userId, sessionId: record.sessionId, revokedAt: null },
            data: { revokedAt: new Date() }
          });
          return { message: 'Logged out successfully' };
        }
      }
    }

    if (sessionId) {
      await this.fastify.prisma.refreshToken.updateMany({
        where: { userId, sessionId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      return { message: 'Logged out successfully' };
    }

    await this.fastify.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    return { message: 'Logged out successfully' };
  }

  private async issueTokensForUser(user: User, tokenContext: TokenIssueContext): Promise<AuthResult> {
    if (user.isBanned) {
      const isAdmin = user.role === Role.ADMIN;
      throw new AppError(
        ERROR_CODES.UNAUTHORISED,
        isAdmin ? 'Admin account not found or inactive' : 'Your account has been suspended. Please contact support.',
        401
      );
    }

    if (user.role === Role.CUSTOMER && !user.isVerified) {
      await this.fastify.prisma.user.updateMany({
        where: { id: user.id, isVerified: false },
        data: { isVerified: true }
      });
      user = { ...user, isVerified: true };
    }

    // PERMISSION SNAPSHOT CAVEAT: admin permissions are resolved from the DB at token issuance and
    // embedded in the JWT payload.  The access token is valid for ACCESS_TOKEN_TTL (15 m) from this
    // point.  If an AdminPermissionGrant row is added, modified, or removed during that window the
    // change will not take effect until the next token refresh.  To force immediate revocation, call
    // logout() for the target session — this marks all RefreshTokens revoked so the next refresh
    // attempt fails, preventing a new access token from being issued with stale permissions.
    const adminPermissions = user.role === Role.ADMIN
      ? await resolveAdminPermissions(this.fastify.prisma, user.id)
      : undefined;
    const payload = {
      sub: user.id,
      role: user.role,
      sid: tokenContext.sessionId,
      ...(adminPermissions ? { permissions: adminPermissions } : {})
    };

    const accessToken = this.fastify.jwt.sign(payload, {
      expiresIn: ACCESS_TOKEN_TTL
    });

    const refreshJti = crypto.randomUUID();
    const refreshToken = jwt.sign({ ...payload, jti: refreshJti }, this.resolveRefreshSecret(), {
      expiresIn: '7d',
      algorithm: 'HS256'
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    await this.fastify.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        jti: refreshJti,
        sessionId: tokenContext.sessionId,
        deviceKeyHash: tokenContext.deviceKeyHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
      }
    });

    return {
      accessToken,
      refreshToken,
      user: sanitizeUser(user)
    };
  }
}

