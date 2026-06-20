import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerHealthRoutes } from './health.routes';

describe('health routes', () => {
  it('returns 200 for healthy /api/v1/health', async () => {
    const app = Fastify();
    app.decorate('prisma', {
      $queryRaw: vi.fn(async () => [{ '?column?': 1 }])
    } as never);
    app.decorate('redis', {
      ping: vi.fn(async () => 'PONG')
    } as never);
    await registerHealthRoutes(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { status: string; database: string; redis: string };
    expect(payload.status).toBe('ok');
    expect(payload.database).toBe('connected');
    expect(payload.redis).toBe('connected');

    await app.close();
  });

  it('returns 503 for degraded /api/v1/health', async () => {
    const app = Fastify();
    app.decorate('prisma', {
      $queryRaw: vi.fn(async () => {
        throw new Error('db down');
      })
    } as never);
    app.decorate('redis', {
      ping: vi.fn(async () => 'PONG')
    } as never);
    await registerHealthRoutes(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(503);
    const payload = response.json() as { error: { message: string } };
    expect(payload.error.message).toContain('Health check failed');

    await app.close();
  });

  it('returns 503 for not-ready /api/v1/health/ready', async () => {
    const now = Date.now();
    const app = Fastify();
    app.decorate('prisma', {
      $queryRaw: vi.fn(async () => [{ '?column?': 1 }])
    } as never);
    app.decorate('redis', {
      ping: vi.fn(async () => 'PONG')
    } as never);
    app.decorate('queues', {
      orderProcessing: {
        getJobCounts: vi.fn(async () => ({ waiting: 10, active: 0 })),
        getWaiting: vi.fn(async () => ([{ timestamp: now - 999_000 }]))
      }
    } as never);
    process.env.HEALTH_QUEUE_STALE_WAITING_SECONDS = '300';
    await registerHealthRoutes(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(response.statusCode).toBe(503);
    const payload = response.json() as {
      data?: { status: string; runtimeConfigMissingKeys?: string[] };
      error: { code: string; message: string; details: { fields?: Array<{ field: string }> } };
    };
    expect(payload.error.code).toBe('CONFIG_NOT_READY');
    expect(payload.error.message).toContain('Readiness check failed');
    expect(payload.data?.status).toBe('not_ready');
    expect(Array.isArray(payload.error.details.fields)).toBe(true);

    await app.close();
  });
});
