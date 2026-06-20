import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerRateLimitPlugin } from './rate-limit.plugin';

describe('registerRateLimitPlugin', () => {
  it('builds standardized 429 error details envelope', async () => {
    const register = vi.fn(async (_plugin: unknown, opts: unknown) => {
      const options = opts as {
        errorResponseBuilder: (_request: unknown, context: { ttl: number }) => {
          error: { details: Record<string, unknown> };
        };
      };
      const payload = options.errorResponseBuilder({}, { ttl: 42 });
      expect(payload.error.details).toEqual(
        expect.objectContaining({
          kind: 'transient',
          hintKey: 'rate_limit_exceeded',
          retryable: true,
          retryAfterSeconds: 42,
          remediation: expect.any(String)
        })
      );
    });

    const fastify = {
      register,
      log: {
        warn: vi.fn()
      }
    } as unknown as FastifyInstance;

    await registerRateLimitPlugin(fastify);
    expect(register).toHaveBeenCalledTimes(1);
  });
});
