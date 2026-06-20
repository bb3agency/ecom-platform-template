import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  PRODUCT_IMAGE_ALLOWED_MIME_TYPES,
  PRODUCT_IMAGE_MAX_BYTES,
  type ProductImageMimeType
} from './product-media.constants';

function startsWith(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

export function detectProductImageMime(buffer: Buffer): ProductImageMimeType | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  return null;
}

export function assertProductImageUpload(input: {
  buffer: Buffer;
  declaredMime?: string | null;
}): ProductImageMimeType {
  if (input.buffer.length === 0) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Image file is empty', 400);
  }
  if (input.buffer.length > PRODUCT_IMAGE_MAX_BYTES) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Image must be ${PRODUCT_IMAGE_MAX_BYTES / (1024 * 1024)} MB or smaller`,
      400
    );
  }

  const detected = detectProductImageMime(input.buffer);
  if (!detected) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'Unsupported image format. Use JPEG, PNG, WebP, or GIF.',
      400
    );
  }

  // The magic-byte `detected` type is authoritative — it is what we store
  // (R2 ContentType + file extension, see products.service.ts). The
  // browser/OS-declared MIME is untrustworthy (renamed files, the non-standard
  // `image/jpg` vs `image/jpeg`, phone exports that mislabel) and must NOT
  // trigger a rejection: trusting `detected` over `declared` is strictly safer
  // than the reverse. We therefore intentionally ignore any declared/detected
  // mismatch instead of 400-ing legitimate images. `declaredMime` is kept on the
  // input for callers/back-compat but is no longer used for acceptance.
  if (!PRODUCT_IMAGE_ALLOWED_MIME_TYPES.includes(detected)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Unsupported image MIME type', 400);
  }

  return detected;
}
