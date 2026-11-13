import { EventEmitter } from 'events';
import { Job, UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { attachWorkerLogging, isTerminalFailure } from './worker-logging';

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
    // BullMQ increments attemptsMade before emitting 'completed'.
    worker.emit('completed', { id: 'job_1', name: 'payment-webhook', attemptsMade: 1 });

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
        attempt: 1,
        status: 'failure',
        errorMessage: 'provider timeout'
      }),
      'BullMQ job failed'
    );
  });

  describe('terminal failure detection (be-rel-01)', () => {
    function setup() {
      const worker = new WorkerMock('notifications');
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      const deadLetterQueue = { add: vi.fn().mockResolvedValue(undefined) };
      const onFailure = vi.fn();
      attachWorkerLogging(worker, logger as never, deadLetterQueue as never, onFailure);
      return { worker, deadLetterQueue, onFailure };
    }

    it('does not dead-letter when BullMQ still has a retry left (2nd of 3 attempts)', () => {
      const { worker, deadLetterQueue, onFailure } = setup();
      // attemptsMade is already incremented by moveToFailed when 'failed' fires.
      worker.emit('failed', { id: 'j', name: 'send-sms', attemptsMade: 2, opts: { attempts: 3 } }, new Error('x'));
      expect(deadLetterQueue.add).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2, terminalFailure: false }));
    });

    it('dead-letters exactly once after the last attempt', () => {
      const { worker, deadLetterQueue, onFailure } = setup();
      worker.emit('failed', { id: 'j', name: 'send-sms', attemptsMade: 1, opts: { attempts: 3 } }, new Error('x'));
      worker.emit('failed', { id: 'j', name: 'send-sms', attemptsMade: 2, opts: { attempts: 3 } }, new Error('x'));
      worker.emit('failed', { id: 'j', name: 'send-sms', attemptsMade: 3, opts: { attempts: 3 } }, new Error('x'));
      expect(deadLetterQueue.add).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenLastCalledWith(expect.objectContaining({ attempt: 3, terminalFailure: true }));
    });

    it('treats UnrecoverableError on the first attempt as terminal', () => {
      const { worker, deadLetterQueue, onFailure } = setup();
      worker.emit(
        'failed',
        { id: 'j', name: 'send-email', attemptsMade: 1, opts: { attempts: 3 } },
        new UnrecoverableError('bad template')
      );
      expect(deadLetterQueue.add).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, terminalFailure: true }));
    });

    it('agrees with BullMQ Job.shouldRetryJob for every attempt (replicates moveToFailed ordering)', async () => {
      const shouldRetryJob = (Job.prototype as unknown as { shouldRetryJob: unknown }).shouldRetryJob as (
        this: unknown,
        err: Error
      ) => Promise<[boolean, number]>;
      for (const attempts of [1, 2, 3, 5]) {
        for (let before = 0; before < attempts; before += 1) {
          for (const err of [new Error('transient'), new UnrecoverableError('fatal')]) {
            const bullJob = { attemptsMade: before, opts: { attempts }, discarded: false, queue: { opts: {} } };
            const [shouldRetry] = await shouldRetryJob.call(bullJob, err);
            // moveToFailed increments attemptsMade before the 'failed' event fires.
            const afterIncrement = { name: 'n', attemptsMade: before + 1, opts: { attempts } };
            expect(isTerminalFailure(afterIncrement, err)).toBe(!shouldRetry);
          }
        }
      }
    });
  });
});
