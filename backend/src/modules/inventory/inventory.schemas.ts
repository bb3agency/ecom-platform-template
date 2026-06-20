import { standardAdminErrorResponses } from '@common/errors/error-response.schema';

const inventoryItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'variantId', 'quantity', 'lowStockThreshold', 'lowStockAlerted', 'variant'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    variantId: { type: 'string', maxLength: 64 },
    quantity: { type: 'integer', minimum: 0, maximum: 1000000000 },
    reservedQuantity: { type: 'integer', minimum: 0, maximum: 1000000000 },
    availableQuantity: { type: 'integer', minimum: 0, maximum: 1000000000 },
    lowStockThreshold: { type: 'integer', minimum: 0, maximum: 1000000 },
    lowStockAlerted: { type: 'boolean' },
    variant: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'sku', 'product'],
      properties: {
        id: { type: 'string', maxLength: 64 },
        name: { type: 'string', maxLength: 100 },
        sku: { type: 'string', maxLength: 100 },
        product: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'slug'],
          properties: {
            id: { type: 'string', maxLength: 64 },
            name: { type: 'string', maxLength: 200 },
            slug: { type: 'string', maxLength: 200 }
          }
        }
      }
    }
  }
} as const;

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

export const listInventorySchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'meta'],
      properties: {
        items: { type: 'array', items: inventoryItemSchema },
        meta: {
          type: 'object',
          additionalProperties: false,
          required: ['page', 'limit', 'total', 'totalPages'],
          properties: {
            page: { type: 'integer', minimum: 1, maximum: 100000 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            total: { type: 'integer', minimum: 0, maximum: 1000000000 },
            totalPages: { type: 'integer', minimum: 0, maximum: 1000000000 }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const lowStockSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: {
      type: 'array',
      items: inventoryItemSchema
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminBulkUpdateInventorySchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['updates'],
    properties: {
      updates: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['variantId'],
          minProperties: 2,
          properties: {
            variantId: { type: 'string', maxLength: 64 },
            quantity: { type: 'integer', minimum: 0, maximum: 1000000000 },
            lowStockThreshold: { type: 'integer', minimum: 0, maximum: 1000000 }
          }
        }
      }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['updated', 'failed'],
      properties: {
        updated: { type: 'integer', minimum: 0 },
        failed: { type: 'array', items: { type: 'string', maxLength: 64 } }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const updateInventorySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['variantId'],
    properties: {
      variantId: { type: 'string', maxLength: 64 }
    }
  },
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      quantity: { type: 'integer', minimum: 0, maximum: 1000000000 },
      lowStockThreshold: { type: 'integer', minimum: 0, maximum: 1000000 }
    }
  },
  response: {
    200: inventoryItemSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminInventoryHistorySchema = {
  tags: ['admin', 'inventory'],
  summary: 'Get stock adjustment history for a variant',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['variantId'],
    properties: {
      variantId: { type: 'string', maxLength: 64 }
    }
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['variantId', 'total', 'page', 'limit', 'items'],
      properties: {
        variantId: { type: 'string' },
        total: { type: 'integer' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'delta', 'quantityAfter', 'createdAt'],
            properties: {
              id: { type: 'string' },
              delta: { type: 'integer' },
              quantityAfter: { type: 'integer' },
              reason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              adminUserId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              createdAt: { type: 'string' }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

