import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const metricsState = vi.hoisted(() => ({
  getMetricsContentType: vi.fn(() => 'text/plain; version=0.0.4'),
  getMetricsSnapshot: vi.fn(async () => 'demo_metric_total 1'),
  recordHttpRequest: vi.fn()
}));

vi.mock('@common/observability/metrics', () => ({
  getMetricsContentType: metricsState.getMetricsContentType,
  getMetricsSnapshot: metricsState.getMetricsSnapshot,
  recordHttpRequest: metricsState.recordHttpRequest
}));

vi.mock('@common/security/webhook-allowlist', () => ({
  parseWebhookIpAllowlist: vi.fn(() => []),
  resolveSecurityClientIp: vi.fn(() => '127.0.0.1')
}));

import { ERROR_CODES } from '@common/errors/error-codes';
import { registerObservabilityPlugin } from './observability.plugin';

describe('registerObservabilityPlugin metrics route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 403 in production when ops token is missing/invalid', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OPS_METRICS_TOKEN', 'ops-secret');

    const app = Fastify();
    await registerObservabilityPlugin(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/ops/metrics' });

    expect(response.statusCode).toBe(403);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.FORBIDDEN);

    await app.close();
  });

  it('returns metrics snapshot in production when token is valid and IP is allowlisted', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OPS_METRICS_TOKEN', 'ops-secret');
    vi.stubEnv('OPS_METRICS_ALLOWLIST', '127.0.0.1');

    const app = Fastify();
    await registerObservabilityPlugin(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ops/metrics',
      headers: {
        'x-ops-token': 'ops-secret'
      },
      remoteAddress: '127.0.0.1'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('demo_metric_total 1');
    expect(response.headers['content-type']).toContain('text/plain');
    expect(metricsState.getMetricsSnapshot).toHaveBeenCalledTimes(1);
    expect(metricsState.recordHttpRequest).toHaveBeenCalled();

    await app.close();
  });
});
