import { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
import { jwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import { idempotencyOnSend, idempotencyPreHandler } from '@common/idempotency/idempotency';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { loadShedGuard } from '@common/reliability/load-shed.guard';
import {
  getCodSettingsSchema,
  getBoxPresetsSchema,
  getInventorySettingsSchema,
  getNotificationSettingsSchema,
  getPublicStoreConfigSchema,
  getShippingSettingsSchema,
  getStoreProfileSchema,
  updateBoxPresetsSchema,
  updateCodSettingsSchema,
  updateInventorySettingsSchema,
  updateNotificationSettingsSchema,
  updateShippingSettingsSchema,
  updateStoreProfileSchema
} from './settings.schemas';
import { SettingsService } from './settings.service';

export async function registerSettingsRoutes(fastify: FastifyInstance): Promise<void> {
  const settingsService = new SettingsService(fastify);
  const adminGuard = [jwtAuthGuard, rolesGuard(Role.ADMIN)];

  // ── Public storefront config — no auth ─────────────────────────────────────
  // Returns only the customer-UI-relevant subset (COD availability, minimum
  // order value). Never exposes sensitive fields.
  fastify.get(
    '/api/v1/store/config',
    {
      schema: getPublicStoreConfigSchema,
      config: { rateLimit: routeRateLimitProfiles.catalogRead }
    },
    async () => settingsService.getPublicStoreConfig()
  );

  fastify.addHook('onSend', async (request, reply, payload) => {
    await idempotencyOnSend(request, reply, payload);
    return payload;
  });

  fastify.get(
    '/api/v1/admin/settings/shipping',
    {
      schema: getShippingSettingsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async () => settingsService.getShippingSettings()
  );

  fastify.patch(
    '/api/v1/admin/settings/shipping',
    {
      schema: updateShippingSettingsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => settingsService.updateShippingSettings(request.body as never)
  );

  fastify.get(
    '/api/v1/admin/settings/store',
    {
      schema: getStoreProfileSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async () => settingsService.getStoreProfile()
  );

  fastify.patch(
    '/api/v1/admin/settings/store',
    {
      schema: updateStoreProfileSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => settingsService.updateStoreProfile(request.body as never)
  );

  fastify.get(
    '/api/v1/admin/settings/notifications',
    {
      schema: getNotificationSettingsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async () => settingsService.getNotificationSettings()
  );

  fastify.patch(
    '/api/v1/admin/settings/notifications',
    {
      schema: updateNotificationSettingsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => settingsService.updateNotificationSettings(request.body as never)
  );

  fastify.get(
    '/api/v1/admin/settings/inventory',
    {
      schema: getInventorySettingsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async () => settingsService.getInventorySettings()
  );

  fastify.patch(
    '/api/v1/admin/settings/inventory',
    {
      schema: updateInventorySettingsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => settingsService.updateInventorySettings(request.body as never)
  );

  fastify.get(
    '/api/v1/admin/settings/cod',
    {
      schema: getCodSettingsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:read')],
      config: { rateLimit: routeRateLimitProfiles.adminRead }
    },
    async () => settingsService.getCodSettings()
  );

  fastify.patch(
    '/api/v1/admin/settings/cod',
    {
      schema: updateCodSettingsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard, idempotencyPreHandler],
      config: { rateLimit: routeRateLimitProfiles.adminWrite }
    },
    async (request) => settingsService.updateCodSettings(request.body as never)
  );

  fastify.get(
    '/api/v1/admin/settings/box-presets',
    {
      schema: getBoxPresetsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:read')],
      config: { rateLimit: routeRateLimitProfiles.adminRead }
    },
    async () => settingsService.getBoxPresets()
  );

  fastify.patch(
    '/api/v1/admin/settings/box-presets',
    {
      schema: updateBoxPresetsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard, idempotencyPreHandler],
      config: { rateLimit: routeRateLimitProfiles.adminWrite }
    },
    async (request) => settingsService.updateBoxPresets(request.body as never)
  );
}
