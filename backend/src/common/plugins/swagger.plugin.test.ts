import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { registerSwaggerPlugin } from './swagger.plugin';

function createFastifyMock() {
  return {
    register: vi.fn().mockResolvedValue(undefined)
  } as unknown as FastifyInstance & { register: ReturnType<typeof vi.fn> };
}

describe('registerSwaggerPlugin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('skips swagger registration in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const fastify = createFastifyMock();

    await registerSwaggerPlugin(fastify);

    expect(fastify.register).not.toHaveBeenCalled();
  });

  it('registers swagger and swagger-ui outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const fastify = createFastifyMock();

    await registerSwaggerPlugin(fastify);

    expect(fastify.register).toHaveBeenCalledTimes(2);
    expect(fastify.register).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        openapi: {
          info: {
            title: 'E-Commerce Backend Template API',
            version: '0.1.0'
          }
        }
      })
    );
    expect(fastify.register).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ routePrefix: '/api/docs' })
    );
  });
});
