import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ProductsService } from './products.service';

describe('ProductsService variant management', () => {
  it('creates product variant with inventory default threshold', async () => {
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            defaultLowStockThreshold: 8
          })
        },
        product: {
          findUnique: vi.fn().mockResolvedValue({ id: 'prod_1' })
        },
        productVariant: {
          create: vi.fn().mockResolvedValue({ id: 'variant_1', sku: 'SKU-1' })
        }
      },
      redis: {
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0)
      },
      queues: {
        analytics: {
          add: vi.fn()
        }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    const created = await service.adminCreateProductVariant('prod_1', {
      sku: 'SKU-1',
      name: 'Variant 1',
      price: 1000
    });

    expect(created.id).toBe('variant_1');
    expect(fastify.prisma.productVariant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inventory: {
            create: expect.objectContaining({
              lowStockThreshold: 8
            })
          }
        })
      })
    );
  });

  it('rejects compareAtPrice less than or equal to price', async () => {
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            defaultLowStockThreshold: 5
          })
        },
        product: {
          findUnique: vi.fn().mockResolvedValue({ id: 'prod_1' })
        },
        productVariant: {
          create: vi.fn()
        }
      },
      redis: {
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0)
      },
      queues: {
        analytics: {
          add: vi.fn()
        }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    await expect(
      service.adminCreateProductVariant('prod_1', {
        sku: 'SKU-1',
        name: 'Variant 1',
        price: 1000,
        compareAtPrice: 1000
      })
    ).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('updates variant box dimensions (packageLengthCm, packageWidthCm, packageHeightCm)', async () => {
    const existingVariant = {
      id: 'variant_1',
      productId: 'prod_1',
      sku: 'SKU-1',
      name: 'Default',
      price: 5000,
      compareAtPrice: null,
      weight: 500,
      packageLengthCm: null,
      packageWidthCm: null,
      packageHeightCm: null,
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      inventory: { quantity: 10, lowStockThreshold: 5 }
    };
    const updatedVariant = {
      ...existingVariant,
      packageLengthCm: 20,
      packageWidthCm: 15,
      packageHeightCm: 10
    };
    const updateManyFn = vi.fn().mockResolvedValue({ count: 1 });

    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ defaultLowStockThreshold: 5 })
        },
        productVariant: {
          findFirst: vi.fn().mockResolvedValue(existingVariant),
          updateMany: updateManyFn,
          findUniqueOrThrow: vi.fn().mockResolvedValue(updatedVariant)
        }
      },
      redis: {
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0)
      },
      queues: { analytics: { add: vi.fn() } },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    const result = await service.adminUpdateProductVariant('prod_1', 'variant_1', {
      packageLengthCm: 20,
      packageWidthCm: 15,
      packageHeightCm: 10
    });

    expect(result).toEqual(updatedVariant);
    expect(updateManyFn).toHaveBeenCalledWith({
      where: { id: 'variant_1', updatedAt: existingVariant.updatedAt },
      data: {
        packageLengthCm: 20,
        packageWidthCm: 15,
        packageHeightCm: 10
      }
    });
  });

  it('persists the keepUpright packing flag on variant update', async () => {
    const existingVariant = {
      id: 'variant_1',
      productId: 'prod_1',
      sku: 'SKU-1',
      name: 'Default',
      price: 5000,
      compareAtPrice: null,
      weight: 500,
      packageLengthCm: 10,
      packageWidthCm: 10,
      packageHeightCm: 30,
      keepUpright: false,
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      inventory: { quantity: 10, lowStockThreshold: 5 }
    };
    const updatedVariant = { ...existingVariant, keepUpright: true };
    const updateManyFn = vi.fn().mockResolvedValue({ count: 1 });

    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ defaultLowStockThreshold: 5 })
        },
        productVariant: {
          findFirst: vi.fn().mockResolvedValue(existingVariant),
          updateMany: updateManyFn,
          findUniqueOrThrow: vi.fn().mockResolvedValue(updatedVariant)
        }
      },
      redis: {
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0)
      },
      queues: { analytics: { add: vi.fn() } },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    const result = await service.adminUpdateProductVariant('prod_1', 'variant_1', {
      keepUpright: true
    });

    expect(result).toEqual(updatedVariant);
    expect(updateManyFn).toHaveBeenCalledWith({
      where: { id: 'variant_1', updatedAt: existingVariant.updatedAt },
      data: { keepUpright: true }
    });
  });

  it('updates primary variant price and compareAtPrice without touching sku or name', async () => {
    const existingVariant = {
      id: 'variant_1',
      productId: 'prod_1',
      sku: 'HNY-500',
      name: 'Default',
      price: 5000,
      compareAtPrice: 50000,
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      inventory: { quantity: 12, lowStockThreshold: 10 }
    };
    const updatedVariant = {
      ...existingVariant,
      price: 7500,
      compareAtPrice: 12000
    };
    const updateManyFn = vi.fn().mockResolvedValue({ count: 1 });

    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({
            defaultLowStockThreshold: 10
          })
        },
        productVariant: {
          findFirst: vi.fn().mockResolvedValue(existingVariant),
          updateMany: updateManyFn,
          findUniqueOrThrow: vi.fn().mockResolvedValue(updatedVariant)
        }
      },
      redis: {
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0)
      },
      queues: {
        analytics: {
          add: vi.fn()
        }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    const result = await service.adminUpdateProductVariant('prod_1', 'variant_1', {
      price: 7500,
      compareAtPrice: 12000
    });

    expect(result).toEqual(updatedVariant);
    expect(updateManyFn).toHaveBeenCalledWith({
      where: {
        id: 'variant_1',
        updatedAt: existingVariant.updatedAt
      },
      data: {
        price: 7500,
        compareAtPrice: 12000
      }
    });
  });

  it('clears compareAtPrice when null is sent (optional, not mandatory)', async () => {
    const existingVariant = {
      id: 'variant_1',
      productId: 'prod_1',
      sku: 'HNY-500',
      name: 'Default',
      price: 5000,
      compareAtPrice: 50000,
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      inventory: { quantity: 12, lowStockThreshold: 10 }
    };
    const updatedVariant = { ...existingVariant, compareAtPrice: null };
    const updateManyFn = vi.fn().mockResolvedValue({ count: 1 });

    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ defaultLowStockThreshold: 10 })
        },
        productVariant: {
          findFirst: vi.fn().mockResolvedValue(existingVariant),
          updateMany: updateManyFn,
          findUniqueOrThrow: vi.fn().mockResolvedValue(updatedVariant)
        }
      },
      redis: { scan: vi.fn().mockResolvedValue(['0', []]), del: vi.fn().mockResolvedValue(0) },
      queues: { analytics: { add: vi.fn() } },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    // Sending null must NOT throw "must be greater than price" and must clear the field.
    const result = await service.adminUpdateProductVariant('prod_1', 'variant_1', {
      compareAtPrice: null
    });

    expect(result).toEqual(updatedVariant);
    expect(updateManyFn).toHaveBeenCalledWith({
      where: { id: 'variant_1', updatedAt: existingVariant.updatedAt },
      data: { compareAtPrice: null }
    });
  });

});
