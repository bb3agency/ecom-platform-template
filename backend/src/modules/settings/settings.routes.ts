import { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
import { jwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import { idempotencyOnSend, idempotencyPreHandler } from '@common/idempotency/idempotency';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { loadShedGuard } from '@common/reliability/load-shed.guard';
import {
  deleteStoreLogoSchema,
  getCodSettingsSchema,
  getBoxPresetsSchema,
  getInventorySettingsSchema,
  getLocalDeliverySettingsSchema,
  getNotificationSettingsSchema,
  getPublicStoreConfigSchema,
  getShippingSettingsSchema,
  getStoreProfileSchema,
  updateBoxPresetsSchema,
  updateCodSettingsSchema,
  updateInventorySettingsSchema,
  updateLocalDeliverySettingsSchema,
  updateNotificationSettingsSchema,
  updateShippingSettingsSchema,
  updateStoreProfileSchema,
  uploadStoreLogoSchema,
  serveStoreLogoSchema
} from './settings.schemas';
import { SettingsService } from './settings.service';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

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

  // Public store logo — serves the UPLOADED logo bytes from the StoreSettings row.
  // Registered unconditionally (unlike /media/products/* it does not depend on the
  // media storage provider). Short cache: the merchant can replace the logo any
  // time; the admin panel busts with ?v=.
  fastify.get(
    '/api/v1/store/logo',
    {
      schema: serveStoreLogoSchema,
      config: { rateLimit: routeRateLimitProfiles.catalogRead }
    },
    async (_request, reply) => {
      const logo = await settingsService.getStoreLogo();
      if (!logo) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'No store logo uploaded', 404);
      }
      reply
        .header('Content-Type', logo.mimeType)
        .header('Cache-Control', 'public, max-age=300');
      return reply.send(logo.data);
    }
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

  // Invoice/brand logo upload — multipart file, stored in the StoreSettings row
  // (PNG/JPG only, magic-byte validated, 2MB cap). Wins over logoUrl on invoices.
  fastify.post(
    '/api/v1/admin/settings/store/logo',
    {
      schema: uploadStoreLogoSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      if (!request.isMultipart()) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          'Logo upload requires multipart/form-data',
          400
        );
      }
      let buffer: Buffer | null = null;
      for await (const part of request.parts()) {
        if (part.type === 'file' && (part.fieldname === 'file' || part.fieldname === 'logo')) {
          buffer = await part.toBuffer();
        }
      }
      if (!buffer) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'No logo file provided', 400);
      }
      return settingsService.uploadStoreLogo(buffer);
    }
  );

  fastify.delete(
    '/api/v1/admin/settings/store/logo',
    {
      schema: deleteStoreLogoSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async () => settingsService.deleteStoreLogo()
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
    '/api/v1/admin/settings/local-delivery',
    {
      schema: getLocalDeliverySettingsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:read')],
      config: { rateLimit: routeRateLimitProfiles.adminRead }
    },
    async () => settingsService.getLocalDeliverySettings()
  );

  fastify.patch(
    '/api/v1/admin/settings/local-delivery',
    {
      schema: updateLocalDeliverySettingsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard, idempotencyPreHandler],
      config: { rateLimit: routeRateLimitProfiles.adminWrite }
    },
    async (request) => settingsService.updateLocalDeliverySettings(request.body as never)
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
