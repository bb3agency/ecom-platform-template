import { FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@common/errors/error-codes';
import { healthLivenessSchema, healthReadinessSchema, healthRouteSchema } from './health.schemas';
import { HealthService } from './health.service';

export async function registerHealthRoutes(fastify: FastifyInstance): Promise<void> {
  const healthService = new HealthService(fastify);

  fastify.get(
    '/api/v1/health',
    {
      schema: healthRouteSchema
    },
    async (_request, reply) => {
      const payload = await healthService.check();
      const isHealthy = payload.database === 'connected' && payload.redis === 'connected';

      if (!isHealthy) {
        return reply.code(503).send({
          success: false,
          error: {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: 'Health check failed: one or more dependencies are unavailable',
            statusCode: 503,
            details: {
              kind: 'dependency',
              hintKey: 'health_dependency_unavailable',
              retryable: true,
              retryAfterSeconds: 30,
              remediation: 'Restore database/redis connectivity and retry.'
            }
          }
        });
      }

      return payload;
    }
  );

  fastify.get(
    '/api/v1/health/live',
    {
      schema: healthLivenessSchema
    },
    async () => healthService.checkLiveness()
  );

  fastify.get(
    '/api/v1/health/ready',
    {
      schema: healthReadinessSchema
    },
    async (_request, reply) => {
      const payload = await healthService.checkReadiness();
      if (payload.status !== 'ready') {
        const runtimeMissingFields = payload.runtimeConfigMissingKeys.map((key) => ({
          field: key,
          rule: 'runtime_required_before_launch',
          message: `${key} must be configured in Ops runtime overlay before go-live`
        }));
        return reply.code(503).send({
          success: false,
          data: payload,
          error: {
            code: ERROR_CODES.CONFIG_NOT_READY,
            message: 'Readiness check failed: dependencies, queue freshness, or runtime config are not ready',
            statusCode: 503,
            details: {
              kind: 'dependency',
              hintKey: 'readiness_not_ready',
              retryable: true,
              retryAfterSeconds: 15,
              remediation: 'Inspect dependency status, queue worker freshness, and runtime config completeness.',
              fields: runtimeMissingFields
            }
          }
        });
      }
      return payload;
    }
  );
}

