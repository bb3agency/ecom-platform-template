import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteHostedProductImage,
  getProductMediaStorage,
  hostedMediaPathFromUrl,
  hostedStorageReferenceFromUrl,
  isHostedProductImageUrl,
  isLocalMediaProviderActive,
  resetProductMediaStorageCache
} from './product-media-provider';

const R2_ENV_KEYS = [
  'MEDIA_STORAGE_PROVIDER',
  'MEDIA_STORAGE_ROOT',
  'CLIENT_ID',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL',
  'R2_ENDPOINT',
  'MEDIA_CDN_BASE_URL',
  'PUBLIC_STORE_URL'
] as const;

const envSnapshot = Object.fromEntries(R2_ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(overrides: Partial<Record<(typeof R2_ENV_KEYS)[number], string>>) {
  for (const key of R2_ENV_KEYS) {
    if (key in overrides) {
      process.env[key] = overrides[key as keyof typeof overrides] ?? '';
    } else {
      delete process.env[key];
    }
  }
}

describe('product-media-provider', () => {
  beforeEach(() => {
    resetProductMediaStorageCache();
  });

  afterEach(() => {
    for (const key of R2_ENV_KEYS) {
      const value = envSnapshot[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetProductMediaStorageCache();
  });

  // ── Provider resolution ──────────────────────────────────────────────────

  it('uses local storage when MEDIA_STORAGE_PROVIDER=local', () => {
    setEnv({ MEDIA_STORAGE_PROVIDER: 'local', MEDIA_STORAGE_ROOT: '' });
    expect(getProductMediaStorage().provider).toBe('local');
    expect(isLocalMediaProviderActive()).toBe(true);
  });

  it('treats missing MEDIA_STORAGE_PROVIDER as local', () => {
    setEnv({});
    expect(getProductMediaStorage().provider).toBe('local');
  });

  it('initialises R2 storage when MEDIA_STORAGE_PROVIDER=r2', () => {
    setEnv({
      MEDIA_STORAGE_PROVIDER: 'r2',
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'kid',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET_NAME: 'bucket',
      R2_PUBLIC_BASE_URL: 'https://cdn.example.com'
    });
    const storage = getProductMediaStorage();
    expect(storage.provider).toBe('r2');
    expect(isLocalMediaProviderActive()).toBe(false);
  });

  it('also accepts cloudflare-r2 as the provider value', () => {
    setEnv({
      MEDIA_STORAGE_PROVIDER: 'cloudflare-r2',
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'kid',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET_NAME: 'bucket',
      R2_PUBLIC_BASE_URL: 'https://cdn.example.com'
    });
    expect(getProductMediaStorage().provider).toBe('r2');
  });

  it('throws when R2 is selected but config is missing', () => {
    setEnv({ MEDIA_STORAGE_PROVIDER: 'r2' });
    expect(() => getProductMediaStorage()).toThrow();
  });

  it('returns cached instance on repeated calls', () => {
    setEnv({ MEDIA_STORAGE_PROVIDER: 'local' });
    const a = getProductMediaStorage();
    const b = getProductMediaStorage();
    expect(a).toBe(b);
  });

  it('returns a fresh instance after resetProductMediaStorageCache', () => {
    setEnv({ MEDIA_STORAGE_PROVIDER: 'local' });
    const a = getProductMediaStorage();
    resetProductMediaStorageCache();
    const b = getProductMediaStorage();
    expect(a).not.toBe(b);
  });

  // ── hostedMediaPathFromUrl ───────────────────────────────────────────────

  it('extracts media path from a bare origin path', () => {
    expect(hostedMediaPathFromUrl('/api/v1/media/products/p1/img.jpg')).toBe(
      '/api/v1/media/products/p1/img.jpg'
    );
  });

  it('extracts media path from a full origin URL', () => {
    expect(hostedMediaPathFromUrl('https://example.com/api/v1/media/products/p1/img.jpg')).toBe(
      '/api/v1/media/products/p1/img.jpg'
    );
  });

  it('returns null for an unrelated URL', () => {
    expect(hostedMediaPathFromUrl('https://cdn.example.com/other/path.jpg')).toBeNull();
  });

  // ── isHostedProductImageUrl / hostedStorageReferenceFromUrl ─────────────

  it('recognizes legacy origin media paths as hosted URLs', () => {
    setEnv({ MEDIA_STORAGE_PROVIDER: 'local', CLIENT_ID: 'client' });
    const url = '/api/v1/media/products/prod_1/abc.jpg';
    expect(isHostedProductImageUrl(url)).toBe(true);
    expect(hostedStorageReferenceFromUrl(url)).toBe('client/products/prod_1/abc.jpg');
  });

  it('recognizes R2 CDN URLs as hosted when R2 is active', () => {
    setEnv({
      MEDIA_STORAGE_PROVIDER: 'r2',
      CLIENT_ID: 'raghava',
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'kid',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET_NAME: 'bucket',
      R2_PUBLIC_BASE_URL: 'https://cdn.example.com'
    });
    const url = 'https://cdn.example.com/raghava/products/prod_1/img.jpg';
    expect(isHostedProductImageUrl(url)).toBe(true);
    expect(hostedStorageReferenceFromUrl(url)).toBe('raghava/products/prod_1/img.jpg');
  });

  it('returns false for an unrelated https URL (not a managed URL, R2 inactive)', () => {
    setEnv({ MEDIA_STORAGE_PROVIDER: 'local' });
    expect(isHostedProductImageUrl('https://example.com/some-other-image.jpg')).toBe(false);
  });

  it('returns false gracefully when R2 not configured (config error swallowed)', () => {
    setEnv({ MEDIA_STORAGE_PROVIDER: 'r2' });
    expect(() => isHostedProductImageUrl('https://cdn.example.com/img.jpg')).not.toThrow();
    expect(isHostedProductImageUrl('https://cdn.example.com/img.jpg')).toBe(false);
  });

  it('returns null gracefully from hostedStorageReferenceFromUrl when R2 not configured', () => {
    setEnv({ MEDIA_STORAGE_PROVIDER: 'r2' });
    expect(() => hostedStorageReferenceFromUrl('https://cdn.example.com/img.jpg')).not.toThrow();
    expect(hostedStorageReferenceFromUrl('https://cdn.example.com/img.jpg')).toBeNull();
  });

  // ── deleteHostedProductImage ─────────────────────────────────────────────

  it('does nothing for an unrecognized URL (no storage reference)', async () => {
    setEnv({ MEDIA_STORAGE_PROVIDER: 'local' });
    await expect(deleteHostedProductImage('https://unknown.example.com/img.jpg')).resolves.toBeUndefined();
  });

  it('deletes from local storage via legacy path when provider=local', async () => {
    setEnv({ MEDIA_STORAGE_PROVIDER: 'local', CLIENT_ID: 'client', MEDIA_STORAGE_ROOT: '/tmp/test-media' });
    const url = '/api/v1/media/products/prod_1/abc.jpg';
    // Should not throw even if file doesn't exist (ENOENT is swallowed by local storage)
    await expect(deleteHostedProductImage(url)).resolves.toBeUndefined();
  });
});
