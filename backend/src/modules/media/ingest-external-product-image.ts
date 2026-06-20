import { randomUUID } from 'node:crypto';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { fetchExternalImageResponse } from './fetch-external-image';
import { PRODUCT_IMAGE_MAX_BYTES } from './product-media.constants';
import { getProductMediaStorage, isHostedProductImageUrl } from './product-media-provider';
import { assertProductImageUpload } from './product-media.validation';

/**
 * Returns a CDN-hosted URL for product image storage.
 * Already-managed URLs pass through; external https URLs are fetched and saved to R2/local.
 */
export async function resolveProductImageStorageUrl(
  productId: string,
  sourceUrl: string
): Promise<string> {
  const trimmed = sourceUrl.trim();
  if (isHostedProductImageUrl(trimmed)) {
    return trimmed;
  }
  const saved = await ingestExternalProductImage({ productId, sourceUrl: trimmed });
  return saved.publicUrl;
}

export async function ingestExternalProductImage(input: {
  productId: string;
  sourceUrl: string;
}): Promise<{ publicUrl: string; storageReference: string }> {
  const response = await fetchExternalImageResponse(input.sourceUrl);

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > PRODUCT_IMAGE_MAX_BYTES) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `Image must be ${PRODUCT_IMAGE_MAX_BYTES / (1024 * 1024)} MB or smaller`,
        400
      );
    }
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const mime = assertProductImageUpload({
    buffer,
    declaredMime: response.headers.get('content-type')
  });

  const imageId = randomUUID();
  const storage = getProductMediaStorage();
  return storage.saveProductImage({
    productId: input.productId,
    imageId,
    mime,
    content: buffer
  });
}
