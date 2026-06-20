import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { registerMultipartPlugin } from './multipart.plugin';

function createFastifyMock() {
  return {
    register: vi.fn().mockResolvedValue(undefined)
  } as unknown as FastifyInstance & { register: ReturnType<typeof vi.fn> };
}

describe('registerMultipartPlugin', () => {
  it('registers multipart with 20MB file size limit', async () => {
    const fastify = createFastifyMock();

    await registerMultipartPlugin(fastify);

    expect(fastify.register).toHaveBeenCalledTimes(1);
    expect(fastify.register).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        limits: {
          fileSize: 20 * 1024 * 1024
        }
      })
    );
  });
});
