import rateLimit from '@fastify/rate-limit';
import { FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@common/errors/error-codes';
import { recordCheckoutPath } from '@common/observability/metrics';
import {
  baseRateLimitWindow,
  rateLimitKeyGenerator,
  resolveRateLimitMax,
  resolveRateLimitTier
} from '@common/rate-limit/rate-limit-policies';

export async function registerRateLimitPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(rateLimit, {
    hook: 'preHandler',
    max: (request) => resolveRateLimitMax(request),
    timeWindow: baseRateLimitWindow,
    keyGenerator: rateLimitKeyGenerator,
    continueExceeding: false,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true
    },
    onExceeded: (request, key) => {
      const tier = resolveRateLimitTier(request);
      const route = typeof request.routeOptions.url === 'string' ? request.routeOptions.url : request.url;
      if (
        route === '/api/v1/orders' ||
        route === '/api/v1/orders/:id/cancel' ||
        route === '/api/v1/payments/initiate' ||
        route === '/api/v1/payments/verify'
      ) {
        recordCheckoutPath(route, 'failure');
      }
      if (tier === 'admin' || tier === 'checkout' || tier === 'auth') {
        fastify.log.warn(
          {
            tier,
            key,
            method: request.method,
            path: request.routeOptions.url,
            ip: request.ip,
            userAgent: request.headers['user-agent']
          },
          'Rate limit exceeded'
        );
      }
    },
    errorResponseBuilder: (_request, context) => ({
      success: false,
      error: {
        code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
        message: 'Rate limit exceeded',
        statusCode: 429,
        details: {
          kind: 'transient',
          hintKey: 'rate_limit_exceeded',
          retryable: true,
          retryAfterSeconds: context.ttl,
          remediation: 'Wait and retry with exponential backoff and jitter.'
        }
      }
    })
  });
}

