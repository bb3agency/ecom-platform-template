import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./product-media-provider', () => ({
  isHostedProductImageUrl: vi.fn(),
  getProductMediaStorage: vi.fn()
}));

import { getProductMediaStorage, isHostedProductImageUrl } from './product-media-provider';
import { ingestExternalProductImage, resolveProductImageStorageUrl } from './ingest-external-product-image';

describe('ingest-external-product-image', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes through already-hosted URLs', async () => {
    vi.mocked(isHostedProductImageUrl).mockReturnValue(true);

    const result = await resolveProductImageStorageUrl('prod_1', 'https://cdn.example.com/a.jpg');
    expect(result).toBe('https://cdn.example.com/a.jpg');
    expect(getProductMediaStorage).not.toHaveBeenCalled();
  });

  it('fetches external https URLs and saves them to storage', async () => {
    vi.mocked(isHostedProductImageUrl).mockReturnValue(false);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(pngHeader, {
          status: 200,
          headers: { 'content-type': 'image/png' }
        })
      )
    );
    vi.mocked(getProductMediaStorage).mockReturnValue({
      provider: 'local',
      saveProductImage: vi.fn().mockResolvedValue({
        publicUrl: 'https://cdn.example.com/client/products/prod_1/uuid.png',
        storageReference: 'client/products/prod_1/uuid.png'
      }),
      saveCategoryImage: vi.fn(),
      saveGalleryImage: vi.fn(),
      deleteProductImage: vi.fn(),
      isManagedPublicUrl: vi.fn(),
      storageReferenceFromPublicUrl: vi.fn()
    });

    const result = await ingestExternalProductImage({
      productId: 'prod_1',
      sourceUrl: 'https://example.com/photo.png'
    });

    expect(result.publicUrl).toContain('cdn.example.com');
    expect(getProductMediaStorage().saveProductImage).toHaveBeenCalledOnce();
  });
});
