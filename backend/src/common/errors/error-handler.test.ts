import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as metricsModule from '@common/observability/metrics';

import { AppError } from './app-error';
import { ERROR_CODES } from './error-codes';
import { registerGlobalErrorHandler } from './error-handler';

describe('global error handler', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('maps AppError responses and sets Retry-After for 429', async () => {
    const recordCheckoutPathSpy = vi.spyOn(metricsModule, 'recordCheckoutPath').mockReturnValue(undefined);

    const app = Fastify();
    await registerGlobalErrorHandler(app);

    app.get('/api/v1/orders', async () => {
      throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many attempts', 429, {
        retryAfterSeconds: 12
      });
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/orders' });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('12');
    const body = response.json() as { error: { code: string; details: { retryAfterSeconds: number } } };
    expect(body.error.code).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
    expect(body.error.details.retryAfterSeconds).toBe(12);
    expect(recordCheckoutPathSpy).toHaveBeenCalledWith('/api/v1/orders', 'failure');

    await app.close();
  });

  it('maps schema validation failures to VALIDATION_ERROR', async () => {
    const app = Fastify();
    await registerGlobalErrorHandler(app);

    app.post(
      '/api/v1/test-validation',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name'],
            additionalProperties: false,
            properties: {
              name: { type: 'string' }
            }
          }
        }
      },
      async () => ({ ok: true })
    );

    const response = await app.inject({ method: 'POST', url: '/api/v1/test-validation', payload: {} });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(body.error.message).toBe('Request validation failed');

    await app.close();
  });

  it('maps unexpected errors to INTERNAL_ERROR', async () => {
    const app = Fastify();
    await registerGlobalErrorHandler(app);

    app.get('/api/v1/unexpected', async () => {
      throw new Error('boom');
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/unexpected' });

    expect(response.statusCode).toBe(500);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(body.error.message).toBe('Internal server error');

    await app.close();
  });
});
