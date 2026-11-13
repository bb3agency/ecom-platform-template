import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const state = vi.hoisted(() => ({
  upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
  upsertCartCleanupScheduler: vi.fn().mockResolvedValue(undefined),
  upsertReconciliationScheduler: vi.fn().mockResolvedValue(undefined),
  removeReconciliationScheduler: vi.fn().mockResolvedValue(true),
  close: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@queues/queue-registry', () => ({
  createQueueRegistry: () => ({
    orderProcessing: { close: state.close },
    notifications: { close: state.close },
    shipping: { close: state.close },
    inventoryAlerts: {
      close: state.close,
      upsertJobScheduler: state.upsertJobScheduler
    },
    refunds: { close: state.close },
    analytics: { close: state.close },
    cartCleanup: {
      close: state.close,
      upsertJobScheduler: state.upsertCartCleanupScheduler
    },
    reconciliation: {
      close: state.close,
      upsertJobScheduler: state.upsertReconciliationScheduler,
      removeJobScheduler: state.removeReconciliationScheduler
    }
  })
}));

import { registerBullmqPlugin } from './bullmq.plugin';

describe('registerBullmqPlugin', () => {
  it('upserts inventory and cart cleanup schedulers on startup', async () => {
    const immediateSpy = vi
      .spyOn(globalThis, 'setImmediate')
      .mockImplementation(((callback: (...args: unknown[]) => void, ...args: unknown[]) => {
        callback(...args);
        return 0 as unknown as NodeJS.Immediate;
      }) as typeof setImmediate);

    const hooks: Array<(instance: FastifyInstance) => Promise<void>> = [];
    const fastify = {
      redis: {
        duplicate: () => ({
          quit: state.quit,
          on: vi.fn()
        })
      },
      log: {
        info: vi.fn(),
        error: vi.fn()
      },
      decorate: vi.fn(),
      addHook: vi.fn((_name: string, hook: (instance: FastifyInstance) => Promise<void>) => {
        hooks.push(hook);
      })
    } as unknown as FastifyInstance;

    await registerBullmqPlugin(fastify);

    await vi.waitFor(() => {
      expect(state.upsertCartCleanupScheduler).toHaveBeenCalledWith(
        'cart-cleanup:purge-expired-refresh-tokens',
        { pattern: '0 3 * * *' },
        { name: 'purge-expired-refresh-tokens', data: {} }
      );
    });

    expect(state.upsertJobScheduler).toHaveBeenCalledWith(
      'inventory-alerts:check-low-stock',
      { every: 60 * 60 * 1000 },
      { name: 'check-low-stock', data: {} }
    );
    expect(state.upsertCartCleanupScheduler).toHaveBeenCalledWith(
      'cart-cleanup:delete-expired-guest-carts',
      { pattern: '0 2 * * *' },
      { name: 'delete-expired-guest-carts', data: {} }
    );
    expect(state.upsertCartCleanupScheduler).toHaveBeenCalledWith(
      'cart-cleanup:purge-expired-idempotency-records',
      { pattern: '0 3 * * *' },
      { name: 'purge-expired-idempotency-records', data: {} }
    );
    expect(state.upsertCartCleanupScheduler).toHaveBeenCalledWith(
      'cart-cleanup:purge-published-outbox-messages',
      { pattern: '0 4 * * 0' },
      { name: 'purge-published-outbox-messages', data: {} }
    );
    expect(state.upsertCartCleanupScheduler).toHaveBeenCalledWith(
      'cart-cleanup:purge-expired-refresh-tokens',
      { pattern: '0 3 * * *' },
      { name: 'purge-expired-refresh-tokens', data: {} }
    );
    expect(hooks.length).toBe(1);

    immediateSpy.mockRestore();
  });
});

describe('registerBullmqPlugin — Razorpay capture reconciliation scheduler', () => {
  async function register(): Promise<void> {
    const immediateSpy = vi
      .spyOn(globalThis, 'setImmediate')
      .mockImplementation(((callback: (...args: unknown[]) => void, ...args: unknown[]) => {
        callback(...args);
        return 0 as unknown as NodeJS.Immediate;
      }) as typeof setImmediate);
    const fastify = {
      redis: { duplicate: () => ({ quit: state.quit, on: vi.fn() }) },
      log: { info: vi.fn(), error: vi.fn() },
      decorate: vi.fn(),
      addHook: vi.fn()
    } as unknown as FastifyInstance;
    await registerBullmqPlugin(fastify);
    await vi.waitFor(() => {
      expect(fastify.log.info).toHaveBeenCalledWith('BullMQ job schedulers registered');
    });
    immediateSpy.mockRestore();
  }

  beforeEach(() => {
    state.upsertReconciliationScheduler.mockClear();
    state.removeReconciliationScheduler.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('schedules razorpay-capture-reconcile every 30 minutes when Razorpay is the provider', async () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'razorpay');
    vi.stubEnv('RAZORPAY_RECONCILE_ENABLED', '');

    await register();

    expect(state.upsertReconciliationScheduler).toHaveBeenCalledWith(
      'reconciliation:razorpay-capture-reconcile',
      { every: 30 * 60 * 1000 },
      { name: 'razorpay-capture-reconcile', data: {} }
    );
    expect(state.removeReconciliationScheduler).not.toHaveBeenCalled();
  });

  it('removes the schedule when the flag is off', async () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'razorpay');
    vi.stubEnv('RAZORPAY_RECONCILE_ENABLED', 'false');

    await register();

    expect(state.removeReconciliationScheduler).toHaveBeenCalledWith('reconciliation:razorpay-capture-reconcile');
    expect(state.upsertReconciliationScheduler).not.toHaveBeenCalledWith(
      'reconciliation:razorpay-capture-reconcile',
      expect.anything(),
      expect.anything()
    );
  });

  it('removes the schedule for non-Razorpay providers', async () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'cod');

    await register();

    expect(state.removeReconciliationScheduler).toHaveBeenCalledWith('reconciliation:razorpay-capture-reconcile');
  });
});
