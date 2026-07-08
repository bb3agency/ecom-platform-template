import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { PRODUCT_IMAGE_MIME_TO_EXT, type ProductImageMimeType } from './product-media.constants';
import type { ProductMediaStorage, SaveProductImageResult } from './product-media-storage.interface';

const SAFE_SEGMENT_REGEX = /^[a-zA-Z0-9_-]+$/;

type R2ProductMediaStorageOptions = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicBaseUrl: string;
  clientId: string;
  endpoint?: string;
};

export function createR2ProductMediaStorage(options: R2ProductMediaStorageOptions): ProductMediaStorage {
  const clientId = options.clientId.trim() || 'client';
  const publicBaseUrl = options.publicBaseUrl.replace(/\/$/, '');
  const endpoint =
    (options.endpoint ?? '').trim() ||
    `https://${options.accountId.trim()}.r2.cloudflarestorage.com`;

  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey
    }
  });

  function sanitizeSegment(value: string, label: string): string {
    const trimmed = value.trim();
    if (!trimmed || !SAFE_SEGMENT_REGEX.test(trimmed)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Invalid ${label} for media storage`, 400);
    }
    return trimmed;
  }

  function buildObjectKey(
    entity: 'products' | 'categories',
    entityId: string,
    imageId: string,
    mime: ProductImageMimeType
  ): string {
    const safeEntityId = sanitizeSegment(entityId, `${entity.slice(0, -1)}Id`);
    const safeImageId = sanitizeSegment(imageId, 'imageId');
    const ext = PRODUCT_IMAGE_MIME_TO_EXT[mime];
    return `${clientId}/${entity}/${safeEntityId}/${safeImageId}.${ext}`;
  }

  // R2/S3 errors otherwise surface as an opaque 500 (and log as an empty `{}`),
  // and the CDN edge strips 5xx bodies — so the operator just sees "500" with no
  // cause. Translate them into a clear, pass-through (422) AppError naming the
  // real reason (InvalidAccessKeyId / SignatureDoesNotMatch / NoSuchBucket / DNS),
  // so the misconfiguration is actionable from the admin UI.
  async function sendS3(command: PutObjectCommand | DeleteObjectCommand, action: string): Promise<void> {
    try {
      await s3.send(command as PutObjectCommand);
    } catch (err) {
      const e = err as {
        name?: string;
        Code?: string;
        message?: string;
        $metadata?: { httpStatusCode?: number };
      };
      const code = e.name || e.Code || 'R2Error';
      const httpStatus = e.$metadata?.httpStatusCode;
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Cloudflare R2 ${action} failed (${code}${httpStatus ? ` ${httpStatus}` : ''}): ${e.message || 'unknown error'}. ` +
          `Verify R2 credentials, bucket "${options.bucketName}", and endpoint "${endpoint}" in Ops → Product Media.`,
        422
      );
    }
  }

  function buildPublicUrl(objectKey: string): string {
    const encodedKey = objectKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${publicBaseUrl}/${encodedKey}`;
  }

  function objectKeyFromPublicUrl(url: string): string | null {
    const trimmed = url.trim();
    if (!publicBaseUrl) return null;

    let pathname: string;
    if (trimmed.startsWith(publicBaseUrl)) {
      pathname = trimmed.slice(publicBaseUrl.length);
    } else {
      try {
        const parsed = new URL(trimmed);
        const base = new URL(publicBaseUrl);
        if (parsed.origin !== base.origin) return null;
        pathname = parsed.pathname;
      } catch {
        return null;
      }
    }

    if (!pathname.startsWith('/')) pathname = `/${pathname}`;
    const key = decodeURIComponent(pathname.replace(/^\//, ''));
    if (
      !key.startsWith(`${clientId}/products/`) &&
      !key.startsWith(`${clientId}/categories/`) &&
      !key.startsWith(`${clientId}/gallery/`)
    ) {
      return null;
    }
    return key;
  }

  return {
    provider: 'r2',

    async saveProductImage(input): Promise<SaveProductImageResult> {
      const storageReference = buildObjectKey('products', input.productId, input.imageId, input.mime);
      const filename = storageReference.split('/').pop() ?? storageReference;

      await sendS3(
        new PutObjectCommand({
          Bucket: options.bucketName,
          Key: storageReference,
          Body: input.content,
          ContentType: input.mime,
          ContentLength: input.content.length,
          CacheControl: 'public, max-age=31536000, immutable'
        }),
        'upload'
      );

      return {
        publicUrl: buildPublicUrl(storageReference),
        storageReference,
        filename
      };
    },

    async saveCategoryImage(input): Promise<SaveProductImageResult> {
      const storageReference = buildObjectKey('categories', input.categoryId, input.imageId, input.mime);
      const filename = storageReference.split('/').pop() ?? storageReference;

      await sendS3(
        new PutObjectCommand({
          Bucket: options.bucketName,
          Key: storageReference,
          Body: input.content,
          ContentType: input.mime,
          ContentLength: input.content.length,
          CacheControl: 'public, max-age=31536000, immutable'
        }),
        'upload'
      );

      return {
        publicUrl: buildPublicUrl(storageReference),
        storageReference,
        filename
      };
    },

    async saveGalleryImage(input): Promise<SaveProductImageResult> {
      const safeImageId = sanitizeSegment(input.imageId, 'imageId');
      const ext = PRODUCT_IMAGE_MIME_TO_EXT[input.mime];
      const storageReference = `${clientId}/gallery/${safeImageId}.${ext}`;
      const filename = storageReference.split('/').pop() ?? storageReference;

      await sendS3(
        new PutObjectCommand({
          Bucket: options.bucketName,
          Key: storageReference,
          Body: input.content,
          ContentType: input.mime,
          ContentLength: input.content.length,
          CacheControl: 'public, max-age=31536000, immutable'
        }),
        'upload'
      );

      return {
        publicUrl: buildPublicUrl(storageReference),
        storageReference,
        filename
      };
    },

    async deleteProductImage(storageReference: string): Promise<void> {
      await sendS3(
        new DeleteObjectCommand({
          Bucket: options.bucketName,
          Key: storageReference
        }),
        'delete'
      );
    },

    storageReferenceFromPublicUrl(url: string): string | null {
      return objectKeyFromPublicUrl(url);
    },

    isManagedPublicUrl(url: string): boolean {
      return objectKeyFromPublicUrl(url) !== null;
    }
  };
}
