import { randomUUID } from 'node:crypto';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { fetchExternalImageResponse } from './fetch-external-image';
import { PRODUCT_IMAGE_MAX_BYTES } from './product-media.constants';
import { getProductMediaStorage, isHostedCategoryImageUrl } from './product-media-provider';
import { assertProductImageUpload } from './product-media.validation';

export async function resolveCategoryImageStorageUrl(
  categoryId: string,
  sourceUrl: string
): Promise<string> {
  const trimmed = sourceUrl.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (isHostedCategoryImageUrl(trimmed)) {
    return trimmed;
  }
  const saved = await ingestExternalCategoryImage({ categoryId, sourceUrl: trimmed });
  return saved.publicUrl;
}

export async function ingestExternalCategoryImage(input: {
  categoryId: string;
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
  return storage.saveCategoryImage({
    categoryId: input.categoryId,
    imageId,
    mime,
    content: buffer
  });
}
