import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

type RedisCtorDep = (url: string, options: Record<string, unknown>) => {
  status: string;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  once: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off: (event: string, listener: (...args: unknown[]) => void) => unknown;
  quit: () => Promise<unknown>;
};

describe('registerRedisPlugin', () => {
  it('constructs redis, decorates instance and quits on close', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    const state = {
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      quit: vi.fn(async () => undefined)
    };
    const redisCtor = vi.fn();
    const redisInstance = {
      status: 'ready',
      on: state.on,
      once: state.once,
      off: state.off,
      quit: state.quit
    };
    const redisCtorFake = ((url: string, options: Record<string, unknown>) => {
      redisCtor(url, options);
      return redisInstance;
    }) as RedisCtorDep;
    const { registerRedisPlugin } = await import('./redis.plugin');
    const hooks: Array<(instance: FastifyInstance) => Promise<void>> = [];
    const decorate = vi.fn();

    const fastify = {
      log: { error: vi.fn() },
      decorate,
      addHook: vi.fn((_name: string, hook: (instance: FastifyInstance) => Promise<void>) => {
        hooks.push(hook);
      })
    } as unknown as FastifyInstance;

    await registerRedisPlugin(fastify, {
      redisCtor: redisCtorFake,
      redisUrl: 'redis://127.0.0.1:6379',
      readyTimeoutMs: 25
    });

    expect(redisCtor).toHaveBeenCalledTimes(1);
    expect(state.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(decorate).toHaveBeenCalledWith('redis', expect.objectContaining({ quit: expect.any(Function) }));
    expect(hooks.length).toBe(1);

    const instance = {
      redis: {
        quit: state.quit
      }
    } as unknown as FastifyInstance;

    const onClose = hooks[0];
    expect(onClose).toBeDefined();
    if (!onClose) {
      throw new Error('Expected onClose hook to be registered');
    }

    await onClose(instance);
    expect(state.quit).toHaveBeenCalledTimes(1);
  });
});
