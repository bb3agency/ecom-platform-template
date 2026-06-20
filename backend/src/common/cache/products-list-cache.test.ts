import { describe, expect, it, vi } from 'vitest';

import { buildProductsListCacheKey, invalidateProductsListCache } from './products-list-cache';

describe('products list cache', () => {
  it('builds stable cache key independent of object key order', () => {
    const payloadA = {
      category: 'fruits',
      filters: { inStock: true, rating: 4 },
      sort: 'price_asc'
    };
    const payloadB = {
      sort: 'price_asc',
      filters: { rating: 4, inStock: true },
      category: 'fruits'
    };

    const keyA = buildProductsListCacheKey(payloadA);
    const keyB = buildProductsListCacheKey(payloadB);

    expect(keyA).toBe(keyB);
    expect(keyA.startsWith('products:list:')).toBe(true);
  });

  it('invalidates all products list cache keys via scan cursor loop', async () => {
    const scan = vi
      .fn()
      .mockResolvedValueOnce(['1', ['products:list:a', 'products:list:b']])
      .mockResolvedValueOnce(['0', ['products:list:c']]);
    const del = vi.fn(async () => 3);

    const redis = {
      scan,
      del
    };

    await invalidateProductsListCache(redis as never);

    expect(scan).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenNthCalledWith(1, 'products:list:a', 'products:list:b');
    expect(del).toHaveBeenNthCalledWith(2, 'products:list:c');
  });

  it('skips del when scan returns no keys', async () => {
    const scan = vi.fn().mockResolvedValueOnce(['0', []]);
    const del = vi.fn(async () => 0);

    const redis = {
      scan,
      del
    };

    await invalidateProductsListCache(redis as never);

    expect(scan).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });
});
