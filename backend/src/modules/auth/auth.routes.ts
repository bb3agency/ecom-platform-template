import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { getCurrentUser } from '@common/decorators/current-user';
import { jwtVerifyGuard } from '@common/guards/jwt-auth.guard';
import { opsAuthGuard } from '@common/guards/ops-auth.guard';
import { opsPermissionGuard } from '@common/guards/ops-permissions.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { idempotencyOnSend, idempotencyPreHandler } from '@common/idempotency/idempotency';
import { AuthService } from './auth.service';
import { AdminInvitesService } from './admin-invites.service';
import { OpsService } from '@modules/ops/ops.service';
import {
  buildRefreshTokenClearCookieHeader,
  buildRefreshTokenSetCookieHeader
} from './auth-cookies';
import {
  adminInviteListSchema,
  adminInviteRevokeSchema,
  adminInviteCleanupSchema,
  adminInviteSetupOtpSchema,
  adminInviteConsumeSchema,
  adminOtpChannelConfigSchema,
  adminInviteCreateSchema,
  adminLoginRequestOtpSchema,
  adminLoginVerifyOtpSchema,
  checkIdentifierSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  loginSchema,
  logoutSchema,
  otpChannelConfigSchema,
  refreshSchema,
  registerSchema,
  sendOtpSchema,
  signupPhoneSchema,
  verifyOtpSchema
} from './auth.schemas';

function parseRefreshTokenFromCookie(cookieHeader?: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const tokenPart = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('refresh_token='));

  if (!tokenPart) {
    return undefined;
  }

  return decodeURIComponent(tokenPart.replace('refresh_token=', ''));
}

function setRefreshTokenCookie(reply: { header: (name: string, value: string) => unknown }, token: string): void {
  reply.header('Set-Cookie', buildRefreshTokenSetCookieHeader(token));
}

function clearRefreshTokenCookie(reply: { header: (name: string, value: string) => unknown }): void {
  reply.header('Set-Cookie', buildRefreshTokenClearCookieHeader());
}

function extractAbuseRiskContext(headers: Record<string, unknown>): {
  sessionId?: string;
  deviceFingerprint?: string;
  tlsFingerprint?: string;
  userAgent?: string;
} {
  const header = (name: string): string | undefined => {
    const value = headers[name];
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 256) : undefined;
  };

  const sessionId = header('x-session-id') ?? header('x-session-token');
  const deviceFingerprint = header('x-device-fingerprint');
  const tlsFingerprint = header('x-ja3-fingerprint');
  const userAgent = header('user-agent');

  return {
    ...(sessionId ? { sessionId } : {}),
    ...(deviceFingerprint ? { deviceFingerprint } : {}),
    ...(tlsFingerprint ? { tlsFingerprint } : {}),
    ...(userAgent ? { userAgent } : {})
  };
}

export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const authService = new AuthService(fastify);
  const adminInvitesService = new AdminInvitesService(fastify);
  const opsService = new OpsService(fastify);
  fastify.addHook('onSend', async (request, reply, payload) => {
    await idempotencyOnSend(request, reply, payload);
    return payload;
  });

  fastify.post(
    '/api/v1/auth/register',
    {
      schema: registerSchema,
      preHandler: [idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request, reply) => {
      const auth = await authService.register(request.body as never, {
        clientIp: request.ip,
        risk: extractAbuseRiskContext(request.headers as Record<string, unknown>)
      });
      setRefreshTokenCookie(reply, auth.refreshToken);
      return {
        accessToken: auth.accessToken,
        user: auth.user
      };
    }
  );

  fastify.get(
    '/api/v1/auth/otp-channel',
    {
      schema: otpChannelConfigSchema,
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async () => authService.getCustomerOtpChannelConfig()
  );

  fastify.get(
    '/api/v1/auth/admin/otp-channel',
    {
      schema: adminOtpChannelConfigSchema,
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async () => authService.getAdminOtpChannelConfig()
  );

  fastify.post(
    '/api/v1/auth/send-otp',
    {
      schema: sendOtpSchema,
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request) =>
      authService.sendOtp(request.body as never, {
        clientIp: request.ip,
        risk: extractAbuseRiskContext(request.headers as Record<string, unknown>)
      })
  );

  fastify.post(
    '/api/v1/auth/verify-otp',
    {
      schema: verifyOtpSchema,
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request, reply) => {
      const auth = await authService.verifyOtp(request.body as never, {
        clientIp: request.ip,
        risk: extractAbuseRiskContext(request.headers as Record<string, unknown>)
      });
      setRefreshTokenCookie(reply, auth.refreshToken);
      return {
        accessToken: auth.accessToken,
        user: auth.user
      };
    }
  );

  fastify.post(
    '/api/v1/auth/signup-phone',
    {
      schema: signupPhoneSchema,
      preHandler: [idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request, reply) => {
      const auth = await authService.verifyOtpAndSignup(request.body as never, {
        clientIp: request.ip,
        risk: extractAbuseRiskContext(request.headers as Record<string, unknown>)
      });
      setRefreshTokenCookie(reply, auth.refreshToken);
      return {
        accessToken: auth.accessToken,
        user: auth.user
      };
    }
  );

  fastify.post(
    '/api/v1/auth/forgot-password',
    {
      schema: forgotPasswordSchema,
      preHandler: [idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request) =>
      authService.requestPasswordReset(request.body as never, {
        clientIp: request.ip,
        risk: extractAbuseRiskContext(request.headers as Record<string, unknown>)
      })
  );

  fastify.post(
    '/api/v1/auth/reset-password',
    {
      schema: resetPasswordSchema,
      preHandler: [idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request) => authService.resetPassword(request.body as never)
  );

  // Lightweight existence check — used by login forms to give early "not registered" feedback.
  fastify.post(
    '/api/v1/auth/check-identifier',
    {
      schema: checkIdentifierSchema,
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request) => authService.checkIdentifier(request.body as never)
  );

  fastify.post(
    '/api/v1/auth/login',
    {
      schema: loginSchema,
      preHandler: [idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.authLogin
      }
    },
    async (request, reply) => {
      const auth = await authService.login(request.body as never, {
        clientIp: request.ip,
        risk: extractAbuseRiskContext(request.headers as Record<string, unknown>)
      });
      setRefreshTokenCookie(reply, auth.refreshToken);
      return {
        accessToken: auth.accessToken,
        user: auth.user
      };
    }
  );

  fastify.post(
    '/api/v1/auth/refresh',
    {
      schema: refreshSchema,
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request, reply) => {
      const token = parseRefreshTokenFromCookie(request.headers.cookie);
      try {
        const refreshed = await authService.refresh(token ?? '', {
          clientIp: request.ip,
          risk: extractAbuseRiskContext(request.headers as Record<string, unknown>)
        });
        setRefreshTokenCookie(reply, refreshed.refreshToken);
        return { accessToken: refreshed.accessToken };
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === ERROR_CODES.UNAUTHORISED
        ) {
          clearRefreshTokenCookie(reply);
        }
        throw error;
      }
    }
  );

  fastify.post(
    '/api/v1/auth/logout',
    {
      schema: logoutSchema,
      preHandler: [
        jwtVerifyGuard,
        async (request, reply) => {
          if (request.user?.role === Role.CUSTOMER || request.user?.role === Role.ADMIN) {
            return;
          }
          await rolesGuard(Role.CUSTOMER)(request, reply);
        }
      ]
    },
    async (request, reply) => {
      const user = getCurrentUser(request);
      const token = parseRefreshTokenFromCookie(request.headers.cookie);
      const result = await authService.logout(user.sub, token, user.sid);
      clearRefreshTokenCookie(reply);
      return result;
    }
  );

  fastify.post(
    '/api/v1/auth/admin/login/request-otp',
    {
      schema: adminLoginRequestOtpSchema,
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request) => {
      const body = request.body as { email: string; password: string; turnstileToken?: string };
      return authService.requestAdminLoginOtp({
        email: body.email,
        password: body.password,
        clientIp: request.ip,
        ...(body.turnstileToken ? { turnstileToken: body.turnstileToken } : {}),
        risk: extractAbuseRiskContext(request.headers as Record<string, unknown>)
      });
    }
  );

  fastify.post(
    '/api/v1/auth/admin/login/verify-otp',
    {
      schema: adminLoginVerifyOtpSchema,
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request, reply) => {
      const body = request.body as { email: string; otp: string };
      const auth = await authService.verifyAdminLoginOtp({
        email: body.email,
        otp: body.otp,
        clientIp: request.ip,
        risk: extractAbuseRiskContext(request.headers as Record<string, unknown>)
      });
      setRefreshTokenCookie(reply, auth.refreshToken);
      return {
        accessToken: auth.accessToken,
        admin: auth.user
      };
    }
  );

  fastify.post(
    '/api/v1/ops/admin-invites',
    {
      schema: adminInviteCreateSchema,
      preHandler: [opsAuthGuard, opsPermissionGuard('ops:write')],
      config: {
        rateLimit: routeRateLimitProfiles.opsCritical
      }
    },
    async (request) => {
      const body = request.body as {
        email: string;
        name: string;
        permissions: string[];
        setupBaseUrl: string;
      };
      return adminInvitesService.createAdminInvite({
        ...(request.opsUser?.id ? { createdByOpsUserId: request.opsUser.id } : {}),
        inviteEmail: body.email,
        inviteName: body.name,
        permissions: body.permissions,
        setupBaseUrl: body.setupBaseUrl
      });
    }
  );

  fastify.get(
    '/api/v1/ops/admin-invites',
    {
      schema: adminInviteListSchema,
      preHandler: [opsAuthGuard, opsPermissionGuard('ops:read')],
      config: {
        rateLimit: routeRateLimitProfiles.opsRead
      }
    },
    async (request) => {
      const query = request.query as {
        status?: 'CREATED' | 'EMAIL_SENT' | 'CONSUMED' | 'CANCELLED' | 'EXPIRED_CLEANED';
        page?: number;
        limit?: number;
      };
      return adminInvitesService.listAdminInvites(query);
    }
  );

  fastify.post(
    '/api/v1/ops/admin-invites/:inviteId/revoke',
    {
      schema: adminInviteRevokeSchema,
      preHandler: [opsAuthGuard, opsPermissionGuard('ops:write')],
      config: {
        rateLimit: routeRateLimitProfiles.opsCritical
      }
    },
    async (request) => {
      const opsUser = request.opsUser;
      if (!opsUser) {
        throw new AppError(ERROR_CODES.UNAUTHORISED, 'Ops authentication required', 401);
      }
      const params = request.params as { inviteId: string };
      const body = request.body as { challengeId: string; otpCode: string };

      await opsService.verifyEmailOtp({
        opsUserId: opsUser.id,
        challengeId: body.challengeId,
        code: body.otpCode,
        expectedAction: 'invite-revoke',
        requestIp: request.ip,
        requestPath: request.url,
        method: request.method
      });

      return adminInvitesService.revokeAdminInvite({
        inviteId: params.inviteId,
        revokerOpsUserId: opsUser.id
      });
    }
  );

  fastify.post(
    '/api/v1/admin/invites/setup/send-otp',
    {
      schema: adminInviteSetupOtpSchema,
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request) => {
      const body = request.body as { token: string; name: string; password: string; phone?: string };
      return adminInvitesService.sendSetupOtp({
        inviteToken: body.token,
        name: body.name,
        password: body.password,
        ...(body.phone ? { phone: body.phone } : {})
      });
    }
  );

  fastify.post(
    '/api/v1/admin/invites/consume',
    {
      schema: adminInviteConsumeSchema,
      config: {
        rateLimit: routeRateLimitProfiles.authSensitive
      }
    },
    async (request) => {
      const body = request.body as { token: string; otp: string };
      return adminInvitesService.consumeAdminInvite({
        inviteToken: body.token,
        otp: body.otp
      });
    }
  );

  fastify.post(
    '/api/v1/ops/admin-invites/cleanup-expired',
    {
      schema: adminInviteCleanupSchema,
      preHandler: [opsAuthGuard, opsPermissionGuard('ops:write')],
      config: {
        rateLimit: routeRateLimitProfiles.opsCritical
      }
    },
    async (request) => {
      const opsUser = (request as unknown as { opsUser?: { id: string } }).opsUser;
      return adminInvitesService.cleanupExpiredAdminInvites(opsUser ? { actorOpsUserId: opsUser.id } : {});
    }
  );

}

