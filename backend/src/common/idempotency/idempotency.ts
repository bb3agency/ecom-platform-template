import { createHash, createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { recordIdempotencyHit } from '@common/observability/metrics';
import { redactSensitiveData } from '@common/security/redaction';

const IDEMPOTENCY_TTL_HOURS = 24;
const IDEMPOTENCY_HEADER = 'idempotency-key';

function toJsonString(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function buildHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function buildScopeFingerprint(scope: string): string {
  const salt = process.env.IDEMPOTENCY_SCOPE_SECRET ?? process.env.JWT_SECRET ?? 'idempotency-scope-default';
  return createHmac('sha256', salt).update(scope).digest('hex');
}

function getScopeKey(request: FastifyRequest): string {
  if (request.user?.sub) {
    return `user:${buildScopeFingerprint(request.user.sub)}`;
  }
  const cartCookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('cart_session='))
    ?.replace('cart_session=', '')
    .trim();
  if (cartCookie && cartCookie.length > 0) {
    return `cart:${buildScopeFingerprint(decodeURIComponent(cartCookie))}`;
  }
  return `anon:${buildScopeFingerprint(request.ip)}`;
}

function getRouteTemplate(request: FastifyRequest): string {
  return typeof request.routeOptions.url === 'string' ? request.routeOptions.url : request.url;
}

function getIdempotencyKeyHeader(request: FastifyRequest): string | null {
  const header = request.headers[IDEMPOTENCY_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) {
    return null;
  }
  const key = raw.trim();
  if (key.length === 0) {
    return null;
  }
  if (key.length > 128) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Idempotency-Key must be 1-128 characters', 400);
  }
  return key;
}

function buildExpiryDate(): Date {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + IDEMPOTENCY_TTL_HOURS);
  return expiresAt;
}

type IdempotencyDelegate = {
  findUnique: (args: {
    where: {
      scopeKey_route_method_idempotencyKey: {
        scopeKey: string;
        route: string;
        method: string;
        idempotencyKey: string;
      };
    };
  }) => Promise<{
    id: string;
    requestHash: string;
    status: 'PROCESSING' | 'FAILED' | 'COMPLETED';
    responsePayload: Prisma.JsonValue | null;
    responseStatus: number | null;
  } | null>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  updateMany?: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
  create?: (args: {
    data: Record<string, unknown>;
    select: { id: true };
  }) => Promise<{ id: string }>;
  upsert?: (args: {
    where: {
      scopeKey_route_method_idempotencyKey: {
        scopeKey: string;
        route: string;
        method: string;
        idempotencyKey: string;
      };
    };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<{ id: string }>;
};

export async function idempotencyPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const delegate = request.server.prisma.idempotencyRecord as unknown as IdempotencyDelegate;
  const idempotencyKey = getIdempotencyKeyHeader(request);
  if (!idempotencyKey) {
    return;
  }

  const route = getRouteTemplate(request);
  const method = request.method.toUpperCase();
  const scopeKey = getScopeKey(request);
  const requestHash = buildHash(toJsonString(request.body));
  const existing = await delegate.findUnique({
    where: {
      scopeKey_route_method_idempotencyKey: {
        scopeKey,
        route,
        method,
        idempotencyKey
      }
    }
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      recordIdempotencyHit(route, 'mismatch');
      throw new AppError(ERROR_CODES.CONFLICT, 'Idempotency-Key payload mismatch', 409);
    }

    if (existing.status === 'PROCESSING') {
      recordIdempotencyHit(route, 'inflight');
      throw new AppError(ERROR_CODES.CONFLICT, 'Request with this Idempotency-Key is already processing', 409);
    }

    if (existing.status === 'FAILED') {
      // Failed attempts can be retried with same key and same payload safely.
      // CAS guard prevents concurrent retries from both transitioning to PROCESSING.
      if (delegate.updateMany) {
        const retryResult = await delegate.updateMany({
          where: {
            id: existing.id,
            status: 'FAILED'
          },
          data: {
            status: 'PROCESSING',
            responsePayload: Prisma.JsonNull,
            responseStatus: null,
            expiresAt: buildExpiryDate()
          }
        });
        if (retryResult.count === 0) {
          throw new AppError(ERROR_CODES.CONFLICT, 'Request with this Idempotency-Key is already processing', 409);
        }
      } else {
        await delegate.update({
          where: { id: existing.id },
          data: {
            status: 'PROCESSING',
            responsePayload: Prisma.JsonNull,
            responseStatus: null,
            expiresAt: buildExpiryDate()
          }
        });
      }
      request.idempotencyContext = {
        id: existing.id,
        route
      };
      return;
    }

    if (existing.status === 'COMPLETED' && existing.responsePayload) {
      recordIdempotencyHit(route, 'replayed');
      reply.header('Idempotent-Replayed', 'true');
      reply.code(existing.responseStatus ?? 200).send(existing.responsePayload as object);
      return;
    }
  }

  let created: { id: string };
  try {
    if (delegate.create) {
      created = await delegate.create({
        data: {
          scopeKey,
          route,
          method,
          idempotencyKey,
          requestHash,
          status: 'PROCESSING',
          expiresAt: buildExpiryDate()
        },
        select: { id: true }
      });
    } else if (delegate.upsert) {
      created = await delegate.upsert({
        where: {
          scopeKey_route_method_idempotencyKey: {
            scopeKey,
            route,
            method,
            idempotencyKey
          }
        },
        create: {
          scopeKey,
          route,
          method,
          idempotencyKey,
          requestHash,
          status: 'PROCESSING',
          expiresAt: buildExpiryDate()
        },
        update: {
          requestHash,
          status: 'PROCESSING',
          responsePayload: Prisma.JsonNull,
          responseStatus: null,
          expiresAt: buildExpiryDate()
        }
      });
    } else {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Idempotency delegate does not support create/upsert', 500);
    }
  } catch (error) {
    const errorRecord = error as { code?: string; message?: string };
    const isUniqueViolation =
      errorRecord.code === 'P2002' ||
      (typeof errorRecord.message === 'string' && errorRecord.message.includes('Unique constraint failed'));
    if (!isUniqueViolation) {
      throw error;
    }

    const concurrent = await delegate.findUnique({
      where: {
        scopeKey_route_method_idempotencyKey: {
          scopeKey,
          route,
          method,
          idempotencyKey
        }
      }
    });
    if (!concurrent) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Idempotency record changed concurrently', 409);
    }

    if (concurrent.requestHash !== requestHash) {
      recordIdempotencyHit(route, 'mismatch');
      throw new AppError(ERROR_CODES.CONFLICT, 'Idempotency-Key payload mismatch', 409);
    }

    if (concurrent.status === 'PROCESSING') {
      recordIdempotencyHit(route, 'inflight');
      throw new AppError(ERROR_CODES.CONFLICT, 'Request with this Idempotency-Key is already processing', 409);
    }

    if (concurrent.status === 'FAILED') {
      if (delegate.updateMany) {
        const retryResult = await delegate.updateMany({
          where: {
            id: concurrent.id,
            status: 'FAILED'
          },
          data: {
            status: 'PROCESSING',
            responsePayload: Prisma.JsonNull,
            responseStatus: null,
            expiresAt: buildExpiryDate()
          }
        });
        if (retryResult.count === 0) {
          throw new AppError(ERROR_CODES.CONFLICT, 'Request with this Idempotency-Key is already processing', 409);
        }
      } else {
        await delegate.update({
          where: { id: concurrent.id },
          data: {
            status: 'PROCESSING',
            responsePayload: Prisma.JsonNull,
            responseStatus: null,
            expiresAt: buildExpiryDate()
          }
        });
      }
      request.idempotencyContext = {
        id: concurrent.id,
        route
      };
      return;
    }

    if (concurrent.status === 'COMPLETED' && concurrent.responsePayload) {
      recordIdempotencyHit(route, 'replayed');
      reply.header('Idempotent-Replayed', 'true');
      reply.code(concurrent.responseStatus ?? 200).send(concurrent.responsePayload as object);
      return;
    }

    throw new AppError(ERROR_CODES.CONFLICT, 'Request with this Idempotency-Key is already processing', 409);
  }

  request.idempotencyContext = {
    id: created.id,
    route
  };
}

function parseJsonPayload(payload: string): Prisma.InputJsonValue {
  try {
    return JSON.parse(payload) as Prisma.InputJsonValue;
  } catch {
    return payload as Prisma.InputJsonValue;
  }
}

export async function idempotencyOnSend(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown
): Promise<void> {
  if (!request.idempotencyContext) {
    return;
  }

  const statusCode = reply.statusCode;
  const parsedPayload =
    typeof payload === 'string'
      ? parseJsonPayload(payload)
      : (payload as Prisma.InputJsonValue | null) ?? Prisma.JsonNull;
  const sanitizedPayload = redactSensitiveData(parsedPayload) as Prisma.InputJsonValue;
  await request.server.prisma.idempotencyRecord.update({
    where: { id: request.idempotencyContext.id },
    data: {
      status: statusCode >= 500 ? 'FAILED' : 'COMPLETED',
      responseStatus: statusCode,
      responsePayload: sanitizedPayload,
      expiresAt: buildExpiryDate()
    }
  });
}
