import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createDeadLetterWorker } from './dead-letter.worker';

type DeadLetterWorkerDeps = NonNullable<Parameters<typeof createDeadLetterWorker>[1]>;
type DeadLetterWorkerType = NonNullable<DeadLetterWorkerDeps['Worker']>;
type DeadLetterPrismaType = NonNullable<DeadLetterWorkerDeps['PrismaClient']>;

describe('dead-letter worker', () => {
  let processor: ((job: { name: string; id?: string; data: unknown }) => Promise<void>) | undefined;

  function MockWorker(_name: string, proc: (job: { name: string; id?: string; data: unknown }) => Promise<void>) {
    processor = proc;
    return { on: vi.fn() };
  }

  function MockPrismaClient() {
    return {};
  }

  const sendTechnicalFailureAlert = vi.fn().mockResolvedValue(undefined);

  const workerDeps = {
    Worker: MockWorker as unknown as DeadLetterWorkerType,
    PrismaClient: MockPrismaClient as unknown as DeadLetterPrismaType,
    sendTechnicalFailureAlert
  };

  beforeEach(() => {
    processor = undefined;
    sendTechnicalFailureAlert.mockReset();
  });

  it('sends a technical failure alert for every job arriving in the DLQ', async () => {
    createDeadLetterWorker({} as never, workerDeps);

    await processor?.({ name: 'process-order-update', id: 'dlq_job_1', data: {} });

    expect(sendTechnicalFailureAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: 'dead-letter',
        jobName: 'process-order-update',
        jobId: 'dlq_job_1',
        terminalFailure: true,
        failureStage: 'WORKER_TERMINAL'
      })
    );
  });

  it('uses "unknown" as jobId when job has no id', async () => {
    createDeadLetterWorker({} as never, workerDeps);

    await processor?.({ name: 'some-job', data: {} });

    expect(sendTechnicalFailureAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'unknown'
      })
    );
  });

  it('includes the job name in the error message', async () => {
    createDeadLetterWorker({} as never, workerDeps);

    await processor?.({ name: 'initiate-razorpay-refund', id: 'dlq_job_2', data: {} });

    expect(sendTechnicalFailureAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining('initiate-razorpay-refund')
      })
    );
  });
});
