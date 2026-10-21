import { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
import { jwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { loadShedGuard } from '@common/reliability/load-shed.guard';
import {
  dashboardActionQueueSchema,
  dashboardKpisSchema,
  dashboardOrderStatusCountsSchema,
  dashboardSalesChartSchema,
  dashboardTopProductsSchema
} from './dashboard.schemas';
import { DashboardService } from './dashboard.service';

export async function registerDashboardRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new DashboardService(fastify);
  const adminGuard = [jwtAuthGuard, rolesGuard(Role.ADMIN), loadShedGuard];

  fastify.get(
    '/api/v1/admin/dashboard/kpis',
    {
      schema: dashboardKpisSchema,
      preHandler: [...adminGuard, adminPermissionGuard('dashboard:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => service.getKpis(request.query as never)
  );

  fastify.get(
    '/api/v1/admin/dashboard/sales-chart',
    {
      schema: dashboardSalesChartSchema,
      preHandler: [...adminGuard, adminPermissionGuard('dashboard:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => service.getSalesChart(request.query as never)
  );

  fastify.get(
    '/api/v1/admin/dashboard/top-products',
    {
      schema: dashboardTopProductsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('dashboard:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => service.getTopProducts(request.query as never)
  );

  fastify.get(
    '/api/v1/admin/dashboard/action-queue',
    {
      schema: dashboardActionQueueSchema,
      preHandler: [...adminGuard, adminPermissionGuard('dashboard:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async () => service.getActionQueue()
  );

  fastify.get(
    '/api/v1/admin/dashboard/order-status-counts',
    {
      schema: dashboardOrderStatusCountsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('orders:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => service.getOrderStatusCounts(request.query as never)
  );
}
