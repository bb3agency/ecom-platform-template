import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ProductsService } from './products.service';

describe('ProductsService product image contracts', () => {
  it('rejects image create when max image count reached', async () => {
    const fastify = {
      prisma: {
        product: {
          findUnique: vi.fn().mockResolvedValue({ id: 'prod_1' })
        },
        productImage: {
          count: vi.fn().mockResolvedValue(8),
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
      service.adminCreateProductImage('prod_1', {
        url: 'https://cdn.example.com/products/sample.jpg',
        altText: 'Sample',
        sortOrder: 0
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects duplicate image ids in reorder payload', async () => {
    const fastify = {
      prisma: {
        product: {
          findUnique: vi.fn().mockResolvedValue({ id: 'prod_1' })
        },
        productImage: {
          findMany: vi.fn(),
          update: vi.fn()
        },
        $transaction: vi.fn()
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
      service.adminReorderProductImages('prod_1', {
        images: [
          { id: 'img_1', sortOrder: 0 },
          { id: 'img_1', sortOrder: 1 }
        ]
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects duplicate sort orders in reorder payload', async () => {
    const fastify = {
      prisma: {
        product: {
          findUnique: vi.fn().mockResolvedValue({ id: 'prod_1' })
        },
        productImage: {
          findMany: vi.fn(),
          update: vi.fn()
        },
        $transaction: vi.fn()
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
      service.adminReorderProductImages('prod_1', {
        images: [
          { id: 'img_1', sortOrder: 0 },
          { id: 'img_2', sortOrder: 0 }
        ]
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects image create when sort order already exists for product', async () => {
    const fastify = {
      prisma: {
        product: {
          findUnique: vi.fn().mockResolvedValue({ id: 'prod_1' })
        },
        productImage: {
          count: vi.fn().mockResolvedValue(2),
          findFirst: vi.fn().mockResolvedValue({ id: 'img_existing' }),
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
      service.adminCreateProductImage('prod_1', {
        url: 'https://cdn.example.com/products/sample.jpg',
        altText: 'Sample',
        sortOrder: 1
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
