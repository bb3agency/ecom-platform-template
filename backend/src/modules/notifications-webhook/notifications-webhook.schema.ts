import { standardErrorResponseSchema } from '@common/errors/error-response.schema';

export const metaWhatsappWebhookVerifySchema = {
  tags: ['notifications-webhook'],
  summary: 'Verify Meta WhatsApp webhook endpoint',
  querystring: {
    type: 'object',
    additionalProperties: true,
    required: ['hub.mode', 'hub.verify_token', 'hub.challenge'],
    properties: {
      'hub.mode': { type: 'string', minLength: 1, maxLength: 32 },
      'hub.verify_token': { type: 'string', minLength: 1, maxLength: 512 },
      'hub.challenge': { type: 'string', minLength: 1, maxLength: 512 }
    }
  },
  response: {
    200: { type: 'string', minLength: 1, maxLength: 512 },
    403: standardErrorResponseSchema
  }
} as const;

export const metaWhatsappWebhookEventSchema = {
  tags: ['notifications-webhook'],
  summary: 'Receive Meta WhatsApp webhook events',
  headers: {
    type: 'object',
    additionalProperties: true,
    properties: {
      'x-hub-signature-256': { type: 'string', minLength: 8, maxLength: 256 }
    }
  },
  body: {
    anyOf: [
      { type: 'string', maxLength: 2000000 },
      {
        type: 'object',
        additionalProperties: true,
        required: ['object', 'entry'],
        properties: {
          object: { type: 'string', minLength: 1, maxLength: 64 },
          entry: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: true,
              required: ['changes'],
              properties: {
                changes: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    additionalProperties: true,
                    required: ['field', 'value'],
                    properties: {
                      field: { type: 'string', minLength: 1, maxLength: 64 },
                      value: { type: 'object', additionalProperties: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    ]
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['received'],
      properties: {
        received: { type: 'boolean' }
      }
    },
    400: standardErrorResponseSchema,
    403: standardErrorResponseSchema,
    500: standardErrorResponseSchema
  }
} as const;
