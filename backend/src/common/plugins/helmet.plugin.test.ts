import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { registerHelmetPlugin } from './helmet.plugin';

function createFastifyMock() {
  return {
    register: vi.fn().mockResolvedValue(undefined)
  } as unknown as FastifyInstance & { register: ReturnType<typeof vi.fn> };
}

describe('registerHelmetPlugin', () => {
  it('registers helmet with CSP and COEP settings', async () => {
    const fastify = createFastifyMock();

    await registerHelmetPlugin(fastify);

    expect(fastify.register).toHaveBeenCalledTimes(1);
    expect(fastify.register).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contentSecurityPolicy: expect.objectContaining({
          directives: expect.objectContaining({
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", 'data:']
          })
        }),
        crossOriginEmbedderPolicy: false
      })
    );
  });
});
