import { standardAdminErrorResponses } from '@common/errors/error-response.schema';

const emptyParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const;

const emptyQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const;

export const opsQueuesUiSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema
} as const;

export const opsQueuesDlqSummarySchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: {
      type: 'object',
      properties: {
        total: { type: 'number' },
        bySourceQueue: {
          type: 'object',
          additionalProperties: { type: 'number' }
        }
      },
      required: ['total', 'bySourceQueue'],
      additionalProperties: false
    },
    ...standardAdminErrorResponses
  }
} as const;
