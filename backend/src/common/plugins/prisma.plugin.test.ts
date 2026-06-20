import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const disconnectMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../database/prisma.service', () => ({
  default: {
    $disconnect: disconnectMock
  }
}));

import { registerPrismaPlugin } from './prisma.plugin';

describe('registerPrismaPlugin', () => {
  it('decorates prisma and disconnects on close', async () => {
    const hooks: Array<(instance: FastifyInstance) => Promise<void>> = [];
    const decorate = vi.fn();

    const fastify = {
      decorate,
      addHook: vi.fn((_name: string, hook: (instance: FastifyInstance) => Promise<void>) => {
        hooks.push(hook);
      })
    } as unknown as FastifyInstance;

    await registerPrismaPlugin(fastify);

    expect(decorate).toHaveBeenCalledWith('prisma', expect.objectContaining({ $disconnect: expect.any(Function) }));
    expect(hooks.length).toBe(1);

    const instance = {
      prisma: {
        $disconnect: disconnectMock
      }
    } as unknown as FastifyInstance;

    const onClose = hooks[0];
    expect(onClose).toBeDefined();
    if (!onClose) {
      throw new Error('Expected onClose hook to be registered');
    }

    await onClose(instance);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
