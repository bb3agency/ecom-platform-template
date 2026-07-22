import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as metricsModule from '@common/observability/metrics';

import { AppError } from './app-error';
import { ERROR_CODES } from './error-codes';
import { registerGlobalErrorHandler } from './error-handler';
import { standardErrorResponses } from './error-response.schema';

describe('global error handler', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('keeps LOCAL_DELIVERY_ONLY_UNAVAILABLE details through response-schema serialization', async () => {
    // Regression guard: errorDetailsSchema is additionalProperties:false, so any detail field
    // that is not declared there is SILENTLY stripped when a route attaches the standard error
    // responses. The storefront renders `products` as the "remove these items" list, so losing
    // it would leave the customer with an empty, useless modal.
    const app = Fastify();
    await registerGlobalErrorHandler(app);

    app.get(
      '/api/v1/cart/delivery-rates',
      { schema: { response: { ...standardErrorResponses } } },
      async () => {
        throw new AppError(
          ERROR_CODES.LOCAL_DELIVERY_ONLY_UNAVAILABLE,
          'Some items are local delivery only',
          422,
          {
            pincode: '999999',
            products: [
              {
                variantId: 'v1',
                productName: 'Fresh Greens',
                variantName: 'Default',
                sku: 'SKU-1'
              }
            ]
          }
        );
      }
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/cart/delivery-rates' });

    expect(response.statusCode).toBe(422);
    const body = response.json() as {
      error: {
        code: string;
        details: { pincode: string; products: Array<{ productName: string; sku: string }> };
      };
    };
    expect(body.error.code).toBe(ERROR_CODES.LOCAL_DELIVERY_ONLY_UNAVAILABLE);
    expect(body.error.details.pincode).toBe('999999');
    expect(body.error.details.products).toHaveLength(1);
    expect(body.error.details.products[0]?.productName).toBe('Fresh Greens');

    await app.close();
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

  it('sanitizes 502s: keeps the crafted message but drops kind/hintKey and details spread', async () => {
    const app = Fastify();
    await registerGlobalErrorHandler(app);

    app.get('/api/v1/upstream-502', async () => {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Unable to initiate payment order', 502, {
        kind: 'dependency',
        hintKey: 'razorpay_down',
        providerResponse: { secret: 'raw-provider-dump' }
      });
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/upstream-502' });

    expect(response.statusCode).toBe(502);
    const body = response.json() as {
      error: { message: string; details: Record<string, unknown> };
    };
    // In-house crafted message is kept (useful to callers, contains nothing internal)…
    expect(body.error.message).toBe('Unable to initiate payment order');
    // …but classification fields and the throw-site details object never leave the server.
    expect(body.error.details).not.toHaveProperty('kind');
    expect(body.error.details).not.toHaveProperty('hintKey');
    expect(JSON.stringify(body)).not.toContain('raw-provider-dump');
  });

  it('preserves the 503 contract (message + hintKey retry guidance for ops/admin UIs)', async () => {
    const app = Fastify();
    await registerGlobalErrorHandler(app);

    app.get('/api/v1/lock-timeout', async () => {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Timed out acquiring ops audit chain lock', 503, {
        kind: 'transient',
        hintKey: 'ops_audit_chain_lock_timeout',
        retryable: true,
        retryAfterSeconds: 1,
        remediation: 'Retry the operation.'
      });
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/lock-timeout' });

    expect(response.statusCode).toBe(503);
    const body = response.json() as { error: { details: Record<string, unknown> } };
    expect(body.error.details.hintKey).toBe('ops_audit_chain_lock_timeout');
    expect(body.error.details.retryAfterSeconds).toBe(1);
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
