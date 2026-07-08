import { standardErrorResponses } from '@common/errors/error-response.schema';
import { productListItemSchema } from '../products/products.schemas';

// Minimal product shape returned by add-to-wishlist (the client only needs the id
// to toggle local state). The list endpoint returns the richer card-ready shape below.
const wishlistProductSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'slug', 'description', 'isFeatured'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    name: { type: 'string', maxLength: 200 },
    slug: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 5000 },
    isFeatured: { type: 'boolean' }
  }
} as const;

// Card-ready product (same shape as the storefront product list item) so the
// /wishlist page can render the standard ProductCard — image, price, variants,
// rating and stock — without a second round-trip per item.
const wishlistCardProductSchema = productListItemSchema;

const wishlistListItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'createdAt', 'product'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    createdAt: { type: 'string', maxLength: 64 },
    product: wishlistCardProductSchema
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

const wishlistItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'createdAt', 'product'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    createdAt: { type: 'string', maxLength: 64 },
    product: wishlistProductSchema
  }
} as const;

export const listWishlistSchema = {
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
        items: { type: 'array', items: wishlistListItemSchema },
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
    ...standardErrorResponses
  }
} as const;

export const addWishlistItemSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['productId'],
    properties: {
      productId: { type: 'string', maxLength: 64 }
    }
  },
  response: {
    200: wishlistItemSchema,
    ...standardErrorResponses
  }
} as const;

export const removeWishlistItemSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['productId'],
    properties: {
      productId: { type: 'string', maxLength: 64 }
    }
  },
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
    ...standardErrorResponses
  }
} as const;
