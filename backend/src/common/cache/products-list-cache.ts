import { createHash } from 'node:crypto';
import type Redis from 'ioredis';

const PRODUCTS_LIST_CACHE_PREFIX = 'products:list:';

type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

function sortJsonLike(value: JsonLike): JsonLike {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonLike(item));
  }

  if (value && typeof value === 'object') {
    const sortedEntries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    const sortedObject: Record<string, JsonLike> = {};
    for (const [key, entryValue] of sortedEntries) {
      sortedObject[key] = sortJsonLike(entryValue);
    }
    return sortedObject;
  }

  return value;
}

export function buildProductsListCacheKey(cachePayload: Record<string, JsonLike>): string {
  const stableJson = JSON.stringify(sortJsonLike(cachePayload));
  const hash = createHash('sha256').update(stableJson).digest('hex');
  return `${PRODUCTS_LIST_CACHE_PREFIX}${hash}`;
}

export async function invalidateProductsListCache(redis: Redis): Promise<void> {
  let cursor = '0';

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${PRODUCTS_LIST_CACHE_PREFIX}*`, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}
