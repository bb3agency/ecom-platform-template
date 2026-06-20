import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ProductsService } from './products.service';

describe('ProductsService public catalog search', () => {
  it('filters active categories by name or slug', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'cat_1', name: 'Fruits', slug: 'fruits' }]);
    const fastify = {
      prisma: {
        category: { findMany }
      }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    const categories = await service.listCategories({ search: 'fruit' });

    expect(categories).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [
          { name: { contains: 'fruit', mode: 'insensitive' } },
          { slug: { contains: 'fruit', mode: 'insensitive' } }
        ]
      },
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }]
    });
  });

  it('searches products with admin-style contains matching', async () => {
    const product = {
      id: 'prod_1',
      name: 'Organic Honey',
      slug: 'organic-honey',
      category: { id: 'cat_1', name: 'Pantry', slug: 'pantry' },
      images: [],
      variants: [{ id: 'var_1', price: 5000, isActive: true, inventory: { quantity: 5 } }]
    };

    const fastify = {
      prisma: {
        $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
        product: {
          findMany: vi.fn().mockResolvedValue([product]),
          count: vi.fn().mockResolvedValue(1)
        },
        cartReservation: {
          groupBy: vi.fn().mockResolvedValue([])
        }
      },
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK')
      },
      queues: {
        analytics: { add: vi.fn() }
      },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    const response = await service.listProducts({
      search: 'honey',
      page: 1,
      limit: 10,
      inStock: false
    });

    expect(response.items).toHaveLength(1);
    expect(fastify.prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          OR: expect.arrayContaining([
            { name: { contains: 'honey', mode: 'insensitive' } },
            { description: { contains: 'honey', mode: 'insensitive' } },
            { tags: { hasSome: ['honey'] } }
          ])
        })
      })
    );
  });
});
