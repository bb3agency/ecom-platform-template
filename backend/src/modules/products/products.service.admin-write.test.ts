import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ProductsService } from './products.service';

function makeBaseFastify(overrides: Record<string, unknown> = {}): FastifyInstance {
  return {
    prisma: {
      product: {
        findUnique: vi.fn().mockResolvedValue(null),
        findUniqueOrThrow: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(null)
      },
      productVariant: {
        updateMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([])
      },
      cartItem: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      cartReservation: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      category: {
        findUnique: vi.fn().mockResolvedValue({ id: 'cat_1' })
      },
      storeSettings: {
        findUnique: vi.fn().mockResolvedValue({ defaultLowStockThreshold: 5 })
      },
      inventory: { upsert: vi.fn() },
      $transaction: vi.fn().mockResolvedValue([[], 0])
    },
    redis: {
      del: vi.fn(),
      keys: vi.fn().mockResolvedValue([])
    },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    ...overrides
  } as unknown as FastifyInstance;
}

// ── adminCreateProduct ────────────────────────────────────────────────────────

describe('ProductsService adminCreateProduct', () => {
  it('throws 400 for duplicate image sort orders', async () => {
    const fastify = makeBaseFastify();
    const service = new ProductsService(fastify);

    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(null);

    await expect(
      service.adminCreateProduct({
        name: 'T-Shirt',
        slug: 'tshirt',
        description: 'desc',
        categoryId: 'cat_1',
        images: [
          { url: 'https://img.test/1.jpg', altText: 'alt', sortOrder: 1 },
          { url: 'https://img.test/2.jpg', altText: 'alt', sortOrder: 1 }
        ]
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 404 when category does not exist', async () => {
    const fastify = makeBaseFastify();
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(null);

    const service = new ProductsService(fastify);

    await expect(
      service.adminCreateProduct({
        name: 'T-Shirt',
        slug: 'tshirt',
        description: 'desc',
        categoryId: 'nonexistent'
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns existing product when slug already exists (idempotent)', async () => {
    const existingProduct = {
      id: 'prod_1',
      slug: 'tshirt',
      name: 'T-Shirt',
      description: 'desc',
      categoryId: 'cat_1',
      tags: [],
      isFeatured: false,
      isActive: true,
      metaTitle: null,
      metaDescription: null,
      category: { id: 'cat_1' },
      images: [],
      variants: []
    };
    const fastify = makeBaseFastify();
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi
      .fn()
      .mockImplementation(({ where }: { where: { id?: string; slug?: string } }) => {
        if ('slug' in where) return Promise.resolve(existingProduct);
        return Promise.resolve(null);
      });
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue({ id: 'cat_1' });

    const service = new ProductsService(fastify);
    const result = await service.adminCreateProduct({
      name: 'T-Shirt',
      slug: 'tshirt',
      description: 'desc',
      categoryId: 'cat_1'
    });

    expect(result).toMatchObject({ id: 'prod_1', slug: 'tshirt' });
    expect((fastify.prisma.product as unknown as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
  });

  it('reactivates an existing inactive product when slug matches instead of creating duplicate', async () => {
    const existingProduct = {
      id: 'prod_1',
      slug: 'tshirt',
      name: 'T-Shirt',
      description: 'desc',
      categoryId: 'cat_1',
      tags: [],
      isFeatured: false,
      isActive: false,
      metaTitle: null,
      metaDescription: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      category: { id: 'cat_1' },
      images: [],
      variants: []
    };
    const updated = {
      ...existingProduct,
      isActive: true,
      category: { id: 'cat_1', name: 'Apparel', slug: 'apparel' },
      images: [],
      variants: []
    };
    const fastify = makeBaseFastify();
    const updateFn = vi.fn().mockResolvedValue(updated);
    const findUnique = vi.fn().mockImplementation(({ where }: { where: { id?: string; slug?: string } }) => {
      if ('slug' in where) return Promise.resolve(existingProduct);
      if (where.id === 'prod_1') return Promise.resolve(existingProduct);
      return Promise.resolve(null);
    });
    const findUniqueOrThrow = vi.fn().mockResolvedValue(updated);
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = findUnique;
    (fastify.prisma.product as unknown as { update: ReturnType<typeof vi.fn> }).update = updateFn;
    (fastify.prisma.product as unknown as { findUniqueOrThrow: ReturnType<typeof vi.fn> }).findUniqueOrThrow = findUniqueOrThrow;
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue({ id: 'cat_1' });

    const service = new ProductsService(fastify);
    const result = await service.adminCreateProduct({
      name: 'T-Shirt',
      slug: 'tshirt',
      description: 'desc',
      categoryId: 'cat_1',
      isActive: true
    });

    expect(result).toMatchObject({ id: 'prod_1', isActive: true });
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prod_1' },
        data: expect.objectContaining({ isActive: true })
      })
    );
    expect((fastify.prisma.product as unknown as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
  });

  it('updates existing product attributes on idempotent create when slug matches', async () => {
    const existingProduct = {
      id: 'prod_1',
      slug: 'tshirt',
      name: 'T-Shirt',
      description: 'desc',
      categoryId: 'cat_1',
      tags: [],
      attributes: {},
      isFeatured: false,
      isActive: true,
      metaTitle: null,
      metaDescription: null,
      category: { id: 'cat_1' },
      images: [],
      variants: []
    };
    const updated = {
      ...existingProduct,
      attributes: { hsnCode: '0910', gstRate: 5 },
      category: { id: 'cat_1', name: 'Apparel', slug: 'apparel' },
      images: [],
      variants: []
    };
    const fastify = makeBaseFastify();
    const updateFn = vi.fn().mockResolvedValue(updated);
    const variantUpdateManyFn = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockImplementation(({ where }: { where: { id?: string; slug?: string } }) => {
      if ('slug' in where) return Promise.resolve(existingProduct);
      if (where.id === 'prod_1') return Promise.resolve(existingProduct);
      return Promise.resolve(null);
    });
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = findUnique;
    (fastify.prisma.product as unknown as { update: ReturnType<typeof vi.fn> }).update = updateFn;
    (fastify.prisma.product as unknown as { findUniqueOrThrow: ReturnType<typeof vi.fn> }).findUniqueOrThrow = vi
      .fn()
      .mockResolvedValue(updated);
    (fastify.prisma.productVariant as unknown as { updateMany: ReturnType<typeof vi.fn> }).updateMany = variantUpdateManyFn;
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue({ id: 'cat_1' });

    const service = new ProductsService(fastify);
    await service.adminCreateProduct({
      name: 'T-Shirt',
      slug: 'tshirt',
      description: 'desc',
      categoryId: 'cat_1',
      attributes: { hsnCode: '0910', gstRate: 5 }
    });

    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prod_1' },
        data: expect.objectContaining({
          attributes: { hsnCode: '0910', gstRate: 5 }
        })
      })
    );
    expect(variantUpdateManyFn).toHaveBeenCalledWith({
      where: { productId: 'prod_1' },
      data: { hsnCode: '0910', gstRatePercent: 5 }
    });
  });

  it('creates a new product and invalidates cache', async () => {
    const created = { id: 'prod_new', slug: 'new-product', name: 'New', category: {}, images: [], variants: [] };
    const fastify = makeBaseFastify();
    const findUnique = vi.fn().mockResolvedValue(null);
    const createFn = vi.fn().mockResolvedValue(created);
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }).findUnique = findUnique;
    (fastify.prisma.product as unknown as { create: ReturnType<typeof vi.fn> }).create = createFn;
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue({ id: 'cat_1' });

    const service = new ProductsService(fastify);
    const result = await service.adminCreateProduct({
      name: 'New',
      slug: 'new-product',
      description: 'desc',
      categoryId: 'cat_1'
    });

    expect(result).toMatchObject({ id: 'prod_new' });
    expect(createFn).toHaveBeenCalledOnce();
  });
});

// ── adminUpdateProduct ────────────────────────────────────────────────────────

describe('ProductsService adminUpdateProduct', () => {
  it('throws 404 when product does not exist', async () => {
    const fastify = makeBaseFastify();
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(null);

    const service = new ProductsService(fastify);
    await expect(service.adminUpdateProduct('nonexistent', { name: 'Updated' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when new categoryId does not exist', async () => {
    const existing = { id: 'prod_1', updatedAt: new Date() };
    const fastify = makeBaseFastify();
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(existing);
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(null);

    const service = new ProductsService(fastify);
    await expect(service.adminUpdateProduct('prod_1', { categoryId: 'nonexistent' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates name and returns refreshed product', async () => {
    const existing = { id: 'prod_1', updatedAt: new Date() };
    const updated = { id: 'prod_1', name: 'Updated', category: {}, images: [], variants: [] };
    const fastify = makeBaseFastify();
    const updateFn = vi.fn().mockResolvedValue(updated);
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(existing);
    (fastify.prisma.product as unknown as { update: ReturnType<typeof vi.fn> }).update = updateFn;
    (fastify.prisma.product as unknown as { findUniqueOrThrow: ReturnType<typeof vi.fn> }).findUniqueOrThrow = vi.fn().mockResolvedValue(updated);

    const service = new ProductsService(fastify);
    const result = await service.adminUpdateProduct('prod_1', { name: 'Updated' });

    expect(result).toMatchObject({ id: 'prod_1', name: 'Updated' });
    expect(updateFn).toHaveBeenCalledOnce();
  });

  it('uses scalar categoryId with updateMany for optimistic concurrency', async () => {
    const existing = { id: 'prod_1', updatedAt: new Date('2026-01-01T00:00:00.000Z') };
    const updated = {
      id: 'prod_1',
      name: 'Updated',
      category: { id: 'cat_2' },
      images: [],
      variants: []
    };
    const fastify = makeBaseFastify();
    const updateManyFn = vi.fn().mockResolvedValue({ count: 1 });
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi
      .fn()
      .mockResolvedValue(existing);
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'cat_2' });
    (fastify.prisma.product as unknown as { updateMany: ReturnType<typeof vi.fn> }).updateMany = updateManyFn;
    (fastify.prisma.product as unknown as { update: unknown }).update = async () => updated;
    (fastify.prisma.product as unknown as { findUniqueOrThrow: ReturnType<typeof vi.fn> }).findUniqueOrThrow = vi
      .fn()
      .mockResolvedValue(updated);

    const service = new ProductsService(fastify);
    const result = await service.adminUpdateProduct('prod_1', {
      name: 'Updated',
      categoryId: 'cat_2'
    });

    expect(result).toMatchObject({ id: 'prod_1', name: 'Updated' });
    expect(updateManyFn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prod_1', updatedAt: existing.updatedAt },
        data: expect.objectContaining({ name: 'Updated', categoryId: 'cat_2' })
      })
    );
    expect(updateManyFn.mock.calls[0]?.[0]?.data).not.toHaveProperty('category');
  });

  it('syncs variant hsnCode and gstRatePercent when product attributes change', async () => {
    const existing = { id: 'prod_1', updatedAt: new Date('2026-01-01T00:00:00.000Z') };
    const updated = { id: 'prod_1', category: {}, images: [], variants: [] };
    const fastify = makeBaseFastify();
    const updateManyFn = vi.fn().mockResolvedValue({ count: 1 });
    const variantUpdateManyFn = vi.fn().mockResolvedValue({ count: 1 });
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi
      .fn()
      .mockResolvedValue(existing);
    (fastify.prisma.product as unknown as { updateMany: ReturnType<typeof vi.fn> }).updateMany = updateManyFn;
    (fastify.prisma.product as unknown as { findUniqueOrThrow: ReturnType<typeof vi.fn> }).findUniqueOrThrow = vi
      .fn()
      .mockResolvedValue(updated);
    (fastify.prisma.productVariant as unknown as { updateMany: ReturnType<typeof vi.fn> }).updateMany = variantUpdateManyFn;

    const service = new ProductsService(fastify);
    await service.adminUpdateProduct('prod_1', {
      attributes: { hsnCode: '0910', gstRate: 5 }
    });

    expect(variantUpdateManyFn).toHaveBeenCalledWith({
      where: { productId: 'prod_1' },
      data: { hsnCode: '0910', gstRatePercent: 5 }
    });
  });

  it('throws 400 when product attributes contain invalid HSN', async () => {
    const existing = { id: 'prod_1', updatedAt: new Date() };
    const fastify = makeBaseFastify();
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(existing);

    const service = new ProductsService(fastify);
    await expect(
      service.adminUpdateProduct('prod_1', {
        attributes: { hsnCode: 'NA' }
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ── adminDeleteProduct ────────────────────────────────────────────────────────

describe('ProductsService adminDeleteProduct', () => {
  it('throws 404 when product does not exist', async () => {
    const fastify = makeBaseFastify();
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(null);

    const service = new ProductsService(fastify);
    await expect(service.adminDeleteProduct('nonexistent')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('deactivates product and returns success message', async () => {
    const existing = { id: 'prod_1', isActive: true };
    const fastify = makeBaseFastify();
    const updateFn = vi.fn().mockResolvedValue({ id: 'prod_1', isActive: false });
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(existing);
    (fastify.prisma.product as unknown as { update: ReturnType<typeof vi.fn> }).update = updateFn;

    const service = new ProductsService(fastify);
    const result = await service.adminDeleteProduct('prod_1');

    expect(result).toMatchObject({ message: 'Product deactivated' });
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'prod_1' }, data: { isActive: false } }));
  });

  it('returns success when product is already inactive (idempotent delete)', async () => {
    const existing = { id: 'prod_1', isActive: false };
    const fastify = makeBaseFastify();
    const updateFn = vi.fn().mockResolvedValue({ id: 'prod_1', isActive: false });
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(existing);
    (fastify.prisma.product as unknown as { update: ReturnType<typeof vi.fn> }).update = updateFn;

    const service = new ProductsService(fastify);
    const result = await service.adminDeleteProduct('prod_1');

    expect(result).toMatchObject({ message: 'Product deactivated' });
  });

  it('purges cart lines and reservations for all variants on deactivation', async () => {
    const existing = { id: 'prod_1', isActive: true };
    const fastify = makeBaseFastify();
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(existing);
    (fastify.prisma.product as unknown as { update: ReturnType<typeof vi.fn> }).update = vi.fn().mockResolvedValue({ id: 'prod_1', isActive: false });
    (fastify.prisma.productVariant as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany =
      vi.fn().mockResolvedValue([{ id: 'v1' }, { id: 'v2' }]);

    const service = new ProductsService(fastify);
    await service.adminDeleteProduct('prod_1');

    // Deactivated product must disappear from live carts (lines + stock reservations).
    expect((fastify.prisma as unknown as { cartItem: { deleteMany: ReturnType<typeof vi.fn> } }).cartItem.deleteMany)
      .toHaveBeenCalledWith({ where: { variantId: { in: ['v1', 'v2'] } } });
    expect((fastify.prisma as unknown as { cartReservation: { deleteMany: ReturnType<typeof vi.fn> } }).cartReservation.deleteMany)
      .toHaveBeenCalledWith({ where: { variantId: { in: ['v1', 'v2'] } } });
  });
});

// ── adminUpdateProductVariant deactivation ───────────────────────────────────

describe('ProductsService adminUpdateProductVariant deactivation', () => {
  it('purges cart lines and reservations when a variant is deactivated', async () => {
    const fastify = makeBaseFastify();
    const variant = { id: 'v1', productId: 'prod_1', isActive: true, price: 1000, compareAtPrice: null, updatedAt: new Date(), inventory: null };
    (fastify.prisma.productVariant as unknown as { findFirst: ReturnType<typeof vi.fn> }).findFirst = vi.fn().mockResolvedValue(variant);
    (fastify.prisma.productVariant as unknown as { update: ReturnType<typeof vi.fn> }).update = vi.fn().mockResolvedValue({ ...variant, isActive: false });
    (fastify.prisma.productVariant as unknown as { findUniqueOrThrow: ReturnType<typeof vi.fn> }).findUniqueOrThrow = vi.fn().mockResolvedValue({ ...variant, isActive: false });

    const service = new ProductsService(fastify);
    await service.adminUpdateProductVariant('prod_1', 'v1', { isActive: false });

    expect((fastify.prisma as unknown as { cartItem: { deleteMany: ReturnType<typeof vi.fn> } }).cartItem.deleteMany)
      .toHaveBeenCalledWith({ where: { variantId: 'v1' } });
    expect((fastify.prisma as unknown as { cartReservation: { deleteMany: ReturnType<typeof vi.fn> } }).cartReservation.deleteMany)
      .toHaveBeenCalledWith({ where: { variantId: 'v1' } });
  });

  it('does NOT purge cart lines on a regular (non-deactivating) update', async () => {
    const fastify = makeBaseFastify();
    const variant = { id: 'v1', productId: 'prod_1', isActive: true, price: 1000, compareAtPrice: null, updatedAt: new Date(), inventory: null };
    (fastify.prisma.productVariant as unknown as { findFirst: ReturnType<typeof vi.fn> }).findFirst = vi.fn().mockResolvedValue(variant);
    (fastify.prisma.productVariant as unknown as { update: ReturnType<typeof vi.fn> }).update = vi.fn().mockResolvedValue(variant);
    (fastify.prisma.productVariant as unknown as { findUniqueOrThrow: ReturnType<typeof vi.fn> }).findUniqueOrThrow = vi.fn().mockResolvedValue(variant);

    const service = new ProductsService(fastify);
    await service.adminUpdateProductVariant('prod_1', 'v1', { price: 1500 });

    expect((fastify.prisma as unknown as { cartItem: { deleteMany: ReturnType<typeof vi.fn> } }).cartItem.deleteMany)
      .not.toHaveBeenCalled();
  });
});

// ── adminCreateCategory ───────────────────────────────────────────────────────

describe('ProductsService adminCreateCategory', () => {
  it('creates a new category when slug does not exist', async () => {
    const created = { id: 'cat_new', name: 'Shoes', slug: 'shoes', isActive: true, parentId: null, imageUrl: null, createdAt: new Date(), updatedAt: new Date() };
    const fastify = makeBaseFastify();
    const createFn = vi.fn().mockResolvedValue(created);
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(null);
    (fastify.prisma.category as unknown as { create: ReturnType<typeof vi.fn> }).create = createFn;

    const service = new ProductsService(fastify);
    const result = await service.adminCreateCategory({ name: 'Shoes', slug: 'shoes' });

    expect(result).toMatchObject({ id: 'cat_new', name: 'Shoes' });
    expect(createFn).toHaveBeenCalledOnce();
  });

  it('reactivates an existing category when slug already exists', async () => {
    const existing = { id: 'cat_1', name: 'Shoes', slug: 'shoes', isActive: false, parentId: null, imageUrl: null, updatedAt: new Date() };
    const updated = { id: 'cat_1', name: 'Shoes', slug: 'shoes', isActive: true };
    const fastify = makeBaseFastify();
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(existing);
    const updateFn = vi.fn().mockResolvedValue(updated);
    const findUniqueOrThrowFn = vi.fn().mockResolvedValue(updated);
    (fastify.prisma.category as unknown as { update: ReturnType<typeof vi.fn> }).update = updateFn;
    (fastify.prisma.category as unknown as { findUniqueOrThrow: ReturnType<typeof vi.fn> }).findUniqueOrThrow = findUniqueOrThrowFn;

    const service = new ProductsService(fastify);
    const result = await service.adminCreateCategory({ name: 'Shoes', slug: 'shoes', isActive: true });

    expect(result).toMatchObject({ id: 'cat_1', isActive: true });
  });

  it('returns existing category unchanged when all fields already match', async () => {
    const existing = { id: 'cat_1', name: 'Shoes', slug: 'shoes', isActive: true, parentId: null, imageUrl: null, updatedAt: new Date() };
    const fastify = makeBaseFastify();
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(existing);

    const service = new ProductsService(fastify);
    const result = await service.adminCreateCategory({ name: 'Shoes', slug: 'shoes' });

    expect(result.id).toBe('cat_1');
  });
});

// ── adminUpdateCategory ───────────────────────────────────────────────────────

describe('ProductsService adminUpdateCategory', () => {
  it('throws 404 when category does not exist', async () => {
    const fastify = makeBaseFastify();
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(null);

    const service = new ProductsService(fastify);
    await expect(service.adminUpdateCategory('nonexistent', { name: 'Updated' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates category name and returns refreshed category', async () => {
    const existing = { id: 'cat_1', updatedAt: new Date() };
    const updated = { id: 'cat_1', name: 'Updated' };
    const fastify = makeBaseFastify();
    const updateFn = vi.fn().mockResolvedValue(updated);
    const findUniqueOrThrowFn = vi.fn().mockResolvedValue(updated);
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(existing);
    (fastify.prisma.category as unknown as { update: ReturnType<typeof vi.fn> }).update = updateFn;
    (fastify.prisma.category as unknown as { findUniqueOrThrow: ReturnType<typeof vi.fn> }).findUniqueOrThrow = findUniqueOrThrowFn;

    const service = new ProductsService(fastify);
    const result = await service.adminUpdateCategory('cat_1', { name: 'Updated' });

    expect(result).toMatchObject({ id: 'cat_1', name: 'Updated' });
    expect(updateFn).toHaveBeenCalledOnce();
  });

  it('rejects setting category as its own parent', async () => {
    const existing = { id: 'cat_1', updatedAt: new Date() };
    const fastify = makeBaseFastify();
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi
      .fn()
      .mockResolvedValue(existing);

    const service = new ProductsService(fastify);
    await expect(service.adminUpdateCategory('cat_1', { parentId: 'cat_1' })).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('rejects invalid parent category id', async () => {
    const existing = { id: 'cat_1', updatedAt: new Date() };
    const fastify = makeBaseFastify();
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi
      .fn()
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null);

    const service = new ProductsService(fastify);
    await expect(service.adminUpdateCategory('cat_1', { parentId: 'missing' })).rejects.toMatchObject({
      statusCode: 404
    });
  });
});

// ── adminDeleteCategory ───────────────────────────────────────────────────────

describe('ProductsService adminDeleteCategory', () => {
  it('throws 404 when category does not exist', async () => {
    const fastify = makeBaseFastify();
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(null);

    const service = new ProductsService(fastify);
    await expect(service.adminDeleteCategory('nonexistent')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('deactivates category and returns message', async () => {
    const existing = { id: 'cat_1', isActive: true };
    const fastify = makeBaseFastify();
    const updateFn = vi.fn().mockResolvedValue({ id: 'cat_1', isActive: false });
    (fastify.prisma.category as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi.fn().mockResolvedValue(existing);
    (fastify.prisma.category as unknown as { update: ReturnType<typeof vi.fn> }).update = updateFn;

    const service = new ProductsService(fastify);
    const result = await service.adminDeleteCategory('cat_1');

    expect(result).toMatchObject({ message: 'Category deactivated' });
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cat_1' }, data: { isActive: false } }));
  });
});

// ── adminImportProductsCsv ────────────────────────────────────────────────────

describe('ProductsService adminImportProductsCsv', () => {
  it('throws 400 when CSV has only header and no data rows', async () => {
    const fastify = makeBaseFastify();
    const service = new ProductsService(fastify);

    await expect(
      service.adminImportProductsCsv({ csv: 'name,slug,description,categoryslug' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 when CSV is missing required columns', async () => {
    const fastify = makeBaseFastify();
    const service = new ProductsService(fastify);

    await expect(
      service.adminImportProductsCsv({ csv: 'name,slug\nShoes,shoes' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('adminHardDeleteProduct permanently deletes a product', async () => {
    const fastify = makeBaseFastify();
    const findUnique = vi.fn().mockResolvedValue({
      id: 'prod_1',
      images: [{ url: 'https://img.test/1.jpg' }],
      variants: [{ id: 'var_1' }]
    });
    const deleteFn = vi.fn().mockResolvedValue({ id: 'prod_1' });
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = findUnique;
    (fastify.prisma.product as unknown as { delete: ReturnType<typeof vi.fn> }).delete = deleteFn;
    (fastify.prisma as unknown as {
      orderItem: { count: ReturnType<typeof vi.fn> };
      review: { count: ReturnType<typeof vi.fn> };
      cartItem: { deleteMany: ReturnType<typeof vi.fn> };
    }).orderItem = { count: vi.fn().mockResolvedValue(0) };
    (fastify.prisma as unknown as {
      orderItem: { count: ReturnType<typeof vi.fn> };
      review: { count: ReturnType<typeof vi.fn> };
      cartItem: { deleteMany: ReturnType<typeof vi.fn> };
    }).review = { count: vi.fn().mockResolvedValue(0) };
    (fastify.prisma as unknown as {
      orderItem: { count: ReturnType<typeof vi.fn> };
      review: { count: ReturnType<typeof vi.fn> };
      cartItem: { deleteMany: ReturnType<typeof vi.fn> };
    }).cartItem = { deleteMany };

    const service = new ProductsService(fastify);
    const result = await service.adminHardDeleteProduct('prod_1');

    expect(deleteMany).toHaveBeenCalledWith({ where: { variantId: { in: ['var_1'] } } });
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'prod_1' } });
    expect(result.message).toBe('Product permanently deleted');
  });

  it('adminHardDeleteProduct throws 409 when product has order history', async () => {
    const fastify = makeBaseFastify();
    const findUnique = vi.fn().mockResolvedValue({
      id: 'prod_1',
      images: [],
      variants: [{ id: 'var_1' }]
    });
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = findUnique;
    (fastify.prisma as unknown as {
      orderItem: { count: ReturnType<typeof vi.fn> };
      review: { count: ReturnType<typeof vi.fn> };
    }).orderItem = { count: vi.fn().mockResolvedValue(2) };
    (fastify.prisma as unknown as {
      orderItem: { count: ReturnType<typeof vi.fn> };
      review: { count: ReturnType<typeof vi.fn> };
    }).review = { count: vi.fn().mockResolvedValue(0) };

    const service = new ProductsService(fastify);
    await expect(service.adminHardDeleteProduct('prod_1')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('adminHardDeleteProduct throws 404 when product not found', async () => {
    const fastify = makeBaseFastify();
    const findUnique = vi.fn().mockResolvedValue(null);
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = findUnique;

    const service = new ProductsService(fastify);
    await expect(service.adminHardDeleteProduct('nonexistent')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('processes a valid CSV row and returns created count', async () => {
    const fastify = makeBaseFastify();
    const findFirstCategory = vi.fn().mockResolvedValue({ id: 'cat_1' });
    const findUniqueProduct = vi.fn().mockResolvedValue(null);
    const createProduct = vi.fn().mockResolvedValue({ id: 'prod_1' });
    (fastify.prisma.category as unknown as { findFirst: ReturnType<typeof vi.fn> }).findFirst = findFirstCategory;
    (fastify.prisma.product as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = findUniqueProduct;
    (fastify.prisma.product as unknown as { create: ReturnType<typeof vi.fn> }).create = createProduct;

    const service = new ProductsService(fastify);
    const csv = 'name,slug,description,categoryslug\nShoes,shoes,Great shoes,footwear';
    const result = await service.adminImportProductsCsv({ csv });

    expect(result.createdCount).toBe(1);
    expect(result.updatedCount).toBe(0);
  });
});
