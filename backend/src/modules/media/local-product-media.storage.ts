import { promises as fs } from 'fs';
import path from 'path';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  CATEGORY_IMAGE_MEDIA_PATH_PREFIX,
  GALLERY_IMAGE_MEDIA_PATH_PREFIX,
  PRODUCT_IMAGE_MEDIA_PATH_PREFIX,
  PRODUCT_IMAGE_MIME_TO_EXT,
  type ProductImageMimeType
} from './product-media.constants';
import type { ProductMediaStorage, SaveProductImageResult } from './product-media-storage.interface';

const SAFE_SEGMENT_REGEX = /^[a-zA-Z0-9_-]+$/;
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/;

type LocalProductMediaStorageOptions = {
  rootDir: string;
  clientId: string;
  publicBaseUrl: string;
};

export function createLocalProductMediaStorage(
  options: LocalProductMediaStorageOptions
): ProductMediaStorage {
  const rootDir = path.resolve(options.rootDir);
  const clientId = options.clientId.trim() || 'client';
  const publicBaseUrl = options.publicBaseUrl.replace(/\/$/, '');

  function sanitizeSegment(value: string, label: string): string {
    const trimmed = value.trim();
    if (!trimmed || !SAFE_SEGMENT_REGEX.test(trimmed)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Invalid ${label} for media storage`, 400);
    }
    return trimmed;
  }

  function buildRelativePath(
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

  function resolveAbsolutePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/').trim();
    if (!normalized || normalized.includes('..')) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid media storage path', 400);
    }

    const absolutePath = path.resolve(rootDir, normalized);
    const rel = path.relative(rootDir, absolutePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Media storage path escapes root directory', 400);
    }
    return absolutePath;
  }

  function buildMediaPath(prefix: string, entityId: string, filename: string, label: string): string {
    sanitizeSegment(entityId, label);
    if (!SAFE_FILENAME_REGEX.test(filename)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid media filename', 400);
    }
    return `${prefix}${entityId}/${filename}`;
  }

  function parseMediaPath(mediaPath: string): { productId: string; filename: string } | null {
    if (!mediaPath.startsWith(PRODUCT_IMAGE_MEDIA_PATH_PREFIX)) return null;
    const remainder = mediaPath.slice(PRODUCT_IMAGE_MEDIA_PATH_PREFIX.length);
    const slash = remainder.indexOf('/');
    if (slash <= 0) return null;
    const productId = remainder.slice(0, slash);
    const filename = remainder.slice(slash + 1);
    if (!SAFE_SEGMENT_REGEX.test(productId) || !SAFE_FILENAME_REGEX.test(filename)) {
      return null;
    }
    return { productId, filename };
  }

  return {
    provider: 'local',

    async saveProductImage(input): Promise<SaveProductImageResult> {
      const storageReference = buildRelativePath('products', input.productId, input.imageId, input.mime);
      const absolutePath = resolveAbsolutePath(storageReference);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, input.content);
      const filename = path.basename(absolutePath);
      const mediaPath = buildMediaPath(PRODUCT_IMAGE_MEDIA_PATH_PREFIX, input.productId, filename, 'productId');
      const publicUrl = publicBaseUrl
        ? `${publicBaseUrl}${mediaPath}`
        : mediaPath;
      return { publicUrl, storageReference, filename, mediaPath };
    },

    async saveCategoryImage(input): Promise<SaveProductImageResult> {
      const storageReference = buildRelativePath('categories', input.categoryId, input.imageId, input.mime);
      const absolutePath = resolveAbsolutePath(storageReference);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, input.content);
      const filename = path.basename(absolutePath);
      const mediaPath = buildMediaPath(
        CATEGORY_IMAGE_MEDIA_PATH_PREFIX,
        input.categoryId,
        filename,
        'categoryId'
      );
      const publicUrl = publicBaseUrl ? `${publicBaseUrl}${mediaPath}` : mediaPath;
      return { publicUrl, storageReference, filename, mediaPath };
    },

    async saveGalleryImage(input): Promise<SaveProductImageResult> {
      const safeImageId = sanitizeSegment(input.imageId, 'imageId');
      const ext = PRODUCT_IMAGE_MIME_TO_EXT[input.mime];
      const filename = `${safeImageId}.${ext}`;
      const storageReference = `${clientId}/gallery/${safeImageId}/${filename}`;
      const absolutePath = resolveAbsolutePath(storageReference);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, input.content);
      const mediaPath = `${GALLERY_IMAGE_MEDIA_PATH_PREFIX}${safeImageId}/${filename}`;
      const publicUrl = publicBaseUrl ? `${publicBaseUrl}${mediaPath}` : mediaPath;
      return { publicUrl, storageReference, filename, mediaPath };
    },

    async readProductImage(storageReference: string) {
      const absolutePath = resolveAbsolutePath(storageReference);
      try {
        const buffer = await fs.readFile(absolutePath);
        const ext = path.extname(absolutePath).toLowerCase();
        const mimeByExt: Record<string, ProductImageMimeType> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.gif': 'image/gif'
        };
        const mime = mimeByExt[ext];
        if (!mime) {
          throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Unknown media file extension', 400);
        }
        return { buffer, mime };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new AppError(ERROR_CODES.NOT_FOUND, 'Product image file not found', 404);
        }
        throw error;
      }
    },

    async deleteProductImage(storageReference: string): Promise<void> {
      const absolutePath = resolveAbsolutePath(storageReference);
      try {
        await fs.unlink(absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return;
        }
        throw error;
      }
    },

    storageReferenceFromPublicUrl(url: string): string | null {
      const trimmed = url.trim();
      let mediaPath: string | null = null;
      if (
        trimmed.startsWith(PRODUCT_IMAGE_MEDIA_PATH_PREFIX) ||
        trimmed.startsWith(CATEGORY_IMAGE_MEDIA_PATH_PREFIX) ||
        trimmed.startsWith(GALLERY_IMAGE_MEDIA_PATH_PREFIX)
      ) {
        mediaPath = trimmed;
      } else if (publicBaseUrl && trimmed.startsWith(publicBaseUrl)) {
        mediaPath = trimmed.slice(publicBaseUrl.length);
      } else {
        try {
          const parsed = new URL(trimmed);
          if (
            parsed.pathname.startsWith(PRODUCT_IMAGE_MEDIA_PATH_PREFIX) ||
            parsed.pathname.startsWith(CATEGORY_IMAGE_MEDIA_PATH_PREFIX) ||
            parsed.pathname.startsWith(GALLERY_IMAGE_MEDIA_PATH_PREFIX)
          ) {
            mediaPath = parsed.pathname;
          }
        } catch {
          return null;
        }
      }
      if (!mediaPath) return null;

      if (mediaPath.startsWith(GALLERY_IMAGE_MEDIA_PATH_PREFIX)) {
        const remainder = mediaPath.slice(GALLERY_IMAGE_MEDIA_PATH_PREFIX.length);
        const slash = remainder.indexOf('/');
        if (slash <= 0) return null;
        const imageId = remainder.slice(0, slash);
        const filename = remainder.slice(slash + 1);
        if (!SAFE_SEGMENT_REGEX.test(imageId) || !SAFE_FILENAME_REGEX.test(filename)) {
          return null;
        }
        return `${clientId}/gallery/${imageId}/${filename}`;
      }

      if (mediaPath.startsWith(CATEGORY_IMAGE_MEDIA_PATH_PREFIX)) {
        const remainder = mediaPath.slice(CATEGORY_IMAGE_MEDIA_PATH_PREFIX.length);
        const slash = remainder.indexOf('/');
        if (slash <= 0) return null;
        const categoryId = remainder.slice(0, slash);
        const filename = remainder.slice(slash + 1);
        if (!SAFE_SEGMENT_REGEX.test(categoryId) || !SAFE_FILENAME_REGEX.test(filename)) {
          return null;
        }
        return `${clientId}/categories/${categoryId}/${filename}`;
      }

      const parsed = parseMediaPath(mediaPath);
      if (!parsed) return null;
      return `${clientId}/products/${parsed.productId}/${parsed.filename}`;
    },

    isManagedPublicUrl(url: string): boolean {
      return this.storageReferenceFromPublicUrl(url) !== null;
    }
  };
}
