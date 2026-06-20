type RedisLike = {
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zcard(key: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
};

/**
 * Per-admin sliding-window rate limit store.
 * Uses Redis when available and a bounded in-memory fallback otherwise.
 */
export class AdminRateLimitStore {
  private static instance: AdminRateLimitStore | null = null;

  private readonly redis: RedisLike | null;
  private readonly localStore = new Map<string, number[]>();
  private readonly maxLocalKeys = 5000;

  private constructor(redis: RedisLike | null) {
    this.redis = redis;
  }

  /**
   * Returns singleton instance.
   */
  static getInstance(redis?: RedisLike | null): AdminRateLimitStore {
    if (!AdminRateLimitStore.instance) {
      AdminRateLimitStore.instance = new AdminRateLimitStore(redis ?? null);
    }
    return AdminRateLimitStore.instance;
  }

  /**
   * Checks and records a request in the configured sliding window.
   */
  async checkLimit(adminUserId: string, action: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
    const key = `admin:ratelimit:${adminUserId}:${action}`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    if (this.redis) {
      try {
        await this.redis.zremrangebyscore(key, 0, windowStart);
        const count = await this.redis.zcard(key);
        if (count >= maxRequests) {
          return false;
        }

        await this.redis.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);
        await this.redis.expire(key, windowSeconds);
        return true;
      } catch {
        return this.checkLocalLimit(key, now, windowStart, maxRequests);
      }
    }

    return this.checkLocalLimit(key, now, windowStart, maxRequests);
  }

  /**
   * Clears singleton and local fallback state.
   */
  static cleanup(): void {
    AdminRateLimitStore.instance = null;
  }

  private checkLocalLimit(
    key: string,
    now: number,
    windowStart: number,
    maxRequests: number
  ): boolean {
    let requests = this.localStore.get(key) ?? [];
    requests = requests.filter((timestamp) => timestamp > windowStart);

    if (requests.length >= maxRequests) {
      this.localStore.set(key, requests);
      return false;
    }

    requests.push(now);
    this.localStore.set(key, requests);
    this.evictOldLocalEntries(windowStart);
    return true;
  }

  private evictOldLocalEntries(windowStart: number): void {
    if (this.localStore.size <= this.maxLocalKeys) {
      return;
    }

    for (const [key, timestamps] of this.localStore.entries()) {
      const active = timestamps.filter((timestamp) => timestamp > windowStart);
      if (active.length === 0) {
        this.localStore.delete(key);
      } else {
        this.localStore.set(key, active);
      }

      if (this.localStore.size <= this.maxLocalKeys) {
        return;
      }
    }
  }
}
