import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCartCleanupWorker, type CartCleanupWorkerDeps } from './cart-cleanup.worker';
import * as alertModule from '@modules/notifications/notification-failure-alert';
import { SYSTEM_RESTART_CHANNEL } from '@common/restart/system-restart';

type CartCleanupWorkerType = NonNullable<CartCleanupWorkerDeps['Worker']>;
type CartCleanupPrismaType = NonNullable<CartCleanupWorkerDeps['PrismaClient']>;

describe('cart-cleanup worker', () => {
  let processor: ((job: { name: string; data: unknown }) => Promise<void>) | undefined;
  const cartDeleteMany = vi.fn();
  const reservationDeleteMany = vi.fn();
  const idempotencyDeleteMany = vi.fn();
  const outboxDeleteMany = vi.fn();
  const refreshTokenDeleteMany = vi.fn();
  const opsUserInviteDeleteMany = vi.fn();
  const opsOtpChallengeDeleteMany = vi.fn();

  function MockWorker(_name: string, proc: (job: { name: string; data: unknown }) => Promise<void>) {
    processor = proc;
  }

  function MockPrismaClient() {
    return {
      cart: { deleteMany: cartDeleteMany },
      cartReservation: { deleteMany: reservationDeleteMany },
      idempotencyRecord: { deleteMany: idempotencyDeleteMany },
      outboxMessage: { deleteMany: outboxDeleteMany },
      refreshToken: { deleteMany: refreshTokenDeleteMany },
      opsUserInvite: { deleteMany: opsUserInviteDeleteMany },
      opsOtpChallenge: { deleteMany: opsOtpChallengeDeleteMany }
    };
  }

  const workerDeps = {
    Worker: MockWorker as unknown as CartCleanupWorkerType,
    PrismaClient: MockPrismaClient as unknown as CartCleanupPrismaType
  };

  beforeEach(() => {
    processor = undefined;
    cartDeleteMany.mockReset();
    reservationDeleteMany.mockReset();
    idempotencyDeleteMany.mockReset();
    outboxDeleteMany.mockReset();
    refreshTokenDeleteMany.mockReset();
    opsUserInviteDeleteMany.mockReset();
    opsOtpChallengeDeleteMany.mockReset();
  });

  it('deletes expired guest carts for scheduled cleanup job', async () => {
    createCartCleanupWorker({}, workerDeps);
    cartDeleteMany.mockResolvedValue({ count: 3 });

    await processor?.({
      name: 'delete-expired-guest-carts',
      data: {}
    });

    expect(cartDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: null,
          expiresAt: expect.objectContaining({ lt: expect.any(Date) })
        })
      })
    );
  });

  it('purges expired idempotency records', async () => {
    createCartCleanupWorker({}, workerDeps);
    idempotencyDeleteMany.mockResolvedValue({ count: 5 });

    await processor?.({
      name: 'purge-expired-idempotency-records',
      data: {}
    });

    expect(idempotencyDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          expiresAt: expect.objectContaining({ lt: expect.any(Date) })
        })
      })
    );
  });

  it('purges published outbox messages older than 7 days', async () => {
    createCartCleanupWorker({}, workerDeps);
    outboxDeleteMany.mockResolvedValue({ count: 2 });

    await processor?.({
      name: 'purge-published-outbox-messages',
      data: {}
    });

    expect(outboxDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PUBLISHED',
          createdAt: expect.objectContaining({ lt: expect.any(Date) })
        })
      })
    );
  });

  it('purges expired refresh tokens', async () => {
    createCartCleanupWorker({}, workerDeps);
    refreshTokenDeleteMany.mockResolvedValue({ count: 4 });

    await processor?.({
      name: 'purge-expired-refresh-tokens',
      data: {}
    });

    expect(refreshTokenDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          expiresAt: expect.objectContaining({ lt: expect.any(Date) })
        })
      })
    );
  });

  it('purges expired ops invites', async () => {
    createCartCleanupWorker({}, workerDeps);
    opsUserInviteDeleteMany.mockResolvedValue({ count: 2 });

    await processor?.({
      name: 'purge-expired-ops-invites',
      data: {}
    });

    expect(opsUserInviteDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: expect.objectContaining({ in: ['CREATED', 'EMAIL_SENT'] }),
          expiresAt: expect.objectContaining({ lt: expect.any(Date) })
        })
      })
    );
  });

  it('purges expired ops otp challenges', async () => {
    createCartCleanupWorker({}, workerDeps);
    opsOtpChallengeDeleteMany.mockResolvedValue({ count: 3 });

    await processor?.({
      name: 'purge-expired-ops-otp-challenges',
      data: {}
    });

    expect(opsOtpChallengeDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: expect.objectContaining({ in: ['PENDING', 'FAILED', 'EXPIRED'] }),
          expiresAt: expect.objectContaining({ lt: expect.any(Date) })
        })
      })
    );
  });

  it('ignores unknown cart-cleanup jobs', async () => {
    createCartCleanupWorker({}, workerDeps);

    await processor?.({
      name: 'unknown-job',
      data: {}
    });

    expect(cartDeleteMany).not.toHaveBeenCalled();
    expect(idempotencyDeleteMany).not.toHaveBeenCalled();
    expect(outboxDeleteMany).not.toHaveBeenCalled();
    expect(refreshTokenDeleteMany).not.toHaveBeenCalled();
    expect(opsUserInviteDeleteMany).not.toHaveBeenCalled();
    expect(opsOtpChallengeDeleteMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scheduled-process-restart
// ─────────────────────────────────────────────────────────────────────────────
describe('cart-cleanup worker — scheduled-process-restart', () => {
  let processor: ((job: { name: string; id?: string; data: unknown }) => Promise<void>) | undefined;

  // Spy on the alert functions — use spyOn so we avoid vi.mock (vmForks incompatibility).
  let sendProcessRestartAlertSpy: ReturnType<typeof vi.spyOn>;
  let sendTechnicalFailureAlertSpy: ReturnType<typeof vi.spyOn>;

  const orderCount = vi.fn();
  const publishMock = vi.fn();
  const quitMock = vi.fn();
  const setMock = vi.fn();

  // ── Queue registry mocks ──────────────────────────────────────────────────
  // Captured call order (pause/resume) is asserted by tests below to verify
  // the protocol: outbox-dispatch must be paused FIRST, then drainable queues.
  const queueKeys = [
    'orderProcessing',
    'notifications',
    'shipping',
    'inventoryAlerts',
    'refunds',
    'analytics',
    'cartCleanup',
    'outboxDispatch',
    'reconciliation',
    'deadLetter'
  ] as const;
  type QueueKey = (typeof queueKeys)[number];

  // Per-queue mocks, recreated each test in beforeEach to avoid leaking state.
  let queueMocks: Record<QueueKey, {
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    getActiveCount: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    name: string;
  }>;
  let pauseCallOrder: QueueKey[];
  let resumeCallOrder: QueueKey[];
  // Active-count behavior: per-queue queue-of-return-values consumed FIFO,
  // falling back to a final default. Tests override these per case.
  let activeCountValues: Partial<Record<QueueKey, number[]>>;
  let activeCountDefaults: Partial<Record<QueueKey, number>>;

  function buildQueueMocks(): typeof queueMocks {
    const mocks = {} as typeof queueMocks;
    for (const key of queueKeys) {
      mocks[key] = {
        name: key,
        pause: vi.fn().mockImplementation(async () => {
          pauseCallOrder.push(key);
        }),
        resume: vi.fn().mockImplementation(async () => {
          resumeCallOrder.push(key);
        }),
        getActiveCount: vi.fn().mockImplementation(async () => {
          const queueValues = activeCountValues[key];
          if (queueValues && queueValues.length > 0) {
            return queueValues.shift() ?? 0;
          }
          return activeCountDefaults[key] ?? 0;
        }),
        close: vi.fn().mockResolvedValue(undefined)
      };
    }
    return mocks;
  }

  const createMockQueueRegistry: NonNullable<CartCleanupWorkerDeps['createQueueRegistry']> = () =>
    queueMocks as unknown as ReturnType<NonNullable<CartCleanupWorkerDeps['createQueueRegistry']>>;

  function makePublisher() {
    return { publish: publishMock, quit: quitMock, set: setMock };
  }

  function MockWorker(_name: string, proc: (job: { name: string; id?: string; data: unknown }) => Promise<void>) {
    processor = proc;
  }

  function MockPrismaClient() {
    return {
      cart: { deleteMany: vi.fn() },
      cartReservation: { deleteMany: vi.fn() },
      idempotencyRecord: { deleteMany: vi.fn() },
      outboxMessage: { deleteMany: vi.fn() },
      refreshToken: { deleteMany: vi.fn() },
      opsUserInvite: { deleteMany: vi.fn() },
      opsOtpChallenge: { deleteMany: vi.fn() },
      order: { count: orderCount }
    };
  }

  // Intercept process.exit so tests don't terminate the test runner.
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    processor = undefined;
    orderCount.mockReset();
    publishMock.mockReset();
    quitMock.mockReset();
    setMock.mockReset();
    publishMock.mockResolvedValue(1 as unknown);
    quitMock.mockResolvedValue('OK' as unknown);
    setMock.mockResolvedValue('OK' as unknown);

    pauseCallOrder = [];
    resumeCallOrder = [];
    activeCountValues = {};
    activeCountDefaults = {};
    queueMocks = buildQueueMocks();

    sendProcessRestartAlertSpy = vi.spyOn(alertModule, 'sendProcessRestartAlert').mockResolvedValue(undefined);
    sendTechnicalFailureAlertSpy = vi.spyOn(alertModule, 'sendTechnicalFailureAlert').mockResolvedValue(undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseWorkerDeps = (overrides: Partial<CartCleanupWorkerDeps> = {}): CartCleanupWorkerDeps => {
    const base = {
      Worker: (overrides.Worker ?? MockWorker) as unknown as CartCleanupWorkerType,
      PrismaClient: (overrides.PrismaClient ?? MockPrismaClient) as unknown as CartCleanupPrismaType,
      createPublisher: (overrides.createPublisher ?? makePublisher) as NonNullable<CartCleanupWorkerDeps['createPublisher']>,
      sleep: overrides.sleep ?? (vi.fn().mockResolvedValue(undefined) as (ms: number) => Promise<void>),
      paymentDrainTimeoutMs: overrides.paymentDrainTimeoutMs ?? 100,
      // Inject the mock queue registry by default so existing tests don't try
      // to hit real Redis. Tests can override to simulate failure modes.
      createQueueRegistry: overrides.createQueueRegistry ?? createMockQueueRegistry,
      queueDrainTimeoutMs: overrides.queueDrainTimeoutMs ?? 100,
      queuePauseGraceMs: overrides.queuePauseGraceMs ?? 0,
      pauseAndDrainQueuesEnabled:
        overrides.pauseAndDrainQueuesEnabled !== undefined ? overrides.pauseAndDrainQueuesEnabled : true
    };
    return base as CartCleanupWorkerDeps;
  };

  it('drains immediately when no PENDING_PAYMENT orders exist', async () => {
    orderCount.mockResolvedValue(0);
    createCartCleanupWorker({}, baseWorkerDeps());

    await processor?.({ name: 'scheduled-process-restart', id: 'job-1', data: { requestedBy: 'ops-user-1', scheduledFor: '2026-05-18T00:00:00.000Z' } });

    expect(orderCount).toHaveBeenCalledWith({ where: { status: 'PENDING_PAYMENT' } });
    expect(sendTechnicalFailureAlertSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ template: 'ProcessRestartPaymentDrainTimeout' })
    );
  });

  it('polls until PENDING_PAYMENT orders clear before proceeding', async () => {
    // First call: 2 pending; second call: 0 pending (cleared).
    orderCount.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    createCartCleanupWorker({}, baseWorkerDeps({ sleep: sleepMock }));

    await processor?.({ name: 'scheduled-process-restart', id: 'job-2', data: {} });

    expect(orderCount).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sendTechnicalFailureAlertSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ template: 'ProcessRestartPaymentDrainTimeout' })
    );
    expect(publishMock).toHaveBeenCalledOnce();
  });

  it('sends drain-timeout failure alert when payments do not clear within timeout', async () => {
    // Always returns 3 pending — timeout will fire immediately (paymentDrainTimeoutMs=0).
    orderCount.mockResolvedValue(3);
    createCartCleanupWorker({}, baseWorkerDeps({ paymentDrainTimeoutMs: 0 }));

    await processor?.({ name: 'scheduled-process-restart', id: 'job-3', data: {} });

    expect(sendTechnicalFailureAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'ProcessRestartPaymentDrainTimeout',
        failureStage: 'PROCESS_RESTART',
        terminalFailure: false
      })
    );
    // Restart still proceeds after timeout.
    expect(sendProcessRestartAlertSpy).toHaveBeenCalledOnce();
    expect(publishMock).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('sends pre-exit ProcessRestartAlert before publishing', async () => {
    orderCount.mockResolvedValue(0);
    let alertCalledBeforePublish = false;
    (sendProcessRestartAlertSpy as import('vitest').Mock).mockImplementation(async () => {
      alertCalledBeforePublish = true;
    });
    publishMock.mockImplementation(async () => {
      expect(alertCalledBeforePublish).toBe(true);
      return 1 as unknown;
    });

    createCartCleanupWorker({}, baseWorkerDeps());
    await processor?.({ name: 'scheduled-process-restart', id: 'job-4', data: { requestedBy: 'ops-1', scheduledFor: '2026-01-01T00:00:00.000Z' } });

    expect(sendProcessRestartAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: 'ops-1', scheduledFor: '2026-01-01T00:00:00.000Z', jobId: 'job-4' })
    );
  });

  it('publishes restart signal with correct channel and payload', async () => {
    orderCount.mockResolvedValue(0);
    createCartCleanupWorker({}, baseWorkerDeps());

    await processor?.({ name: 'scheduled-process-restart', id: 'job-5', data: { requestedBy: 'ops-2', scheduledFor: '2026-06-01T12:00:00.000Z' } });

    expect(publishMock).toHaveBeenCalledWith(
      SYSTEM_RESTART_CHANNEL,
      JSON.stringify({ jobId: 'job-5', requestedBy: 'ops-2', scheduledFor: '2026-06-01T12:00:00.000Z' })
    );
    expect(quitMock).toHaveBeenCalledOnce();
  });

  it('uses job.id and job.data defaults when values are absent', async () => {
    orderCount.mockResolvedValue(0);
    createCartCleanupWorker({}, baseWorkerDeps());

    await processor?.({ name: 'scheduled-process-restart', data: {} });

    const publishArg = publishMock.mock.calls[0]?.[1];
    const parsed = JSON.parse(publishArg ?? '{}') as { jobId: string; requestedBy: string };
    expect(parsed.jobId).toBe('unknown');
    expect(parsed.requestedBy).toBe('unknown');
  });

  it('resets load-shed mode to normal before publishing restart signal', async () => {
    orderCount.mockResolvedValue(0);
    let loadShedResetBeforePublish = false;
    setMock.mockImplementation(async () => {
      loadShedResetBeforePublish = true;
      return 'OK';
    });
    publishMock.mockImplementation(async () => {
      expect(loadShedResetBeforePublish).toBe(true);
      return 1;
    });

    createCartCleanupWorker({}, baseWorkerDeps());
    await processor?.({ name: 'scheduled-process-restart', id: 'job-ls', data: { requestedBy: 'ops-1', scheduledFor: '2026-01-01T00:00:00.000Z' } });

    expect(setMock).toHaveBeenCalledWith('ops:load_shed:mode', 'normal');
    expect(publishMock).toHaveBeenCalledOnce();
  });

  it('sends publish-failure alert and still calls process.exit(0) when publish throws', async () => {
    orderCount.mockResolvedValue(0);
    publishMock.mockRejectedValueOnce(new Error('Redis unreachable'));
    createCartCleanupWorker({}, baseWorkerDeps());

    await processor?.({ name: 'scheduled-process-restart', id: 'job-6', data: {} });

    expect(sendTechnicalFailureAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'ProcessRestartPublishFailed',
        failureStage: 'PROCESS_RESTART',
        terminalFailure: true
      })
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('calls quit() even when publish throws', async () => {
    orderCount.mockResolvedValue(0);
    publishMock.mockRejectedValueOnce(new Error('conn error'));
    createCartCleanupWorker({}, baseWorkerDeps());

    await processor?.({ name: 'scheduled-process-restart', id: 'job-7', data: {} });

    expect(quitMock).toHaveBeenCalledOnce();
  });

  it('calls process.exit(0) regardless of alert or publish outcomes', async () => {
    orderCount.mockResolvedValue(0);
    (sendProcessRestartAlertSpy as import('vitest').Mock).mockRejectedValueOnce(new Error('email down'));
    publishMock.mockRejectedValueOnce(new Error('redis down'));
    createCartCleanupWorker({}, baseWorkerDeps());

    // Neither alert failure nor publish failure should throw out of the handler.
    await processor?.({ name: 'scheduled-process-restart', id: 'job-8', data: {} });

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('skips payment drain when order delegate is absent', async () => {
    function MockPrismaNoOrder() {
      return {
        cart: { deleteMany: vi.fn() },
        cartReservation: { deleteMany: vi.fn() },
        idempotencyRecord: { deleteMany: vi.fn() },
        outboxMessage: { deleteMany: vi.fn() },
        refreshToken: { deleteMany: vi.fn() }
      };
    }
    createCartCleanupWorker({}, {
      ...baseWorkerDeps(),
      PrismaClient: MockPrismaNoOrder as unknown as CartCleanupPrismaType
    });

    await processor?.({ name: 'scheduled-process-restart', id: 'job-9', data: {} });

    expect(orderCount).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Queue pause + drain protocol (Step 0 / Step 2.5)
  // ─────────────────────────────────────────────────────────────────────────

  it('pauses outbox-dispatch FIRST, then every other producer queue', async () => {
    orderCount.mockResolvedValue(0);
    createCartCleanupWorker({}, baseWorkerDeps());

    await processor?.({ name: 'scheduled-process-restart', id: 'job-pause-order', data: {} });

    expect(pauseCallOrder[0]).toBe('outboxDispatch');
    expect(pauseCallOrder).toEqual(
      expect.arrayContaining([
        'outboxDispatch',
        'orderProcessing',
        'notifications',
        'shipping',
        'inventoryAlerts',
        'refunds',
        'analytics',
        'cartCleanup',
        'reconciliation'
      ])
    );
    expect(pauseCallOrder).not.toContain('deadLetter');
  });

  it('waits the pause grace period between outbox pause and downstream pause', async () => {
    orderCount.mockResolvedValue(0);
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    createCartCleanupWorker(
      {},
      baseWorkerDeps({ sleep: sleepMock, queuePauseGraceMs: 1500 })
    );

    await processor?.({ name: 'scheduled-process-restart', id: 'job-grace', data: {} });

    expect(sleepMock).toHaveBeenCalledWith(1500);
    // outboxDispatch.pause must complete before the grace sleep, which must
    // complete before any drainable queue is paused.
    expect(queueMocks.outboxDispatch.pause).toHaveBeenCalledOnce();
  });

  it('polls getActiveCount until sum reaches 0, then proceeds to publish', async () => {
    orderCount.mockResolvedValue(0);
    // First sample: notifications=2 active; second sample: 0 (drained).
    activeCountValues = { notifications: [2, 0] };
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    createCartCleanupWorker({}, baseWorkerDeps({ sleep: sleepMock }));

    await processor?.({ name: 'scheduled-process-restart', id: 'job-drain', data: {} });

    // Two samples for notifications = polled twice.
    expect(queueMocks.notifications.getActiveCount).toHaveBeenCalledTimes(2);
    // No drain-timeout alert because we drained successfully.
    expect(sendTechnicalFailureAlertSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ template: 'ProcessRestartQueueDrainTimeout' })
    );
    expect(publishMock).toHaveBeenCalledOnce();
  });

  it('emits ProcessRestartQueueDrainTimeout alert when active jobs do not drain in time', async () => {
    orderCount.mockResolvedValue(0);
    // Always returns 3 — drain never completes; timeout fires immediately.
    activeCountDefaults = { shipping: 3 };
    createCartCleanupWorker({}, baseWorkerDeps({ queueDrainTimeoutMs: 0 }));

    await processor?.({ name: 'scheduled-process-restart', id: 'job-drain-timeout', data: {} });

    expect(sendTechnicalFailureAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'ProcessRestartQueueDrainTimeout',
        failureStage: 'PROCESS_RESTART',
        terminalFailure: false
      })
    );
    // Restart still proceeds after timeout.
    expect(publishMock).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('resumes all queues BEFORE publishing the restart signal', async () => {
    orderCount.mockResolvedValue(0);
    let publishCalledWithResumedQueues = false;
    publishMock.mockImplementation(async () => {
      // At the moment publish is called, every drainable queue + outbox must
      // already have been resumed. This guarantees the post-restart workers
      // boot with queues in the resumed state and immediately start
      // processing the accumulated backlog.
      publishCalledWithResumedQueues =
        resumeCallOrder.includes('outboxDispatch') &&
        resumeCallOrder.includes('notifications') &&
        resumeCallOrder.includes('orderProcessing') &&
        resumeCallOrder.includes('shipping') &&
        resumeCallOrder.includes('inventoryAlerts') &&
        resumeCallOrder.includes('refunds') &&
        resumeCallOrder.includes('analytics') &&
        resumeCallOrder.includes('cartCleanup') &&
        resumeCallOrder.includes('reconciliation');
      return 1 as unknown;
    });

    createCartCleanupWorker({}, baseWorkerDeps());

    await processor?.({ name: 'scheduled-process-restart', id: 'job-resume', data: {} });

    expect(publishCalledWithResumedQueues).toBe(true);
    // dead-letter is intentionally NOT touched.
    expect(queueMocks.deadLetter.pause).not.toHaveBeenCalled();
    expect(queueMocks.deadLetter.resume).not.toHaveBeenCalled();
  });

  it('closes queue registry handles before exiting', async () => {
    orderCount.mockResolvedValue(0);
    createCartCleanupWorker({}, baseWorkerDeps());

    await processor?.({ name: 'scheduled-process-restart', id: 'job-close', data: {} });

    // Every queue (including dead-letter) gets close() called — releasing Redis
    // connection handles before process.exit. Best-effort, must not throw.
    for (const key of queueKeys) {
      expect(queueMocks[key].close).toHaveBeenCalled();
    }
  });

  it('does not block the restart when a single queue.pause() throws', async () => {
    orderCount.mockResolvedValue(0);
    queueMocks.shipping.pause.mockRejectedValueOnce(new Error('redis transient'));
    createCartCleanupWorker({}, baseWorkerDeps());

    await processor?.({ name: 'scheduled-process-restart', id: 'job-pause-fail', data: {} });

    expect(sendTechnicalFailureAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'ProcessRestartQueuePauseFailed',
        failureStage: 'PROCESS_RESTART',
        terminalFailure: false
      })
    );
    // Restart still proceeds.
    expect(publishMock).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('emits terminal alert when queue.resume() fails (operator must manually resume)', async () => {
    orderCount.mockResolvedValue(0);
    queueMocks.notifications.resume.mockRejectedValueOnce(new Error('redis EOF'));
    createCartCleanupWorker({}, baseWorkerDeps());

    await processor?.({ name: 'scheduled-process-restart', id: 'job-resume-fail', data: {} });

    expect(sendTechnicalFailureAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'ProcessRestartQueueResumeFailed',
        failureStage: 'PROCESS_RESTART',
        terminalFailure: true
      })
    );
    // Restart still proceeds — operator gets alerted to manually resume.
    expect(publishMock).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('falls through to legacy payment-only drain when pauseAndDrainQueuesEnabled=false', async () => {
    orderCount.mockResolvedValue(0);
    createCartCleanupWorker(
      {},
      baseWorkerDeps({ pauseAndDrainQueuesEnabled: false })
    );

    await processor?.({ name: 'scheduled-process-restart', id: 'job-disabled', data: {} });

    // No pause/resume invoked when the protocol is disabled.
    expect(pauseCallOrder).toEqual([]);
    expect(resumeCallOrder).toEqual([]);
    // Restart still proceeds via the legacy path.
    expect(publishMock).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('queue pause+drain failure does not abort the restart sequence', async () => {
    orderCount.mockResolvedValue(0);
    // Force createQueueRegistry to throw, simulating Redis-unreachable at the
    // protocol start. Restart must still proceed via the legacy path.
    const throwingRegistry: NonNullable<CartCleanupWorkerDeps['createQueueRegistry']> = () => {
      throw new Error('redis connection refused');
    };
    createCartCleanupWorker(
      {},
      baseWorkerDeps({ createQueueRegistry: throwingRegistry })
    );

    await processor?.({ name: 'scheduled-process-restart', id: 'job-registry-fail', data: {} });

    expect(sendTechnicalFailureAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'ProcessRestartPauseDrainFailed',
        failureStage: 'PROCESS_RESTART',
        terminalFailure: false
      })
    );
    expect(publishMock).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

