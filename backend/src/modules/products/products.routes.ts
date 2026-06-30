import { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
import { jwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { rolesGuard } from '@common/guards/roles.guard';
import {
  adminCreateProductImageSchema,
  adminUploadProductImageSchema,
  adminGetProductByIdSchema,
  adminGetCategoryByIdSchema,
  adminImportProductsCsvSchema,
  adminListCategoriesSchema,
  adminListProductsSchema,
  adminCreateCategorySchema,
  adminCreateProductSchema,
  adminCreateProductVariantSchema,
  adminDeleteCategorySchema,
  adminHardDeleteCategorySchema,
  adminDeleteProductSchema,
  adminHardDeleteProductSchema,
  adminDeleteProductVariantSchema,
  adminUpdateCategorySchema,
  adminUpdateProductSchema,
  adminUpdateProductVariantSchema,
  adminReorderProductVariantsSchema,
  adminReorderProductImagesSchema,
  adminDeleteProductImageSchema,
  getProductBySlugSchema,
  listCategoriesSchema,
  listProductsByCategorySchema,
  listProductsSchema
} from './products.schemas';
import { ProductsService } from './products.service';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { PRODUCT_IMAGE_MAX_BYTES } from '@modules/media/product-media.constants';
import { idempotencyOnSend, idempotencyPreHandler } from '@common/idempotency/idempotency';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { loadShedGuard } from '@common/reliability/load-shed.guard';

export async function registerProductsRoutes(fastify: FastifyInstance): Promise<void> {
  const productsService = new ProductsService(fastify);
  fastify.addHook('onSend', async (request, reply, payload) => {
    await idempotencyOnSend(request, reply, payload);
    return payload;
  });

  fastify.get(
    '/api/v1/products',
    {
      schema: listProductsSchema,
      config: {
        rateLimit: routeRateLimitProfiles.catalogRead
      }
    },
    async (request) => productsService.listProducts(request.query as never)
  );

  fastify.get(
    '/api/v1/products/categories',
    {
      schema: listCategoriesSchema,
      config: {
        rateLimit: routeRateLimitProfiles.catalogRead
      }
    },
    async (request) => productsService.listCategories(request.query as never)
  );

  fastify.get(
    '/api/v1/products/categories/:slug/products',
    {
      schema: listProductsByCategorySchema,
      config: {
        rateLimit: routeRateLimitProfiles.catalogRead
      }
    },
    async (request) => {
      const params = request.params as { slug: string };
      return productsService.listProducts(request.query as never, params.slug);
    }
  );

  fastify.get(
    '/api/v1/products/:slug',
    {
      schema: getProductBySlugSchema,
      config: {
        rateLimit: routeRateLimitProfiles.catalogRead
      }
    },
    async (request) => {
      const params = request.params as { slug: string };
      return productsService.getProductBySlug(params.slug);
    }
  );

  const adminGuard = [jwtAuthGuard, rolesGuard(Role.ADMIN)];

  fastify.get(
    '/api/v1/admin/products',
    {
      schema: adminListProductsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => productsService.adminListProducts(request.query as never)
  );

  fastify.get(
    '/api/v1/admin/products/:id',
    {
      schema: adminGetProductByIdSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return productsService.adminGetProductById(params.id);
    }
  );

  fastify.post(
    '/api/v1/admin/products/import-csv',
    {
      schema: adminImportProductsCsvSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      if (!request.isMultipart()) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'CSV upload requires multipart/form-data', 400);
      }

      const file = await request.file();
      if (!file) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Missing CSV file', 400);
      }

      const csvBuffer = await file.toBuffer();
      const csv = csvBuffer.toString('utf8');
      if (csv.trim().length === 0) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'CSV file is empty', 400);
      }

      return productsService.adminImportProductsCsv({ csv });
    }
  );

  fastify.post(
    '/api/v1/admin/products',
    {
      schema: adminCreateProductSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => productsService.adminCreateProduct(request.body as never)
  );

  fastify.patch(
    '/api/v1/admin/products/:id/variants/:variantId',
    {
      schema: adminUpdateProductVariantSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string; variantId: string };
      return productsService.adminUpdateProductVariant(params.id, params.variantId, request.body as never);
    }
  );

  fastify.post(
    '/api/v1/admin/products/:id/variants',
    {
      schema: adminCreateProductVariantSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return productsService.adminCreateProductVariant(params.id, request.body as never);
    }
  );

  fastify.patch(
    '/api/v1/admin/products/:id',
    {
      schema: adminUpdateProductSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return productsService.adminUpdateProduct(params.id, request.body as never);
    }
  );

  fastify.post(
    '/api/v1/admin/products/:id/images',
    {
      schema: adminCreateProductImageSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return productsService.adminCreateProductImage(params.id, request.body as never);
    }
  );

  fastify.post(
    '/api/v1/admin/products/:id/images/upload',
    {
      schema: adminUploadProductImageSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      if (!request.isMultipart()) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          'Image upload requires multipart/form-data',
          400
        );
      }

      const params = request.params as { id: string };
      const files: Array<{ buffer: Buffer; mimeType: string | null }> = [];
      let altText = '';
      let sortOrderOverride: number | undefined;

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
          files.push({ buffer, mimeType: part.mimetype });
          continue;
        }
        if (part.type === 'field') {
          const raw = part.value;
          const value = (
            typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : ''
          ).trim();
          if (part.fieldname === 'altText') altText = value;
          if (part.fieldname === 'sortOrder') {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed >= 0) {
              sortOrderOverride = Math.floor(parsed);
            }
          }
        }
      }

      if (files.length === 0) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Missing image file', 400);
      }

      const defaultAlt = altText || 'Product image';
      const uploads = files.map((file) => ({
        buffer: file.buffer,
        mimeType: file.mimeType,
        altText: defaultAlt,
        ...(sortOrderOverride !== undefined ? { sortOrderHint: sortOrderOverride } : {})
      }));

      const items = await productsService.adminUploadProductImages(params.id, uploads);
      // Map to the response DTO shape. Returning the raw Prisma row (which also
      // has createdAt/updatedAt) makes fast-json-stringify fail to resolve the
      // `oneOf` response schema (additionalProperties:false) and throw
      // "The value of '#' does not match schema definition" → a 500 *after* the
      // image is already saved to R2 + DB. Stripping to the declared fields fixes it.
      const toImageDto = (image: {
        id: string;
        productId: string;
        url: string;
        altText: string;
        sortOrder: number;
      }) => ({
        id: image.id,
        productId: image.productId,
        url: image.url,
        altText: image.altText,
        sortOrder: image.sortOrder
      });
      const dtos = items.map(toImageDto);
      return dtos.length === 1 ? dtos[0]! : { items: dtos };
    }
  );

  fastify.patch(
    '/api/v1/admin/products/:id/images/reorder',
    {
      schema: adminReorderProductImagesSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return productsService.adminReorderProductImages(params.id, request.body as never);
    }
  );

  fastify.delete(
    '/api/v1/admin/products/:id/images/:imageId',
    {
      schema: adminDeleteProductImageSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string; imageId: string };
      return productsService.adminDeleteProductImage(params.id, params.imageId);
    }
  );

  fastify.patch(
    '/api/v1/admin/products/:id/variants/reorder',
    {
      schema: adminReorderProductVariantsSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      const body = request.body as { variantIds: string[] };
      return productsService.adminReorderProductVariants(params.id, body.variantIds);
    }
  );

  fastify.delete(
    '/api/v1/admin/products/:id/variants/:variantId',
    {
      schema: adminDeleteProductVariantSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string; variantId: string };
      return productsService.adminDeleteProductVariant(params.id, params.variantId);
    }
  );

  fastify.delete(
    '/api/v1/admin/products/:id',
    {
      schema: adminDeleteProductSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return productsService.adminDeleteProduct(params.id);
    }
  );

  fastify.delete(
    '/api/v1/admin/products/:id/permanent',
    {
      schema: adminHardDeleteProductSchema,
      preHandler: [...adminGuard, adminPermissionGuard('products:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return productsService.adminHardDeleteProduct(params.id);
    }
  );

  fastify.get(
    '/api/v1/admin/categories',
    {
      schema: adminListCategoriesSchema,
      preHandler: [...adminGuard, adminPermissionGuard('categories:read', 'products:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => productsService.adminListCategories(request.query as never)
  );

  fastify.post(
    '/api/v1/admin/categories',
    {
      schema: adminCreateCategorySchema,
      preHandler: [...adminGuard, adminPermissionGuard('categories:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => productsService.adminCreateCategory(request.body as never)
  );

  fastify.get(
    '/api/v1/admin/categories/:id',
    {
      schema: adminGetCategoryByIdSchema,
      preHandler: [...adminGuard, adminPermissionGuard('categories:read', 'products:read')],
      config: {
        rateLimit: routeRateLimitProfiles.adminRead
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return productsService.adminGetCategoryById(params.id);
    }
  );

  fastify.patch(
    '/api/v1/admin/categories/:id',
    {
      schema: adminUpdateCategorySchema,
      preHandler: [...adminGuard, adminPermissionGuard('categories:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return productsService.adminUpdateCategory(params.id, request.body as never);
    }
  );

  fastify.delete(
    '/api/v1/admin/categories/:id',
    {
      schema: adminDeleteCategorySchema,
      preHandler: [...adminGuard, adminPermissionGuard('categories:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return productsService.adminDeleteCategory(params.id);
    }
  );

  fastify.delete(
    '/api/v1/admin/categories/:id/permanent',
    {
      schema: adminHardDeleteCategorySchema,
      preHandler: [...adminGuard, adminPermissionGuard('categories:write'), loadShedGuard, idempotencyPreHandler],
      config: {
        rateLimit: routeRateLimitProfiles.adminWrite
      }
    },
    async (request) => {
      const params = request.params as { id: string };
      return productsService.adminHardDeleteCategory(params.id);
    }
  );
}

