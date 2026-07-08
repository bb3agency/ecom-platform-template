import path from 'path';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { CATEGORY_IMAGE_MEDIA_PATH_PREFIX, GALLERY_IMAGE_MEDIA_PATH_PREFIX, PRODUCT_IMAGE_MEDIA_PATH_PREFIX } from './product-media.constants';
import { createLocalProductMediaStorage } from './local-product-media.storage';
import { createR2ProductMediaStorage } from './r2-product-media.storage';
import type { ProductMediaStorage } from './product-media-storage.interface';

export type ProductMediaStorageProvider = 'local' | 'r2';

let cachedStorage: ProductMediaStorage | null = null;

function resolveProvider(): ProductMediaStorageProvider {
  const raw = (process.env.MEDIA_STORAGE_PROVIDER ?? 'local').trim().toLowerCase();
  if (raw === 'r2' || raw === 'cloudflare-r2') return 'r2';
  return 'local';
}

function resolvePublicBaseUrl(): string {
  return (
    process.env.R2_PUBLIC_BASE_URL ??
    process.env.MEDIA_CDN_BASE_URL ??
    process.env.PUBLIC_STORE_URL ??
    ''
  )
    .trim()
    .replace(/\/$/, '');
}

function assertR2Config(): void {
  const missing: string[] = [];
  if (!(process.env.R2_ACCOUNT_ID ?? '').trim()) missing.push('R2_ACCOUNT_ID');
  if (!(process.env.R2_ACCESS_KEY_ID ?? '').trim()) missing.push('R2_ACCESS_KEY_ID');
  if (!(process.env.R2_SECRET_ACCESS_KEY ?? '').trim()) missing.push('R2_SECRET_ACCESS_KEY');
  if (!(process.env.R2_BUCKET_NAME ?? '').trim()) missing.push('R2_BUCKET_NAME');
  if (!resolvePublicBaseUrl()) missing.push('R2_PUBLIC_BASE_URL or MEDIA_CDN_BASE_URL');

  if (missing.length > 0) {
    // Must be 4xx, not 5xx: the Cloudflare/Nginx edge strips 5xx response bodies,
    // so a 500 here reaches the admin UI as an opaque "500" with no cause. A 422
    // passes the body through so the operator sees exactly which keys are missing.
    // (Mirrors the R2 send-error wrapper in r2-product-media.storage.ts.)
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Product image storage is misconfigured. MEDIA_STORAGE_PROVIDER=r2 requires (configure in Ops panel → Product Media): ${missing.join(', ')}`,
      422
    );
  }
}

export function getProductMediaStorage(): ProductMediaStorage {
  if (cachedStorage) return cachedStorage;

  const provider = resolveProvider();
  const clientId = process.env.CLIENT_ID ?? 'client';
  const publicBaseUrl = resolvePublicBaseUrl();

  if (provider === 'r2') {
    assertR2Config();
    const r2Endpoint = (process.env.R2_ENDPOINT ?? '').trim();
    cachedStorage = createR2ProductMediaStorage({
      accountId: process.env.R2_ACCOUNT_ID!.trim(),
      accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
      bucketName: process.env.R2_BUCKET_NAME!.trim(),
      publicBaseUrl,
      clientId,
      ...(r2Endpoint ? { endpoint: r2Endpoint } : {})
    });
    return cachedStorage;
  }

  const configuredRoot = (process.env.MEDIA_STORAGE_ROOT ?? '').trim();
  const rootDir =
    configuredRoot.length > 0 ? configuredRoot : path.resolve(process.cwd(), 'storage', 'media');
  cachedStorage = createLocalProductMediaStorage({
    rootDir,
    clientId,
    publicBaseUrl
  });
  return cachedStorage;
}

export function resetProductMediaStorageCache(): void {
  cachedStorage = null;
}

function storageReferenceFromLegacyMediaPath(mediaPath: string): string | null {
  if (!mediaPath.startsWith(PRODUCT_IMAGE_MEDIA_PATH_PREFIX)) return null;
  const remainder = mediaPath.slice(PRODUCT_IMAGE_MEDIA_PATH_PREFIX.length);
  const slash = remainder.indexOf('/');
  if (slash <= 0) return null;
  const productId = remainder.slice(0, slash);
  const filename = remainder.slice(slash + 1);
  const clientId = (process.env.CLIENT_ID ?? 'client').trim() || 'client';
  if (!/^[a-zA-Z0-9_-]+$/.test(productId) || !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/.test(filename)) {
    return null;
  }
  return `${clientId}/products/${productId}/${filename}`;
}

function storageReferenceIndicatesProductPath(storageReference: string): boolean {
  return storageReference.includes('/products/');
}

function storageReferenceIndicatesCategoryPath(storageReference: string): boolean {
  return storageReference.includes('/categories/');
}

function storageReferenceIndicatesGalleryPath(storageReference: string): boolean {
  return storageReference.includes('/gallery/');
}

export function isHostedGalleryImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith(GALLERY_IMAGE_MEDIA_PATH_PREFIX)) return true;
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.startsWith(GALLERY_IMAGE_MEDIA_PATH_PREFIX)) return true;
  } catch {
    // not an absolute URL — fall through to the storage check
  }
  try {
    const storage = getProductMediaStorage();
    if (!storage.isManagedPublicUrl(url)) return false;
    const storageReference = storage.storageReferenceFromPublicUrl(url);
    return storageReference !== null && storageReferenceIndicatesGalleryPath(storageReference);
  } catch {
    return false;
  }
}

export function hostedCategoryMediaPathFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.startsWith(CATEGORY_IMAGE_MEDIA_PATH_PREFIX)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.startsWith(CATEGORY_IMAGE_MEDIA_PATH_PREFIX)) {
      return parsed.pathname;
    }
  } catch {
    return null;
  }
  return null;
}

export function isHostedProductImageUrl(url: string): boolean {
  if (hostedMediaPathFromUrl(url)) return true;
  try {
    const storage = getProductMediaStorage();
    if (!storage.isManagedPublicUrl(url)) return false;
    const storageReference = storage.storageReferenceFromPublicUrl(url);
    return storageReference !== null && storageReferenceIndicatesProductPath(storageReference);
  } catch {
    return false;
  }
}

export function isHostedCategoryImageUrl(url: string): boolean {
  if (hostedCategoryMediaPathFromUrl(url)) return true;
  try {
    const storage = getProductMediaStorage();
    if (!storage.isManagedPublicUrl(url)) return false;
    const storageReference = storage.storageReferenceFromPublicUrl(url);
    return storageReference !== null && storageReferenceIndicatesCategoryPath(storageReference);
  } catch {
    return false;
  }
}

function storageReferenceFromLegacyCategoryPath(mediaPath: string): string | null {
  if (!mediaPath.startsWith(CATEGORY_IMAGE_MEDIA_PATH_PREFIX)) return null;
  const remainder = mediaPath.slice(CATEGORY_IMAGE_MEDIA_PATH_PREFIX.length);
  const slash = remainder.indexOf('/');
  if (slash <= 0) return null;
  const categoryId = remainder.slice(0, slash);
  const filename = remainder.slice(slash + 1);
  const client = (process.env.CLIENT_ID ?? 'client').trim() || 'client';
  if (!/^[a-zA-Z0-9_-]+$/.test(categoryId) || !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/.test(filename)) {
    return null;
  }
  return `${client}/categories/${categoryId}/${filename}`;
}

export function hostedStorageReferenceFromUrl(url: string): string | null {
  const productMediaPath = hostedMediaPathFromUrl(url);
  if (productMediaPath) {
    return storageReferenceFromLegacyMediaPath(productMediaPath);
  }
  const categoryMediaPath = hostedCategoryMediaPathFromUrl(url);
  if (categoryMediaPath) {
    return storageReferenceFromLegacyCategoryPath(categoryMediaPath);
  }
  try {
    return getProductMediaStorage().storageReferenceFromPublicUrl(url);
  } catch {
    return null;
  }
}

function getLegacyLocalProductMediaStorage(): ProductMediaStorage {
  const configuredRoot = (process.env.MEDIA_STORAGE_ROOT ?? '').trim();
  const rootDir =
    configuredRoot.length > 0 ? configuredRoot : path.resolve(process.cwd(), 'storage', 'media');
  return createLocalProductMediaStorage({
    rootDir,
    clientId: process.env.CLIENT_ID ?? 'client',
    publicBaseUrl: resolvePublicBaseUrl()
  });
}

/** Deletes a hosted image URL from the active provider, with VPS fallback for legacy local paths. */
export async function deleteHostedProductImage(url: string): Promise<void> {
  const storageReference = hostedStorageReferenceFromUrl(url);
  if (!storageReference) return;

  const storage = getProductMediaStorage();
  if (storage.isManagedPublicUrl(url)) {
    await storage.deleteProductImage(storageReference);
    return;
  }

  const mediaPath = hostedMediaPathFromUrl(url);
  if (mediaPath) {
    await getLegacyLocalProductMediaStorage().deleteProductImage(storageReference);
  }
}

/** @deprecated Use SaveProductImageResult.publicUrl from saveProductImage */
export function buildProductImagePublicUrl(mediaPath: string): string {
  const cdnBase = resolvePublicBaseUrl();
  if (!cdnBase) {
    return mediaPath;
  }
  return `${cdnBase}${mediaPath.startsWith('/') ? mediaPath : `/${mediaPath}`}`;
}

export function hostedMediaPathFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.startsWith(PRODUCT_IMAGE_MEDIA_PATH_PREFIX)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.startsWith(PRODUCT_IMAGE_MEDIA_PATH_PREFIX)) {
      return parsed.pathname;
    }
  } catch {
    return null;
  }
  return null;
}

export function isLocalMediaProviderActive(): boolean {
  return resolveProvider() === 'local';
}

export function isR2MediaProviderActive(): boolean {
  return resolveProvider() === 'r2';
}
