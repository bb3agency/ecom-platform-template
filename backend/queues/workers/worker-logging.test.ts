import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { attachWorkerLogging } from './worker-logging';

class WorkerMock extends EventEmitter {
  constructor(public readonly name: string) {
    super();
  }
}

describe('attachWorkerLogging', () => {
  it('logs active and completed with duration', () => {
    const worker = new WorkerMock('order-processing');
    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };

    attachWorkerLogging(worker, logger as never);
    worker.emit('active', { id: 'job_1', name: 'payment-webhook', attemptsMade: 0 });
    worker.emit('completed', { id: 'job_1', name: 'payment-webhook', attemptsMade: 0 });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'order-processing',
        jobName: 'payment-webhook',
        jobId: 'job_1',
        attempt: 1,
        status: 'active'
      }),
      'BullMQ job started'
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'order-processing',
        jobName: 'payment-webhook',
        jobId: 'job_1',
        attempt: 1,
        status: 'success',
        durationMs: expect.any(Number)
      }),
      'BullMQ job completed'
    );
  });

  it('logs failed jobs with error and attempt', () => {
    const worker = new WorkerMock('refunds');
    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };

    attachWorkerLogging(worker, logger as never);
    worker.emit('failed', { id: 'job_2', name: 'initiate-razorpay-refund', attemptsMade: 1 }, new Error('provider timeout'));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'refunds',
        jobName: 'initiate-razorpay-refund',
        jobId: 'job_2',
        attempt: 2,
        status: 'failure',
        errorMessage: 'provider timeout'
      }),
      'BullMQ job failed'
    );
  });
});
