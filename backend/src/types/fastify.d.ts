import type { CheckoutRiskAssessmentPort } from '@common/interfaces/checkout-risk.interface';
import type { AdminDutyRole, AdminPermission } from '@common/auth/admin-permissions';
import type { OpsPermissionScope, OpsPermissionValue } from '@common/auth/ops-permissions';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { QueueRegistry } from '@queues/queue-registry';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
    queues: QueueRegistry;
    /** Set via `fastify.decorate` before orders routes, or defaulted inside `registerOrdersRoutes`. */
    checkoutRisk?: CheckoutRiskAssessmentPort;
  }

  interface FastifyRequest {
    correlationId?: string;
    traceId?: string;
    idempotencyContext?: {
      id: string;
      route: string;
    };
    adminControlDecision?: {
      permission: AdminPermission;
      layer: 'A' | 'B' | 'C';
      role: AdminDutyRole;
      requiresApproval: boolean;
    };
    opsUser?: {
      id: string;
      email: string;
      name: string;
      permissions: OpsPermissionValue[];
    };
    opsControlDecision?: {
      permission: OpsPermissionScope;
    };
  }
}

