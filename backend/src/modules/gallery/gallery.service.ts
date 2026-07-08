import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { assertProductImageUpload } from '@modules/media/product-media.validation';
import {
  deleteHostedProductImage,
  getProductMediaStorage,
  isHostedGalleryImageUrl
} from '@modules/media/product-media-provider';

export type GalleryImageRecord = {
  id: string;
  imageUrl: string;
  caption: string | null;
  altText: string;
  sortOrder: number;
  isActive: boolean;
};

function serialize(row: {
  id: string;
  imageUrl: string;
  caption: string | null;
  altText: string;
  sortOrder: number;
  isActive: boolean;
}): GalleryImageRecord {
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    caption: row.caption,
    altText: row.altText,
    sortOrder: row.sortOrder,
    isActive: row.isActive
  };
}

const SELECT = {
  id: true,
  imageUrl: true,
  caption: true,
  altText: true,
  sortOrder: true,
  isActive: true
} as const;

export class GalleryService {
  constructor(private readonly fastify: FastifyInstance) {}

  private async isEnabled(): Promise<boolean> {
    const settings = await this.fastify.prisma.storeSettings.findUnique({
      where: { singletonKey: 'default' },
      select: { galleryEnabled: true }
    });
    return settings?.galleryEnabled ?? false;
  }

  /** Public storefront list — active images only, ordered. Empty when the gallery is disabled. */
  async listPublic(): Promise<{ enabled: boolean; items: GalleryImageRecord[] }> {
    const enabled = await this.isEnabled();
    if (!enabled) {
      return { enabled: false, items: [] };
    }
    const rows = await this.fastify.prisma.galleryImage.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: SELECT
    });
    return { enabled: true, items: rows.map(serialize) };
  }

  /** Admin list — all images (active + hidden), ordered. */
  async adminList(): Promise<{ items: GalleryImageRecord[] }> {
    const rows = await this.fastify.prisma.galleryImage.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: SELECT
    });
    return { items: rows.map(serialize) };
  }

  /** Upload a new image to storage (R2/local) and create the record. */
  async adminCreateFromUpload(input: {
    buffer: Buffer;
    mimeType?: string | null;
    caption?: string | null;
    altText?: string | null;
  }): Promise<GalleryImageRecord> {
    const mime = assertProductImageUpload({
      buffer: input.buffer,
      ...(input.mimeType != null ? { declaredMime: input.mimeType } : {})
    });
    const storage = getProductMediaStorage();
    const saved = await storage.saveGalleryImage({
      imageId: randomUUID(),
      mime,
      content: input.buffer
    });

    const last = await this.fastify.prisma.galleryImage.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true }
    });
    const nextSortOrder = (last?.sortOrder ?? -1) + 1;

    const created = await this.fastify.prisma.galleryImage.create({
      data: {
        imageUrl: saved.publicUrl,
        caption: input.caption?.trim() || null,
        altText: input.altText?.trim() || '',
        sortOrder: nextSortOrder,
        isActive: true
      },
      select: SELECT
    });
    return serialize(created);
  }

  async adminUpdate(
    id: string,
    input: { caption?: string | null; altText?: string; isActive?: boolean; sortOrder?: number }
  ): Promise<GalleryImageRecord> {
    const existing = await this.fastify.prisma.galleryImage.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Gallery image not found', 404);
    }

    const data: {
      caption?: string | null;
      altText?: string;
      isActive?: boolean;
      sortOrder?: number;
    } = {};
    if (input.caption !== undefined) data.caption = input.caption?.trim() || null;
    if (input.altText !== undefined) data.altText = input.altText.trim();
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    const updated = await this.fastify.prisma.galleryImage.update({
      where: { id },
      data,
      select: SELECT
    });
    return serialize(updated);
  }

  async adminDelete(id: string): Promise<{ message: string }> {
    const existing = await this.fastify.prisma.galleryImage.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Gallery image not found', 404);
    }
    if (existing.imageUrl && isHostedGalleryImageUrl(existing.imageUrl)) {
      await deleteHostedProductImage(existing.imageUrl);
    }
    await this.fastify.prisma.galleryImage.delete({ where: { id } });
    return { message: 'Gallery image deleted' };
  }

  /** Persist a new display order. `orderedIds` is the full list in the desired order. */
  async adminReorder(orderedIds: string[]): Promise<{ items: GalleryImageRecord[] }> {
    const existing = await this.fastify.prisma.galleryImage.findMany({ select: { id: true } });
    const existingIds = new Set(existing.map((r) => r.id));
    for (const id of orderedIds) {
      if (!existingIds.has(id)) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Unknown gallery image id: ${id}`, 400);
      }
    }

    await this.fastify.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.fastify.prisma.galleryImage.update({
          where: { id },
          data: { sortOrder: index }
        })
      )
    );
    return this.adminList();
  }
}
