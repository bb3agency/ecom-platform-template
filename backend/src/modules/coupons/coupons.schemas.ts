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

const couponScopeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    productIds: {
      type: 'array',
      maxItems: 500,
      items: { type: 'string', maxLength: 64 }
    },
    categoryIds: {
      type: 'array',
      maxItems: 500,
      items: { type: 'string', maxLength: 64 }
    }
  }
} as const;

const couponSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'code',
    'type',
    'value',
    'minOrderPaise',
    'maxUsesTotal',
    'maxUsesPerUser',
    'usesCount',
    'isActive',
    'validFrom',
    'validUntil',
    'status',
    'applicableTo',
    'createdBy',
    'updatedBy',
    'deletedAt',
    'deletedBy',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string', maxLength: 64 },
    code: { type: 'string', maxLength: 50 },
    type: { type: 'string', enum: ['PERCENTAGE_OFF', 'FLAT_AMOUNT_OFF', 'FREE_SHIPPING', 'BUY_X_GET_Y'], maxLength: 30 },
    value: { type: 'integer', minimum: 0, maximum: 1000000000 },
    minOrderPaise: { type: 'integer', minimum: 0, maximum: 1000000000 },
    maxUsesTotal: { anyOf: [{ type: 'integer', minimum: 1, maximum: 1000000000 }, { type: 'null' }] },
    maxUsesPerUser: { anyOf: [{ type: 'integer', minimum: 1, maximum: 1000000 }, { type: 'null' }] },
    usesCount: { type: 'integer', minimum: 0, maximum: 1000000000 },
    isActive: { type: 'boolean' },
    validFrom: { type: 'string', maxLength: 64 },
    validUntil: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
    status: { type: 'string', enum: ['active', 'expired', 'paused', 'deleted'], maxLength: 20 },
    applicableTo: { anyOf: [couponScopeSchema, { type: 'null' }] },
    // Audit fields
    createdBy: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
    updatedBy: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
    deletedAt: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
    deletedBy: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
    createdAt: { type: 'string', maxLength: 64 },
    updatedAt: { type: 'string', maxLength: 64 }
  }
} as const;

const couponInputProperties = {
  code: { type: 'string', minLength: 3, maxLength: 50 },
  type: { type: 'string', enum: ['PERCENTAGE_OFF', 'FLAT_AMOUNT_OFF', 'FREE_SHIPPING'], maxLength: 30 },
  value: { type: 'integer', minimum: 0, maximum: 1000000000 },
  minOrderPaise: { type: 'integer', minimum: 0, maximum: 1000000000 },
  maxUsesTotal: { type: 'integer', minimum: 1, maximum: 1000000000 },
  maxUsesPerUser: { anyOf: [{ type: 'integer', minimum: 1, maximum: 1000000 }, { type: 'null' }] },
  validFrom: { type: 'string', format: 'date-time', maxLength: 64 },
  validUntil: { type: 'string', format: 'date-time', maxLength: 64 },
  applicableTo: couponScopeSchema,
  isActive: { type: 'boolean' }
} as const;

export const adminListCouponsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      code: { type: 'string', maxLength: 50 },
      status: { type: 'string', enum: ['active', 'expired', 'paused', 'deleted'], maxLength: 20 },
      type: { type: 'string', enum: ['PERCENTAGE_OFF', 'FLAT_AMOUNT_OFF', 'FREE_SHIPPING', 'BUY_X_GET_Y'], maxLength: 20 },
      from: { type: 'string', format: 'date-time', maxLength: 64 },
      to: { type: 'string', format: 'date-time', maxLength: 64 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'meta'],
      properties: {
        items: {
          type: 'array',
          items: couponSchema
        },
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

export const adminCreateCouponSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'type', 'value', 'validFrom'],
    properties: couponInputProperties
  },
  response: {
    200: couponSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminUpdateCouponSchema = {
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
    minProperties: 1,
    properties: couponInputProperties
  },
  response: {
    200: couponSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminUpdateCouponStatusSchema = {
  params: adminUpdateCouponSchema.params,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['isActive'],
    properties: {
      isActive: { type: 'boolean' }
    }
  },
  response: {
    200: couponSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminDeleteCouponSchema = {
  params: adminUpdateCouponSchema.params,
  querystring: emptyQuerystringSchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { type: 'string', maxLength: 100 }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminCouponAnalyticsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      from: { type: 'string', format: 'date-time', maxLength: 64 },
      to: { type: 'string', format: 'date-time', maxLength: 64 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'meta'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['couponId', 'code', 'usesCount', 'totalDiscountPaise'],
            properties: {
              couponId: { type: 'string', maxLength: 64 },
              code: { type: 'string', maxLength: 50 },
              usesCount: { type: 'integer', minimum: 0, maximum: 1000000000 },
              totalDiscountPaise: { type: 'integer', minimum: 0, maximum: 1000000000000 }
            }
          }
        },
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

export const adminRestoreCouponSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  querystring: emptyQuerystringSchema,
  response: {
    200: couponSchema,
    ...standardAdminErrorResponses
  }
} as const;

const auditLogChangeSchema = {
  type: 'object',
  additionalProperties: {
    type: 'object',
    additionalProperties: false,
    required: ['from', 'to'],
    properties: {
      from: {},
      to: {}
    }
  },
  properties: {}
} as const;

const couponAuditLogEntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'action', 'actorId', 'actorName', 'actorType', 'changes', 'ipAddress', 'userAgent', 'createdAt'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    action: { type: 'string', enum: ['CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'PAUSE', 'RESUME', 'ACTIVATE'], maxLength: 20 },
    actorId: { type: 'string', maxLength: 64 },
    actorName: { type: 'string', maxLength: 200 },
    actorType: { type: 'string', enum: ['ADMIN', 'SYSTEM'], maxLength: 10 },
    changes: { anyOf: [auditLogChangeSchema, { type: 'null' }] },
    ipAddress: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
    userAgent: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
    createdAt: { type: 'string', maxLength: 64 }
  }
} as const;

export const adminListCouponAuditSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      action: { type: 'string', enum: ['CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'PAUSE', 'RESUME', 'ACTIVATE'], maxLength: 20 },
      actorId: { type: 'string', maxLength: 64 },
      fromDate: { type: 'string', format: 'date-time', maxLength: 64 },
      toDate: { type: 'string', format: 'date-time', maxLength: 64 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'meta'],
      properties: {
        items: {
          type: 'array',
          items: couponAuditLogEntrySchema
        },
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

const adminStorefrontCouponsStatusShape = {
  type: 'object',
  additionalProperties: false,
  required: ['merchantEnabled', 'storefrontEnabled', 'redeemableCouponCount'],
  properties: {
    merchantEnabled: { type: 'boolean' },
    storefrontEnabled: { type: 'boolean' },
    redeemableCouponCount: { type: 'integer', minimum: 0 }
  }
} as const;

export const adminStorefrontCouponsStatusSchema = {
  tags: ['admin', 'coupons'],
  summary: 'Storefront coupon module status for admin Coupons page',
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: adminStorefrontCouponsStatusShape,
    ...standardAdminErrorResponses
  }
} as const;

export const adminUpdateStorefrontCouponsStatusSchema = {
  tags: ['admin', 'coupons'],
  summary: 'Enable or disable coupon codes on the customer storefront',
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['couponsEnabled'],
    properties: {
      couponsEnabled: { type: 'boolean' }
    }
  },
  response: {
    200: adminStorefrontCouponsStatusShape,
    ...standardAdminErrorResponses
  }
} as const;

export const adminCloneCouponSchema = {
  tags: ['admin', 'coupons'],
  summary: 'Clone an existing coupon with a new code',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['newCode'],
    properties: {
      newCode: { type: 'string', minLength: 1, maxLength: 100 },
      validFrom: { type: 'string', format: 'date-time' },
      validUntil: { type: 'string', format: 'date-time' }
    }
  },
  response: {
    201: couponSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminGetCouponByIdSchema = {
  tags: ['admin', 'coupons'],
  summary: 'Get a single coupon by ID',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  response: {
    200: couponSchema,
    ...standardAdminErrorResponses
  }
} as const;
