import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ProductsService } from './products.service';

describe('ProductsService admin read APIs', () => {
  it('lists admin products with pagination metadata', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const fastify = {
      prisma: {
        $transaction: vi.fn().mockResolvedValue([[], 0]),
        product: {
          findMany,
          count
        }
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
    const result = await service.adminListProducts({ page: 1, limit: 20 });

    expect(result).toEqual({
      items: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
      }
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20
      })
    );
    expect(count).toHaveBeenCalled();
  });

  it('applies admin product filters for price and stock', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const fastify = {
      prisma: {
        product: { findMany, count },
        $transaction: vi.fn((promises: Array<Promise<unknown>>) => Promise.all(promises))
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
    await service.adminListProducts({ page: 1, limit: 20, isActive: false });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: false })
      })
    );
  });

  it('applies out-of-stock filter when inStock is false', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const fastify = {
      prisma: {
        product: { findMany, count },
        $transaction: vi.fn((promises: Array<Promise<unknown>>) => Promise.all(promises))
      },
      queues: { analytics: { add: vi.fn() } },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    await service.adminListProducts({ page: 1, limit: 20, inStock: false });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { variants: { none: { inventory: { is: { quantity: { gt: 0 } } } } } }
          ])
        })
      })
    );
  });

  it('returns admin product by id', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'prod_1',
      name: 'Milk',
      slug: 'milk',
      description: 'Fresh milk',
      tags: [],
      isFeatured: false,
      category: {
        id: 'cat_1',
        name: 'Dairy',
        slug: 'dairy'
      },
      variants: []
    });
    const fastify = {
      prisma: {
        product: {
          findUnique
        }
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
    const product = await service.adminGetProductById('prod_1');

    expect(product.id).toBe('prod_1');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prod_1' }
      })
    );
  });

  it('lists admin categories without storefront active-only filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const fastify = {
      prisma: {
        $transaction: vi.fn().mockResolvedValue([[], 0]),
        category: {
          findMany,
          count
        }
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
    const result = await service.adminListCategories({ page: 1, limit: 20 });

    expect(result).toEqual({
      items: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
      }
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
        skip: 0,
        take: 20
      })
    );
    expect(count).toHaveBeenCalledWith({ where: {} });
  });

  it('applies isActive and search filters for admin category list', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const fastify = {
      prisma: {
        $transaction: vi.fn().mockResolvedValue([[], 0]),
        category: {
          findMany,
          count
        }
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
    await service.adminListCategories({ page: 1, limit: 20, isActive: true, search: 'veg' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          OR: [
            { name: { contains: 'veg', mode: 'insensitive' } },
            { slug: { contains: 'veg', mode: 'insensitive' } }
          ]
        }
      })
    );
    expect(count).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [
          { name: { contains: 'veg', mode: 'insensitive' } },
          { slug: { contains: 'veg', mode: 'insensitive' } }
        ]
      }
    });
  });

  it('returns a category by id', async () => {
    const category = {
      id: 'cat_1',
      name: 'Shoes',
      slug: 'shoes',
      parentId: null,
      imageUrl: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const findUnique = vi.fn().mockResolvedValue(category);
    const fastify = {
      prisma: {
        category: { findUnique }
      },
      redis: { del: vi.fn() },
      queues: { analytics: { add: vi.fn() } },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    const result = await service.adminGetCategoryById('cat_1');

    expect(result).toEqual(category);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'cat_1' } });
  });

  it('throws 404 when category id does not exist', async () => {
    const fastify = {
      prisma: {
        category: { findUnique: vi.fn().mockResolvedValue(null) }
      },
      redis: { del: vi.fn() },
      queues: { analytics: { add: vi.fn() } },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    await expect(service.adminGetCategoryById('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

});
