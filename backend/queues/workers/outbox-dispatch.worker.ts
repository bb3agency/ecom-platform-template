import { Worker, type ConnectionOptions } from 'bullmq';
import { PrismaClient as RealPrismaClient } from '@prisma/client';
import { createQueueRegistry } from '@queues/queue-registry';
import { recordOutboxDeadLetterDepth, recordOutboxLag, recordQueueDeadLetterGrowth } from '@common/observability/metrics';
import { sendTechnicalFailureAlert, type TechnicalFailureChannel } from '@modules/notifications/notification-failure-alert';

const MAX_OUTBOX_ATTEMPTS = 5;

function mapChannelFromJob(jobName: string): TechnicalFailureChannel {
  if (jobName === 'send-email') {
    return 'EMAIL';
  }
  if (jobName === 'send-sms') {
    return 'SMS';
  }
  if (jobName === 'send-whatsapp') {
    return 'WHATSAPP';
  }
  return 'UNKNOWN';
}

function resolveRecipient(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'unknown-recipient';
  }
  const record = payload as Record<string, unknown>;
  const to = typeof record.to === 'string' ? record.to.trim() : '';
  if (to) {
    return to;
  }
  const email = typeof record.email === 'string' ? record.email.trim() : '';
  if (email) {
    return email;
  }
  const phone = typeof record.phone === 'string' ? record.phone.trim() : '';
  if (phone) {
    return phone;
  }
  return 'unknown-recipient';
}

function resolveTemplate(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'UnknownTemplate';
  }
  const template = (payload as Record<string, unknown>).template;
  return typeof template === 'string' && template.trim() ? template : 'UnknownTemplate';
}

type OutboxDispatchWorkerDeps = {
  PrismaClient?: typeof RealPrismaClient;
  Worker?: typeof Worker;
  createQueueRegistry?: typeof createQueueRegistry;
};

export function createOutboxDispatchWorker(
  connection: ConnectionOptions,
  deps?: OutboxDispatchWorkerDeps
): Worker {
  const PrismaClientCtor = deps?.PrismaClient ?? RealPrismaClient;
  const WorkerCtor = deps?.Worker ?? Worker;
  const createRegistry = deps?.createQueueRegistry ?? createQueueRegistry;
  const prisma = new PrismaClientCtor();

  return new WorkerCtor(
    'outbox-dispatch',
    async (job) => {
      if (job.name === 'replay-dead-letter') {
        const replayId = typeof job.data?.outboxMessageId === 'string' ? job.data.outboxMessageId : null;
        const requestedBy = typeof job.data?.requestedBy === 'string' ? job.data.requestedBy : 'unknown';
        if (!replayId) {
          return;
        }
        await prisma.outboxMessage.updateMany({
          where: { id: replayId, status: 'FAILED' },
          data: {
            status: 'PENDING',
            lastError: `Replay requested by ${requestedBy} at ${new Date().toISOString()}`
          }
        });
        return;
      }
      if (job.name !== 'publish-pending') return;

      const registry = createRegistry(connection);
      try {
        const pending = await prisma.outboxMessage.findMany({
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          take: 50
        });
        const oldestPending = pending[0];
        const deadLetterCount = await prisma.outboxMessage.count({
          where: { status: 'FAILED' }
        });
        recordOutboxDeadLetterDepth(deadLetterCount);
        if (oldestPending) {
          recordOutboxLag((Date.now() - oldestPending.createdAt.getTime()) / 1000);
        } else {
          recordOutboxLag(0);
        }

        for (const item of pending) {
          try {
            const claimResult = await prisma.outboxMessage.updateMany({
              where: {
                id: item.id,
                status: 'PENDING'
              },
              data: {
                attemptCount: {
                  increment: 1
                }
              }
            });
            if (claimResult.count === 0) {
              continue;
            }

            const queue = registry[item.queueName as keyof ReturnType<typeof createQueueRegistry>];
            if (!queue) {
              await prisma.outboxMessage.update({
                where: { id: item.id },
                data: {
                  status: 'FAILED',
                  lastError: `Unknown queue: ${item.queueName}`
                }
              });
              recordQueueDeadLetterGrowth('outbox-dispatch', item.jobName);
              await sendTechnicalFailureAlert({
                prisma,
                template: resolveTemplate(item.payload),
                channel: mapChannelFromJob(item.jobName),
                recipient: resolveRecipient(item.payload),
                errorMessage: `Unknown queue: ${item.queueName}`,
                failureStage: 'OUTBOX_DISPATCH',
                domain: 'outbox',
                component: 'outbox-dispatch-worker',
                queueName: item.queueName,
                jobName: item.jobName,
                ...(item.jobId ? { jobId: item.jobId } : {}),
                outboxMessageId: item.id,
                terminalFailure: true
              });
              continue;
            }

            // BullMQ 5.x rejects custom jobIds containing ':' (unless exactly 3 colon
            // segments — legacy repeatable-job compat). Outbox rows written with ids
            // like `cancel-shipment:<orderId>` or `shipping:primary:<id>:shipped`
            // failed EVERY dispatch attempt and dead-lettered silently — cancels never
            // reached the provider and OrderShipped mails never sent. Sanitize here so
            // existing rows and dead-letter replays relay cleanly too.
            const safeJobId = item.jobId ? item.jobId.replace(/:/g, '-') : undefined;
            await queue.add(item.jobName, item.payload as object, safeJobId ? { jobId: safeJobId } : undefined);
            await prisma.outboxMessage.update({
              where: { id: item.id },
              data: {
                status: 'PUBLISHED',
                publishedAt: new Date(),
                lastError: null
              }
            });
          } catch (error) {
            const nextStatus = item.attemptCount + 1 >= MAX_OUTBOX_ATTEMPTS ? 'FAILED' : 'PENDING';
            await prisma.outboxMessage.update({
              where: { id: item.id },
              data: {
                status: nextStatus,
                lastError: error instanceof Error ? error.message : 'Unknown outbox dispatch error'
              }
            });
            if (nextStatus === 'FAILED') {
              recordQueueDeadLetterGrowth('outbox-dispatch', item.jobName);
              await sendTechnicalFailureAlert({
                prisma,
                template: resolveTemplate(item.payload),
                channel: mapChannelFromJob(item.jobName),
                recipient: resolveRecipient(item.payload),
                errorMessage: error instanceof Error ? error.message : 'Unknown outbox dispatch error',
                failureStage: 'OUTBOX_DISPATCH',
                domain: 'outbox',
                component: 'outbox-dispatch-worker',
                queueName: item.queueName,
                jobName: item.jobName,
                ...(item.jobId ? { jobId: item.jobId } : {}),
                outboxMessageId: item.id,
                terminalFailure: true
              });
            }
          }
        }
      } finally {
        await Promise.allSettled(Object.values(registry).map(async (queue) => queue.close()));
      }
    },
    { connection }
  );
}
