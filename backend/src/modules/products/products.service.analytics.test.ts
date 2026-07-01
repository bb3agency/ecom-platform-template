import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ProductsService } from './products.service';

function createRedisMock() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    scan: vi.fn().mockResolvedValue(['0', []]),
    del: vi.fn().mockResolvedValue(0)
  };
}

describe('ProductsService analytics producers', () => {
  it('enqueues PAGE_VIEW event when listing products without search query', async () => {
    const analyticsAdd = vi.fn().mockResolvedValue(undefined);
    const redis = createRedisMock();
    const fastify = {
      prisma: {
        $transaction: vi.fn().mockResolvedValue([[], 0]),
        product: {
          findMany: vi.fn(),
          count: vi.fn()
        }
      },
      queues: {
        analytics: {
          add: analyticsAdd
        }
      },
      redis,
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    await service.listProducts({ page: 1, limit: 20 });

    expect(analyticsAdd).toHaveBeenCalledWith(
      'record-event',
      expect.objectContaining({
        eventType: 'PAGE_VIEW',
        sessionId: 'catalog:all',
        payload: expect.objectContaining({
          category: null
        })
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('analytics-PAGE_VIEW-catalog-all-')
      })
    );
  });

  it('applies in-stock variant filter when listing products', async () => {
    const analyticsAdd = vi.fn().mockResolvedValue(undefined);
    const redis = createRedisMock();
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
          add: analyticsAdd
        }
      },
      redis,
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    await service.listProducts({ page: 1, limit: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          variants: expect.objectContaining({
            some: expect.objectContaining({
              isActive: true,
              inventory: {
                is: {
                  quantity: {
                    gt: 0
                  }
                }
              }
            })
          })
        })
      })
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          variants: expect.objectContaining({
            some: expect.objectContaining({
              isActive: true
            })
          })
        })
      })
    );
  });

  it('enqueues SEARCH event when listProducts has search query', async () => {
    const analyticsAdd = vi.fn().mockResolvedValue(undefined);
    const redis = createRedisMock();
    const product = {
      id: 'prod_1',
      slug: 'milk',
      name: 'Milk',
      description: 'Fresh milk',
      tags: [],
      isFeatured: false,
      category: { id: 'cat_1', name: 'Dairy', slug: 'dairy' },
      variants: []
    };
    const findMany = vi.fn().mockResolvedValue([product]);
    const count = vi.fn().mockResolvedValue(1);
    const fastify = {
      prisma: {
        $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
        product: {
          findMany,
          count
        },
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ reviewsEnabled: false })
        },
        cartReservation: {
          groupBy: vi.fn().mockResolvedValue([])
        }
      },
      queues: {
        analytics: {
          add: analyticsAdd
        }
      },
      redis,
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    await service.listProducts({ search: 'milk', page: 1, limit: 20 });

    expect(analyticsAdd).toHaveBeenCalledWith(
      'record-event',
      expect.objectContaining({
        eventType: 'SEARCH',
        sessionId: 'search:milk',
        payload: expect.objectContaining({
          search: 'milk'
        })
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('analytics-SEARCH-search-milk-')
      })
    );
  });

  it('enqueues PRODUCT_VIEW event when loading product by slug', async () => {
    const analyticsAdd = vi.fn().mockResolvedValue(undefined);
    const redis = createRedisMock();
    const fastify = {
      prisma: {
        product: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'prod_1',
            slug: 'fresh-milk',
            name: 'Fresh Milk',
            category: { id: 'cat_1', name: 'Dairy', slug: 'dairy' },
            variants: []
          })
        },
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ reviewsEnabled: false })
        }
      },
      queues: {
        analytics: {
          add: analyticsAdd
        }
      },
      redis,
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    await service.getProductBySlug('fresh-milk');

    expect(analyticsAdd).toHaveBeenCalledWith(
      'record-event',
      expect.objectContaining({
        eventType: 'PRODUCT_VIEW',
        sessionId: 'product:fresh-milk',
        payload: expect.objectContaining({
          productId: 'prod_1'
        })
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('analytics-PRODUCT_VIEW-product-fresh-milk-')
      })
    );
  });

  it('fetches active variants with inventory included when fetching product by slug', async () => {
    const analyticsAdd = vi.fn().mockResolvedValue(undefined);
    const redis = createRedisMock();
    const findFirst = vi.fn().mockResolvedValue({
      id: 'prod_1',
      slug: 'fresh-milk',
      name: 'Fresh Milk',
      category: { id: 'cat_1', name: 'Dairy', slug: 'dairy' },
      variants: []
    });
    const fastify = {
      prisma: {
        product: {
          findFirst
        },
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ reviewsEnabled: false })
        },
        cartReservation: {
          groupBy: vi.fn().mockResolvedValue([])
        }
      },
      queues: {
        analytics: {
          add: analyticsAdd
        }
      },
      redis,
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new ProductsService(fastify);
    await service.getProductBySlug('fresh-milk');

    // Service now fetches all active variants and includes inventory for inStock calculation
    // rather than filtering by stock level in the DB query itself.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: 'fresh-milk',
          isActive: true,
          variants: expect.objectContaining({
            some: expect.objectContaining({
              isActive: true
            })
          })
        }),
        include: expect.objectContaining({
          variants: expect.objectContaining({
            include: expect.objectContaining({ inventory: true })
          })
        })
      })
    );
  });
});

