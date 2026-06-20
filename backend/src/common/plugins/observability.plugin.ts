import { FastifyInstance } from 'fastify';
import { timingSafeEqual, createHmac, randomUUID } from 'crypto';
import { mkdir, appendFile } from 'fs/promises';
import path from 'path';
import { getMetricsContentType, getMetricsSnapshot, recordHttpRequest } from '@common/observability/metrics';
import { errorDetailsSchema } from '@common/errors/error-response.schema';
import { Prisma, Role } from '@prisma/client';
import { ERROR_CODES } from '@common/errors/error-codes';
import { parseWebhookIpAllowlist, resolveSecurityClientIp } from '@common/security/webhook-allowlist';
import { opsAuthGuard } from '@common/guards/ops-auth.guard';
import { opsPermissionGuard } from '@common/guards/ops-permissions.guard';
import { sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';

function sanitizeSummary(value: unknown, depth = 0): unknown {
  if (depth > 3) {
    return '[TRUNCATED_DEPTH]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeSummary(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const sensitive = /password|secret|token|signature|authorization|cookie|key/i;
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sensitive.test(key) ? '[REDACTED]' : sanitizeSummary(raw, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 400) {
    return `${value.slice(0, 400)}...[TRUNCATED]`;
  }
  return value;
}

function secureEquals(left: string | undefined, right: string): boolean {
  if (!left) {
    return false;
  }
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

async function appendAdminAuditAnchor(
  fastify: FastifyInstance,
  payload: {
    id: string;
    adminUserId: string;
    action: string;
    createdAt: string;
    correlationId?: string;
  }
): Promise<void> {
  const secret = process.env.AUDIT_ANCHOR_SECRET?.trim() || process.env.JWT_SECRET?.trim();
  if (!secret) {
    return;
  }
  const lockKey = 'audit:admin:chain:lock';
  const lockToken = randomUUID();
  const lockWaitTimeoutMs = 2_000;
  const lockTtlMs = 5_000;
  const lockRetryDelayMs = 50;
  const startedAt = Date.now();

  while (true) {
    const acquired = await fastify.redis.set(lockKey, lockToken, 'PX', lockTtlMs, 'NX');
    if (acquired === 'OK') {
      break;
    }
    if (Date.now() - startedAt >= lockWaitTimeoutMs) {
      throw new Error('Timed out acquiring admin audit chain lock');
    }
    await new Promise((resolve) => setTimeout(resolve, lockRetryDelayMs));
  }

  let previousHash = 'GENESIS';
  let hash = '';
  const body = JSON.stringify(payload);
  try {
    previousHash = (await fastify.redis.get('audit:admin:last_hash')) ?? 'GENESIS';
    hash = createHmac('sha256', secret).update(`${previousHash}:${body}`).digest('hex');
    await fastify.redis.set('audit:admin:last_hash', hash);
  } finally {
    await fastify.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey,
      lockToken
    );
  }

  const dir = path.join(process.cwd(), 'artifacts', 'audit');
  await mkdir(dir, { recursive: true });
  try {
    await appendFile(
      path.join(dir, 'admin-audit-chain.log'),
      `${JSON.stringify({ previousHash, hash, body })}\n`,
      'utf8'
    );
  } catch (fileErr) {
    // Redis chain-head was already updated; log divergence so operators can reconcile.
    fastify.log.error(
      { err: fileErr, hash, previousHash },
      'audit-chain: Redis updated but file append failed — manual reconciliation required'
    );
    await sendTechnicalFailureAlert({
      prisma: fastify.prisma,
      template: 'AuditChainAppend',
      channel: 'UNKNOWN',
      recipient: 'audit-chain',
      errorMessage: fileErr instanceof Error ? fileErr.message : String(fileErr),
      failureStage: 'CORE_LOGIC',
      domain: 'observability',
      component: 'admin-audit-chain'
    });
  }
}

export async function registerObservabilityPlugin(fastify: FastifyInstance): Promise<void> {
  let trustedProxyRules: ReturnType<typeof parseWebhookIpAllowlist>;
  try {
    trustedProxyRules = parseWebhookIpAllowlist(process.env.TRUSTED_PROXY_ALLOWLIST_CIDR);
  } catch (error) {
    throw new Error(
      `Invalid trusted proxy CIDR configuration: ${
        error instanceof Error ? error.message : 'unknown parse error'
      }`
    );
  }
  fastify.addHook('onRequest', async (request) => {
    (request as { startedAtMs?: number }).startedAtMs = Date.now();
    const correlationHeader = request.headers['x-correlation-id'];
    const correlationId =
      (Array.isArray(correlationHeader) ? correlationHeader[0] : correlationHeader)?.trim() || request.id;
    (request as { correlationId?: string }).correlationId = correlationId;
    const traceHeader = request.headers['x-trace-id'];
    const traceId = (Array.isArray(traceHeader) ? traceHeader[0] : traceHeader)?.trim() || correlationId;
    (request as { traceId?: string }).traceId = traceId;
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const startedAtMs = (request as { startedAtMs?: number }).startedAtMs ?? Date.now();
    const correlationId = (request as { correlationId?: string }).correlationId;
    const traceId = (request as { traceId?: string }).traceId;
    const policyDecision = request.adminControlDecision;
    if (correlationId) {
      reply.header('x-correlation-id', correlationId);
    }
    if (traceId) {
      reply.header('x-trace-id', traceId);
    }
    if (policyDecision) {
      reply.header('x-admin-control-layer', policyDecision.layer);
      reply.header('x-admin-control-role', policyDecision.role);
    }
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    recordHttpRequest({
      method: request.method,
      route: typeof request.routeOptions.url === 'string' ? request.routeOptions.url : request.url,
      statusCode: reply.statusCode,
      durationMs
    });

    const route = typeof request.routeOptions.url === 'string' ? request.routeOptions.url : request.url;
    const isAdminMutation = route.startsWith('/api/v1/admin/') && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);
    const actor = request.user;
    if (isAdminMutation && actor?.role === Role.ADMIN && fastify.hasDecorator('prisma')) {
      const params = (request.params ?? {}) as Record<string, unknown>;
      const inferredResourceId =
        typeof params.id === 'string'
          ? params.id
          : typeof params.variantId === 'string'
            ? params.variantId
            : undefined;

      try {
        const created = await fastify.prisma.adminAuditLog.create({
          data: {
            adminUserId: actor.sub,
            action: `${request.method} ${route}`,
            resourceType: route.split('/')[4] ?? 'admin',
            ...(inferredResourceId ? { resourceId: inferredResourceId } : {}),
            ...(correlationId ? { correlationId } : {}),
            requestPath: request.url,
            method: request.method,
            outcome: reply.statusCode >= 400 ? 'ERROR' : 'SUCCESS',
            statusCode: reply.statusCode,
            summary: sanitizeSummary({
              params: request.params,
              query: request.query,
              body: request.body,
              controlDecision: policyDecision
            }) as Prisma.InputJsonValue
          }
        });
        await appendAdminAuditAnchor(fastify, {
          id: created.id,
          adminUserId: created.adminUserId,
          action: created.action,
          createdAt: created.createdAt.toISOString(),
          ...(created.correlationId ? { correlationId: created.correlationId } : {})
        });
      } catch (error) {
        void sendTechnicalFailureAlert({
          prisma: fastify.prisma,
          template: 'AdminAuditEntryPersist',
          channel: 'UNKNOWN',
          recipient: 'admin-audit-log',
          errorMessage: error instanceof Error ? error.message : String(error),
          failureStage: 'CORE_LOGIC',
          domain: 'observability',
          component: 'admin-audit-persist'
        });
        fastify.log.warn(
          { error: error instanceof Error ? error.message : String(error), route },
          'Failed to persist admin audit entry'
        );
      }
    }
  });

  fastify.get('/api/v1/ops/metrics', {
    preHandler: async (request, reply) => {
      const allowlist = (process.env.OPS_METRICS_ALLOWLIST ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const opsToken = process.env.OPS_METRICS_TOKEN?.trim();
      const resolvedClientIp = resolveSecurityClientIp({
        directRemoteIp: request.raw.socket.remoteAddress ?? null,
        derivedRequestIp: request.ip,
        trustedProxyRules
      });
      const tokenHeader = request.headers['x-ops-token'];
      const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
      const isProduction = process.env.NODE_ENV === 'production';

      const allowlisted = Boolean(resolvedClientIp && allowlist.includes(resolvedClientIp));
      const tokenMatched = Boolean(opsToken && secureEquals(token, opsToken));
      const hasTokenOrAllowlistAccess = isProduction ? (allowlisted && tokenMatched) : (allowlisted || tokenMatched);
      if (hasTokenOrAllowlistAccess) {
        return;
      }

      try {
        // Allow authenticated ops UI users (cookie session) to view metrics from /ops route.
        await opsAuthGuard(request, reply);
        await opsPermissionGuard('ops:read')(request, reply);
        return;
      } catch {
        reply.code(403);
        return reply.send({
          success: false,
          error: {
            code: ERROR_CODES.FORBIDDEN,
            message: 'Metrics endpoint is restricted',
            statusCode: 403,
            details: {
              kind: 'permission',
              hintKey: 'ops_metrics_restricted',
              retryable: false,
              retryAfterSeconds: null,
              remediation: isProduction
                ? 'Use a valid x-ops-token from a trusted ops network or an authenticated ops session.'
                : 'Use an allowlisted source, valid x-ops-token, or an authenticated ops session.'
            }
          }
        });
      }
    },
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        properties: {}
      },
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {}
      },
      response: {
        200: { type: 'string', maxLength: 5000000 },
        403: {
          type: 'object',
          additionalProperties: false,
          required: ['success', 'error'],
          properties: {
            success: { type: 'boolean' },
            error: {
              type: 'object',
              additionalProperties: false,
              required: ['code', 'message', 'statusCode', 'details'],
              properties: {
                code: { type: 'string', maxLength: 64 },
                message: { type: 'string', maxLength: 200 },
                statusCode: { type: 'integer', minimum: 400, maximum: 599 },
                details: errorDetailsSchema
              }
            }
          }
        }
      }
    }
  }, async (_request, reply) => {
    reply.header('content-type', getMetricsContentType());
    return reply.send(await getMetricsSnapshot());
  });
}
