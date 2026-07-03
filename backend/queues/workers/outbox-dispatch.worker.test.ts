import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOutboxDispatchWorker } from './outbox-dispatch.worker';

type OutboxDispatchDeps = NonNullable<Parameters<typeof createOutboxDispatchWorker>[1]>;
type OutboxDispatchWorkerType = NonNullable<OutboxDispatchDeps['Worker']>;
type OutboxDispatchPrismaType = NonNullable<OutboxDispatchDeps['PrismaClient']>;
type OutboxDispatchQueueRegistryFactory = NonNullable<OutboxDispatchDeps['createQueueRegistry']>;

describe('outbox-dispatch worker', () => {
  let processor: undefined | ((job: { name: string; data: Record<string, unknown> }) => Promise<void>);
  let pending: Array<Record<string, unknown>> = [];
  let failedCount = 0;
  const outboxUpdate = vi.fn();
  const outboxUpdateMany = vi.fn(async () => ({ count: 1 }));
  const queueAdd = vi.fn();
  const queueClose = vi.fn();

  function MockWorker(_name: string, proc: (job: { name: string; data: Record<string, unknown> }) => Promise<void>) {
    processor = proc;
  }

  function MockPrismaClient() {
    return {
      outboxMessage: {
        findMany: vi.fn(async () => pending),
        update: outboxUpdate,
        updateMany: outboxUpdateMany,
        count: vi.fn(async () => failedCount)
      }
    };
  }

  function mockCreateQueueRegistry() {
    return {
      notifications: { add: queueAdd, close: queueClose },
      orderProcessing: { add: queueAdd, close: queueClose },
      shipping: { add: queueAdd, close: queueClose },
      refunds: { add: queueAdd, close: queueClose },
      analytics: { add: queueAdd, close: queueClose },
      inventoryAlerts: { add: queueAdd, close: queueClose },
      cartCleanup: { add: queueAdd, close: queueClose },
      outboxDispatch: { add: queueAdd, close: queueClose },
      reconciliation: { add: queueAdd, close: queueClose }
    };
  }

  const workerDeps = {
    Worker: MockWorker as unknown as OutboxDispatchWorkerType,
    PrismaClient: MockPrismaClient as unknown as OutboxDispatchPrismaType,
    createQueueRegistry: mockCreateQueueRegistry as unknown as OutboxDispatchQueueRegistryFactory
  };

  beforeEach(() => {
    processor = undefined;
    pending = [];
    failedCount = 0;
    outboxUpdate.mockReset();
    outboxUpdateMany.mockClear();
    queueAdd.mockReset();
    queueClose.mockReset();
  });

  it('publishes pending messages and marks them published', async () => {
    createOutboxDispatchWorker({} as never, workerDeps);
    pending = [
      {
        id: 'outbox_1',
        queueName: 'notifications',
        jobName: 'send-email',
        payload: { to: 'x@example.com' },
        jobId: 'job_1',
        attemptCount: 0,
        createdAt: new Date()
      }
    ];

    await processor?.({ name: 'publish-pending', data: {} });

    expect(queueAdd).toHaveBeenCalledWith('send-email', { to: 'x@example.com' }, { jobId: 'job_1' });
    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox_1' },
        data: expect.objectContaining({ status: 'PUBLISHED' })
      })
    );
  });

  it('sanitizes colon jobIds before queue.add (BullMQ rejects ids with ":" — cancel-shipment / OrderShipped regression)', async () => {
    createOutboxDispatchWorker({} as never, workerDeps);
    pending = [
      {
        id: 'outbox_colon',
        queueName: 'shipping',
        jobName: 'cancel-shipment',
        payload: { orderId: 'order_1', awbNumber: 'AWB1' },
        jobId: 'cancel-shipment:order_1',
        attemptCount: 0,
        createdAt: new Date()
      }
    ];

    await processor?.({ name: 'publish-pending', data: {} });

    expect(queueAdd).toHaveBeenCalledWith(
      'cancel-shipment',
      { orderId: 'order_1', awbNumber: 'AWB1' },
      { jobId: 'cancel-shipment-order_1' }
    );
    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox_colon' },
        data: expect.objectContaining({ status: 'PUBLISHED' })
      })
    );
  });

  it('moves dead-letter message back to pending on replay request', async () => {
    createOutboxDispatchWorker({} as never, workerDeps);
    await processor?.({
      name: 'replay-dead-letter',
      data: { outboxMessageId: 'outbox_failed', requestedBy: 'admin_1' }
    });

    expect(outboxUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox_failed', status: 'FAILED' }
      })
    );
  });

  it('marks notification outbox message as FAILED after terminal publish error', async () => {
    createOutboxDispatchWorker({} as never, workerDeps);
    pending = [
      {
        id: 'outbox_terminal_1',
        queueName: 'notifications',
        jobName: 'send-primary',
        payload: { template: 'OrderConfirmed', email: 'customer@example.com' },
        jobId: 'job_terminal_1',
        attemptCount: 4,
        createdAt: new Date()
      }
    ];
    queueAdd.mockRejectedValueOnce(new Error('redis publish failed'));

    await processor?.({ name: 'publish-pending', data: {} });

    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox_terminal_1' },
        data: expect.objectContaining({
          status: 'FAILED',
          lastError: 'redis publish failed'
        })
      })
    );
  });
});
