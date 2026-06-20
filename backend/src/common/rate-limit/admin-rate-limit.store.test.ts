import { describe, expect, it, vi } from 'vitest';
import { AdminRateLimitStore } from './admin-rate-limit.store';

describe('AdminRateLimitStore', () => {
  it('falls back to local store when redis commands fail', async () => {
    AdminRateLimitStore.cleanup();
    const store = AdminRateLimitStore.getInstance({
      zremrangebyscore: vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
      zcard: vi.fn(async () => 0),
      zadd: vi.fn(async () => 1),
      expire: vi.fn(async () => 1)
    });

    await expect(store.checkLimit('admin-1', 'delete', 5, 60)).resolves.toBe(true);
    await expect(store.checkLimit('admin-1', 'delete', 5, 60)).resolves.toBe(true);
  });

  it('uses local store when redis is unavailable at construction', async () => {
    AdminRateLimitStore.cleanup();
    const store = AdminRateLimitStore.getInstance(null);

    await expect(store.checkLimit('admin-2', 'update', 1, 60)).resolves.toBe(true);
    await expect(store.checkLimit('admin-2', 'update', 1, 60)).resolves.toBe(false);
  });
});
