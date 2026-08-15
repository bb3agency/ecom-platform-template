import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { assertProductImageUpload } from '@modules/media/product-media.validation';
import { readImageDimensions } from '@modules/media/image-dimensions';
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
  /** Merchant-entered capture date (ISO), or null when never set. */
  capturedAt: string | null;
  /** Intrinsic pixel size; null for images uploaded before this was captured. */
  width: number | null;
  height: number | null;
  /**
   * The date the storefront timeline groups by: capturedAt when the merchant set
   * one, otherwise the upload date. Always present, so clients never have to
   * re-implement the fallback (and cannot disagree with the server's ordering).
   */
  timelineDate: string;
};

type GalleryRow = {
  id: string;
  imageUrl: string;
  caption: string | null;
  altText: string;
  sortOrder: number;
  isActive: boolean;
  capturedAt: Date | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
};

function serialize(row: GalleryRow): GalleryImageRecord {
  const effective = row.capturedAt ?? row.createdAt;
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    caption: row.caption,
    altText: row.altText,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    capturedAt: row.capturedAt ? row.capturedAt.toISOString() : null,
    width: row.width ?? null,
    height: row.height ?? null,
    timelineDate: effective.toISOString()
  };
}

const SELECT = {
  id: true,
  imageUrl: true,
  caption: true,
  altText: true,
  sortOrder: true,
  isActive: true,
  capturedAt: true,
  width: true,
  height: true,
  createdAt: true
} as const;

/**
 * Timeline order: newest capture date first, the way a phone gallery reads.
 * Prisma sorts NULLs last on desc, which is what we want — an undated photo
 * falls back to createdAt in `serialize`, so the final sort is applied in JS
 * over the effective date to keep dated and undated photos interleaved
 * correctly rather than dumping all undated ones at the end.
 */
function sortByTimelineDesc(items: GalleryImageRecord[]): GalleryImageRecord[] {
  return [...items].sort((a, b) => b.timelineDate.localeCompare(a.timelineDate));
}

/**
 * Accepts an ISO date (`2026-08-15` or a full timestamp) and returns a Date, or
 * null to clear. A future date is rejected — a photo cannot have been taken
 * tomorrow, and silently accepting one would pin it to the top of the timeline
 * forever. Anything unparseable is a 400 rather than a silent null, so a typo
 * does not quietly file the photo under its upload date.
 */
function parseCapturedAt(value: string | null | undefined): Date | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Photo date is not a valid date', 400);
  }
  // One day of slack absorbs client/server timezone differences around "today".
  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Photo date cannot be in the future', 400);
  }
  return parsed;
}

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
    // Newest-first for the storefront timeline. `sortOrder` remains the merchant's
    // manual ordering and still breaks ties within the same instant.
    return { enabled: true, items: sortByTimelineDesc(rows.map(serialize)) };
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
    /** ISO date the photo was taken; omitted → timeline falls back to upload time. */
    capturedAt?: string | null;
  }): Promise<GalleryImageRecord> {
    const mime = assertProductImageUpload({
      buffer: input.buffer,
      ...(input.mimeType != null ? { declaredMime: input.mimeType } : {})
    });
    const dimensions = readImageDimensions(input.buffer);
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
        isActive: true,
        capturedAt: parseCapturedAt(input.capturedAt),
        // Header-only parse; null when unreadable, which the UI tolerates.
        ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {})
      },
      select: SELECT
    });
    return serialize(created);
  }

  async adminUpdate(
    id: string,
    input: {
      caption?: string | null;
      altText?: string;
      isActive?: boolean;
      sortOrder?: number;
      /** ISO date, or null to clear it and fall back to the upload date. */
      capturedAt?: string | null;
    }
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
      capturedAt?: Date | null;
    } = {};
    if (input.caption !== undefined) data.caption = input.caption?.trim() || null;
    if (input.altText !== undefined) data.altText = input.altText.trim();
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.capturedAt !== undefined) data.capturedAt = parseCapturedAt(input.capturedAt);

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
