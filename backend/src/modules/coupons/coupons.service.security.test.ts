import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRateLimitStore } from '@common/rate-limit/admin-rate-limit.store';

describe('coupon admin security controls', () => {
  beforeEach(() => {
    AdminRateLimitStore.cleanup();
    vi.useRealTimers();
  });

  it('enforces coupon mutation rate limits per admin and action', async () => {
    const store = AdminRateLimitStore.getInstance();

    await expect(store.checkLimit('admin-1', 'coupon:create', 2, 60)).resolves.toBe(true);
    await expect(store.checkLimit('admin-1', 'coupon:create', 2, 60)).resolves.toBe(true);
    await expect(store.checkLimit('admin-1', 'coupon:create', 2, 60)).resolves.toBe(false);
    await expect(store.checkLimit('admin-2', 'coupon:create', 2, 60)).resolves.toBe(true);
    await expect(store.checkLimit('admin-1', 'coupon:update', 2, 60)).resolves.toBe(true);
  });

  it('uses Redis sliding window operations when Redis is available', async () => {
    const redis = {
      zremrangebyscore: vi.fn().mockResolvedValue(1),
      zcard: vi.fn().mockResolvedValue(0),
      zadd: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1)
    };
    const store = AdminRateLimitStore.getInstance(redis);

    await expect(store.checkLimit('admin-1', 'coupon:delete', 1, 60)).resolves.toBe(true);

    expect(redis.zremrangebyscore).toHaveBeenCalled();
    expect(redis.zcard).toHaveBeenCalledWith('admin:ratelimit:admin-1:coupon:delete');
    expect(redis.zadd).toHaveBeenCalled();
    expect(redis.expire).toHaveBeenCalledWith('admin:ratelimit:admin-1:coupon:delete', 60);
  });
});
