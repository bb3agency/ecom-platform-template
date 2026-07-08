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
      { id: 'a', imageUrl: 'u1', caption: 'c', altText: 'alt', sortOrder: 0, isActive: true }
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
            Promise.resolve({ id: 'new', ...data, caption: data.caption, altText: data.altText })
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
});
