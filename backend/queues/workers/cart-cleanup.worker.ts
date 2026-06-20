import { Worker, type ConnectionOptions, type Queue } from 'bullmq';
import { PrismaClient as RealPrismaClient } from '@prisma/client';
import IORedis from 'ioredis';
import pino from 'pino';
import { sendProcessRestartAlert, sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';
import { publishRestartSignal, SYSTEM_RESTART_CHANNEL, type RestartPublisherLike } from '@common/restart/system-restart';
import { LOAD_SHED_MODE_KEY } from '@common/reliability/load-shed.guard';
import {
  readMaintenanceState,
  writeMaintenanceState,
  type MaintenanceStatePrismaLike,
  type MaintenanceStateRedisLike
} from '@common/reliability/maintenance-state';
import {
  attachRedisErrorListener,
  buildStandardRedisOptions
} from '@common/redis/redis-connection';
import { createQueueRegistry as createRealQueueRegistry, type QueueRegistry } from '@queues/queue-registry';

/**
 * Module-level logger for the cart-cleanup worker. `attachWorkerLogging` covers
 * generic BullMQ lifecycle events (active/completed/failed) via the worker
 * bootstrap; this logger is for handler-internal milestones — primarily the
 * maintenance-activation cutover, where the operator must be able to trace
 * each step (pick up → drain → flip → resume) in plain `docker compose logs`.
 */
const log = pino({ name: 'cart-cleanup-worker' });

function createEphemeralRedisClient(context: string): IORedis | null {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    return null;
  }

  const client = new IORedis(redisUrl, buildStandardRedisOptions() as never);
  attachRedisErrorListener(
    client,
    {
      warn: (obj, msg) => log.warn(obj, msg),
      error: (obj, msg) => log.error(obj, msg)
    },
    context
  );
  return client;
}

/**
 * Maximum time (ms) to wait for in-flight PENDING_PAYMENT orders to reach
 * a terminal state before forcing the restart anyway.
 * Default: 5 minutes. Override via RESTART_PAYMENT_DRAIN_TIMEOUT_MS env var.
 */
const DEFAULT_PAYMENT_DRAIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Interval (ms) between DB polls while waiting for payments to drain.
 */
const PAYMENT_DRAIN_POLL_INTERVAL_MS = 5_000;

/**
 * Maximum time (ms) to wait for in-flight BullMQ queue jobs to settle
 * (i.e. for `getActiveCount()` to reach 0 on every paused queue) before
 * proceeding with the restart anyway.
 * Default: 60 seconds. Override via RESTART_QUEUE_DRAIN_TIMEOUT_MS env var.
 *
 * This is independent of the PENDING_PAYMENT drain — payments are tracked at
 * the DB level (`Order.status`) while queues are tracked at the Redis level
 * (`Queue.getActiveCount`). Both drains run in sequence: queue drain first
 * (to stop new outbound notification / shipping / fulfillment work), then
 * payment drain (to ensure money-affecting writes settle), then restart.
 */
const DEFAULT_QUEUE_DRAIN_TIMEOUT_MS = 60 * 1000;

/**
 * Interval (ms) between active-count polls while waiting for queues to drain.
 */
const QUEUE_DRAIN_POLL_INTERVAL_MS = 1_000;

/**
 * Grace period (ms) after pausing the outbox dispatcher and before pausing
 * downstream queues. Allows any in-flight outbox-dispatch handler iteration
 * to finish fanning out the jobs it has already claimed from the DB. Without
 * this, the dispatcher could be mid-loop when downstream queues are paused
 * and the queue.add() calls would succeed (jobs land in waiting state) but
 * could not be processed before the active-count drain check fires.
 * Default: 1500 ms. Override via RESTART_QUEUE_PAUSE_GRACE_MS env var.
 */
const DEFAULT_QUEUE_PAUSE_GRACE_MS = 1500;

/**
 * Queue keys (from QueueRegistry) that participate in the pause+drain protocol.
 * The dead-letter queue is intentionally excluded — it processes terminal
 * failure logging and must keep accepting failure notifications during the
 * drain window. The outbox-dispatch queue is paused FIRST (separately) to
 * stop the influx of fan-out jobs into the other queues.
 */
const DRAINABLE_QUEUE_KEYS: ReadonlyArray<Exclude<keyof QueueRegistry, 'outboxDispatch' | 'deadLetter'>> = [
  'orderProcessing',
  'notifications',
  'shipping',
  'inventoryAlerts',
  'refunds',
  'analytics',
  'cartCleanup',
  'reconciliation'
];

function isQueuePauseAndDrainEnabled(): boolean {
  const raw = (process.env['RESTART_PAUSE_AND_DRAIN_QUEUES_ENABLED'] ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

export type CartCleanupWorkerDeps = {
  PrismaClient?: typeof RealPrismaClient;
  Worker?: typeof Worker;
  /**
   * Injectable Redis publisher for tests — avoids real IORedis connection.
   * If omitted, a real IORedis client is created from REDIS_URL at restart time.
   * Return null to simulate a missing REDIS_URL.
   */
  createPublisher?: () => (RestartPublisherLike & { quit: () => Promise<unknown> }) | null;
  /**
   * Injectable sleep function for tests — replaces setTimeout delay.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Payment drain timeout override in ms (for tests).
   */
  paymentDrainTimeoutMs?: number;
  /**
   * Injectable queue registry factory for tests. Receives the same `connection`
   * the worker was created with; in production this returns real BullMQ Queue
   * instances bound to Redis. Tests inject mocks that record pause/resume/
   * getActiveCount/close calls.
   */
  createQueueRegistry?: (connection: ConnectionOptions) => QueueRegistry;
  /**
   * Queue drain timeout override in ms (for tests).
   */
  queueDrainTimeoutMs?: number;
  /**
   * Outbox dispatcher pause grace period override in ms (for tests).
   */
  queuePauseGraceMs?: number;
  /**
   * Feature flag override (for tests). When false, skips the queue pause+drain
   * protocol entirely and falls back to the legacy PENDING_PAYMENT-only drain.
   */
  pauseAndDrainQueuesEnabled?: boolean;
};

export function createCartCleanupWorker(
  connection: ConnectionOptions,
  deps?: CartCleanupWorkerDeps
): Worker {
  const PrismaClientCtor = deps?.PrismaClient ?? RealPrismaClient;
  const WorkerCtor = deps?.Worker ?? Worker;
  const prisma = new PrismaClientCtor();
  const sleepFn = deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const paymentDrainTimeoutMs =
    deps?.paymentDrainTimeoutMs ??
    (process.env['RESTART_PAYMENT_DRAIN_TIMEOUT_MS']
      ? Number(process.env['RESTART_PAYMENT_DRAIN_TIMEOUT_MS'])
      : DEFAULT_PAYMENT_DRAIN_TIMEOUT_MS);
  const queueDrainTimeoutMs =
    deps?.queueDrainTimeoutMs ??
    (process.env['RESTART_QUEUE_DRAIN_TIMEOUT_MS']
      ? Number(process.env['RESTART_QUEUE_DRAIN_TIMEOUT_MS'])
      : DEFAULT_QUEUE_DRAIN_TIMEOUT_MS);
  const queuePauseGraceMs =
    deps?.queuePauseGraceMs ??
    (process.env['RESTART_QUEUE_PAUSE_GRACE_MS']
      ? Number(process.env['RESTART_QUEUE_PAUSE_GRACE_MS'])
      : DEFAULT_QUEUE_PAUSE_GRACE_MS);
  const pauseAndDrainEnabled = deps?.pauseAndDrainQueuesEnabled ?? isQueuePauseAndDrainEnabled();
  const createQueueRegistry = deps?.createQueueRegistry ?? createRealQueueRegistry;

  const deleteManyIfDelegateExists = async (delegateName: string, where: Record<string, unknown>) => {
    const delegate = (prisma as unknown as Record<string, unknown>)[delegateName] as
      | { deleteMany?: (args: { where: Record<string, unknown> }) => Promise<unknown> }
      | undefined;
    if (delegate?.deleteMany) {
      await delegate.deleteMany({ where });
    }
  };

  return new WorkerCtor(
    'cart-cleanup',
    async (job) => {
      if (job.name === 'delete-expired-guest-carts') {
        await prisma.cart.deleteMany({
          where: {
            userId: null,
            expiresAt: {
              lt: new Date()
            }
          }
        });
        return;
      }

      if (job.name === 'release-expired-reservations') {
        await prisma.cartReservation.deleteMany({
          where: {
            expiresAt: {
              lt: new Date()
            }
          }
        });
        return;
      }

      if (job.name === 'purge-expired-idempotency-records') {
        await prisma.idempotencyRecord.deleteMany({
          where: {
            expiresAt: {
              lt: new Date()
            }
          }
        });
        return;
      }

      if (job.name === 'purge-published-outbox-messages') {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        await prisma.outboxMessage.deleteMany({
          where: {
            status: 'PUBLISHED',
            createdAt: {
              lt: cutoff
            }
          }
        });
        return;
      }

      if (job.name === 'purge-expired-refresh-tokens') {
        await prisma.refreshToken.deleteMany({
          where: {
            expiresAt: {
              lt: new Date()
            }
          }
        });
        return;
      }

      if (job.name === 'purge-expired-ops-invites') {
        await deleteManyIfDelegateExists('opsUserInvite', {
          status: {
            in: ['CREATED', 'EMAIL_SENT']
          },
          expiresAt: {
            lt: new Date()
          }
        });
        return;
      }

      if (job.name === 'purge-expired-ops-otp-challenges') {
        await deleteManyIfDelegateExists('opsOtpChallenge', {
          status: {
            in: ['PENDING', 'FAILED', 'EXPIRED']
          },
          expiresAt: {
            lt: new Date()
          }
        });
        return;
      }

      if (job.name === 'maintenance-activation') {
        // ── Maintenance cutover ──────────────────────────────────────────────
        // Fires `DEFAULT_MAINTENANCE_PENDING_WINDOW_MS` after the ops user
        // selected mode='maintenance'. The state row is already in
        // mode='maintenance', phase='pending' (the API set it synchronously),
        // and the storefront banner has been counting down to this moment.
        //
        // Responsibilities here (in strict order):
        //   1. Re-check durable state — operator might have already exited
        //      maintenance during the warning window; if so, no-op.
        //   2. Pause outbox + downstream queues so no new jobs enter the
        //      system during the drain (reuses the same protocol as
        //      `scheduled-process-restart`).
        //   3. Wait for BullMQ active counts to drain (with timeout).
        //   4. Wait for PENDING_PAYMENT orders to reach terminal status —
        //      this is the "no payment lost" gate the operator was
        //      promised. Payment-flow routes (/payments/verify and /retry)
        //      remain reachable throughout because they are in
        //      `PAYMENT_DRAIN_ALLOWLIST` of `load-shed.guard.ts`.
        //   5. Flip phase to 'active' in Postgres + Redis. Once this row
        //      is written, the Nginx `auth_request` gate starts returning
        //      503 for non-ops routes and the storefront blocks at the edge.
        //   6. Resume the queues so post-maintenance workers can pick up
        //      anything that arrived during the drain window. Tower is still
        //      gated at Nginx, but background jobs (notifications, refunds,
        //      etc.) continue to run normally for whoever can still write
        //      via ops/webhook routes.
        const activationStartMs = Date.now();
        const activationJobId = String(job.id ?? 'unknown');
        log.info({ jobId: activationJobId, jobName: job.name }, '[maintenance-activation] job picked up');

        const prismaState = prisma as unknown as MaintenanceStatePrismaLike;
        let redisForState: MaintenanceStateRedisLike | null = null;
        try {
          redisForState = createEphemeralRedisClient('cart-cleanup-maintenance-state') as unknown as MaintenanceStateRedisLike | null;
        } catch (redisErr) {
          log.warn({ err: redisErr, jobId: activationJobId }, '[maintenance-activation] failed to construct local Redis client; proceeding without cache write');
          redisForState = null;
        }

        try {
          const current = await readMaintenanceState({ prisma: prismaState, redis: redisForState });
          if (current.mode !== 'maintenance' || current.phase !== 'pending') {
            // Operator already exited maintenance (or it's already active).
            // Nothing to do — the durable row is the source of truth.
            log.info(
              { jobId: activationJobId, mode: current.mode, phase: current.phase },
              '[maintenance-activation] no-op: state already moved out of pending'
            );
            return;
          }
          log.info({ jobId: activationJobId, pendingUntil: current.pendingUntil }, '[maintenance-activation] state confirmed pending; beginning drain');

          // Pause queues to stop the influx.
          let registry: QueueRegistry | null = null;
          if (pauseAndDrainEnabled) {
            try {
              registry = createQueueRegistry(connection);
              await registry.outboxDispatch.pause();
              if (queuePauseGraceMs > 0) {
                await sleepFn(queuePauseGraceMs);
              }
              await Promise.all(
                DRAINABLE_QUEUE_KEYS.map(async (key) => {
                  try {
                    await registry![key].pause();
                  } catch {
                    // Best-effort — proceeding is safer than failing the cutover.
                  }
                })
              );

              // Drain BullMQ active counts.
              const drainDeadline = Date.now() + queueDrainTimeoutMs;
              const sampleActiveCounts = async (): Promise<number> => {
                const counts = await Promise.all(
                  [...DRAINABLE_QUEUE_KEYS, 'outboxDispatch' as const].map(async (key) => {
                    try {
                      const q = registry![key as keyof QueueRegistry] as Queue;
                      return await q.getActiveCount();
                    } catch {
                      return 0;
                    }
                  })
                );
                return counts.reduce((s, n) => s + n, 0);
              };

              let active = await sampleActiveCounts();
              while (active > 0 && Date.now() < drainDeadline) {
                await sleepFn(QUEUE_DRAIN_POLL_INTERVAL_MS);
                active = await sampleActiveCounts();
              }
              if (active > 0) {
                await sendTechnicalFailureAlert({
                  prisma,
                  template: 'MaintenanceActivationQueueDrainTimeout',
                  channel: 'UNKNOWN',
                  recipient: 'ops-maintenance',
                  errorMessage: `Maintenance cutover proceeding with ${active} active queue job(s) still in-flight after ${queueDrainTimeoutMs}ms drain timeout. Jobs will be stalled+retried by BullMQ.`,
                  failureStage: 'CORE_LOGIC',
                  domain: 'ops',
                  component: 'maintenance-activation',
                  jobId: String(job.id ?? 'unknown'),
                  terminalFailure: false
                });
              }
            } catch (pauseErr) {
              await sendTechnicalFailureAlert({
                prisma,
                template: 'MaintenanceActivationPauseFailed',
                channel: 'UNKNOWN',
                recipient: 'ops-maintenance',
                errorMessage: `Queue pause/drain protocol failed: ${pauseErr instanceof Error ? pauseErr.message : String(pauseErr)}. Cutover proceeding without queue drain.`,
                failureStage: 'CORE_LOGIC',
                domain: 'ops',
                component: 'maintenance-activation',
                jobId: String(job.id ?? 'unknown'),
                terminalFailure: false
              });
            }
          }

          // PENDING_PAYMENT drain — the contract the operator was promised:
          // "no payment lost". We poll until count reaches 0 or the timeout
          // elapses. Payment-flow routes stay reachable during this window.
          const orderDelegate = (prisma as unknown as {
            order?: { count: (args: { where: Record<string, unknown> }) => Promise<number> };
          }).order;
          if (orderDelegate?.count) {
            const drainDeadline = Date.now() + paymentDrainTimeoutMs;
            let pendingCount = await orderDelegate.count({ where: { status: 'PENDING_PAYMENT' } });
            while (pendingCount > 0 && Date.now() < drainDeadline) {
              await sleepFn(PAYMENT_DRAIN_POLL_INTERVAL_MS);
              pendingCount = await orderDelegate.count({ where: { status: 'PENDING_PAYMENT' } });
            }
            if (pendingCount > 0) {
              await sendTechnicalFailureAlert({
                prisma,
                template: 'MaintenanceActivationPaymentDrainTimeout',
                channel: 'UNKNOWN',
                recipient: 'ops-maintenance',
                errorMessage: `Maintenance cutover proceeding with ${pendingCount} PENDING_PAYMENT order(s) still in-flight after ${paymentDrainTimeoutMs}ms. Manual reconciliation may be required.`,
                failureStage: 'CORE_LOGIC',
                domain: 'ops',
                component: 'maintenance-activation',
                jobId: String(job.id ?? 'unknown'),
                terminalFailure: false
              });
            }
          }

          // Flip phase → 'active'. This is the moment Nginx starts serving
          // the maintenance page for non-ops traffic and the storefront
          // banner switches from countdown to "we'll be back soon".
          const activatedAtIso = new Date().toISOString();
          await writeMaintenanceState({
            prisma: prismaState,
            redis: redisForState,
            record: {
              mode: 'maintenance',
              phase: 'active',
              pendingUntil: current.pendingUntil,
              activatedAt: activatedAtIso,
              reason: current.reason,
              setByOpsUserId: current.setByOpsUserId,
              setAt: activatedAtIso
            }
          });
          log.info(
            {
              jobId: activationJobId,
              activatedAt: activatedAtIso,
              elapsedMs: Date.now() - activationStartMs
            },
            '[maintenance-activation] state flipped to active; storefront now gated by Nginx + load-shed guard'
          );

          // Resume queues so internal background work (notifications, refunds)
          // can continue while the storefront is gated. Best-effort — if a
          // resume fails the operator can manually resume via Bull Board.
          if (registry) {
            try {
              await Promise.all(
                [...DRAINABLE_QUEUE_KEYS, 'outboxDispatch' as const].map(async (key) => {
                  try {
                    const q = registry![key as keyof QueueRegistry] as Queue;
                    await q.resume();
                  } catch (resumeErr) {
                    log.warn(
                      { err: resumeErr, jobId: activationJobId, queue: key },
                      '[maintenance-activation] queue resume failed (best-effort)'
                    );
                  }
                })
              );
              log.info({ jobId: activationJobId }, '[maintenance-activation] background queues resumed for post-cutover processing');
            } finally {
              await Promise.allSettled(Object.values(registry).map((q) => (q as Queue).close()));
            }
          }
        } catch (cutoverErr) {
          // Any unexpected exception in the cutover path. Without this catch,
          // an error here would propagate to BullMQ as a job failure → the
          // job stays in the queue and retries, which is the wrong behaviour
          // for a cutover step where partial progress (paused queues + DB
          // state still pending) leaves the system in a weird middle. We log
          // the error AND escalate as a technical failure alert so ops sees
          // the activation needs manual intervention.
          log.error(
            { err: cutoverErr, jobId: activationJobId, elapsedMs: Date.now() - activationStartMs },
            '[maintenance-activation] cutover failed before state flip; read-side self-heal will promote pending→active once grace expires'
          );
          await sendTechnicalFailureAlert({
            prisma,
            template: 'MaintenanceActivationCutoverFailed',
            channel: 'UNKNOWN',
            recipient: 'ops-maintenance',
            errorMessage:
              cutoverErr instanceof Error
                ? `Maintenance cutover failed: ${cutoverErr.message}. The state row is still in pending. The read-side self-heal (default 7-min grace past pendingUntil) will promote it to active automatically, but verify the worker container is healthy.`
                : 'Maintenance cutover failed (unknown error).',
            failureStage: 'CORE_LOGIC',
            domain: 'ops',
            component: 'maintenance-activation',
            jobId: activationJobId,
            terminalFailure: true
          });
        } finally {
          // Always close the local Redis client created for state writes.
          if (redisForState && typeof (redisForState as { quit?: () => Promise<unknown> }).quit === 'function') {
            try {
              await (redisForState as unknown as { quit: () => Promise<unknown> }).quit();
            } catch {
              // Ignore — process is long-lived, the next job will recreate.
            }
          }
        }
        return;
      }

      if (job.name === 'scheduled-process-restart') {
        const jobId = String(job.id ?? 'unknown');
        const requestedBy = String(job.data?.requestedBy ?? 'unknown');
        const scheduledFor = String(job.data?.scheduledFor ?? new Date().toISOString());

        // ── Step 0: Pause outbox first, then producer queues, then drain ───────
        // Two-phase pause is required because the outbox-dispatch worker is the
        // primary fan-out producer for every other queue (notifications, shipping,
        // refunds, etc.). Pausing outbox first stops the influx; the grace period
        // lets any in-flight outbox-dispatch handler complete the loop iteration
        // it has already claimed from the DB (those queue.add() calls land jobs in
        // waiting state on the soon-to-be-paused downstream queues, which is fine
        // — they get picked up by the post-restart workers, no work lost).
        //
        // After downstream pause, we poll Queue.getActiveCount() on every paused
        // queue until the sum reaches 0 (all in-flight handlers have completed)
        // or the queue-drain timeout elapses. This is the BullMQ-side equivalent
        // of the PENDING_PAYMENT DB drain that follows.
        //
        // No HTTP request is affected by these pauses — Queue.pause() only stops
        // workers from picking new jobs. Queue.add() calls from API request
        // handlers still succeed and land jobs in waiting state, which get
        // processed by the post-restart workers. Storefront browsing, cart
        // operations, and outbox writes (transactional DB inserts) are
        // completely unaffected.
        let registry: QueueRegistry | null = null;
        if (pauseAndDrainEnabled) {
          try {
            registry = createQueueRegistry(connection);

            // Pause outbox-dispatch first — stops the recurring publish-pending
            // scheduler from claiming new DB rows. Outbox messages keep
            // accumulating in the DB as PENDING (no work lost) and are dispatched
            // by the new worker after restart.
            await registry.outboxDispatch.pause();

            // Grace period: lets any in-flight outbox-dispatch handler finish
            // the iteration it has already claimed before we pause downstream
            // queues. Without this, the downstream pause could land in the
            // middle of a fan-out loop and leave handler-level state in a
            // confusing place.
            if (queuePauseGraceMs > 0) {
              await sleepFn(queuePauseGraceMs);
            }

            // Pause every other producer queue except dead-letter (which keeps
            // accepting failure alerts during the drain window).
            await Promise.all(
              DRAINABLE_QUEUE_KEYS.map(async (key) => {
                try {
                  await registry![key].pause();
                } catch (pauseErr) {
                  // Pause failure on a single queue must not block the restart —
                  // the worker will be exiting in a moment anyway. Best-effort.
                  await sendTechnicalFailureAlert({
                    prisma,
                    template: 'ProcessRestartQueuePauseFailed',
                    channel: 'UNKNOWN',
                    recipient: 'ops-restart',
                    errorMessage: `Queue.pause() failed on ${key}: ${pauseErr instanceof Error ? pauseErr.message : String(pauseErr)}. Restart proceeding.`,
                    failureStage: 'PROCESS_RESTART',
                    domain: 'ops',
                    component: 'scheduled-process-restart',
                    jobId,
                    terminalFailure: false
                  });
                }
              })
            );

            // Poll active-count across every paused queue until sum reaches 0
            // (all in-flight handlers completed) or the timeout elapses.
            const queueDrainDeadline = Date.now() + queueDrainTimeoutMs;
            const sampleActiveCounts = async (): Promise<Record<string, number>> => {
              const entries = await Promise.all(
                [...DRAINABLE_QUEUE_KEYS, 'outboxDispatch' as const].map(async (key) => {
                  try {
                    const q = registry![key as keyof QueueRegistry] as Queue;
                    const count = await q.getActiveCount();
                    return [key, count] as const;
                  } catch {
                    return [key, 0] as const;
                  }
                })
              );
              return Object.fromEntries(entries) as Record<string, number>;
            };

            let activeCounts = await sampleActiveCounts();
            let activeTotal = Object.values(activeCounts).reduce((s, n) => s + n, 0);
            while (activeTotal > 0 && Date.now() < queueDrainDeadline) {
              await sleepFn(QUEUE_DRAIN_POLL_INTERVAL_MS);
              activeCounts = await sampleActiveCounts();
              activeTotal = Object.values(activeCounts).reduce((s, n) => s + n, 0);
            }

            if (activeTotal > 0) {
              // Timeout — alert ops that some in-flight queue jobs did not
              // complete. They will be stalled by BullMQ on the worker exit
              // and retried by the post-restart workers (at-least-once
              // semantics — no work lost, may produce duplicate processing
              // for non-idempotent handlers).
              await sendTechnicalFailureAlert({
                prisma,
                template: 'ProcessRestartQueueDrainTimeout',
                channel: 'UNKNOWN',
                recipient: 'ops-restart',
                errorMessage: `Restart proceeding with ${activeTotal} active queue job(s) still in-flight after ${queueDrainTimeoutMs}ms drain timeout. Counts: ${JSON.stringify(activeCounts)}. Jobs will be stalled+retried by BullMQ on the post-restart workers.`,
                failureStage: 'PROCESS_RESTART',
                domain: 'ops',
                component: 'scheduled-process-restart',
                jobId,
                terminalFailure: false
              });
            }
          } catch (pauseDrainErr) {
            // Any unexpected failure in the pause+drain protocol falls through
            // to the legacy PENDING_PAYMENT drain + restart. Best-effort alert.
            await sendTechnicalFailureAlert({
              prisma,
              template: 'ProcessRestartPauseDrainFailed',
              channel: 'UNKNOWN',
              recipient: 'ops-restart',
              errorMessage: `Queue pause+drain protocol failed: ${pauseDrainErr instanceof Error ? pauseDrainErr.message : String(pauseDrainErr)}. Falling back to PENDING_PAYMENT drain + restart.`,
              failureStage: 'PROCESS_RESTART',
              domain: 'ops',
              component: 'scheduled-process-restart',
              jobId,
              terminalFailure: false
            });
          }
        }

        // ── Step 1: Payment-safe drain ──────────────────────────────────────────
        // Poll the DB until all orders in PENDING_PAYMENT reach a terminal state
        // (CONFIRMED, PAYMENT_FAILED, CANCELLED, etc.) or the timeout elapses.
        // This ensures no in-flight payment is orphaned by the restart.
        const orderDelegate = (prisma as unknown as {
          order?: { count: (args: { where: Record<string, unknown> }) => Promise<number> };
        }).order;

        if (orderDelegate?.count) {
          const drainDeadline = Date.now() + paymentDrainTimeoutMs;
          let pendingCount = await orderDelegate.count({ where: { status: 'PENDING_PAYMENT' } });

          while (pendingCount > 0 && Date.now() < drainDeadline) {
            await sleepFn(PAYMENT_DRAIN_POLL_INTERVAL_MS);
            pendingCount = await orderDelegate.count({ where: { status: 'PENDING_PAYMENT' } });
          }

          if (pendingCount > 0) {
            // Timeout elapsed — alert ops/admin that restart is proceeding with in-flight payments.
            await sendTechnicalFailureAlert({
              prisma,
              template: 'ProcessRestartPaymentDrainTimeout',
              channel: 'UNKNOWN',
              recipient: 'ops-restart',
              errorMessage: `Restart proceeding with ${pendingCount} PENDING_PAYMENT order(s) still in-flight after ${paymentDrainTimeoutMs}ms drain timeout. Manual reconciliation may be required.`,
              failureStage: 'PROCESS_RESTART',
              domain: 'ops',
              component: 'scheduled-process-restart',
              jobId,
              terminalFailure: false
            });
          }
        }

        // ── Step 2: Resume queues so post-restart workers immediately process backlog ──
        // We resume BEFORE publishing the restart signal so the queue state in
        // Redis is 'resumed' by the time the new worker containers boot. Any
        // jobs added during the pause window are sitting in waiting state and
        // get picked up on the very first poll after boot. The tiny race window
        // between resume and process.exit (where the current worker process
        // could theoretically pick up a job) is handled by BullMQ's stalled-job
        // detection — if a handler is interrupted by exit, the job is
        // automatically re-queued on the post-restart worker, preserving
        // at-least-once semantics. No work lost.
        if (registry) {
          try {
            await Promise.all(
              [...DRAINABLE_QUEUE_KEYS, 'outboxDispatch' as const].map(async (key) => {
                try {
                  const q = registry![key as keyof QueueRegistry] as Queue;
                  await q.resume();
                } catch (resumeErr) {
                  // Resume failure means the queue stays paused — the operator
                  // must manually call queue.resume() via Bull Board or a
                  // one-off script. Alert so they know to do that.
                  await sendTechnicalFailureAlert({
                    prisma,
                    template: 'ProcessRestartQueueResumeFailed',
                    channel: 'UNKNOWN',
                    recipient: 'ops-restart',
                    errorMessage: `Queue.resume() failed on ${key}: ${resumeErr instanceof Error ? resumeErr.message : String(resumeErr)}. Operator must manually resume the ${key} queue after restart, otherwise jobs will accumulate in waiting state.`,
                    failureStage: 'PROCESS_RESTART',
                    domain: 'ops',
                    component: 'scheduled-process-restart',
                    jobId,
                    terminalFailure: true
                  });
                }
              })
            );
          } finally {
            // Close registry queues to release Redis connections before exit.
            // Best-effort — process.exit(0) below will tear everything down anyway.
            await Promise.allSettled(
              Object.values(registry).map((q) => (q as Queue).close())
            );
          }
        }

        // ── Step 3: Pre-exit alert ──────────────────────────────────────────────
        // Notify ops/admin users that the restart is imminent. Best-effort.
        try {
          await sendProcessRestartAlert({ prisma, requestedBy, scheduledFor, jobId });
        } catch {
          // Non-fatal — alert failure must never block the restart.
        }

        // ── Step 4: Publish restart signal ─────────────────────────────────────
        // The API process and worker-index both subscribe to SYSTEM_RESTART_CHANNEL.
        // Publishing here triggers graceful shutdown in both processes simultaneously.
        const createPublisher = deps?.createPublisher ?? (() => createEphemeralRedisClient('cart-cleanup-restart-publisher'));

        let publisher: (RestartPublisherLike & { quit: () => Promise<unknown> }) | null = null;
        try {
          publisher = createPublisher();
          if (publisher) {
            // Reset load-shed to 'normal' before signalling restart so both
            // containers come back up in normal serving mode. Best-effort —
            // a failure here must not block the restart itself.
            await publisher.set(LOAD_SHED_MODE_KEY, 'normal').catch(() => { /* best-effort */ });
            await publishRestartSignal(publisher, { jobId, requestedBy, scheduledFor });
          }
        } catch (publishErr) {
          // Publish failed — alert ops/admin so they know the API process will NOT
          // restart automatically and manual intervention is required.
          await sendTechnicalFailureAlert({
            prisma,
            template: 'ProcessRestartPublishFailed',
            channel: 'UNKNOWN',
            recipient: 'ops-restart',
            errorMessage: `Failed to publish restart signal on ${SYSTEM_RESTART_CHANNEL}: ${publishErr instanceof Error ? publishErr.message : String(publishErr)}. The worker process will exit but the API process must be restarted manually.`,
            failureStage: 'PROCESS_RESTART',
            domain: 'ops',
            component: 'scheduled-process-restart',
            jobId,
            terminalFailure: true
          });
        } finally {
          await publisher?.quit().catch(() => { /* best-effort */ });
        }

        // ── Step 5: Exit worker process ────────────────────────────────────────
        // Docker restart: unless-stopped brings the worker container back.
        // The API process exits independently on receipt of the pub/sub message.
        process.exit(0);
      }
    },
    { connection }
  );
}

