import { FastifyInstance } from 'fastify';
import { recordQueueHealthSnapshot } from '@common/observability/metrics';
import { guardRedisDuplicate } from '@common/redis/redis-connection';
import { createQueueRegistry } from '@queues/queue-registry';
import { sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';

export async function registerBullmqPlugin(fastify: FastifyInstance): Promise<void> {
  const connection = guardRedisDuplicate(fastify.redis, fastify.log, 'bullmq-queues', {
    onPersistentError: (err) => {
      void sendTechnicalFailureAlert({
        prisma: fastify.prisma,
        template: 'BullmqRedisConnectionError',
        channel: 'UNKNOWN',
        recipient: 'bullmq-runtime',
        errorMessage: err.message,
        failureStage: 'CORE_LOGIC',
        domain: 'queues',
        component: 'bullmq-plugin'
      });
    }
  });
  const queues = createQueueRegistry(connection);

  // Schedule recurring jobs after startup — fire-and-forget so they never block boot.
  // Uses setImmediate to yield the event loop first, ensuring Redis connection is stable.
  setImmediate(() => {
    void (async () => {
      try {
        await queues.inventoryAlerts.upsertJobScheduler(
          'inventory-alerts:check-low-stock',
          { every: 60 * 60 * 1000 },
          { name: 'check-low-stock', data: {} }
        );

        await queues.cartCleanup.upsertJobScheduler(
          'cart-cleanup:delete-expired-guest-carts',
          { pattern: '0 2 * * *' },
          { name: 'delete-expired-guest-carts', data: {} }
        );

        await queues.cartCleanup.upsertJobScheduler(
          'cart-cleanup:release-expired-reservations',
          { every: 60 * 1000 },
          { name: 'release-expired-reservations', data: {} }
        );

        await queues.cartCleanup.upsertJobScheduler(
          'cart-cleanup:purge-expired-idempotency-records',
          { pattern: '0 3 * * *' },
          { name: 'purge-expired-idempotency-records', data: {} }
        );

        await queues.cartCleanup.upsertJobScheduler(
          'cart-cleanup:purge-published-outbox-messages',
          { pattern: '0 4 * * 0' },
          { name: 'purge-published-outbox-messages', data: {} }
        );

        await queues.cartCleanup.upsertJobScheduler(
          'cart-cleanup:purge-expired-refresh-tokens',
          { pattern: '0 3 * * *' },
          { name: 'purge-expired-refresh-tokens', data: {} }
        );

        await queues.cartCleanup.upsertJobScheduler(
          'cart-cleanup:purge-expired-ops-invites',
          { every: 15 * 60 * 1000 },
          { name: 'purge-expired-ops-invites', data: {} }
        );

        await queues.cartCleanup.upsertJobScheduler(
          'cart-cleanup:purge-expired-ops-otp-challenges',
          { every: 15 * 60 * 1000 },
          { name: 'purge-expired-ops-otp-challenges', data: {} }
        );

        if (queues.outboxDispatch) {
          await queues.outboxDispatch.upsertJobScheduler(
            'outbox-dispatch:publish-pending',
            { every: 10 * 1000 },
            { name: 'publish-pending', data: {} }
          );
        }

        if (queues.reconciliation) {
          await queues.reconciliation.upsertJobScheduler(
            'reconciliation:run-order-lifecycle-check',
            { every: 60 * 60 * 1000 },
            { name: 'run-order-lifecycle-check', data: {} }
          );
        }

        fastify.log.info('BullMQ job schedulers registered');
      } catch (err) {
        fastify.log.error({ err }, 'BullMQ job scheduler registration failed (non-fatal)');
        void sendTechnicalFailureAlert({
          prisma: fastify.prisma,
          template: 'BullmqSchedulerRegistration',
          channel: 'UNKNOWN',
          recipient: 'bullmq-scheduler',
          errorMessage: err instanceof Error ? err.message : 'BullMQ scheduler registration failed',
          failureStage: 'CORE_LOGIC',
          domain: 'queues',
          component: 'bullmq-plugin'
        });
      }
    })();
  });

  const queueHealthInterval = setInterval(() => {
    void (async () => {
      const queueEntries = Object.entries(queues);
      await Promise.all(queueEntries.map(async ([, queue]) => {
        try {
          const counts = await queue.getJobCounts('waiting', 'active');
          const oldestWaiting = await queue.getWaiting(0, 0);
          const oldestWaitingAgeSeconds = oldestWaiting[0]
            ? Math.max(0, Math.floor((Date.now() - oldestWaiting[0].timestamp) / 1000))
            : 0;

          recordQueueHealthSnapshot({
            queue: queue.name,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            oldestWaitingAgeSeconds
          });
        } catch {
          // Queue health polling must never crash plugin lifecycle.
        }
      }));
    })();
  }, 30_000);
  // .unref() prevents this timer from keeping the event loop alive during shutdown
  queueHealthInterval.unref();

  fastify.decorate('queues', queues);

  fastify.addHook('onClose', async (instance) => {
    clearInterval(queueHealthInterval);
    const closeResults = await Promise.allSettled(
      Object.values(instance.queues).map((queue) => queue.close())
    );
    for (const result of closeResults) {
      if (result.status === 'rejected') {
        instance.log.error({ err: result.reason }, 'Queue close error during plugin shutdown');
        void sendTechnicalFailureAlert({
          prisma: instance.prisma,
          template: 'BullmqQueueClose',
          channel: 'UNKNOWN',
          recipient: 'bullmq-shutdown',
          errorMessage: result.reason instanceof Error ? result.reason.message : String(result.reason),
          failureStage: 'CORE_LOGIC',
          domain: 'queues',
          component: 'bullmq-plugin-shutdown'
        });
      }
    }
    await connection.quit();
  });
}

