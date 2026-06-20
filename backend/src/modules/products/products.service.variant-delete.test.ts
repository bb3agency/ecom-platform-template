import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ProductsService } from './products.service';

function makeFastify(overrides: Record<string, unknown> = {}): FastifyInstance {
  return {
    prisma: {
      product: {
        findUnique: vi.fn().mockResolvedValue({ id: 'prod_1' }),
        ...((overrides.product as object) ?? {})
      },
      productVariant: {
        count: vi.fn().mockResolvedValue(2),
        delete: vi.fn().mockResolvedValue({ id: 'v1' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'v1', productId: 'prod_1' }),
        ...((overrides.productVariant as object) ?? {})
      },
      $transaction: vi.fn().mockResolvedValue([])
    },
    redis: {
      scan: vi.fn().mockResolvedValue(['0', []]),
      del: vi.fn().mockResolvedValue(0),
      ...((overrides.redis as object) ?? {})
    },
    queues: {
      analytics: { add: vi.fn() },
      ...((overrides.queues as object) ?? {})
    },
    log: { error: vi.fn() }
  } as unknown as FastifyInstance;
}

describe('ProductsService adminDeleteProductVariant', () => {
  it('deletes variant when product has more than one variant', async () => {
    const fastify = makeFastify();
    const service = new ProductsService(fastify);

    const result = await service.adminDeleteProductVariant('prod_1', 'v1');
    expect(result).toEqual({ message: 'Product variant deleted' });
    expect(fastify.prisma.productVariant.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'v1' } })
    );
  });

  it('throws 400 when trying to delete the last variant', async () => {
    const fastify = makeFastify({ productVariant: { count: vi.fn().mockResolvedValue(1), delete: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue({ id: 'v1', productId: 'prod_1' }) } });
    const service = new ProductsService(fastify);

    await expect(service.adminDeleteProductVariant('prod_1', 'v1')).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('throws 404 when variant does not belong to the product', async () => {
    const fastify = makeFastify({ productVariant: { count: vi.fn().mockResolvedValue(2), delete: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null) } });
    const service = new ProductsService(fastify);

    await expect(service.adminDeleteProductVariant('prod_1', 'v_other')).rejects.toMatchObject({
      statusCode: 404
    });
  });
});
