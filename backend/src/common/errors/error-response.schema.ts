export const errorDetailsSchema = {
  type: 'object',
  additionalProperties: false,
  // `kind`/`hintKey` are intentionally OPTIONAL: they are internal classification fields and are
  // stripped from 500 responses (generic body only — full detail is logged server-side). 4xx/503
  // responses keep sending them; the storefront branches on them only for 4xx flows (OTP hints).
  required: ['retryable', 'remediation'],
  properties: {
    kind: {
      type: 'string',
      enum: ['validation', 'auth', 'permission', 'business_rule', 'dependency', 'transient', 'internal'],
      maxLength: 40
    },
    hintKey: { type: 'string', maxLength: 120 },
    retryable: { type: 'boolean' },
    retryAfterSeconds: { anyOf: [{ type: 'number', minimum: 0, maximum: 86400 }, { type: 'null' }] },
    remediation: { type: 'string', maxLength: 300 },
    traceId: { type: 'string', maxLength: 64 },
    requestId: { type: 'string', maxLength: 64 },
    timestamp: { type: 'string', maxLength: 30 },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'rule', 'message'],
        properties: {
          field: { type: 'string', maxLength: 200 },
          rule: { type: 'string', maxLength: 120 },
          message: { type: 'string', maxLength: 400 }
        }
      }
    }
  }
} as const;

export const standardErrorResponseSchema = {
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
        message: { type: 'string', maxLength: 300 },
        statusCode: { type: 'integer', minimum: 400, maximum: 599 },
        details: errorDetailsSchema
      }
    }
  }
} as const;

export const standardAdminErrorResponses = {
  400: standardErrorResponseSchema,
  401: standardErrorResponseSchema,
  422: standardErrorResponseSchema,
  403: standardErrorResponseSchema,
  404: standardErrorResponseSchema,
  409: standardErrorResponseSchema,
  429: standardErrorResponseSchema,
  502: standardErrorResponseSchema,
  503: standardErrorResponseSchema,
  500: standardErrorResponseSchema
} as const;

export const standardErrorResponses = {
  400: standardErrorResponseSchema,
  401: standardErrorResponseSchema,
  422: standardErrorResponseSchema,
  403: standardErrorResponseSchema,
  404: standardErrorResponseSchema,
  409: standardErrorResponseSchema,
  429: standardErrorResponseSchema,
  502: standardErrorResponseSchema,
  503: standardErrorResponseSchema,
  500: standardErrorResponseSchema
} as const;
