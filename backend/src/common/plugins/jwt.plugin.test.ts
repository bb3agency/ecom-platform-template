import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { registerJwtPlugin } from './jwt.plugin';

function createFastifyMock() {
  return {
    register: vi.fn().mockResolvedValue(undefined)
  } as unknown as FastifyInstance & { register: ReturnType<typeof vi.fn> };
}

describe('registerJwtPlugin', () => {
  it('registers jwt plugin with HS256 settings', async () => {
    process.env.JWT_SECRET = 'unit-test-secret';

    const fastify = createFastifyMock();

    await registerJwtPlugin(fastify);

    expect(fastify.register).toHaveBeenCalledTimes(1);
    const options = fastify.register.mock.calls[0]?.[1] as {
      secret: string;
      sign: { algorithm: string };
      verify: { algorithms: string[] };
    };
    expect(options.secret).toBe('unit-test-secret');
    expect(options.sign.algorithm).toBe('HS256');
    expect(options.verify.algorithms).toEqual(['HS256']);
  });
});
