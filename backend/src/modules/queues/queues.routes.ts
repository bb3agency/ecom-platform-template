import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { Queue } from 'bullmq';
import { FastifyInstance } from 'fastify';
import { opsAuthGuard } from '@common/guards/ops-auth.guard';
import { opsPermissionGuard } from '@common/guards/ops-permissions.guard';
import { routeRateLimitProfiles } from '@common/rate-limit/rate-limit-policies';
import { opsQueuesUiSchema, opsQueuesDlqSummarySchema } from './queues.schemas';

export async function registerQueuesRoutes(fastify: FastifyInstance): Promise<void> {
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/api/v1/ops/queues');

  const registryQueues = Object.values(fastify.queues).map((queue) => new BullMQAdapter(queue));

  createBullBoard({
    queues: registryQueues as never,
    serverAdapter
  });

  await fastify.register(async (secured) => {
    secured.addHook('onRoute', (routeOptions) => {
      if (
        routeOptions.method === 'GET' &&
        typeof routeOptions.url === 'string' &&
        routeOptions.url === '/api/v1/ops/queues'
      ) {
        routeOptions.schema = opsQueuesUiSchema;
      }
    });

    secured.addHook('onRequest', async (request, reply) => {
      await opsAuthGuard(request, reply);
      await opsPermissionGuard('ops:read')(request, reply);
    });

    secured.get('/api/v1/ops/queues/dlq/summary', {
      schema: opsQueuesDlqSummarySchema,
      config: {
        rateLimit: routeRateLimitProfiles.opsRead
      },
      handler: async () => {
        const dlq: Queue | undefined = fastify.queues.deadLetter;
        if (!dlq) {
          return { total: 0, bySourceQueue: {} };
        }

        const waiting = await dlq.getWaiting(0, 500);
        const completed = await dlq.getCompleted(0, 500);
        const allJobs = [...waiting, ...completed];

        const bySourceQueue: Record<string, number> = {};
        for (const job of allJobs) {
          const source = (job.data as { sourceQueue?: string })?.sourceQueue ?? 'unknown';
          bySourceQueue[source] = (bySourceQueue[source] ?? 0) + 1;
        }

        return { total: allJobs.length, bySourceQueue };
      }
    });

    await secured.register(serverAdapter.registerPlugin(), {
      prefix: '/api/v1/ops/queues'
    } as never);
  });
}

