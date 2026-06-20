import { Role } from '@prisma/client';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { getCurrentUser } from '@common/decorators/current-user';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
import { jwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import { idempotencyOnSend, idempotencyPreHandler } from '@common/idempotency/idempotency';
import { AdminRateLimitStore } from '@common/rate-limit/admin-rate-limit.store';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { loadShedGuard } from '@common/reliability/load-shed.guard';
import {
  adminCouponAnalyticsSchema,
  adminCreateCouponSchema,
  adminCloneCouponSchema,
  adminDeleteCouponSchema,
  adminGetCouponByIdSchema,
  adminListCouponAuditSchema,
  adminListCouponsSchema,
  adminRestoreCouponSchema,
  adminStorefrontCouponsStatusSchema,
  adminUpdateStorefrontCouponsStatusSchema,
  adminUpdateCouponSchema,
  adminUpdateCouponStatusSchema
} from './coupons.schemas';
import { AuditMetadata } from './coupons.types';
import { CouponsService } from './coupons.service';

const adminCouponRateLimit = {
  create: { max: 10, windowSeconds: 60 },
  update: { max: 20, windowSeconds: 60 },
  status: { max: 20, windowSeconds: 60 },
  delete: { max: 5, windowSeconds: 60 },
  restore: { max: 5, windowSeconds: 60 }
} as const;

function getAuditMetadata(request: FastifyRequest): AuditMetadata {
  return {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] ?? undefined
  };
}

async function enforceAdminCouponRateLimit(
  request: FastifyRequest,
  action: keyof typeof adminCouponRateLimit
): Promise<void> {
  const user = getCurrentUser(request);
  const policy = adminCouponRateLimit[action];
  const allowed = await AdminRateLimitStore.getInstance(request.server.redis).checkLimit(
    user.sub,
    `coupon:${action}`,
    policy.max,
    policy.windowSeconds
  );

  if (!allowed) {
    throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many coupon operations. Please slow down.', 429);
  }
}

export async function registerCouponsRoutes(fastify: FastifyInstance): Promise<void> {
  // Use singleton pattern for memory efficiency
  const service = CouponsService.getInstance(fastify);
  const adminGuard = [jwtAuthGuard, rolesGuard(Role.ADMIN)];

  fastify.addHook('onSend', async (request, reply, payload) => {
    await idempotencyOnSend(request, reply, payload);
    return payload;
  });

  fastify.get(
    '/api/v1/admin/coupons/analytics',
    {
      schema: adminCouponAnalyticsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('coupons:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => service.adminCouponAnalytics(request.query as never)
  );

  fastify.get(
    '/api/v1/admin/coupons/storefront-status',
    {
      schema: adminStorefrontCouponsStatusSchema,
      preHandler: [...adminGuard, adminPermissionGuard('coupons:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async () => service.getAdminStorefrontCouponsStatus()
  );

  fastify.patch(
    '/api/v1/admin/coupons/storefront-status',
    {
      schema: adminUpdateStorefrontCouponsStatusSchema,
      preHandler: [
        ...adminGuard,
        adminPermissionGuard('coupons:write'),
        loadShedGuard,
        idempotencyPreHandler,
        async (request) => enforceAdminCouponRateLimit(request, 'status')
      ],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const body = request.body as { couponsEnabled: boolean };
      return service.updateStorefrontCouponsEnabled(body.couponsEnabled);
    }
  );

  fastify.get(
    '/api/v1/admin/coupons/:id',
    {
      schema: adminGetCouponByIdSchema,
      preHandler: [...adminGuard, adminPermissionGuard('coupons:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => service.adminGetCouponById((request.params as { id: string }).id)
  );

  fastify.get(
    '/api/v1/admin/coupons',
    {
      schema: adminListCouponsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('coupons:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => service.adminListCoupons(request.query as never, false)
  );

  fastify.post(
    '/api/v1/admin/coupons',
    {
      schema: adminCreateCouponSchema,
      preHandler: [...adminGuard, adminPermissionGuard('coupons:write'), loadShedGuard, idempotencyPreHandler, async (request) => enforceAdminCouponRateLimit(request, 'create')],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return service.adminCreateCoupon(request.body as never, user.sub, getAuditMetadata(request));
    }
  );

  fastify.patch(
    '/api/v1/admin/coupons/:id',
    {
      schema: adminUpdateCouponSchema,
      preHandler: [...adminGuard, adminPermissionGuard('coupons:write'), loadShedGuard, idempotencyPreHandler, async (request) => enforceAdminCouponRateLimit(request, 'update')],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return service.adminUpdateCoupon(
        (request.params as { id: string }).id,
        request.body as never,
        user.sub,
        getAuditMetadata(request)
      );
    }
  );

  fastify.patch(
    '/api/v1/admin/coupons/:id/status',
    {
      schema: adminUpdateCouponStatusSchema,
      preHandler: [...adminGuard, adminPermissionGuard('coupons:write'), loadShedGuard, idempotencyPreHandler, async (request) => enforceAdminCouponRateLimit(request, 'status')],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return service.adminUpdateCouponStatus(
        (request.params as { id: string }).id,
        request.body as never,
        user.sub,
        getAuditMetadata(request)
      );
    }
  );

  fastify.delete(
    '/api/v1/admin/coupons/:id',
    {
      schema: adminDeleteCouponSchema,
      preHandler: [...adminGuard, adminPermissionGuard('coupons:write'), loadShedGuard, idempotencyPreHandler, async (request) => enforceAdminCouponRateLimit(request, 'delete')],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return service.adminDeleteCoupon(
        (request.params as { id: string }).id,
        user.sub,
        getAuditMetadata(request)
      );
    }
  );

  // Restore soft-deleted coupon
  fastify.post(
    '/api/v1/admin/coupons/:id/restore',
    {
      schema: adminRestoreCouponSchema,
      preHandler: [...adminGuard, adminPermissionGuard('coupons:write'), loadShedGuard, idempotencyPreHandler, async (request) => enforceAdminCouponRateLimit(request, 'restore')],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const user = getCurrentUser(request);
      return service.adminRestoreCoupon(
        (request.params as { id: string }).id,
        user.sub,
        getAuditMetadata(request)
      );
    }
  );

  // Clone coupon
  fastify.post(
    '/api/v1/admin/coupons/:id/clone',
    {
      schema: adminCloneCouponSchema,
      preHandler: [...adminGuard, adminPermissionGuard('coupons:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request, reply) => {
      const user = getCurrentUser(request);
      const body = request.body as { newCode: string; validFrom?: string; validUntil?: string };
      const overrides: { validFrom?: string; validUntil?: string } = {};
      if (body.validFrom) overrides.validFrom = body.validFrom;
      if (body.validUntil) overrides.validUntil = body.validUntil;
      const result = await service.adminCloneCoupon(
        (request.params as { id: string }).id,
        body.newCode,
        user.sub,
        overrides,
        getAuditMetadata(request)
      );
      reply.code(201);
      return result;
    }
  );

  // Get coupon audit logs
  fastify.get(
    '/api/v1/admin/coupons/:id/audit',
    {
      schema: adminListCouponAuditSchema,
      preHandler: [...adminGuard, adminPermissionGuard('coupons:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => service.getCouponAuditLogs(
      (request.params as { id: string }).id,
      request.query as never
    )
  );
}
