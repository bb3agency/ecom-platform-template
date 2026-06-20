import { standardErrorResponses } from '@common/errors/error-response.schema';

const cartItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'variantId', 'quantity', 'priceSnapshot', 'lineTotal', 'product', 'variant'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    variantId: { type: 'string', maxLength: 64 },
    quantity: { type: 'integer', minimum: 1, maximum: 1000 },
    priceSnapshot: { type: 'integer', minimum: 0, maximum: 1000000000 },
    lineTotal: { type: 'integer', minimum: 0, maximum: 1000000000 },
    product: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'metaDescription', 'imageUrl', 'imageAlt'],
      properties: {
        name: { type: 'string', maxLength: 200 },
        metaDescription: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
        imageUrl: { anyOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
        imageAlt: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] }
      }
    },
    variant: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'sku', 'price'],
      properties: {
        id: { type: 'string', maxLength: 64 },
        name: { type: 'string', maxLength: 100 },
        sku: { type: 'string', maxLength: 100 },
        price: { type: 'integer', minimum: 0, maximum: 1000000000 }
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

const emptyBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const;

const cartResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'items', 'subtotal', 'discountAmount', 'total', 'coupon', 'meta', 'minOrderValuePaise', 'meetsMinimumOrder'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    items: { type: 'array', items: cartItemSchema },
    subtotal: { type: 'integer', minimum: 0, maximum: 1000000000 },
    discountAmount: { type: 'integer', minimum: 0, maximum: 1000000000 },
    total: { type: 'integer', minimum: 0, maximum: 1000000000 },
    minOrderValuePaise: { type: 'integer', minimum: 0, maximum: 1000000000 },
    meetsMinimumOrder: { type: 'boolean' },
    coupon: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'code', 'type', 'value'],
          properties: {
            id: { type: 'string', maxLength: 64 },
            code: { type: 'string', maxLength: 50 },
            type: {
              type: 'string',
              enum: ['PERCENTAGE_OFF', 'FLAT_AMOUNT_OFF', 'FREE_SHIPPING', 'BUY_X_GET_Y'],
              maxLength: 30
            },
            value: { type: 'integer', minimum: 0, maximum: 1000000000 }
          }
        },
        { type: 'null' }
      ]
    },
    meta: {
      type: 'object',
      additionalProperties: false,
      required: ['isGuest', 'reservationExpiresAt', 'reservedItemCount'],
      properties: {
        isGuest: { type: 'boolean' },
        reservationExpiresAt: { anyOf: [{ type: 'string', format: 'date-time', maxLength: 64 }, { type: 'null' }] },
        reservedItemCount: { type: 'integer', minimum: 0, maximum: 1000000 }
      }
    }
  }
} as const;

export const getCartSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: cartResponseSchema,
    ...standardErrorResponses
  }
} as const;

export const addCartItemSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['variantId', 'quantity'],
    properties: {
      variantId: { type: 'string', maxLength: 64 },
      quantity: { type: 'integer', minimum: 1, maximum: 1000 }
    }
  },
  response: {
    200: cartResponseSchema,
    ...standardErrorResponses
  }
} as const;

export const updateCartItemSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['quantity'],
    properties: {
      quantity: { type: 'integer', minimum: 1, maximum: 1000 }
    }
  },
  response: {
    200: cartResponseSchema,
    ...standardErrorResponses
  }
} as const;

export const deleteCartItemSchema = {
  params: updateCartItemSchema.params,
  querystring: emptyQuerystringSchema,
  response: {
    200: cartResponseSchema,
    ...standardErrorResponses
  }
} as const;

export const clearCartSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: cartResponseSchema,
    ...standardErrorResponses
  }
} as const;

export const mergeCartSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: emptyBodySchema,
  response: {
    200: cartResponseSchema,
    ...standardErrorResponses
  }
} as const;

export const applyCouponSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['code'],
    properties: {
      code: { type: 'string', maxLength: 50 }
    }
  },
  response: {
    200: cartResponseSchema,
    ...standardErrorResponses
  }
} as const;

export const removeCouponSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: cartResponseSchema,
    ...standardErrorResponses
  }
} as const;

export const checkPincodeSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['pincode'],
    properties: {
      pincode: { type: 'string', minLength: 6, maxLength: 6 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['pincode', 'serviceable'],
      properties: {
        pincode: { type: 'string', maxLength: 6 },
        serviceable: { type: 'boolean' }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const deliveryRatesSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['pincode'],
    properties: {
      pincode: { type: 'string', minLength: 6, maxLength: 6 },
      paymentMode: { type: 'string', enum: ['COD', 'PREPAID'] }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['pincode', 'shippingCharge', 'estimatedDays'],
      properties: {
        pincode: { type: 'string', maxLength: 6 },
        shippingCharge: { type: 'integer', minimum: 0, maximum: 1000000000 },
        estimatedDays: { type: 'integer', minimum: 1, maximum: 30 },
        availableCouriers: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['courierCompanyId', 'courierName', 'shippingChargePaise', 'estimatedDays'],
            properties: {
              courierCompanyId: { type: 'integer', minimum: 1 },
              courierName: { type: 'string', maxLength: 100 },
              shippingChargePaise: { type: 'integer', minimum: 0 },
              estimatedDays: { type: 'integer', minimum: 1 }
            }
          }
        },
        selectedShippingProvider: {
          type: 'string',
          enum: ['DELHIVERY', 'SHIPROCKET'],
          maxLength: 20
        },
        courierCompanyId: { type: 'integer', minimum: 1 }
      }
    },
    ...standardErrorResponses
  }
} as const;

