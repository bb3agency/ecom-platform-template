import {
  standardAdminErrorResponses,
  standardErrorResponses
} from '@common/errors/error-response.schema';

const reviewAuthorAdminSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'firstName', 'lastName'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    firstName: { type: 'string', maxLength: 100 },
    lastName: { type: 'string', maxLength: 100 }
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

const reviewOwnerItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'productId',
    'rating',
    'body',
    'images',
    'approved',
    'createdAt',
    'updatedAt',
    'author'
  ],
  properties: {
    id: { type: 'string', maxLength: 64 },
    productId: { type: 'string', maxLength: 64 },
    rating: { type: 'number', minimum: 1, maximum: 5 },
    body: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
    images: { type: 'array', items: { type: 'string', maxLength: 1000 }, maxItems: 5 },
    approved: { type: 'boolean' },
    createdAt: { type: 'string', maxLength: 64 },
    updatedAt: { type: 'string', maxLength: 64 },
    author: {
      type: 'object',
      additionalProperties: false,
      required: ['firstName', 'lastName'],
      properties: {
        firstName: { type: 'string', maxLength: 100 },
        lastName: { type: 'string', maxLength: 100 }
      }
    }
  }
} as const;

const reviewAdminItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'userId',
    'productId',
    'orderId',
    'rating',
    'body',
    'images',
    'approved',
    'createdAt',
    'updatedAt',
    'author'
  ],
  properties: {
    id: { type: 'string', maxLength: 64 },
    userId: { type: 'string', maxLength: 64 },
    productId: { type: 'string', maxLength: 64 },
    productName: { anyOf: [{ type: 'string', maxLength: 255 }, { type: 'null' }] },
    productSlug: { anyOf: [{ type: 'string', maxLength: 255 }, { type: 'null' }] },
    orderId: { type: 'string', maxLength: 64 },
    rating: { type: 'number', minimum: 1, maximum: 5 },
    body: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
    images: { type: 'array', items: { type: 'string', maxLength: 1000 }, maxItems: 5 },
    approved: { type: 'boolean' },
    createdAt: { type: 'string', maxLength: 64 },
    updatedAt: { type: 'string', maxLength: 64 },
    author: reviewAuthorAdminSchema
  }
} as const;

const reviewAuthorPublicSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['firstName', 'lastName'],
  properties: {
    firstName: { type: 'string', maxLength: 100 },
    lastName: { type: 'string', maxLength: 100 }
  }
} as const;

const reviewPublicItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'rating', 'body', 'images', 'approved', 'createdAt', 'updatedAt', 'author'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    rating: { type: 'number', minimum: 1, maximum: 5 },
    body: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
    images: { type: 'array', items: { type: 'string', maxLength: 1000 }, maxItems: 5 },
    approved: { type: 'boolean' },
    createdAt: { type: 'string', maxLength: 64 },
    updatedAt: { type: 'string', maxLength: 64 },
    author: reviewAuthorPublicSchema
  }
} as const;

/** Storefront showcase — approved reviews with product context (homepage testimonials). */
const reviewStorefrontItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'rating', 'body', 'images', 'createdAt', 'author', 'productName', 'productSlug'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    rating: { type: 'number', minimum: 1, maximum: 5 },
    body: { type: 'string', minLength: 1, maxLength: 2000 },
    images: { type: 'array', items: { type: 'string', maxLength: 1000 }, maxItems: 5 },
    createdAt: { type: 'string', maxLength: 64 },
    author: reviewAuthorPublicSchema,
    productName: { anyOf: [{ type: 'string', maxLength: 255 }, { type: 'null' }] },
    productSlug: { anyOf: [{ type: 'string', maxLength: 255 }, { type: 'null' }] }
  }
} as const;

const paginatedReviewResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'meta'],
  properties: {
    items: { type: 'array', items: reviewOwnerItemSchema },
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
} as const;

const paginatedAdminReviewResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'meta'],
  properties: {
    items: { type: 'array', items: reviewAdminItemSchema },
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
} as const;

const paginatedPublicReviewResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'meta'],
  properties: {
    items: { type: 'array', items: reviewPublicItemSchema },
    meta: paginatedReviewResponseSchema.properties.meta
  }
} as const;

export const createReviewSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['productId', 'orderId', 'rating'],
    properties: {
      productId: { type: 'string', maxLength: 64 },
      orderId: { type: 'string', maxLength: 64 },
      rating: { type: 'number', minimum: 1, maximum: 5 },
      body: { type: 'string', maxLength: 2000 },
      images: {
        type: 'array',
        maxItems: 5,
        items: { type: 'string', maxLength: 1000 }
      }
    }
  },
  response: {
    200: reviewOwnerItemSchema,
    ...standardErrorResponses
  }
} as const;

export const listMyReviewsSchema = {
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
    200: paginatedReviewResponseSchema,
    ...standardErrorResponses
  }
} as const;

export const listProductReviewsSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['slug'],
    properties: {
      slug: { type: 'string', maxLength: 200 }
    }
  },
  querystring: listMyReviewsSchema.querystring,
  response: {
    200: paginatedPublicReviewResponseSchema,
    ...standardErrorResponses
  }
} as const;

const paginatedStorefrontReviewResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'meta'],
  properties: {
    items: { type: 'array', items: reviewStorefrontItemSchema },
    meta: paginatedReviewResponseSchema.properties.meta
  }
} as const;

export const listRecentApprovedReviewsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 10, default: 3 }
    }
  },
  response: {
    200: paginatedStorefrontReviewResponseSchema,
    ...standardErrorResponses
  }
} as const;

export const adminReviewSummarySchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      from: { type: 'string', format: 'date-time', maxLength: 64 },
      to: { type: 'string', format: 'date-time', maxLength: 64 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['averageRating', 'totalApproved', 'distribution'],
      properties: {
        averageRating: { type: ['number', 'null'], minimum: 1, maximum: 5 },
        totalApproved: { type: 'integer', minimum: 0, maximum: 1000000000 },
        distribution: {
          type: 'object',
          additionalProperties: false,
          required: ['1', '2', '3', '4', '5'],
          properties: {
            '1': { type: 'integer', minimum: 0, maximum: 1000000000 },
            '2': { type: 'integer', minimum: 0, maximum: 1000000000 },
            '3': { type: 'integer', minimum: 0, maximum: 1000000000 },
            '4': { type: 'integer', minimum: 0, maximum: 1000000000 },
            '5': { type: 'integer', minimum: 0, maximum: 1000000000 }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminListReviewsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      approved: { type: 'boolean' },
      ratingLte: { type: 'integer', minimum: 1, maximum: 5 },
      ratingGte: { type: 'integer', minimum: 1, maximum: 5 },
      search: { type: 'string', maxLength: 100 },
      from: { type: 'string', format: 'date-time', maxLength: 64 },
      to: { type: 'string', format: 'date-time', maxLength: 64 },
      page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
    }
  },
  response: {
    200: paginatedAdminReviewResponseSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const moderateReviewSchema = {
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
    required: ['approved'],
    properties: {
      approved: { type: 'boolean' }
    }
  },
  response: {
    200: reviewAdminItemSchema,
    ...standardAdminErrorResponses
  }
} as const;

/** Products in a delivered order the signed-in customer may review (drives the write-review UI). */
export const listReviewableForOrderSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['orderId'],
    properties: {
      orderId: { type: 'string', maxLength: 64 }
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
            required: ['productId', 'productName', 'productSlug', 'alreadyReviewed'],
            properties: {
              productId: { type: 'string', maxLength: 64 },
              productName: { type: 'string', maxLength: 255 },
              productSlug: { type: 'string', maxLength: 255 },
              alreadyReviewed: { type: 'boolean' }
            }
          }
        }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const adminDeleteReviewSchema = {
  tags: ['admin', 'reviews'],
  summary: 'Hard-delete a review (spam/illegal content removal)',
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
      type: 'object',
      additionalProperties: false,
      required: ['id', 'deleted'],
      properties: {
        id: { type: 'string' },
        deleted: { type: 'boolean' }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;
