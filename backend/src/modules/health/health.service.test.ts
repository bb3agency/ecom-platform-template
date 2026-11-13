import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthService } from './health.service';

function buildFastify(oldestWaitingAgeSeconds: number) {
  const now = Date.now();

  const queue = {
    getJobCounts: vi.fn(async () => ({ waiting: 1, active: 0 })),
    getWaiting: vi.fn(async () => [{ timestamp: now - oldestWaitingAgeSeconds * 1000 }])
  };

  return {
    prisma: {
      $queryRaw: vi.fn(async () => [{ '?column?': 1 }])
    },
    redis: {
      ping: vi.fn(async () => 'PONG')
    },
    hasDecorator: vi.fn((name: string) => name === 'queues'),
    queues: {
      orderProcessing: queue
    }
  };
}

describe('HealthService queue freshness threshold', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to default threshold when env is invalid', async () => {
    vi.stubEnv('HEALTH_QUEUE_STALE_WAITING_SECONDS', 'not-a-number');
    const fastify = buildFastify(301);
    const service = new HealthService(fastify as never);

    const result = await service.checkReadiness();

    expect(result.queues.workerFreshness).toBe('stale');
    expect(result.status).toBe('not_ready');
    expect(result.degradationMode).toBe('queue_stale');
    expect(result.runtimeConfigMissingKeys).toEqual([]);
  });

  it('uses configured threshold when env is valid', async () => {
    vi.stubEnv('HEALTH_QUEUE_STALE_WAITING_SECONDS', '900');
    const fastify = buildFastify(301);
    const service = new HealthService(fastify as never);

    const result = await service.checkReadiness();

    expect(result.queues.workerFreshness).toBe('fresh');
    expect(result.status).toBe('ready');
    expect(result.degradationMode).toBe('none');
    expect(result.runtimeConfigMissingKeys).toEqual([]);
  });

  it('reports runtime config missing in production-like profile', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PAYMENT_PROVIDER', '');
    // SHIPPING_PROVIDER not stubbed — it's non-mutable and not in the required set
    vi.stubEnv('SMS_PROVIDER', '');
    vi.stubEnv('OPS_METRICS_TOKEN', '');
    vi.stubEnv('REPLAY_APPROVAL_TOKEN', '');
    const fastify = buildFastify(10);
    const service = new HealthService(fastify as never);

    const result = await service.checkReadiness();

    expect(result.status).toBe('not_ready');
    expect(result.degradationMode).toBe('runtime_config_missing');
    expect(result.runtimeConfigMissingKeys).toContain('PAYMENT_PROVIDER');
    // SHIPPING_PROVIDER is not required (routing auto-detects from credentials)
    expect(result.runtimeConfigMissingKeys).not.toContain('SHIPPING_PROVIDER');
    expect(result.runtimeConfigMissingKeys).toContain('MEDIA_STORAGE_PROVIDER');
    expect(result.runtimeConfigMissingKeys).toContain('OPS_METRICS_TOKEN');
    expect(result.runtimeConfigMissingKeys).toContain('REPLAY_APPROVAL_TOKEN');
  });
});

describe('HealthService probe timeouts (be-rel-07)', () => {
  const never = () => new Promise<never>(() => undefined);

  it('reports redis disconnected instead of hanging when PING never resolves', async () => {
    const fastify = buildFastify(10);
    fastify.redis.ping = vi.fn(never);
    const service = new HealthService(fastify as never, 20);

    const result = await service.check();

    expect(result.redis).toBe('disconnected');
    expect(result.database).toBe('connected');
    expect(result.status).toBe('degraded');
  });

  it('readiness answers not_ready / redis_down with unknown queue freshness when Redis hangs', async () => {
    const fastify = buildFastify(10);
    fastify.redis.ping = vi.fn(never);
    const getJobCounts = vi.fn(never);
    fastify.queues.orderProcessing.getJobCounts = getJobCounts;
    const service = new HealthService(fastify as never, 20);

    const result = await service.checkReadiness();

    expect(result.status).toBe('not_ready');
    expect(result.degradationMode).toBe('redis_down');
    expect(result.queues.workerFreshness).toBe('unknown');
    expect(getJobCounts).not.toHaveBeenCalled();
  });

  it('reports database disconnected when the DB probe hangs', async () => {
    const fastify = buildFastify(10);
    fastify.prisma.$queryRaw = vi.fn(never);
    const service = new HealthService(fastify as never, 20);

    const result = await service.checkReadiness();

    expect(result.database).toBe('disconnected');
    expect(result.degradationMode).toBe('database_down');
  });

  it('falls back to unknown queue freshness when queue counts time out', async () => {
    const fastify = buildFastify(10);
    fastify.queues.orderProcessing.getJobCounts = vi.fn(never);
    const service = new HealthService(fastify as never, 20);

    const result = await service.checkReadiness();

    expect(result.redis).toBe('connected');
    expect(result.queues.workerFreshness).toBe('unknown');
  });
});
