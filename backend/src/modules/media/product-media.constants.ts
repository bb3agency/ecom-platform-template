/** Raw product image uploads — strict 5 MiB cap site-wide. */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Maximum images allowed per product (admin upload + URL add). */
export const PRODUCT_MAX_IMAGES_PER_PRODUCT = 8;

export const PRODUCT_IMAGE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
] as const;

export type ProductImageMimeType = (typeof PRODUCT_IMAGE_ALLOWED_MIME_TYPES)[number];

export const PRODUCT_IMAGE_MIME_TO_EXT: Record<ProductImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

export const PRODUCT_IMAGE_MEDIA_PATH_PREFIX = '/api/v1/media/products/';
export const CATEGORY_IMAGE_MEDIA_PATH_PREFIX = '/api/v1/media/categories/';
