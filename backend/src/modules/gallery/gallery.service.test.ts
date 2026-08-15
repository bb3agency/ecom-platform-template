import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { GalleryService } from './gallery.service';

vi.mock('@modules/media/product-media.validation', () => ({
  assertProductImageUpload: vi.fn(() => 'image/png')
}));

vi.mock('@modules/media/product-media-provider', () => ({
  getProductMediaStorage: vi.fn(() => ({
    saveGalleryImage: vi.fn().mockResolvedValue({
      publicUrl: 'https://cdn.example.com/client/gallery/img_1.png',
      storageReference: 'client/gallery/img_1.png',
      filename: 'img_1.png'
    })
  })),
  deleteHostedProductImage: vi.fn().mockResolvedValue(undefined),
  isHostedGalleryImageUrl: vi.fn(() => true)
}));

import { deleteHostedProductImage } from '@modules/media/product-media-provider';

type PrismaMock = {
  storeSettings: { findUnique: ReturnType<typeof vi.fn> };
  galleryImage: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

function buildFastify(prisma: PrismaMock): FastifyInstance {
  return { prisma } as unknown as FastifyInstance;
}

afterEach(() => vi.clearAllMocks());

describe('GalleryService', () => {
  it('listPublic returns empty + disabled when galleryEnabled is false', async () => {
    const prisma = {
      storeSettings: { findUnique: vi.fn().mockResolvedValue({ galleryEnabled: false }) },
      galleryImage: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      $transaction: vi.fn()
    } satisfies PrismaMock;
    const service = new GalleryService(buildFastify(prisma));

    await expect(service.listPublic()).resolves.toEqual({ enabled: false, items: [] });
    expect(prisma.galleryImage.findMany).not.toHaveBeenCalled();
  });

  it('listPublic returns active images when enabled', async () => {
    const rows = [
      {
        id: 'a',
        imageUrl: 'u1',
        caption: 'c',
        altText: 'alt',
        sortOrder: 0,
        isActive: true,
        capturedAt: new Date('2026-03-14T00:00:00.000Z'),
        createdAt: new Date('2026-08-01T00:00:00.000Z')
      }
    ];
    const prisma = {
      storeSettings: { findUnique: vi.fn().mockResolvedValue({ galleryEnabled: true }) },
      galleryImage: {
        findMany: vi.fn().mockResolvedValue(rows),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      $transaction: vi.fn()
    } satisfies PrismaMock;
    const service = new GalleryService(buildFastify(prisma));

    const result = await service.listPublic();
    expect(result.enabled).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(prisma.galleryImage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } })
    );
  });

  it('adminCreateFromUpload uploads and appends at the next sortOrder', async () => {
    const prisma = {
      storeSettings: { findUnique: vi.fn() },
      galleryImage: {
        findMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({ sortOrder: 4 }),
        findUnique: vi.fn(),
        create: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({
              id: 'new',
              ...data,
              caption: data.caption,
              altText: data.altText,
              createdAt: new Date('2026-08-15T00:00:00.000Z')
            })
          ),
        update: vi.fn(),
        delete: vi.fn()
      },
      $transaction: vi.fn()
    } satisfies PrismaMock;
    const service = new GalleryService(buildFastify(prisma));

    const created = await service.adminCreateFromUpload({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mimeType: 'image/png',
      caption: '  Our farm  ',
      altText: '  Green fields  '
    });

    expect(prisma.galleryImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imageUrl: 'https://cdn.example.com/client/gallery/img_1.png',
          caption: 'Our farm',
          altText: 'Green fields',
          sortOrder: 5,
          isActive: true
        })
      })
    );
    expect(created.id).toBe('new');
  });

  it('adminDelete removes the hosted image and the row', async () => {
    const prisma = {
      storeSettings: { findUnique: vi.fn() },
      galleryImage: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ id: 'x', imageUrl: 'https://cdn/x.png' }),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn().mockResolvedValue({})
      },
      $transaction: vi.fn()
    } satisfies PrismaMock;
    const service = new GalleryService(buildFastify(prisma));

    await expect(service.adminDelete('x')).resolves.toEqual({ message: 'Gallery image deleted' });
    expect(deleteHostedProductImage).toHaveBeenCalledWith('https://cdn/x.png');
    expect(prisma.galleryImage.delete).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('adminReorder rejects unknown ids', async () => {
    const prisma = {
      storeSettings: { findUnique: vi.fn() },
      galleryImage: {
        findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      $transaction: vi.fn()
    } satisfies PrismaMock;
    const service = new GalleryService(buildFastify(prisma));

    await expect(service.adminReorder(['a', 'ghost'])).rejects.toThrow(/Unknown gallery image id/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  /**
   * Timeline behaviour (backend-core 0.1.99). The storefront groups photos by
   * date like a phone gallery, so the server owns the effective date and the
   * newest-first order — clients must never have to re-derive either.
   */
  describe('timeline dates', () => {
    function galleryPrisma(rows: unknown[]) {
      return {
        storeSettings: { findUnique: vi.fn().mockResolvedValue({ galleryEnabled: true }) },
        galleryImage: {
          findMany: vi.fn().mockResolvedValue(rows),
          findFirst: vi.fn(),
          findUnique: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn()
        },
        $transaction: vi.fn()
      } satisfies PrismaMock;
    }

    const row = (id: string, capturedAt: Date | null, createdAt: Date) => ({
      id,
      imageUrl: `u-${id}`,
      caption: null,
      altText: '',
      sortOrder: 0,
      isActive: true,
      capturedAt,
      createdAt
    });

    it('falls back to the upload date when no photo date was entered', async () => {
      const prisma = galleryPrisma([
        row('a', null, new Date('2026-08-01T10:00:00.000Z'))
      ]);
      const result = await new GalleryService(buildFastify(prisma)).listPublic();
      expect(result.items[0]?.capturedAt).toBeNull();
      expect(result.items[0]?.timelineDate).toBe('2026-08-01T10:00:00.000Z');
    });

    it('prefers the photo date over the upload date', async () => {
      // The whole point: a 2019 farm photo uploaded today belongs in 2019.
      const prisma = galleryPrisma([
        row('a', new Date('2019-06-02T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z'))
      ]);
      const result = await new GalleryService(buildFastify(prisma)).listPublic();
      expect(result.items[0]?.timelineDate).toBe('2019-06-02T00:00:00.000Z');
    });

    it('orders newest-first and interleaves dated with undated photos', async () => {
      const prisma = galleryPrisma([
        row('old-capture', new Date('2020-01-01T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z')),
        row('undated-2024', null, new Date('2024-05-05T00:00:00.000Z')),
        row('new-capture', new Date('2026-07-07T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z'))
      ]);
      const result = await new GalleryService(buildFastify(prisma)).listPublic();
      // Undated photos must NOT be dumped at the end — they sort by upload date.
      expect(result.items.map((i) => i.id)).toEqual(['new-capture', 'undated-2024', 'old-capture']);
    });

    it('rejects an unparseable or future photo date rather than silently ignoring it', async () => {
      const prisma = {
        storeSettings: { findUnique: vi.fn() },
        galleryImage: {
          findMany: vi.fn(),
          findFirst: vi.fn().mockResolvedValue({ sortOrder: 0 }),
          findUnique: vi.fn().mockResolvedValue({ id: 'a' }),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn()
        },
        $transaction: vi.fn()
      } satisfies PrismaMock;
      const service = new GalleryService(buildFastify(prisma));

      await expect(
        service.adminUpdate('a', { capturedAt: 'not-a-date' })
      ).rejects.toMatchObject({ statusCode: 400 });

      const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      await expect(
        service.adminUpdate('a', { capturedAt: nextYear })
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(prisma.galleryImage.update).not.toHaveBeenCalled();
    });

    it('clears the photo date when passed null', async () => {
      const prisma = {
        storeSettings: { findUnique: vi.fn() },
        galleryImage: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
          findUnique: vi.fn().mockResolvedValue({ id: 'a' }),
          create: vi.fn(),
          update: vi.fn().mockResolvedValue(row('a', null, new Date('2026-08-01T00:00:00.000Z'))),
          delete: vi.fn()
        },
        $transaction: vi.fn()
      } satisfies PrismaMock;
      await new GalleryService(buildFastify(prisma)).adminUpdate('a', { capturedAt: null });
      expect(prisma.galleryImage.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ capturedAt: null }) })
      );
    });
  });
});
