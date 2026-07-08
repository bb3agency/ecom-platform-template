import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import {
  getProductMediaStorage,
  hostedStorageReferenceFromUrl,
  isLocalMediaProviderActive
} from './product-media-provider';
import { CATEGORY_IMAGE_MEDIA_PATH_PREFIX, GALLERY_IMAGE_MEDIA_PATH_PREFIX, PRODUCT_IMAGE_MEDIA_PATH_PREFIX } from './product-media.constants';
import { serveCategoryImageSchema, serveGalleryImageSchema, serveProductImageSchema } from './media.schemas';

export async function registerMediaRoutes(fastify: FastifyInstance): Promise<void> {
  if (!isLocalMediaProviderActive()) {
    fastify.log.info(
      'Skipping GET /api/v1/media/products/* — MEDIA_STORAGE_PROVIDER is not local (images served from R2/CDN)'
    );
    return;
  }

  fastify.get(
    '/api/v1/media/products/:productId/:filename',
    {
      schema: serveProductImageSchema,
      config: {
        rateLimit: routeRateLimitProfiles.catalogRead
      }
    },
    async (request, reply) => {
      const params = request.params as { productId: string; filename: string };
      const mediaPath = `${PRODUCT_IMAGE_MEDIA_PATH_PREFIX}${params.productId}/${params.filename}`;
      const storageReference = hostedStorageReferenceFromUrl(mediaPath);

      const storage = getProductMediaStorage();
      if (!storageReference || !storage.readProductImage) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Image not found', 404);
      }

      const { buffer, mime } = await storage.readProductImage(storageReference);
      reply
        .header('Content-Type', mime)
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000')
        .header('CDN-Cache-Control', 'public, max-age=31536000');
      return reply.send(buffer);
    }
  );

  fastify.get(
    '/api/v1/media/categories/:categoryId/:filename',
    {
      schema: serveCategoryImageSchema,
      config: {
        rateLimit: routeRateLimitProfiles.catalogRead
      }
    },
    async (request, reply) => {
      const params = request.params as { categoryId: string; filename: string };
      const mediaPath = `${CATEGORY_IMAGE_MEDIA_PATH_PREFIX}${params.categoryId}/${params.filename}`;
      const storageReference = hostedStorageReferenceFromUrl(mediaPath);

      const storage = getProductMediaStorage();
      if (!storageReference || !storage.readProductImage) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Image not found', 404);
      }

      const { buffer, mime } = await storage.readProductImage(storageReference);
      reply
        .header('Content-Type', mime)
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000')
        .header('CDN-Cache-Control', 'public, max-age=31536000');
      return reply.send(buffer);
    }
  );

  fastify.get(
    '/api/v1/media/gallery/:imageId/:filename',
    {
      schema: serveGalleryImageSchema,
      config: {
        rateLimit: routeRateLimitProfiles.catalogRead
      }
    },
    async (request, reply) => {
      const params = request.params as { imageId: string; filename: string };
      const mediaPath = `${GALLERY_IMAGE_MEDIA_PATH_PREFIX}${params.imageId}/${params.filename}`;
      const storageReference = hostedStorageReferenceFromUrl(mediaPath);

      const storage = getProductMediaStorage();
      if (!storageReference || !storage.readProductImage) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Image not found', 404);
      }

      const { buffer, mime } = await storage.readProductImage(storageReference);
      reply
        .header('Content-Type', mime)
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000')
        .header('CDN-Cache-Control', 'public, max-age=31536000');
      return reply.send(buffer);
    }
  );
}
