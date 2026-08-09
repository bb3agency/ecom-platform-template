import { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './app-error';
import { ERROR_CODES } from './error-codes';
import { recordCheckoutPath } from '@common/observability/metrics';
import { redactSensitiveData } from '@common/security/redaction';
import { sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';

type ValidationError = FastifyError & {
  validation?: unknown;
};

function isValidationError(error: ValidationError): boolean {
  return error.validation !== undefined;
}

function maybeTrackCheckoutFailure(request: FastifyRequest): void {
  const route = typeof request.routeOptions.url === 'string' ? request.routeOptions.url : request.url;
  if (
    route === '/api/v1/orders' ||
    route === '/api/v1/orders/:id/cancel' ||
    route === '/api/v1/payments/initiate' ||
    route === '/api/v1/payments/verify'
  ) {
    recordCheckoutPath(route, 'failure');
  }
}

function sanitizeUnexpectedError(error: ValidationError): Record<string, unknown> {
  const isProd = process.env.NODE_ENV === 'production';
  const statusCode = typeof error.statusCode === 'number' ? error.statusCode : undefined;
  return {
    name: error.name,
    message: error.message,
    ...(statusCode ? { statusCode } : {}),
    ...(error.code ? { code: error.code } : {}),
    ...(isProd ? {} : { stack: error.stack })
  };
}

/**
 * Safe, actionable message for a CLIENT-fault error raised by Fastify itself or a
 * plugin (multipart, content-type parsers). These carry an accurate 4xx statusCode
 * but are not AppErrors, so before this mapping existed they fell through to the
 * generic 500 — turning "file too large" or "unsupported media type" into an
 * untraceable "Something went wrong" with a false internal-outage alert.
 * Whitelisted codes only; anything unrecognized gets a neutral sentence (never the
 * framework's raw message, which can name internal limits/paths).
 */
function frameworkClientErrorMessage(error: ValidationError): string {
  switch (error.code) {
    case 'FST_REQ_FILE_TOO_LARGE':
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return 'The uploaded file is too large. Choose a smaller file and try again.';
    case 'FST_PARTS_LIMIT':
    case 'FST_FILES_LIMIT':
    case 'FST_FIELDS_LIMIT':
      return 'Too many parts in the upload. Send a single file and try again.';
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return 'Unsupported content type for this endpoint.';
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return 'The request body could not be parsed.';
    default:
      return 'The request could not be processed. Review the request and try again.';
  }
}

function frameworkClientErrorHint(error: ValidationError): string {
  switch (error.code) {
    case 'FST_REQ_FILE_TOO_LARGE':
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return 'payload_too_large';
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return 'unsupported_media_type';
    default:
      return 'request_rejected';
  }
}

function normalizedValidationFields(validation: unknown): Array<{ field: string; rule: string; message: string }> {
  if (!Array.isArray(validation)) {
    return [];
  }
  return validation
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const safe = entry as { instancePath?: string; keyword?: string; message?: string };
      return {
        field: safe.instancePath?.replace(/^\//, '') || 'unknown',
        rule: safe.keyword ?? 'validation',
        message: safe.message ?? 'Invalid value'
      };
    })
    .filter((entry): entry is { field: string; rule: string; message: string } => entry !== null);
}

export async function registerGlobalErrorHandler(fastify: FastifyInstance): Promise<void> {
  const verboseValidationErrors = process.env.ENABLE_VERBOSE_VALIDATION_ERRORS?.trim().toLowerCase() === 'true';

  const dispatchTechnicalFailureAlert = (args: {
    errorMessage: string;
    statusCode: number;
    request: FastifyRequest;
    component: string;
    terminalFailure?: boolean;
  }): void => {
    const routePath = typeof args.request.routeOptions.url === 'string' ? args.request.routeOptions.url : args.request.url;
    void sendTechnicalFailureAlert({
      prisma: fastify.prisma,
      template: 'RouteHandlerFailure',
      channel: 'UNKNOWN',
      recipient: 'system-route',
      errorMessage: args.errorMessage,
      failureStage: 'ROUTE_HANDLER',
      domain: 'api',
      component: args.component,
      route: routePath,
      method: args.request.method,
      statusCode: args.statusCode,
      terminalFailure: args.terminalFailure ?? false
    });
  };

  fastify.setErrorHandler(
    (error: ValidationError, request: FastifyRequest, reply: FastifyReply): void => {
      if (error instanceof AppError) {
        maybeTrackCheckoutFailure(request);
        if (error.statusCode >= 500) {
          dispatchTechnicalFailureAlert({
            errorMessage: error.message,
            statusCode: error.statusCode,
            request,
            component: 'app-error-handler'
          });
        }

        // 500s expose NOTHING internal to callers: no throw-site message, no classification
        // fields (kind/hintKey), no spread details. Full detail is logged server-side only.
        if (error.statusCode === 500) {
          fastify.log.error(
            {
              error: redactSensitiveData({
                code: error.code,
                message: error.message,
                details: error.details ?? null
              }),
              request: { id: request.id, method: request.method, url: request.url }
            },
            'Internal AppError (500) — full detail logged server-side, generic body sent to caller'
          );
          reply.status(500).send({
            success: false,
            error: {
              code: ERROR_CODES.INTERNAL_ERROR,
              message: 'Something went wrong. Please try again later.',
              statusCode: 500,
              details: {
                retryable: true,
                remediation: 'Retry later. If the issue persists, contact support.'
              }
            }
          });
          return;
        }

        // Other 5xx (502/504 upstream failures — but NOT 503, whose message + hintKey are an
        // intentional retry/remediation contract for ops/admin UIs): keep the crafted in-house
        // message, but never forward classification fields or the throw-site details object.
        if (error.statusCode > 500 && error.statusCode !== 503) {
          fastify.log.error(
            {
              error: redactSensitiveData({
                code: error.code,
                message: error.message,
                statusCode: error.statusCode,
                details: error.details ?? null
              }),
              request: { id: request.id, method: request.method, url: request.url }
            },
            'Upstream AppError (5xx) — details logged server-side, sanitized body sent to caller'
          );
          reply.status(error.statusCode).send({
            success: false,
            error: {
              code: error.code,
              message: error.message,
              statusCode: error.statusCode,
              details: {
                retryable: true,
                remediation: 'Retry later. If the issue persists, contact support.'
              }
            }
          });
          return;
        }

        if (
          error.statusCode === 429 &&
          error.details &&
          typeof error.details === 'object' &&
          'retryAfterSeconds' in error.details
        ) {
          const retryAfter = (error.details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
          if (typeof retryAfter === 'number' && retryAfter > 0) {
            reply.header('Retry-After', Math.ceil(retryAfter).toString());
          }
        }
        reply.status(error.statusCode).send({
          success: false,
          error: {
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
            details: redactSensitiveData({
              kind: (error.details?.kind as string | undefined) ?? 'business_rule',
              hintKey: (error.details?.hintKey as string | undefined) ?? 'request_failed',
              retryable: Boolean(error.statusCode >= 500 || error.statusCode === 429),
              retryAfterSeconds: typeof error.details?.retryAfterSeconds === 'number' ? error.details.retryAfterSeconds : undefined,
              remediation: error.statusCode >= 500 ? 'Retry later or contact support.' : 'Review request and try again.',
              ...(error.details ?? {})
            })
          }
        });
        return;
      }

      if (isValidationError(error)) {
        maybeTrackCheckoutFailure(request);
        reply.status(400).send({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Request validation failed',
            statusCode: 400,
            details: {
              kind: 'validation',
              hintKey: 'request_validation_failed',
              retryable: false,
              remediation: 'Fix the highlighted fields and retry.',
              fields: normalizedValidationFields(error.validation),
              ...(verboseValidationErrors ? { validation: redactSensitiveData(error.validation) } : {})
            }
          }
        });
        return;
      }

      if (error.statusCode === 429) {
        maybeTrackCheckoutFailure(request);
        reply.status(429).send({
          success: false,
          error: {
            code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
            message: 'Rate limit exceeded',
            statusCode: 429,
            details: {
              kind: 'transient',
              hintKey: 'rate_limit_exceeded',
              retryable: true,
              retryAfterSeconds: 60,
              remediation: 'Wait and retry with exponential backoff.'
            }
          }
        });
        return;
      }

      // CLIENT faults raised by Fastify/plugins (multipart limits, content-type parser,
      // malformed body) carry a real 4xx statusCode. Honour it instead of masking as a
      // 500: nothing is broken server-side, so no technical-failure alert fires and the
      // caller gets an actionable status + safe message. The raw error is logged (warn).
      const frameworkStatus = typeof error.statusCode === 'number' ? error.statusCode : 0;
      if (frameworkStatus >= 400 && frameworkStatus < 500) {
        maybeTrackCheckoutFailure(request);
        fastify.log.warn(
          {
            error: redactSensitiveData(sanitizeUnexpectedError(error)),
            request: { id: request.id, method: request.method, url: request.url }
          },
          'Client request rejected by framework/plugin'
        );
        reply.status(frameworkStatus).send({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: frameworkClientErrorMessage(error),
            statusCode: frameworkStatus,
            details: {
              kind: 'validation',
              hintKey: frameworkClientErrorHint(error),
              retryable: false,
              remediation: 'Review the request and try again.'
            }
          }
        });
        return;
      }

      maybeTrackCheckoutFailure(request);
      fastify.log.error(
        {
          error: redactSensitiveData(sanitizeUnexpectedError(error)),
          request: {
            id: request.id,
            method: request.method,
            url: request.url
          }
        },
        'Unhandled application error'
      );

      dispatchTechnicalFailureAlert({
        errorMessage: error.message,
        statusCode: 500,
        request,
        component: 'unhandled-error-handler',
        terminalFailure: true
      });

      // Generic 500 body only — no internal classification fields (kind/hintKey) and no error
      // message from the throw site. The full error was logged above, server-side only.
      reply.status(500).send({
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Something went wrong. Please try again later.',
          statusCode: 500,
          details: {
            retryable: true,
            remediation: 'Retry later. If the issue persists, contact support.'
          }
        }
      });
    }
  );
}

