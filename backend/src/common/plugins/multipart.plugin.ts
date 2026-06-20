import multipart from '@fastify/multipart';
import { FastifyInstance } from 'fastify';

import { PRODUCT_IMAGE_MAX_BYTES } from '@modules/media/product-media.constants';

/** CSV import allows larger files; product images are capped at 5 MiB per route handler. */
const MULTIPART_MAX_FILE_BYTES = Math.max(20 * 1024 * 1024, PRODUCT_IMAGE_MAX_BYTES);

export async function registerMultipartPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(multipart, {
    limits: {
      fileSize: MULTIPART_MAX_FILE_BYTES
    }
  });
}

