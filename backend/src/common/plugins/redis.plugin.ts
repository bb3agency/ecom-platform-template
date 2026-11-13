import { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import {
  API_REDIS_MAX_RETRIES_PER_REQUEST,
  attachRedisErrorListener,
  buildStandardRedisOptions,
  waitForRedisReady,
  type RedisEventClient
} from '@common/redis/redis-connection';
import { redisConfig } from '@config/redis.config';
import { sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';

type RedisInstance = InstanceType<typeof Redis>;

type RedisClientLike = {
  status: string;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  quit(): Promise<unknown>;
};

type RedisCtorLike = (url: string, options: Record<string, unknown>) => RedisClientLike;

type RedisPluginDeps = {
  redisCtor?: RedisCtorLike;
  redisUrl?: string;
  readyTimeoutMs?: number;
};

export async function registerRedisPlugin(fastify: FastifyInstance, deps: RedisPluginDeps = {}): Promise<void> {
  const redisCtor = deps.redisCtor ?? ((url: string, options: Record<string, unknown>) => new Redis(url, options) as unknown as RedisClientLike);
  const redisUrl = deps.redisUrl ?? redisConfig.url;
  const redisReadyTimeoutMs = deps.readyTimeoutMs ?? 20_000;
  // Non-blocking request-path client: fail commands fast during an outage (be-rel-07).
  // Duplicates (BullMQ producer queues, restart subscriber) inherit this — none of
  // them issue blocking commands; worker connections are built separately.
  const redis = redisCtor(
    redisUrl,
    buildStandardRedisOptions({ maxRetriesPerRequest: API_REDIS_MAX_RETRIES_PER_REQUEST })
  );

  attachRedisErrorListener(redis as unknown as RedisEventClient, fastify.log, 'redis-primary', {
    onPersistentError: (err) => {
      void sendTechnicalFailureAlert({
        prisma: fastify.prisma,
        template: 'RedisClientError',
        channel: 'UNKNOWN',
        recipient: 'redis-runtime',
        errorMessage: err.message,
        failureStage: 'CORE_LOGIC',
        domain: 'infrastructure',
        component: 'redis-plugin'
      });
    }
  });

  await waitForRedisReady(redis as unknown as RedisEventClient & RedisClientLike, redisReadyTimeoutMs);

  fastify.decorate('redis', redis as unknown as RedisInstance);

  fastify.addHook('onClose', async (instance) => {
    await instance.redis.quit();
  });
}
