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

  it('maps unexpected errors to a GENERIC 500 with no internal classification fields', async () => {
    const app = Fastify();
    await registerGlobalErrorHandler(app);

    app.get('/api/v1/unexpected', async () => {
      throw new Error('boom: db password xyz leaked in message');
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/unexpected' });

    expect(response.statusCode).toBe(500);
    const body = response.json() as {
      error: { code: string; message: string; details: Record<string, unknown> };
    };
    expect(body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    // Generic body only — never the throw-site message.
    expect(body.error.message).toBe('Something went wrong. Please try again later.');
    expect(body.error.message).not.toContain('boom');
    // Internal classification fields are logged server-side, never sent to callers.
    expect(body.error.details).not.toHaveProperty('kind');
    expect(body.error.details).not.toHaveProperty('hintKey');
    expect(body.error.details).toMatchObject({ retryable: true });

    await app.close();
  });

  it('sanitizes 500-class AppErrors: generic body to callers, full detail logged server-side', async () => {
    const app = Fastify();
    const logged: unknown[] = [];
    await registerGlobalErrorHandler(app);
    app.log.error = ((obj: unknown, msg?: string) => {
      logged.push({ obj, msg });
    }) as typeof app.log.error;

    app.get('/api/v1/internal-app-error', async () => {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Razorpay secret rejected: key rzp_live_abc', 500, {
        kind: 'dependency',
        hintKey: 'razorpay_auth_failed',
        provider: 'razorpay'
      });
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/internal-app-error' });

    expect(response.statusCode).toBe(500);
    const body = response.json() as {
      error: { code: string; message: string; details: Record<string, unknown> };
    };
    expect(body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(body.error.message).toBe('Something went wrong. Please try again later.');
    // Neither the throw-site message nor ANY of its details may reach the caller.
    expect(JSON.stringify(body)).not.toContain('Razorpay');
    expect(body.error.details).not.toHaveProperty('kind');
    expect(body.error.details).not.toHaveProperty('hintKey');
    expect(body.error.details).not.toHaveProperty('provider');
    // The full detail IS logged server-side.
    expect(JSON.stringify(logged)).toContain('razorpay_auth_failed');

    await app.close();
  });

  it('keeps kind/hintKey on 4xx responses (client contract unchanged)', async () => {
    const app = Fastify();
    await registerGlobalErrorHandler(app);

    app.get('/api/v1/business-rule', async () => {
      throw new AppError(ERROR_CODES.CONFLICT, 'Already exists', 409, {
        kind: 'business_rule',
        hintKey: 'duplicate_thing'
      });
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/business-rule' });

    expect(response.statusCode).toBe(409);
    const body = response.json() as { error: { details: Record<string, unknown> } };
    expect(body.error.details.kind).toBe('business_rule');
    expect(body.error.details.hintKey).toBe('duplicate_thing');

    await app.close();
  });
});
