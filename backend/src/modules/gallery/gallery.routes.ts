import { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
import { jwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { idempotencyOnSend, idempotencyPreHandler } from '@common/idempotency/idempotency';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { loadShedGuard } from '@common/reliability/load-shed.guard';
import { PRODUCT_IMAGE_MAX_BYTES } from '@modules/media/product-media.constants';
import {
  adminDeleteGalleryImageSchema,
  adminListGallerySchema,
  adminReorderGallerySchema,
  adminUpdateGalleryImageSchema,
  adminUploadGalleryImageSchema,
  getPublicGallerySchema
} from './gallery.schemas';
import { GalleryService } from './gallery.service';

export async function registerGalleryRoutes(fastify: FastifyInstance): Promise<void> {
  const galleryService = new GalleryService(fastify);
  const adminGuard = [jwtAuthGuard, rolesGuard(Role.ADMIN)];

  // ── Public storefront gallery — no auth. Empty when galleryEnabled is false. ──
  fastify.get(
    '/api/v1/gallery',
    {
      schema: getPublicGallerySchema,
      config: { rateLimit: routeRateLimitProfiles.catalogRead }
    },
    async () => galleryService.listPublic()
  );

  fastify.addHook('onSend', async (request, reply, payload) => {
    await idempotencyOnSend(request, reply, payload);
    return payload;
  });

  fastify.get(
    '/api/v1/admin/gallery',
    {
      schema: adminListGallerySchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:read')],
      config: { rateLimit: routeRateLimitProfiles.adminRead }
    },
    async () => galleryService.adminList()
  );

  fastify.post(
    '/api/v1/admin/gallery',
    {
      schema: adminUploadGalleryImageSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard, idempotencyPreHandler],
      config: { rateLimit: routeRateLimitProfiles.adminWrite }
    },
    async (request) => {
      if (!request.isMultipart()) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          'Image upload requires multipart/form-data',
          400
        );
      }

      let file: { buffer: Buffer; mimeType: string | null } | null = null;
      let caption: string | null = null;
      let altText: string | null = null;

      for await (const part of request.parts()) {
        if (part.type === 'file' && (part.fieldname === 'file' || part.fieldname === 'files')) {
          const buffer = await part.toBuffer();
          if (buffer.length > PRODUCT_IMAGE_MAX_BYTES) {
            throw new AppError(
              ERROR_CODES.VALIDATION_ERROR,
              `Image must be ${PRODUCT_IMAGE_MAX_BYTES / (1024 * 1024)} MB or smaller`,
              400
            );
          }
          if (!file) {
            file = { buffer, mimeType: part.mimetype };
          }
        } else if (part.type === 'field' && part.fieldname === 'caption') {
          caption = String(part.value);
        } else if (part.type === 'field' && part.fieldname === 'altText') {
          altText = String(part.value);
        }
      }

      if (!file) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Missing image file', 400);
      }

      return galleryService.adminCreateFromUpload({
        buffer: file.buffer,
        mimeType: file.mimeType,
        caption,
        altText
      });
    }
  );

  fastify.patch(
    '/api/v1/admin/gallery/reorder',
    {
      schema: adminReorderGallerySchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard, idempotencyPreHandler],
      config: { rateLimit: routeRateLimitProfiles.adminWrite }
    },
    async (request) => {
      const body = request.body as { orderedIds: string[] };
      return galleryService.adminReorder(body.orderedIds);
    }
  );

  fastify.patch(
    '/api/v1/admin/gallery/:id',
    {
      schema: adminUpdateGalleryImageSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard, idempotencyPreHandler],
      config: { rateLimit: routeRateLimitProfiles.adminWrite }
    },
    async (request) => {
      const params = request.params as { id: string };
      return galleryService.adminUpdate(params.id, request.body as never);
    }
  );

  fastify.delete(
    '/api/v1/admin/gallery/:id',
    {
      schema: adminDeleteGalleryImageSchema,
      preHandler: [...adminGuard, adminPermissionGuard('settings:write'), loadShedGuard, idempotencyPreHandler],
      config: { rateLimit: routeRateLimitProfiles.adminWrite }
    },
    async (request) => {
      const params = request.params as { id: string };
      return galleryService.adminDelete(params.id);
    }
  );
}
