import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAnalyticsWorker } from './analytics.worker';

type AnalyticsWorkerDeps = NonNullable<Parameters<typeof createAnalyticsWorker>[1]>;
type AnalyticsWorkerType = NonNullable<AnalyticsWorkerDeps['Worker']>;
type AnalyticsPrismaType = NonNullable<AnalyticsWorkerDeps['PrismaClient']>;

describe('analytics worker', () => {
  let processor: ((job: { name: string; data: unknown }) => Promise<void>) | undefined;
  let failedHandler: ((job: unknown, error: Error) => void) | undefined;
  const create = vi.fn();

  function MockWorker(_name: string, proc: (job: { name: string; data: unknown }) => Promise<void>) {
    processor = proc;
    return { on: (event: string, handler: (job: unknown, error: Error) => void) => { if (event === 'failed') failedHandler = handler; } };
  }

  function MockPrismaClient() {
    return { analyticsEvent: { create } };
  }

  const sendTechnicalFailureAlert = vi.fn().mockResolvedValue(undefined);

  const workerDeps = {
    Worker: MockWorker as unknown as AnalyticsWorkerType,
    PrismaClient: MockPrismaClient as unknown as AnalyticsPrismaType,
    sendTechnicalFailureAlert
  };

  beforeEach(() => {
    processor = undefined;
    failedHandler = undefined;
    create.mockReset();
    sendTechnicalFailureAlert.mockReset();
  });

  it('creates analytics event for record-event job', async () => {
    createAnalyticsWorker({}, workerDeps);
    create.mockResolvedValue(undefined);

    await processor?.({
      name: 'record-event',
      data: {
        eventType: 'ADD_TO_CART',
        sessionId: 'sess_1',
        userId: 'user_1',
        payload: {
          productId: 'prod_1',
          quantity: 1
        },
        occurredAt: '2026-04-26T12:00:00.000Z'
      }
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'ADD_TO_CART',
          sessionId: 'sess_1',
          userId: 'user_1',
          payload: expect.objectContaining({
            productId: 'prod_1'
          })
        })
      })
    );
  });

  it('ignores unknown analytics jobs', async () => {
    createAnalyticsWorker({}, workerDeps);

    await processor?.({
      name: 'unknown-job',
      data: {}
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('throws for invalid event type', async () => {
    createAnalyticsWorker({}, workerDeps);

    await expect(
      processor?.({
        name: 'record-event',
        data: {
          eventType: 'INVALID_EVENT',
          sessionId: 'sess_1',
          payload: {}
        }
      })
    ).rejects.toThrow('Invalid analytics event type');
  });

  it('sends terminal failure alert when job exhausts all attempts', () => {
    createAnalyticsWorker({}, workerDeps);

    const terminalJob = { name: 'record-event', id: 'job_1', opts: { attempts: 3 }, attemptsMade: 3 };
    failedHandler?.(terminalJob, new Error('db write failed'));

    expect(sendTechnicalFailureAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: 'analytics',
        jobName: 'record-event',
        jobId: 'job_1',
        terminalFailure: true,
        errorMessage: 'db write failed'
      })
    );
  });

  it('does NOT send alert when job still has remaining attempts', () => {
    createAnalyticsWorker({}, workerDeps);

    const retryJob = { name: 'record-event', id: 'job_2', opts: { attempts: 3 }, attemptsMade: 1 };
    failedHandler?.(retryJob, new Error('transient error'));

    expect(sendTechnicalFailureAlert).not.toHaveBeenCalled();
  });
});

