import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { registerCorsPlugin } from './cors.plugin';

const originalEnv = { ...process.env };

function createFastifyMock() {
  return {
    register: vi.fn().mockResolvedValue(undefined)
  } as unknown as FastifyInstance & { register: ReturnType<typeof vi.fn> };
}

describe('registerCorsPlugin', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('dedupes same storefront/admin origins', async () => {
    process.env.NODE_ENV = 'production';
    process.env.STOREFRONT_URL = 'https://client1.com/';
    process.env.ADMIN_URL = 'https://client1.com';
    const fastify = createFastifyMock();

    await registerCorsPlugin(fastify);

    expect(fastify.register).toHaveBeenCalledTimes(1);
    const options = fastify.register.mock.calls[0]?.[1] as { origin: string[] };
    expect(options.origin).toEqual(['https://client1.com']);
  });

  it('fails fast in strict profile when required origins missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.STOREFRONT_URL;
    delete process.env.ADMIN_URL;
    const fastify = createFastifyMock();

    await expect(registerCorsPlugin(fastify)).rejects.toThrow(
      'Missing required CORS origins for strict profile'
    );
  });

  it('throws on invalid origin URLs', async () => {
    process.env.NODE_ENV = 'production';
    process.env.STOREFRONT_URL = 'not-a-url';
    process.env.ADMIN_URL = 'https://client1.com';
    const fastify = createFastifyMock();

    await expect(registerCorsPlugin(fastify)).rejects.toThrow('Invalid URL in STOREFRONT_URL');
  });
});
