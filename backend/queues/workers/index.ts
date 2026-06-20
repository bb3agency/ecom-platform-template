import dotenv from 'dotenv';
import IORedis from 'ioredis';
import pino from 'pino';
import { Queue } from 'bullmq';
import {
  attachRedisErrorListener,
  buildStandardRedisOptions,
  guardRedisDuplicate,
  installGuardedIORedisDuplicate,
  waitForRedisReady
} from '@common/redis/redis-connection';
import { validateBootstrapEnv } from '@config/app.config';
import { refreshFeatureFlags, featureFlags } from '@config/feature-flags';
import prismaClient from '../../src/database/prisma.service';
import { applyOpsConfigRuntimeOverlay, type OpsConfigRuntimePrismaLike } from '../../src/modules/ops/ops-config-runtime';
import { dlqJobOptions } from '../queue-registry';
import { createOrderProcessingWorker } from './order-processing.worker';
import { createShippingWorker } from './shipping.worker';
import { createNotificationsWorker } from './notifications.worker';
import { createInventoryAlertsWorker } from './inventory-alerts.worker';
import { createRefundsWorker } from './refunds.worker';
import { createCartCleanupWorker } from './cart-cleanup.worker';
import { createAnalyticsWorker } from './analytics.worker';
import { createOutboxDispatchWorker } from './outbox-dispatch.worker';
import { createReconciliationWorker } from './reconciliation.worker';
import { createDeadLetterWorker } from './dead-letter.worker';
import { attachWorkerLogging } from './worker-logging';
import { sendTechnicalFailureAlert } from '../../src/modules/notifications/notification-failure-alert';
import { SYSTEM_RESTART_CHANNEL } from '../../src/common/restart/system-restart';

dotenv.config();

function isEnabled(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}

function requireWorkerEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required worker env var: ${name}`);
  }
  return value;
}

function envVarPresentForWorker(name: string): boolean {
  return Boolean((process.env[name] ?? '').trim());
}

function isPlaceholderValueForWorker(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return (
    normalized.startsWith('replace_with_') ||
    normalized.startsWith('change_me') ||
    normalized.startsWith('<')
  );
}

// Production safety for a key that is already set — never requires missing
// overlay keys at boot. Mirrors `assertEnvNotPlaceholderIfPresent` in
// src/config/app.config.ts so workers and API have the same tolerance.
function assertWorkerEnvNotPlaceholderIfPresent(name: string): void {
  if (!envVarPresentForWorker(name)) {
    return;
  }
  if (isPlaceholderValueForWorker(process.env[name])) {
    throw new Error(`Invalid ${name}: placeholder values are not allowed in production-like profiles`);
  }
}

function validateWorkerEnv(): void {
  // Boot tolerance contract (matches src/config/app.config.ts validateConditionalEnv):
  //   - Hard-require core infrastructure keys (database, ops crypto, OTel endpoint
  //     when tracing is enabled). These cannot be loaded from the Ops DB overlay
  //     because the overlay itself needs them.
  //   - For every provider chain (email/SMS/WhatsApp/shipping), only validate the
  //     selector enum value and placeholder safety on keys that ARE present. Do
  //     not throw if a full chain is incomplete — the notifications/shipping
  //     workers already read provider keys fresh from OpsConfigSecret on every
  //     job and log a FAILED NotificationLog row when the key is missing. A crash
  //     loop here would kill ALL queues (notifications, shipping, refunds,
  //     analytics, reconciliation, dead-letter, …) over a single missing
  //     provider key, which is exactly the failure mode we saw on the VPS
  //     (May 25, 2026 — SHIPPING_PROVIDER=shiprocket saved without the chain).
  //   - Full chain completeness is enforced at go-live by GET /health/ready
  //     (findMissingStrictOpsConfigKeys) — not as a per-restart gate.
  const env = (process.env.NODE_ENV ?? 'development').toLowerCase();
  const isStrictProfile = env !== 'development' && env !== 'test';

  if (isStrictProfile) {
    requireWorkerEnv('DATABASE_URL');
    requireWorkerEnv('OPS_DB_ENCRYPTION_KEY');
  }

  // Email — worker resolveRuntimeConfig reads RESEND_API_KEY/RESEND_FROM from
  // OpsConfigSecret on every job, so missing-at-boot is acceptable.
  if (isEnabled(process.env.NOTIFY_EMAIL_ENABLED)) {
    assertWorkerEnvNotPlaceholderIfPresent('RESEND_API_KEY');
    assertWorkerEnvNotPlaceholderIfPresent('RESEND_FROM');
  }

  // SMS — validate enum + placeholder safety only.
  const smsProviderRaw = (process.env.SMS_PROVIDER ?? '').trim().toLowerCase();
  if (smsProviderRaw && !['msg91', 'fast2sms', 'noop'].includes(smsProviderRaw)) {
    throw new Error(`Unsupported SMS_PROVIDER for workers: ${smsProviderRaw}. Allowed: msg91, fast2sms, noop`);
  }
  if (isEnabled(process.env.NOTIFY_SMS_ENABLED)) {
    assertWorkerEnvNotPlaceholderIfPresent('MSG91_AUTH_KEY');
    assertWorkerEnvNotPlaceholderIfPresent('MSG91_SENDER_ID');
    assertWorkerEnvNotPlaceholderIfPresent('FAST2SMS_API_KEY');
  }

  // WhatsApp — validate placeholder safety only.
  if (isEnabled(process.env.NOTIFY_WHATSAPP_ENABLED)) {
    assertWorkerEnvNotPlaceholderIfPresent('META_WHATSAPP_ACCESS_TOKEN');
    assertWorkerEnvNotPlaceholderIfPresent('META_WHATSAPP_PHONE_NUMBER_ID');
    assertWorkerEnvNotPlaceholderIfPresent('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    assertWorkerEnvNotPlaceholderIfPresent('META_WHATSAPP_APP_SECRET');
  }

  // OTel endpoint must be reachable at boot when tracing is enabled — it is
  // initialised once per process, not per-job, so this is a true hard requirement.
  if (isEnabled(process.env.OTEL_TRACING_ENABLED)) {
    requireWorkerEnv('OTEL_EXPORTER_OTLP_ENDPOINT');
  }

  // Shipping — SHIPPING_PROVIDER env var is not used for routing (credential-based auto-detection).
  // Validate placeholder safety based on which credentials are present.
  if ((process.env.DELHIVERY_API_KEY ?? '').trim()) {
    assertWorkerEnvNotPlaceholderIfPresent('DELHIVERY_API_KEY');
    assertWorkerEnvNotPlaceholderIfPresent('DELHIVERY_WEBHOOK_TOKEN');
  }
  if ((process.env.SHIPROCKET_EMAIL ?? '').trim() || (process.env.SHIPROCKET_PASSWORD ?? '').trim()) {
    assertWorkerEnvNotPlaceholderIfPresent('SHIPROCKET_EMAIL');
    assertWorkerEnvNotPlaceholderIfPresent('SHIPROCKET_PASSWORD');
    assertWorkerEnvNotPlaceholderIfPresent('SHIPROCKET_WEBHOOK_TOKEN');
  }

  if (isStrictProfile) {
    // noop SMS is dev/test only.
    if (smsProviderRaw === 'noop') {
      throw new Error(
        `Invalid SMS_PROVIDER=noop when NODE_ENV=${env}. 'noop' is allowed only in development-like profiles (development/test).`
      );
    }
  }
}

async function bootstrapWorkers(): Promise<void> {
  validateBootstrapEnv();
  const overlayReport = await applyOpsConfigRuntimeOverlay(prismaClient as unknown as OpsConfigRuntimePrismaLike);
  refreshFeatureFlags();
  validateWorkerEnv();

  // Validate required DB-backed StoreSettings metadata (no fallback)
  try {
    const settings = await prismaClient.storeSettings.findUnique({
      where: { singletonKey: 'default' },
      select: { storeName: true, websiteUrl: true, sellerLegalName: true, sellerAddress: true, sellerState: true, gstin: true }
    });
    const missing: string[] = [];
    if (!settings?.storeName || settings.storeName.trim().length === 0) {
      missing.push('StoreSettings.storeName');
    }
    if (!settings?.websiteUrl || settings.websiteUrl.trim().length === 0) {
      missing.push('StoreSettings.websiteUrl');
    }
    // If GST invoicing feature is enabled, ensure seller fields exist in DB.
    if (featureFlags.gstInvoicing) {
      if (!settings?.sellerLegalName || settings.sellerLegalName.trim().length === 0) missing.push('StoreSettings.sellerLegalName');
      if (!settings?.sellerAddress || settings.sellerAddress.trim().length === 0) missing.push('StoreSettings.sellerAddress');
      if (!settings?.sellerState || settings.sellerState.trim().length === 0) missing.push('StoreSettings.sellerState');
      if (!settings?.gstin || settings.gstin.trim().length === 0) missing.push('StoreSettings.gstin');
    }
    if (missing.length > 0) {
      void sendTechnicalFailureAlert({
        prisma: prismaClient,
        template: 'ConfigurationMissing',
        channel: 'UNKNOWN',
        recipient: 'worker-runtime',
        errorMessage: `Missing required DB-backed configuration: ${missing.join(', ')}`,
        failureStage: 'CORE_LOGIC',
        domain: 'workers',
        component: 'startup-config-check'
      });
    }
  } catch (err) {
    void sendTechnicalFailureAlert({
      prisma: prismaClient,
      template: 'ConfigurationCheckError',
      channel: 'UNKNOWN',
      recipient: 'worker-runtime',
      errorMessage: err instanceof Error ? err.message : 'Unknown configuration check error',
      failureStage: 'CORE_LOGIC',
      domain: 'workers',
      component: 'startup-config-check'
    });
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('Missing required env var: REDIS_URL');
  }

  const logger = pino();
  logger.info({
    appliedKeys: overlayReport.appliedKeys,
    skippedBootstrapKeys: overlayReport.skippedBootstrapKeys,
    skippedUnknownKeys: overlayReport.skippedUnknownKeys,
    failedKeys: overlayReport.failedKeys
  }, 'Ops DB runtime config overlay applied for workers');

  // --- Redis connection hardening (R2) ---
  // BullMQ requires maxRetriesPerRequest: null — shared options also add keepAlive
  // and reconnect-on-error so transient Docker/Windows network blips recover cleanly.
  const workerRedisLog = {
    warn: (obj: Record<string, unknown>, msg: string) => logger.warn(obj, msg),
    error: (obj: Record<string, unknown>, msg: string) => logger.error(obj, msg)
  };
  const workerRedisPersistentAlert = (template: string, component: string) => (err: Error) => {
    void sendTechnicalFailureAlert({
      prisma: prismaClient,
      template,
      channel: 'UNKNOWN',
      recipient: 'worker-runtime',
      errorMessage: err.message,
      failureStage: 'CORE_LOGIC',
      domain: 'workers',
      component
    });
  };

  const redis = new IORedis(
    redisUrl,
    buildStandardRedisOptions({
      keepAlive: 10_000,
      connectTimeout: 10_000,
      retryStrategy: (times: number) => Math.min(times * 200, 5_000)
    }) as never
  );
  attachRedisErrorListener(redis, workerRedisLog, 'worker-redis-primary', {
    onPersistentError: workerRedisPersistentAlert('WorkerRedisPrimary', 'worker-redis-primary')
  });
  const workerRedis: IORedis = guardRedisDuplicate(redis, workerRedisLog, 'worker-redis-shared', {
    onPersistentError: workerRedisPersistentAlert('WorkerRedisWorker', 'worker-redis-worker')
  });

  installGuardedIORedisDuplicate(IORedis, workerRedisLog, {
    onPersistentError: workerRedisPersistentAlert('WorkerRedisBullMqDuplicate', 'worker-redis-bullmq-duplicate')
  });

  await waitForRedisReady(redis);

  // --- Auto-resume queues left paused by a prior worker exit (R4 — May 26, 2026) ---
  //
  // The scheduled-process-restart and maintenance-activation flows in
  // cart-cleanup.worker.ts pause every DRAINABLE queue (plus outbox-dispatch),
  // drain in-flight work, then call Queue.resume() before publishing the restart
  // signal and exiting. If the resume step fails, races with process.exit, or
  // the alert it would normally send is itself enqueued onto the now-paused
  // notifications queue, the operator silently ends up with a paused queue
  // post-restart. Symptom: workers are "up" but new jobs land in
  // bull:<queue>:paused and never get processed. OTP emails, order
  // confirmations, refund alerts, etc. all stop arriving with no visible error.
  //
  // Recovery without this block requires running scripts/resume-paused-queues.js.
  // With this block, every worker boot re-asserts the queues as resumed, so the
  // worst-case after any abnormal exit is "delayed until next deploy" instead
  // of "silent indefinite outage". This is safe because the only code paths
  // that pause queues are the two drain protocols above, both of which intend
  // for the pause to last only seconds. An operator who manually pauses a queue
  // via Bull Board and then restarts the worker container is opting into a
  // re-resume — that's an acceptable trade-off versus the silent outage mode.
  try {
    const recoveryRegistry: Record<string, Queue> = {
      'order-processing': new Queue('order-processing', { connection: workerRedis }),
      notifications: new Queue('notifications', { connection: workerRedis }),
      shipping: new Queue('shipping', { connection: workerRedis }),
      'inventory-alerts': new Queue('inventory-alerts', { connection: workerRedis }),
      refunds: new Queue('refunds', { connection: workerRedis }),
      analytics: new Queue('analytics', { connection: workerRedis }),
      'cart-cleanup': new Queue('cart-cleanup', { connection: workerRedis }),
      'outbox-dispatch': new Queue('outbox-dispatch', { connection: workerRedis }),
      reconciliation: new Queue('reconciliation', { connection: workerRedis })
      // dead-letter is intentionally excluded — the drain protocol never pauses
      // it, and we don't want to mask a deliberate operator pause there.
    };

    const resumed: string[] = [];
    const resumeFailed: string[] = [];
    await Promise.all(
      Object.entries(recoveryRegistry).map(async ([name, q]) => {
        try {
          const paused = await q.isPaused();
          if (paused) {
            await q.resume();
            const stillPaused = await q.isPaused();
            if (stillPaused) {
              resumeFailed.push(name);
            } else {
              resumed.push(name);
            }
          }
        } catch (err) {
          resumeFailed.push(`${name}(${err instanceof Error ? err.message : String(err)})`);
        } finally {
          await q.close().catch(() => undefined);
        }
      })
    );

    if (resumed.length > 0 || resumeFailed.length > 0) {
      logger.warn(
        { resumed, resumeFailed },
        'Detected queues paused at boot — likely incomplete drain from a prior restart. Auto-resumed.'
      );
    }
    if (resumeFailed.length > 0) {
      void sendTechnicalFailureAlert({
        prisma: prismaClient,
        template: 'WorkerBootQueueResumeFailed',
        channel: 'UNKNOWN',
        recipient: 'worker-runtime',
        errorMessage: `Workers booted with queue(s) still paused after auto-resume attempt: ${resumeFailed.join(
          ', '
        )}. New jobs on these queues will not be processed. Operator must manually resume via scripts/resume-paused-queues.js or Bull Board.`,
        failureStage: 'CORE_LOGIC',
        domain: 'workers',
        component: 'worker-boot-queue-recovery',
        terminalFailure: true
      });
    }
  } catch (recoveryErr) {
    logger.error(
      { err: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr) },
      'Worker boot queue auto-resume recovery failed — workers will start but paused queues may still be paused'
    );
    void sendTechnicalFailureAlert({
      prisma: prismaClient,
      template: 'WorkerBootQueueRecoveryFailed',
      channel: 'UNKNOWN',
      recipient: 'worker-runtime',
      errorMessage: `Worker boot auto-resume recovery failed: ${
        recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)
      }. Run scripts/resume-paused-queues.js manually to check queue state.`,
      failureStage: 'CORE_LOGIC',
      domain: 'workers',
      component: 'worker-boot-queue-recovery'
    });
  }

  const orderProcessingWorker = createOrderProcessingWorker(workerRedis);
  const shippingWorker = createShippingWorker(workerRedis);
  const notificationsWorker = createNotificationsWorker(workerRedis);
  const inventoryAlertsWorker = createInventoryAlertsWorker(workerRedis);
  const refundsWorker = createRefundsWorker(workerRedis);
  const cartCleanupWorker = createCartCleanupWorker(workerRedis);
  const analyticsWorker = createAnalyticsWorker(workerRedis);
  const outboxDispatchWorker = createOutboxDispatchWorker(workerRedis);
  const reconciliationWorker = createReconciliationWorker(workerRedis);
  const deadLetterWorker = createDeadLetterWorker(workerRedis);

  // --- DLQ connection fix (R3) ---
  // Use workerRedis.duplicate() to preserve password, TLS, and db config from the
  // original Redis URL. The previous host/port extraction lost these settings.
  const dlqConnection: IORedis = guardRedisDuplicate(workerRedis, workerRedisLog, 'worker-redis-dlq', {
    onPersistentError: workerRedisPersistentAlert('WorkerRedisDlq', 'worker-redis-dlq')
  });

  const deadLetterQueue = new Queue('dead-letter', {
    connection: dlqConnection,
    defaultJobOptions: dlqJobOptions
  });

  const failureAlertHandler = (context: {
    queue: string;
    jobName: string;
    jobId: string;
    attempt: number;
    maxAttempts: number;
    terminalFailure: boolean;
    errorMessage: string;
    originalData: unknown;
  }) => {
    const payload = context.originalData;
    const template =
      payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).template === 'string'
        ? String((payload as Record<string, unknown>).template)
        : `${context.queue}:${context.jobName}`;
    const recipient = (() => {
      if (!payload || typeof payload !== 'object') {
        return 'system-worker';
      }
      const p = payload as Record<string, unknown>;
      const val = (typeof p['to'] === 'string' ? p['to'] : undefined)
        ?? (typeof p['email'] === 'string' ? p['email'] : undefined)
        ?? (typeof p['phone'] === 'string' ? p['phone'] : undefined);
      return val ?? 'system-worker';
    })();

    void sendTechnicalFailureAlert({
      prisma: prismaClient,
      template,
      channel: 'UNKNOWN',
      recipient,
      errorMessage: context.errorMessage,
      failureStage: context.terminalFailure ? 'WORKER_TERMINAL' : 'WORKER_DELIVERY',
      domain: 'workers',
      component: context.queue,
      queueName: context.queue,
      jobName: context.jobName,
      jobId: context.jobId,
      terminalFailure: context.terminalFailure
    });
  };

  const dlqFailureAlertHandler = (context: { queue: string; jobName: string; jobId: string; errorMessage: string }) => {
    void sendTechnicalFailureAlert({
      prisma: prismaClient,
      template: `${context.queue}:${context.jobName}`,
      channel: 'UNKNOWN',
      recipient: 'dead-letter-queue',
      errorMessage: context.errorMessage,
      failureStage: 'WORKER_TERMINAL',
      domain: 'workers',
      component: 'dead-letter-enqueue',
      queueName: context.queue,
      jobName: context.jobName,
      jobId: context.jobId,
      terminalFailure: true
    });
  };

  const stallAlertHandler = (context: { queue: string; jobId: string }) => {
    void sendTechnicalFailureAlert({
      prisma: prismaClient,
      template: `${context.queue}:stalled`,
      channel: 'UNKNOWN',
      recipient: 'worker-stall',
      errorMessage: `Job ${context.jobId} stalled in queue ${context.queue}`,
      failureStage: 'WORKER_STALL',
      domain: 'workers',
      component: context.queue,
      queueName: context.queue,
      jobId: context.jobId
    });
  };

  attachWorkerLogging(orderProcessingWorker, logger, deadLetterQueue, failureAlertHandler, dlqFailureAlertHandler, stallAlertHandler);
  attachWorkerLogging(shippingWorker, logger, deadLetterQueue, failureAlertHandler, dlqFailureAlertHandler, stallAlertHandler);
  attachWorkerLogging(notificationsWorker, logger, deadLetterQueue, failureAlertHandler, dlqFailureAlertHandler, stallAlertHandler);
  attachWorkerLogging(inventoryAlertsWorker, logger, deadLetterQueue, failureAlertHandler, dlqFailureAlertHandler, stallAlertHandler);
  attachWorkerLogging(refundsWorker, logger, deadLetterQueue, failureAlertHandler, dlqFailureAlertHandler, stallAlertHandler);
  attachWorkerLogging(cartCleanupWorker, logger, deadLetterQueue, failureAlertHandler, dlqFailureAlertHandler, stallAlertHandler);
  attachWorkerLogging(analyticsWorker, logger, deadLetterQueue, failureAlertHandler, dlqFailureAlertHandler, stallAlertHandler);
  attachWorkerLogging(outboxDispatchWorker, logger, deadLetterQueue, failureAlertHandler, dlqFailureAlertHandler, stallAlertHandler);
  attachWorkerLogging(reconciliationWorker, logger, deadLetterQueue, failureAlertHandler, dlqFailureAlertHandler, stallAlertHandler);
  attachWorkerLogging(deadLetterWorker, logger, undefined, failureAlertHandler, dlqFailureAlertHandler, stallAlertHandler);

  let shiprocketRefreshQueue: Queue | null = null;
  let shiprocketRefreshConnection: IORedis | null = null;
  // Start Shiprocket token refresh queue when Shiprocket credentials are present.
  // Credential-based detection mirrors resolveDualShippingRuntime — SHIPPING_PROVIDER env var is unused.
  const shiprocketActive =
    Boolean((process.env.SHIPROCKET_EMAIL ?? '').trim()) &&
    Boolean((process.env.SHIPROCKET_PASSWORD ?? '').trim());
  if (shiprocketActive) {
    shiprocketRefreshConnection = guardRedisDuplicate(
      workerRedis,
      workerRedisLog,
      'worker-redis-shiprocket-refresh',
      {
        onPersistentError: workerRedisPersistentAlert(
          'WorkerRedisShiprocketRefresh',
          'worker-redis-shiprocket-refresh'
        )
      }
    );
    shiprocketRefreshQueue = new Queue('shipping', { connection: shiprocketRefreshConnection });
    shiprocketRefreshQueue
      .add(
        'shiprocket-token-refresh',
        {},
        {
          repeat: { every: 9 * 24 * 60 * 60 * 1000 },
          jobId: 'shiprocket-token-refresh-repeatable'
        }
      )
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to register shiprocket-token-refresh repeatable job');
        void sendTechnicalFailureAlert({
          prisma: prismaClient,
          template: 'ShiprocketTokenRefreshSchedule',
          channel: 'UNKNOWN',
          recipient: 'shiprocket-scheduler',
          errorMessage: err instanceof Error ? err.message : String(err),
          failureStage: 'CORE_LOGIC',
          domain: 'shipping',
          component: 'shiprocket-token-refresh-schedule'
        });
      });

    // Background shipment status polling: runs every 30 min to catch missed
    // webhooks (e.g. cancellations triggered from Shiprocket's dashboard).
    shiprocketRefreshQueue
      .add(
        'poll-shipment-statuses',
        {},
        {
          repeat: { every: 30 * 60 * 1000 },
          jobId: 'poll-shipment-statuses-repeatable'
        }
      )
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to register poll-shipment-statuses repeatable job');
      });
  }

  logger.info('All background workers started successfully and are listening for jobs.');

  // --- Shutdown orchestration ---
  // restartSubscriber is declared here so shutdown() can close it on any exit path.
  let restartSubscriber: IORedis | null = null;
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    const closeResults = await Promise.allSettled([
      orderProcessingWorker.close(),
      shippingWorker.close(),
      notificationsWorker.close(),
      inventoryAlertsWorker.close(),
      refundsWorker.close(),
      cartCleanupWorker.close(),
      analyticsWorker.close(),
      outboxDispatchWorker.close(),
      reconciliationWorker.close(),
      deadLetterWorker.close(),
      deadLetterQueue.close(),
      ...(shiprocketRefreshQueue ? [shiprocketRefreshQueue.close()] : [])
    ]);
    for (const result of closeResults) {
      if (result.status === 'rejected') {
        logger.error({ err: result.reason }, 'Worker/queue close error during shutdown');
        void sendTechnicalFailureAlert({
          prisma: prismaClient,
          template: 'WorkerShutdownClose',
          channel: 'UNKNOWN',
          recipient: 'worker-runtime',
          errorMessage: result.reason instanceof Error ? result.reason.message : String(result.reason),
          failureStage: 'CORE_LOGIC',
          domain: 'workers',
          component: 'worker-shutdown-close'
        });
      }
    }
    // Redis quit() must always run regardless of close() failures above
    await Promise.allSettled([
      restartSubscriber ? restartSubscriber.quit() : Promise.resolve(),
      shiprocketRefreshConnection ? shiprocketRefreshConnection.quit() : Promise.resolve(),
      dlqConnection.quit(),
      workerRedis.quit(),
      redis.quit()
    ]);
    await prismaClient.$disconnect();
  };

  // --- Restart signal subscriber ---
  // Subscribes to the same channel the cart-cleanup worker publishes to when a
  // scheduled-process-restart BullMQ job fires. This ensures the worker process
  // also initiates a graceful shutdown alongside the API process.
  // A duplicate connection is used because ioredis pub/sub mode blocks the connection.
  restartSubscriber = guardRedisDuplicate(workerRedis, workerRedisLog, 'worker-restart-subscriber');
  try {
    await restartSubscriber.subscribe(SYSTEM_RESTART_CHANNEL);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Failed to subscribe to restart channel — auto-restart signals disabled until Redis pub/sub recovers'
    );
  }
  restartSubscriber.on('message', (channel: string) => {
    if (channel !== SYSTEM_RESTART_CHANNEL) return;
    logger.info('System restart signal received — initiating graceful worker shutdown');
    // shutdown() already calls restartSubscriber.quit() internally.
    void shutdown().finally(() => process.exit(0));
  });

  // --- Signal handlers (M3) ---
  // process.once() prevents double-invocation if operator sends SIGINT twice quickly
  process.once('SIGINT', () => {
    void shutdown().then(() => {
      process.exit(0);
    });
  });

  process.once('SIGTERM', () => {
    void shutdown().then(() => {
      process.exit(0);
    });
  });

  // --- Process crash boundary handlers (C2) ---
  // Same rationale as the API process (C1): Node 22 kills on unhandled rejections.
  // We log and attempt an orderly shutdown.
  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ reason }, 'Worker unhandled promise rejection — initiating shutdown');
    void sendTechnicalFailureAlert({
      prisma: prismaClient,
      template: 'WorkerUnhandledRejection',
      channel: 'UNKNOWN',
      recipient: 'worker-runtime',
      errorMessage: reason instanceof Error ? reason.message : String(reason),
      failureStage: 'PROCESS_RESTART',
      domain: 'workers',
      component: 'worker-process',
      terminalFailure: true
    });
    void shutdown().finally(() => process.exit(1));
  });

  process.on('uncaughtException', (error: Error) => {
    logger.fatal({ error: error.message, stack: error.stack }, 'Worker uncaught exception — initiating shutdown');
    void sendTechnicalFailureAlert({
      prisma: prismaClient,
      template: 'WorkerUncaughtException',
      channel: 'UNKNOWN',
      recipient: 'worker-runtime',
      errorMessage: error.message,
      failureStage: 'PROCESS_RESTART',
      domain: 'workers',
      component: 'worker-process',
      terminalFailure: true
    });
    void shutdown().finally(() => process.exit(1));
  });
}

bootstrapWorkers().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
