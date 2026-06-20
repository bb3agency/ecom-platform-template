import { standardAdminErrorResponses, standardErrorResponses } from '@common/errors/error-response.schema';

export const serveCategoryImageSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['categoryId', 'filename'],
    properties: {
      categoryId: { type: 'string', maxLength: 64 },
      filename: { type: 'string', maxLength: 128 }
    }
  },
  response: {
    200: { type: 'string', contentEncoding: 'binary', contentMediaType: 'image/*' },
    ...standardErrorResponses
  }
} as const;

export const serveProductImageSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['productId', 'filename'],
    properties: {
      productId: { type: 'string', maxLength: 64 },
      filename: { type: 'string', maxLength: 128 }
    }
  },
  response: {
    200: { type: 'string', contentEncoding: 'binary', contentMediaType: 'image/*' },
    ...standardErrorResponses
  }
} as const;

const productImageRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'productId', 'url', 'altText', 'sortOrder'],
  properties: {
    id: { type: 'string' },
    productId: { type: 'string' },
    url: { type: 'string', maxLength: 1000 },
    altText: { type: 'string', maxLength: 200 },
    sortOrder: { type: 'integer' }
  }
} as const;

export const adminUploadProductImageSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  response: {
    200: {
      oneOf: [
        productImageRecordSchema,
        {
          type: 'object',
          additionalProperties: false,
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              items: productImageRecordSchema
            }
          }
        }
      ]
    },
    ...standardAdminErrorResponses
  }
} as const;
