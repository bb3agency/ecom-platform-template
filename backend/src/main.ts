import Fastify from 'fastify';
import { getAppConfig, validateBootstrapEnv, validateRuntimeEnv } from '@config/app.config';
import { ERROR_CODES } from '@common/errors/error-codes';
import prismaClient from './database/prisma.service';
import { registerApp } from './app';
import { registerGlobalErrorHandler } from './common/errors/error-handler';
import { registerBullmqPlugin } from './common/plugins/bullmq.plugin';
import { registerCorsPlugin } from './common/plugins/cors.plugin';
import { registerCookiePlugin } from './common/plugins/cookie.plugin';
import { registerHelmetPlugin } from './common/plugins/helmet.plugin';
import { registerJwtPlugin } from './common/plugins/jwt.plugin';
import { registerMultipartPlugin } from './common/plugins/multipart.plugin';
import { registerPrismaPlugin } from './common/plugins/prisma.plugin';
import { registerRateLimitPlugin } from './common/plugins/rate-limit.plugin';
import { registerRedisPlugin } from './common/plugins/redis.plugin';
import { registerSwaggerPlugin } from './common/plugins/swagger.plugin';
import { registerObservabilityPlugin } from './common/plugins/observability.plugin';
import { loadShedGuard, setLoadShedModeViaRedis } from '@common/reliability/load-shed.guard';
import {
  readMaintenanceState,
  writeMaintenanceState,
  type MaintenanceStatePrismaLike,
  type MaintenanceStateRedisLike
} from '@common/reliability/maintenance-state';
import { initializeTracing, shutdownTracing } from '@common/observability/tracing';
import { registerResponseEnvelopeHook } from '@common/hooks/response-envelope.hook';
import { featureFlags, refreshFeatureFlags } from '@config/feature-flags';
import { sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';
import { recordProcessCrash } from '@common/observability/metrics';
import { isIpAllowlisted, parseWebhookIpAllowlist } from '@common/security/webhook-allowlist';
import { applyOpsConfigRuntimeOverlay, type OpsConfigRuntimePrismaLike } from './modules/ops/ops-config-runtime';
import type Redis from 'ioredis';
import { guardRedisDuplicate } from '@common/redis/redis-connection';
import { SYSTEM_RESTART_CHANNEL, type RestartSignalPayload } from '@common/restart/system-restart';

function normalizeRoutePath(url: string): string {
  const rawPath = url.split('?')[0] ?? '';
  if (rawPath.length > 1 && rawPath.endsWith('/')) {
    return rawPath.slice(0, -1);
  }
  return rawPath;
}

async function bootstrap(): Promise<void> {
  validateBootstrapEnv();
  const overlayReport = await applyOpsConfigRuntimeOverlay(prismaClient as unknown as OpsConfigRuntimePrismaLike);
  const { resetProductMediaStorageCache } = await import('@modules/media/product-media-provider');
  resetProductMediaStorageCache();
  refreshFeatureFlags();
  validateRuntimeEnv();
  const appConfig = getAppConfig();

  await initializeTracing();
  const trustedProxyRules = parseWebhookIpAllowlist(process.env.TRUSTED_PROXY_ALLOWLIST_CIDR);
  const trustProxy = trustedProxyRules.length > 0
    ? (address: string) => {
      const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
      return isIpAllowlisted(normalized, trustedProxyRules);
    }
    : false;
  const fastify = Fastify({
    // Explicit body limit — defense-in-depth; matches Fastify default but makes it
    // visible in code so a future Fastify upgrade cannot silently change it.
    bodyLimit: 1_048_576, // 1 MiB
    logger: {
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-ops-token"]',
          'req.headers["x-api-key"]',
          'req.headers["x-signature"]',
          'req.headers["x-webhook-signature"]',
          'req.headers["x-razorpay-signature"]',
          'req.headers["set-cookie"]',
          'res.headers["set-cookie"]',
          'authorization',
          'cookie',
          'token',
          '*.token',
          '*.sessionToken',
          '*.refreshToken',
          '*.signature',
          '*.secret',
          '*.apiKey'
        ],
        censor: '[REDACTED]'
      }
    },
    trustProxy,
    // Avoid 404s when clients or proxies add a trailing slash (e.g. `/api/v1/.../shipping/`).
    routerOptions: { ignoreTrailingSlash: true }
  });

  fastify.log.info({
    appliedKeys: overlayReport.appliedKeys,
    skippedBootstrapKeys: overlayReport.skippedBootstrapKeys,
    skippedUnknownKeys: overlayReport.skippedUnknownKeys,
    failedKeys: overlayReport.failedKeys
  }, 'Ops DB runtime config overlay applied');

  fastify.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({
      success: false,
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Route not found',
        statusCode: 404,
        details: {
          kind: 'business_rule',
          hintKey: 'route_not_found',
          retryable: false,
          retryAfterSeconds: null,
          remediation: 'Verify HTTP method and API path.'
        }
      }
    });
  });

  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, payload, done) => {
      try {
        const routePath = normalizeRoutePath(request.url);
        const shouldKeepRawBody =
          routePath === '/api/v1/payments/webhook' ||
          routePath === '/api/v1/shipping/webhook' ||
          routePath === '/api/v1/notifications/webhook/meta-whatsapp';

        if (shouldKeepRawBody) {
          // Preserve the exact raw bytes for HMAC signature verification.
          // Converting to string and back risks subtle byte-level mismatches
          // that would cause Razorpay webhook signature validation to fail.
          done(null, payload);
          return;
        }

        const text = payload.toString('utf8').trim();
        if (text.length === 0) {
          done(null, {});
          return;
        }

        const parsed = JSON.parse(text) as unknown;
        done(null, parsed);
      } catch (error) {
        done(error as Error);
      }
    }
  );

  // Locked order from TRD §4.2 / rules §7:
  // helmet -> cors -> cookie -> jwt -> rate-limit -> multipart -> swagger -> prisma -> redis -> bullmq -> modules
  await registerHelmetPlugin(fastify);
  await registerCorsPlugin(fastify);
  await registerCookiePlugin(fastify);
  await registerJwtPlugin(fastify);
  await registerRateLimitPlugin(fastify);
  await registerMultipartPlugin(fastify);
  await registerSwaggerPlugin(fastify);
  await registerPrismaPlugin(fastify);
  await registerRedisPlugin(fastify);
  await registerBullmqPlugin(fastify);
  await registerGlobalErrorHandler(fastify);
  await registerObservabilityPlugin(fastify);
  fastify.addHook('preHandler', loadShedGuard);
  await registerApp(fastify);

  // Response envelope — wraps all 2xx JSON responses in { success, data, meta? }
  // Activate per-client via FEATURE_RESPONSE_ENVELOPE_ENABLED=true
  if (featureFlags.responseEnvelope) {
    await registerResponseEnvelopeHook(fastify);
  }

  // Graceful shutdown — defined before listen() so crash handlers can reference it.
  // restartSubscriber is declared here so gracefulShutdown() can close it on any exit path.
  let restartSubscriber: InstanceType<typeof Redis> | null = null;
  let shuttingDown = false;
  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await fastify.close();
    await shutdownTracing();
    await restartSubscriber?.quit().catch(() => { /* best-effort */ });
  };

  await fastify.listen({
    host: appConfig.host,
    port: appConfig.port
  });

  // Rehydrate the durable maintenance/load-shed state from Postgres into
  // Redis on every boot. Without this, a Redis flush (or a fresh Redis
  // container) would silently default to 'normal' on the next request even
  // though the DB still has 'maintenance' persisted — exactly the
  // "survives infra reset" contract this feature promises. Best-effort: a
  // failure here does NOT block startup, the on-demand cache miss read in
  // `readMaintenanceStateFromRequest` will catch up on the first request.
  //
  // Critical: we ONLY upsert the durable row when one already exists. On a
  // fresh deploy (no row yet) we leave the table empty and rely on
  // `readMaintenanceState`'s default `normal` fallback. Without this guard,
  // every backend boot on a fresh DB would create a synthetic row with
  // `setAt = 1970-01-01` and `setByOpsUserId = null`, which would then
  // appear in audit-style queries as a phantom "load-shed change".
  void (async () => {
    try {
      const prismaForState = prismaClient as unknown as MaintenanceStatePrismaLike;
      const redisForState = fastify.redis as unknown as MaintenanceStateRedisLike;
      const row = await prismaForState.maintenanceState.findUnique({
        where: { singletonKey: 'singleton' }
      });
      if (!row) {
        // Fresh DB. Populate Redis cache with the default `normal` state so
        // the very first request after boot doesn't have to round-trip to
        // Postgres just to learn there is no override.
        await setLoadShedModeViaRedis(fastify.redis, 'normal');
        fastify.log.info('Maintenance state rehydrate: no DB row, using default normal mode');
        return;
      }

      // Real row exists — refresh Redis cache + legacy mode key so every
      // downstream reader (load-shed guard, status route, rate-limit
      // policies) sees the same value within one resolution cycle. The
      // upsert uses identical values to the existing row, so it is a safe
      // no-op on the DB side but lets `writeMaintenanceState` repopulate
      // the Redis JSON blob in one place.
      const state = await readMaintenanceState({ prisma: prismaForState, redis: redisForState });
      await writeMaintenanceState({
        prisma: prismaForState,
        redis: redisForState,
        record: {
          mode: state.mode,
          phase: state.phase,
          pendingUntil: state.pendingUntil,
          activatedAt: state.activatedAt,
          reason: state.reason,
          setByOpsUserId: state.setByOpsUserId,
          setAt: state.setAt
        }
      });
      await setLoadShedModeViaRedis(fastify.redis, state.mode);
      fastify.log.info({ mode: state.mode, phase: state.phase }, 'Maintenance state rehydrated on boot');
    } catch (rehydrateErr) {
      fastify.log.warn({ err: rehydrateErr }, 'Maintenance state rehydration failed (non-fatal)');
    }
  })();

  // --- Signal handlers ---
  process.once('SIGINT', () => {
    void gracefulShutdown();
  });
  process.once('SIGTERM', () => {
    void gracefulShutdown();
  });

  // --- Restart signal subscriber ---
  // A dedicated subscriber connection (ioredis pub/sub requires its own connection).
  // The worker's scheduled-process-restart BullMQ job publishes to this channel
  // so both the API container and the worker container restart cleanly when the
  // ops-triggered restart fires. Fastify.close() drains in-flight requests before
  // process.exit(0); Docker restart: unless-stopped brings the API back up.
  restartSubscriber = guardRedisDuplicate(fastify.redis, fastify.log, 'restart-subscriber', {
    onPersistentError: (err) => {
      void sendTechnicalFailureAlert({
        prisma: prismaClient,
        template: 'RestartSubscriberRedisError',
        channel: 'UNKNOWN',
        recipient: 'restart-subscriber',
        errorMessage: err.message,
        failureStage: 'CORE_LOGIC',
        domain: 'infrastructure',
        component: 'restart-subscriber'
      });
    }
  });
  try {
    await restartSubscriber.subscribe(SYSTEM_RESTART_CHANNEL);
  } catch (err) {
    fastify.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Failed to subscribe to restart channel — auto-restart signals disabled until Redis pub/sub recovers'
    );
    void sendTechnicalFailureAlert({
      prisma: prismaClient,
      template: 'RestartSubscriberSubscribeFailed',
      channel: 'UNKNOWN',
      recipient: 'restart-subscriber',
      errorMessage: err instanceof Error ? err.message : String(err),
      failureStage: 'CORE_LOGIC',
      domain: 'infrastructure',
      component: 'restart-subscriber'
    });
  }
  restartSubscriber.on('message', (channel: string, message: string) => {
    if (channel !== SYSTEM_RESTART_CHANNEL) return;
    let payload: Partial<RestartSignalPayload> = {};
    try { payload = JSON.parse(message) as Partial<RestartSignalPayload>; } catch { /* ignore */ }
    fastify.log.info(
      { jobId: payload.jobId, scheduledFor: payload.scheduledFor, requestedBy: payload.requestedBy },
      'System restart signal received — initiating graceful shutdown'
    );
    // gracefulShutdown() already calls restartSubscriber.quit() internally.
    void gracefulShutdown().finally(() => process.exit(0));
  });

  // --- Process crash boundary handlers ---
  // Node 22 defaults to --unhandled-rejections=throw; without these handlers an
  // unhandled rejection in any async path (plugin, hook, background timer) kills
  // the process silently. We log and initiate an orderly shutdown instead.
  process.on('unhandledRejection', (reason: unknown) => {
    fastify.log.fatal({ reason }, 'Unhandled promise rejection — initiating shutdown');
    recordProcessCrash('unhandled_rejection');
    void sendTechnicalFailureAlert({
      prisma: prismaClient,
      template: 'ApiUnhandledRejection',
      channel: 'UNKNOWN',
      recipient: 'api-process',
      errorMessage: reason instanceof Error ? reason.message : String(reason),
      failureStage: 'PROCESS_RESTART',
      domain: 'infrastructure',
      component: 'api-process',
      terminalFailure: true
    });
    void gracefulShutdown().finally(() => process.exit(1));
  });

  process.on('uncaughtException', (error: Error) => {
    fastify.log.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception — initiating shutdown');
    recordProcessCrash('uncaught_exception');
    void sendTechnicalFailureAlert({
      prisma: prismaClient,
      template: 'ApiUncaughtException',
      channel: 'UNKNOWN',
      recipient: 'api-process',
      errorMessage: error.message,
      failureStage: 'PROCESS_RESTART',
      domain: 'infrastructure',
      component: 'api-process',
      terminalFailure: true
    });
    void gracefulShutdown().finally(() => process.exit(1));
  });
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
