import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

type WrappedSuccess<T> = {
  success: true;
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

function extractPaginationMeta(payload: unknown): WrappedSuccess<unknown>['meta'] | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const record = payload as { meta?: unknown };
  if (!record.meta || typeof record.meta !== 'object') {
    return undefined;
  }
  const meta = record.meta as Record<string, unknown>;
  const page = meta.page;
  const limit = meta.limit;
  const total = meta.total;
  const totalPages = meta.totalPages;
  if (
    typeof page === 'number' &&
    typeof limit === 'number' &&
    typeof total === 'number' &&
    typeof totalPages === 'number'
  ) {
    return { page, limit, total, totalPages };
  }
  return undefined;
}

function tryParseJson(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return undefined;
  }
}

function isAlreadyWrapped(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  if (!('success' in payload)) {
    return false;
  }

  const candidate = payload as { success?: unknown };
  return typeof candidate.success === 'boolean';
}

export async function registerResponseEnvelopeHook(fastify: FastifyInstance): Promise<void> {
  fastify.addHook(
    'onSend',
    async (request: FastifyRequest, reply: FastifyReply, payload: string) => {
      if (reply.statusCode >= 400) {
        return payload;
      }

      const contentType = reply.getHeader('content-type');
      if (typeof contentType !== 'string' || !contentType.includes('application/json')) {
        return payload;
      }

      const parsedPayload = tryParseJson(payload);
      if (isAlreadyWrapped(parsedPayload)) {
        return payload;
      }

      const wrappedPayload: WrappedSuccess<unknown> = {
        success: true,
        data: parsedPayload
      };
      const paginationMeta = extractPaginationMeta(parsedPayload);
      if (paginationMeta) {
        if (
          parsedPayload &&
          typeof parsedPayload === 'object' &&
          'items' in (parsedPayload as Record<string, unknown>)
        ) {
          wrappedPayload.data = (parsedPayload as { items: unknown }).items;
        }
        wrappedPayload.meta = paginationMeta;
      }

      void request;
      return JSON.stringify(wrappedPayload);
    }
  );
}

