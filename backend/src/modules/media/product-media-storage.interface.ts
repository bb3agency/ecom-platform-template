import type { ProductImageMimeType } from './product-media.constants';

export type SaveProductImageResult = {
  /** URL stored on ProductImage.url (R2/CDN or origin media path). */
  publicUrl: string;
  /** Provider-specific key (filesystem path or R2 object key). */
  storageReference: string;
  filename: string;
  /** Present for local provider — `/api/v1/media/products/...` */
  mediaPath?: string;
};

export interface ProductMediaStorage {
  readonly provider: 'local' | 'r2';

  saveProductImage(input: {
    productId: string;
    imageId: string;
    mime: ProductImageMimeType;
    content: Buffer;
  }): Promise<SaveProductImageResult>;

  saveCategoryImage(input: {
    categoryId: string;
    imageId: string;
    mime: ProductImageMimeType;
    content: Buffer;
  }): Promise<SaveProductImageResult>;

  /** Store-wide gallery images (opt-in per client). Keyed by imageId only — no parent entity. */
  saveGalleryImage(input: {
    imageId: string;
    mime: ProductImageMimeType;
    content: Buffer;
  }): Promise<SaveProductImageResult>;

  deleteProductImage(storageReference: string): Promise<void>;

  /** Local filesystem only — used by GET /api/v1/media/... */
  readProductImage?(storageReference: string): Promise<{ buffer: Buffer; mime: ProductImageMimeType }>;

  storageReferenceFromPublicUrl(url: string): string | null;

  isManagedPublicUrl(url: string): boolean;
}
