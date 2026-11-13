import { FastifyInstance } from 'fastify';
import { findMissingStrictOpsConfigKeys } from '@modules/ops/ops-config-contract';

export type DependencyStatus = 'connected' | 'disconnected';
export type ReadinessStatus = 'ready' | 'not_ready';
export type WorkerFreshness = 'fresh' | 'stale' | 'unknown';

export type HealthCheckResult = {
  status: 'ok' | 'degraded';
  timestamp: string;
  version: string;
  database: DependencyStatus;
  redis: DependencyStatus;
};

export type ReadinessCheckResult = {
  status: ReadinessStatus;
  timestamp: string;
  version: string;
  database: DependencyStatus;
  redis: DependencyStatus;
  degradationMode: 'none' | 'database_down' | 'redis_down' | 'queue_stale' | 'runtime_config_missing';
  queues: {
    waiting: number;
    active: number;
    oldestWaitingAgeSeconds: number;
    workerFreshness: WorkerFreshness;
  };
  runtimeConfigMissingKeys: string[];
};

/** Upper bound for each dependency probe so /health and /health/ready always answer (be-rel-07). */
export const HEALTH_PROBE_TIMEOUT_MS = 2_000;

const UNKNOWN_QUEUE_SUMMARY = {
  waiting: 0,
  active: 0,
  oldestWaitingAgeSeconds: 0,
  workerFreshness: 'unknown' as WorkerFreshness
};

class ProbeTimeoutError extends Error {
  constructor(probe: string, timeoutMs: number) {
    super(`${probe} probe timed out after ${timeoutMs}ms`);
    this.name = 'ProbeTimeoutError';
  }
}

async function withProbeTimeout<T>(probe: string, task: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeoutError(probe, timeoutMs)), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([task(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class HealthService {
  constructor(
    private readonly fastify: FastifyInstance,
    private readonly probeTimeoutMs: number = HEALTH_PROBE_TIMEOUT_MS
  ) {}

  async check(): Promise<HealthCheckResult> {
    const [database, redis] = await Promise.all([this.pingDatabase(), this.pingRedis()]);
    const isHealthy = database === 'connected' && redis === 'connected';

    return {
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
      database,
      redis
    };
  }

  async checkReadiness(): Promise<ReadinessCheckResult> {
    const [database, redis] = await Promise.all([this.pingDatabase(), this.pingRedis()]);
    // Queue counts need Redis; when it is down (or slow) report freshness as
    // 'unknown' instead of throwing or hanging the readiness probe.
    const queueSummary =
      redis === 'connected'
        ? await withProbeTimeout('queues', () => this.queueSummary(), this.probeTimeoutMs).catch(
            () => UNKNOWN_QUEUE_SUMMARY
          )
        : UNKNOWN_QUEUE_SUMMARY;
    const strictProfile = this.isProductionLikeProfile();
    const runtimeConfigMissingKeys = strictProfile ? findMissingStrictOpsConfigKeys(process.env) : [];
    const isReady =
      database === 'connected' &&
      redis === 'connected' &&
      queueSummary.workerFreshness !== 'stale' &&
      runtimeConfigMissingKeys.length === 0;
    const degradationMode =
      database !== 'connected'
        ? 'database_down'
        : redis !== 'connected'
          ? 'redis_down'
          : queueSummary.workerFreshness === 'stale'
            ? 'queue_stale'
            : runtimeConfigMissingKeys.length > 0
              ? 'runtime_config_missing'
            : 'none';

    return {
      status: isReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
      database,
      redis,
      degradationMode,
      queues: queueSummary,
      runtimeConfigMissingKeys
    };
  }

  async checkLiveness(): Promise<{ status: 'alive'; timestamp: string; version: string }> {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0'
    };
  }

  private async pingDatabase(): Promise<DependencyStatus> {
    try {
      await withProbeTimeout('database', () => this.fastify.prisma.$queryRaw`SELECT 1`, this.probeTimeoutMs);
      return 'connected';
    } catch {
      return 'disconnected';
    }
  }

  private async pingRedis(): Promise<DependencyStatus> {
    try {
      const redisPing = await withProbeTimeout('redis', () => this.fastify.redis.ping(), this.probeTimeoutMs);
      return redisPing === 'PONG' ? 'connected' : 'disconnected';
    } catch {
      return 'disconnected';
    }
  }

  private isProductionLikeProfile(): boolean {
    const env = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
    return env !== 'development' && env !== 'test';
  }

  private async queueSummary(): Promise<{
    waiting: number;
    active: number;
    oldestWaitingAgeSeconds: number;
    workerFreshness: WorkerFreshness;
  }> {
    if (!this.fastify.hasDecorator('queues')) {
      return { waiting: 0, active: 0, oldestWaitingAgeSeconds: 0, workerFreshness: 'unknown' };
    }

    const entries = Object.values(this.fastify.queues);
    let waiting = 0;
    let active = 0;
    let oldestWaitingAgeSeconds = 0;
    for (const queue of entries) {
      const counts = await queue.getJobCounts('waiting', 'active');
      waiting += counts.waiting ?? 0;
      active += counts.active ?? 0;
      const oldest = await queue.getWaiting(0, 0);
      const ageSeconds = oldest[0] ? Math.max(0, Math.floor((Date.now() - oldest[0].timestamp) / 1000)) : 0;
      oldestWaitingAgeSeconds = Math.max(oldestWaitingAgeSeconds, ageSeconds);
    }
    const thresholdRaw = Number(process.env.HEALTH_QUEUE_STALE_WAITING_SECONDS ?? 300);
    const thresholdSeconds = Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 300;
    const workerFreshness: WorkerFreshness = oldestWaitingAgeSeconds > thresholdSeconds ? 'stale' : 'fresh';
    return { waiting, active, oldestWaitingAgeSeconds, workerFreshness };
  }
}
