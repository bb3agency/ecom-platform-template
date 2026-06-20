import { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
import { jwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import { idempotencyOnSend, idempotencyPreHandler } from '@common/idempotency/idempotency';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { loadShedGuard } from '@common/reliability/load-shed.guard';
import {
  adminBulkUpdateInventorySchema,
  adminInventoryHistorySchema,
  listInventorySchema,
  lowStockSchema,
  updateInventorySchema
} from './inventory.schemas';
import { InventoryService } from './inventory.service';

export async function registerInventoryRoutes(fastify: FastifyInstance): Promise<void> {
  const inventoryService = new InventoryService(fastify);
  const adminGuard = [jwtAuthGuard, rolesGuard(Role.ADMIN)];

  fastify.addHook('onSend', async (request, reply, payload) => {
    await idempotencyOnSend(request, reply, payload);
    return payload;
  });

  fastify.get(
    '/api/v1/admin/inventory',
    {
      schema: listInventorySchema,
      preHandler: [...adminGuard, adminPermissionGuard('inventory:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => inventoryService.listInventory(request.query as never)
  );

  fastify.get(
    '/api/v1/admin/inventory/low-stock',
    {
      schema: lowStockSchema,
      preHandler: [...adminGuard, adminPermissionGuard('inventory:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async () => inventoryService.listLowStock()
  );

  fastify.post(
    '/api/v1/admin/inventory/bulk-update',
    {
      schema: adminBulkUpdateInventorySchema,
      preHandler: [...adminGuard, adminPermissionGuard('inventory:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => inventoryService.adminBulkUpdateInventory(request.body as never)
  );

  fastify.patch(
    '/api/v1/admin/inventory/:variantId',
    {
      schema: updateInventorySchema,
      preHandler: [...adminGuard, adminPermissionGuard('inventory:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { variantId: string };
      return inventoryService.updateInventory(params.variantId, request.body as never);
    }
  );

  fastify.get(
    '/api/v1/admin/inventory/history/:variantId',
    {
      schema: adminInventoryHistorySchema,
      preHandler: [...adminGuard, adminPermissionGuard('inventory:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const params = request.params as { variantId: string };
      return inventoryService.adminGetInventoryHistory(params.variantId, request.query as never);
    }
  );

}

