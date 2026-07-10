import {
  standardAdminErrorResponses,
  standardErrorResponses
} from '@common/errors/error-response.schema';
import { adminUploadProductImageSchema } from '@modules/media/media.schemas';
import { PRODUCT_MAX_IMAGES_PER_PRODUCT } from '@modules/media/product-media.constants';

/** HTTPS CDN URL or VPS-hosted media path served via Cloudflare origin. */
const productImageUrlProperty = {
  type: 'string',
  maxLength: 1000,
  anyOf: [
    { type: 'string', format: 'uri', pattern: '^https://.+' },
    {
      type: 'string',
      pattern: '^/api/v1/media/products/[a-zA-Z0-9-]+/[a-zA-Z0-9._-]+\\.(jpg|jpeg|png|webp|gif)$'
    }
  ]
} as const;

export const productListItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'slug',
    'description',
    'tags',
    'isFeatured',
    'isActive',
    'category',
    'images',
    'variants'
  ],
  properties: {
    id: { type: 'string', maxLength: 64 },
    name: { type: 'string', maxLength: 200 },
    slug: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 5000 },
    tags: { type: 'array', items: { type: 'string', maxLength: 50 } },
    isFeatured: { type: 'boolean' },
    isActive: { type: 'boolean' },
    inStock: { type: 'boolean' },
    // Approved-review aggregates. Present on storefront list + detail so product
    // cards and the PDP header can show stars without fetching every review.
    // 0 / 0 when reviews are disabled or the product has no approved reviews.
    rating: { type: 'number', minimum: 0, maximum: 5 },
    reviewCount: { type: 'integer', minimum: 0, maximum: 100000000 },
    metaDescription: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
    category: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'slug'],
      properties: {
        id: { type: 'string', maxLength: 64 },
        name: { type: 'string', maxLength: 100 },
        slug: { type: 'string', maxLength: 100 }
      }
    },
    images: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'url', 'altText', 'sortOrder'],
        properties: {
          id: { type: 'string', maxLength: 64 },
          url: { ...productImageUrlProperty, maxLength: 1000 },
          altText: { type: 'string', maxLength: 200 },
          sortOrder: { type: 'integer', minimum: 0, maximum: 1000 }
        }
      }
    },
    variants: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'sku', 'price', 'compareAtPrice', 'isActive'],
        properties: {
          id: { type: 'string', maxLength: 64 },
          name: { type: 'string', maxLength: 100 },
          sku: { type: 'string', maxLength: 100 },
          price: { type: 'integer', minimum: 0, maximum: 1000000000 },
          compareAtPrice: {
            anyOf: [{ type: 'integer', minimum: 0, maximum: 1000000000 }, { type: 'null' }]
          },
          weight: {
            anyOf: [{ type: 'integer', minimum: 0, maximum: 10000000 }, { type: 'null' }]
          },
          hsnCode: {
            anyOf: [{ type: 'string', pattern: '^[0-9]{1,15}$' }, { type: 'null' }]
          },
          gstRatePercent: { type: 'integer', minimum: 0, maximum: 100 },
          isActive: { type: 'boolean' }
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

const publicCategorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'slug', 'parentId'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    name: { type: 'string', maxLength: 100 },
    slug: { type: 'string', maxLength: 100 },
    parentId: { type: ['string', 'null'], maxLength: 64 },
    imageUrl: { type: ['string', 'null'], maxLength: 500 }
  }
} as const;

const categorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'slug', 'parentId', 'isActive', 'createdAt'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    name: { type: 'string', maxLength: 100 },
    slug: { type: 'string', maxLength: 100 },
    parentId: { type: ['string', 'null'], maxLength: 64 },
    imageUrl: { type: ['string', 'null'], maxLength: 500 },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', maxLength: 64 },
    updatedAt: { type: 'string', maxLength: 64 }
  }
} as const;

const publicReviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'rating', 'body', 'images', 'createdAt', 'author'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    rating: { type: 'number', minimum: 1, maximum: 5 },
    body: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
    images: { type: 'array', items: { type: 'string', maxLength: 1000 }, maxItems: 5 },
    createdAt: { type: 'string', maxLength: 64 },
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

// Admin-only variant item: extends the public schema with packaging dimensions.
// These fields must never appear in storefront/customer-facing responses.
const adminVariantItemSchema = {
  ...productListItemSchema.properties.variants.items,
  properties: {
    ...productListItemSchema.properties.variants.items.properties,
    packageLengthCm: {
      anyOf: [{ type: 'integer', minimum: 1, maximum: 10000 }, { type: 'null' }]
    },
    packageWidthCm: {
      anyOf: [{ type: 'integer', minimum: 1, maximum: 10000 }, { type: 'null' }]
    },
    packageHeightCm: {
      anyOf: [{ type: 'integer', minimum: 1, maximum: 10000 }, { type: 'null' }]
    },
    keepUpright: { type: 'boolean' },
    sortOrder: { type: 'integer', minimum: 0, maximum: 100000 }
  }
} as const;

const adminProductListItemSchema = {
  ...productListItemSchema,
  properties: {
    ...productListItemSchema.properties,
    variants: {
      ...productListItemSchema.properties.variants,
      items: adminVariantItemSchema
    }
  }
} as const;

const productDetailSchema = {
  ...productListItemSchema,
  required: [...productListItemSchema.required, 'reviews'],
  properties: {
    ...productListItemSchema.properties,
    reviews: {
      type: 'array',
      items: publicReviewSchema
    }
  }
} as const;

export const listProductsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      category: { type: 'string', maxLength: 100 },
      search: { type: 'string', maxLength: 200 },
      minPrice: { type: 'integer', minimum: 0, maximum: 1000000000 },
      maxPrice: { type: 'integer', minimum: 0, maximum: 1000000000 },
      tags: { type: 'string', maxLength: 500 },
      sort: {
        type: 'string',
        enum: ['price_asc', 'price_desc', 'newest', 'popularity'],
        maxLength: 20
      },
      inStock: { type: 'boolean' },
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
        items: { type: 'array', items: productListItemSchema },
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

export const getProductBySlugSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['slug'],
    properties: {
      slug: { type: 'string', maxLength: 200 }
    }
  },
  querystring: emptyQuerystringSchema,
  response: {
    200: productDetailSchema,
    ...standardErrorResponses
  }
} as const;

export const listCategoriesSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      search: { type: 'string', maxLength: 200 }
    }
  },
  response: {
    200: {
      type: 'array',
      items: publicCategorySchema
    },
    ...standardErrorResponses
  }
} as const;

export const listProductsByCategorySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['slug'],
    properties: {
      slug: { type: 'string', maxLength: 100 }
    }
  },
  querystring: listProductsSchema.querystring,
  response: {
    ...listProductsSchema.response,
    ...standardErrorResponses
  }
} as const;

const adminProductInputProperties = {
  name: { type: 'string', maxLength: 200 },
  slug: { type: 'string', maxLength: 200 },
  description: { type: 'string', maxLength: 5000 },
  categoryId: { type: 'string', maxLength: 64 },
  tags: { type: 'array', items: { type: 'string', maxLength: 50 } },
  attributes: {
    type: 'object',
    additionalProperties: false,
    properties: {
      gstRate: { type: 'integer', minimum: 0, maximum: 100 },
      hsnCode: { type: 'string', pattern: '^[0-9]{1,15}$' },
      nutritionalInfo: { type: 'string', maxLength: 1000 },
      allergens: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 25 },
      shelfLifeDays: { type: 'integer', minimum: 0, maximum: 5000 },
      fssaiNumber: { type: 'string', maxLength: 50 },
      processor: { type: 'string', maxLength: 200 },
      ram: { type: 'string', maxLength: 100 },
      storage: { type: 'string', maxLength: 100 },
      warrantyMonths: { type: 'integer', minimum: 0, maximum: 120 }
    }
  },
  metaTitle: { type: 'string', maxLength: 200 },
  metaDescription: { type: 'string', maxLength: 500 },
  isFeatured: { type: 'boolean' },
  isActive: { type: 'boolean' },
  images: {
    type: 'array',
    maxItems: PRODUCT_MAX_IMAGES_PER_PRODUCT,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['url', 'altText', 'sortOrder'],
      properties: {
        url: productImageUrlProperty,
        altText: { type: 'string', maxLength: 200 },
        sortOrder: { type: 'integer', minimum: 0, maximum: 1000 }
      }
    }
  },
  variants: {
    type: 'array',
    minItems: 1,
    maxItems: 100,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['sku', 'name', 'price'],
      properties: {
        sku: { type: 'string', maxLength: 100 },
        name: { type: 'string', maxLength: 100 },
        price: { type: 'integer', minimum: 0, maximum: 1000000000 },
        compareAtPrice: {
          anyOf: [{ type: 'integer', minimum: 0, maximum: 1000000000 }, { type: 'null' }]
        },
        weight: { type: 'integer', minimum: 0, maximum: 10000000 },
        packageLengthCm: { type: 'integer', minimum: 1, maximum: 10000 },
        packageWidthCm: { type: 'integer', minimum: 1, maximum: 10000 },
        packageHeightCm: { type: 'integer', minimum: 1, maximum: 10000 },
        keepUpright: { type: 'boolean' },
        quantity: { type: 'integer', minimum: 0, maximum: 1000000000 },
        lowStockThreshold: { type: 'integer', minimum: 0, maximum: 1000000 },
        attributes: {
          type: 'object',
          additionalProperties: false,
          properties: {}
        },
        isActive: { type: 'boolean' }
      }
    }
  }
} as const;

export const adminCreateProductImageSchema = {
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
    required: ['url', 'altText', 'sortOrder'],
    properties: {
      url: productImageUrlProperty,
      altText: { type: 'string', maxLength: 200 },
      sortOrder: { type: 'integer', minimum: 0, maximum: 1000 }
    }
  },
  response: {
    200: productListItemSchema.properties.images.items,
    ...standardAdminErrorResponses
  }
} as const;

export { adminUploadProductImageSchema };

export const adminReorderProductImagesSchema = {
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
    required: ['images'],
    properties: {
      images: {
        type: 'array',
        minItems: 1,
        maxItems: PRODUCT_MAX_IMAGES_PER_PRODUCT,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'sortOrder'],
          properties: {
            id: { type: 'string', maxLength: 64 },
            sortOrder: { type: 'integer', minimum: 0, maximum: 1000 }
          }
        }
      }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['updated'],
      properties: {
        updated: { type: 'integer', minimum: 0, maximum: 30 }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminDeleteProductImageSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'imageId'],
    properties: {
      id: { type: 'string', maxLength: 64 },
      imageId: { type: 'string', maxLength: 64 }
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
    ...standardAdminErrorResponses
  }
} as const;

export const adminCreateProductSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'slug', 'description', 'categoryId'],
    properties: adminProductInputProperties
  },
  response: {
    200: adminProductListItemSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminImportProductsCsvSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  consumes: ['multipart/form-data'],
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['csvFile'],
    properties: {
      csvFile: { type: 'string', format: 'binary' }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['createdCount', 'updatedCount', 'failedCount', 'errors'],
      properties: {
        createdCount: { type: 'integer', minimum: 0, maximum: 1000000 },
        updatedCount: { type: 'integer', minimum: 0, maximum: 1000000 },
        failedCount: { type: 'integer', minimum: 0, maximum: 1000000 },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['line', 'message'],
            properties: {
              line: { type: 'integer', minimum: 2, maximum: 1000000 },
              message: { type: 'string', maxLength: 500 }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminCreateProductVariantSchema = {
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
    required: ['sku', 'name', 'price'],
    properties: adminProductInputProperties.variants.items.properties
  },
  response: {
    200: adminVariantItemSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminUpdateProductVariantSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'variantId'],
    properties: {
      id: { type: 'string', maxLength: 64 },
      variantId: { type: 'string', maxLength: 64 }
    }
  },
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: adminProductInputProperties.variants.items.properties
  },
  response: {
    200: adminVariantItemSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminReorderProductVariantsSchema = {
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
    required: ['variantIds'],
    properties: {
      // The full ordered list of this product's variant ids; index = new sortOrder.
      variantIds: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: { type: 'string', maxLength: 64 }
      }
    }
  },
  response: {
    200: adminProductListItemSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminListProductsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...listProductsSchema.querystring.properties,
      sku: { type: 'string', maxLength: 100 },
      isActive: { type: 'boolean' }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'meta'],
      properties: {
        items: { type: 'array', items: adminProductListItemSchema },
        meta: listProductsSchema.response[200].properties.meta
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminGetProductByIdSchema = {
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
    200: adminProductListItemSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminUpdateProductSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: adminProductInputProperties
  },
  response: {
    200: adminProductListItemSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminDeleteProductVariantSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'variantId'],
    properties: {
      id: { type: 'string', maxLength: 64 },
      variantId: { type: 'string', maxLength: 64 }
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
    ...standardAdminErrorResponses
  }
} as const;

export const adminDeleteProductSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
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
    ...standardAdminErrorResponses
  }
} as const;

export const adminHardDeleteProductSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
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
    ...standardAdminErrorResponses
  }
} as const;

const adminCategoryInputProperties = {
  name: { type: 'string', maxLength: 100 },
  slug: { type: 'string', maxLength: 100 },
  parentId: { type: 'string', maxLength: 64 },
  imageUrl: { type: 'string', maxLength: 500 },
  isActive: { type: 'boolean' }
} as const;

const adminCategoryUpdateInputProperties = {
  name: { type: 'string', maxLength: 100 },
  slug: { type: 'string', maxLength: 100 },
  parentId: { type: ['string', 'null'], maxLength: 64 },
  imageUrl: { type: ['string', 'null'], maxLength: 500 },
  isActive: { type: 'boolean' }
} as const;

export const adminGetCategoryByIdSchema = {
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
    200: categorySchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminCreateCategorySchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'slug'],
    properties: adminCategoryInputProperties
  },
  response: {
    200: categorySchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminUpdateCategorySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: adminCategoryUpdateInputProperties
  },
  response: {
    200: categorySchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminUploadCategoryImageSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
  querystring: emptyQuerystringSchema,
  // multipart/form-data — body validated in the handler, not by JSON schema.
  response: {
    200: categorySchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminHardDeleteCategorySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
  querystring: emptyQuerystringSchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: { message: { type: 'string', maxLength: 100 } }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminDeleteCategorySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
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
    ...standardAdminErrorResponses
  }
} as const;

export const adminHsnSuggestionsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['q'],
    properties: {
      // Product name (or partial HSN digits) to suggest codes for.
      q: { type: 'string', minLength: 2, maxLength: 160 }
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
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'description'],
            properties: {
              code: { type: 'string', minLength: 4, maxLength: 8 },
              description: { type: 'string', maxLength: 500 }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminListCategoriesSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      search: { type: 'string', maxLength: 200 },
      isActive: { type: 'boolean' },
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
        items: { type: 'array', items: categorySchema },
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
