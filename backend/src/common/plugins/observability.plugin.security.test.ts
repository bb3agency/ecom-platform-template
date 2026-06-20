import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerObservabilityPlugin } from './observability.plugin';

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  OPS_METRICS_ALLOWLIST: process.env.OPS_METRICS_ALLOWLIST,
  OPS_METRICS_TOKEN: process.env.OPS_METRICS_TOKEN
};

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerObservabilityPlugin(app);
  return app;
}

afterEach(async () => {
  vi.restoreAllMocks();
  process.env.NODE_ENV = originalEnv.NODE_ENV;
  process.env.OPS_METRICS_ALLOWLIST = originalEnv.OPS_METRICS_ALLOWLIST;
  process.env.OPS_METRICS_TOKEN = originalEnv.OPS_METRICS_TOKEN;
});

describe('observability metrics endpoint guards', () => {
  it('denies metrics access without allowlist or token', async () => {
    process.env.OPS_METRICS_ALLOWLIST = '';
    process.env.OPS_METRICS_TOKEN = 'ops-secret';
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ops/metrics'
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.error?.details?.hintKey).toBe('ops_metrics_restricted');
    await app.close();
  });

  it('allows metrics access with matching ops token', async () => {
    process.env.OPS_METRICS_ALLOWLIST = '';
    process.env.OPS_METRICS_TOKEN = 'ops-secret';
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ops/metrics',
      headers: {
        'x-ops-token': 'ops-secret'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    await app.close();
  });

  it('allows metrics access from allowlisted ip', async () => {
    process.env.NODE_ENV = 'development';
    process.env.OPS_METRICS_ALLOWLIST = '127.0.0.1';
    process.env.OPS_METRICS_TOKEN = '';
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ops/metrics'
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('requires valid ops token in production even for allowlisted ip', async () => {
    process.env.NODE_ENV = 'production';
    process.env.OPS_METRICS_ALLOWLIST = '127.0.0.1';
    process.env.OPS_METRICS_TOKEN = 'ops-secret';
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ops/metrics'
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
