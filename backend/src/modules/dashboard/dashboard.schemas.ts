import { standardAdminErrorResponses } from '@common/errors/error-response.schema';

const granularityValues = ['hour', 'day', 'week'] as const;
const periodValues = ['today', '7d', '30d', 'custom'] as const;

const emptyParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const;

export const dashboardKpisSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      period: { type: 'string', enum: periodValues, maxLength: 10 },
      from: { type: 'string', format: 'date-time', maxLength: 64 },
      to: { type: 'string', format: 'date-time', maxLength: 64 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['period', 'from', 'to', 'ordersCount', 'revenuePaise', 'averageOrderValuePaise', 'customersCount'],
      properties: {
        period: { type: 'string', enum: periodValues, maxLength: 10 },
        from: { type: 'string', maxLength: 64 },
        to: { type: 'string', maxLength: 64 },
        ordersCount: { type: 'integer', minimum: 0, maximum: 1000000000 },
        revenuePaise: { type: 'integer', minimum: 0, maximum: 1000000000000 },
        averageOrderValuePaise: { type: 'integer', minimum: 0, maximum: 1000000000000 },
        customersCount: { type: 'integer', minimum: 0, maximum: 1000000000 }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const dashboardSalesChartSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      granularity: { type: 'string', enum: granularityValues, maxLength: 10 },
      from: { type: 'string', format: 'date-time', maxLength: 64 },
      to: { type: 'string', format: 'date-time', maxLength: 64 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['granularity', 'points'],
      properties: {
        granularity: { type: 'string', enum: granularityValues, maxLength: 10 },
        points: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['bucket', 'ordersCount', 'revenuePaise'],
            properties: {
              bucket: { type: 'string', maxLength: 64 },
              ordersCount: { type: 'integer', minimum: 0, maximum: 1000000000 },
              revenuePaise: { type: 'integer', minimum: 0, maximum: 1000000000000 }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const dashboardTopProductsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      from: { type: 'string', format: 'date-time', maxLength: 64 },
      to: { type: 'string', format: 'date-time', maxLength: 64 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['variantId', 'productName', 'variantName', 'quantitySold', 'revenuePaise'],
            properties: {
              variantId: { type: 'string', maxLength: 64 },
              productName: { type: 'string', maxLength: 200 },
              variantName: { type: 'string', maxLength: 200 },
              quantitySold: { type: 'integer', minimum: 0, maximum: 1000000000 },
              revenuePaise: { type: 'integer', minimum: 0, maximum: 1000000000000 }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;


const countSchema = { type: 'integer', minimum: 0, maximum: 1000000000 } as const;

export const dashboardActionQueueSchema = {
  params: emptyParamsSchema,
  querystring: { type: 'object', additionalProperties: false, properties: {} },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: [
        'ordersToFulfil',
        'ordersProcessing',
        'ordersAwaitingPayment',
        'returnsToReview',
        'reviewsToModerate',
        'lowStockVariants',
        'outOfStockVariants',
        'generatedAt'
      ],
      properties: {
        ordersToFulfil: countSchema,
        ordersProcessing: countSchema,
        ordersAwaitingPayment: countSchema,
        returnsToReview: countSchema,
        reviewsToModerate: countSchema,
        lowStockVariants: countSchema,
        outOfStockVariants: countSchema,
        generatedAt: { type: 'string', maxLength: 64 }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

const orderStatusValues = [
  'PENDING_PAYMENT',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED'
] as const;

const statusCountsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['total', 'byStatus'],
  properties: {
    total: countSchema,
    byStatus: {
      type: 'object',
      additionalProperties: false,
      required: [...orderStatusValues],
      properties: Object.fromEntries(orderStatusValues.map((status) => [status, countSchema]))
    }
  }
} as const;

export const dashboardOrderStatusCountsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['from', 'to'],
    properties: {
      from: { type: 'string', format: 'date-time', maxLength: 64 },
      to: { type: 'string', format: 'date-time', maxLength: 64 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to', 'previousFrom', 'previousTo', 'current', 'previous'],
      properties: {
        from: { type: 'string', maxLength: 64 },
        to: { type: 'string', maxLength: 64 },
        previousFrom: { type: 'string', maxLength: 64 },
        previousTo: { type: 'string', maxLength: 64 },
        current: statusCountsSchema,
        previous: statusCountsSchema
      }
    },
    ...standardAdminErrorResponses
  }
} as const;
