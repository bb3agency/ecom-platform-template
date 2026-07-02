import { standardAdminErrorResponses, standardErrorResponses } from '@common/errors/error-response.schema';

const userSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email', 'phone', 'firstName', 'lastName', 'role', 'isVerified'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    email: { anyOf: [{ type: 'string', maxLength: 255 }, { type: 'null' }] },
    phone: { type: 'string', maxLength: 20 },
    firstName: { type: 'string', maxLength: 100 },
    lastName: { type: 'string', maxLength: 100 },
    role: { type: 'string', maxLength: 20 },
    isVerified: { type: 'boolean' }
  }
} as const;

const addressSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'fullName', 'phone', 'line1', 'city', 'state', 'pincode', 'isDefault'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    fullName: { type: 'string', maxLength: 100 },
    phone: { type: 'string', maxLength: 20 },
    line1: { type: 'string', maxLength: 200 },
    line2: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
    city: { type: 'string', maxLength: 100 },
    state: { type: 'string', maxLength: 100 },
    pincode: { type: 'string', maxLength: 12 },
    isDefault: { type: 'boolean' }
  }
} as const;

const orderSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'orderNumber',
    'status',
    'subtotal',
    'shippingCharge',
    'discountAmount',
    'total',
    'createdAt',
    'shipmentStatus',
    'awb',
    'trackingUrl',
    'latestShipmentEventStatus',
    'latestShipmentEventAt'
  ],
  properties: {
    id: { type: 'string', maxLength: 64 },
    orderNumber: { type: 'string', maxLength: 30 },
    status: { type: 'string', maxLength: 40 },
    subtotal: { type: 'integer', minimum: 0, maximum: 1000000000 },
    shippingCharge: { type: 'integer', minimum: 0, maximum: 1000000000 },
    discountAmount: { type: 'integer', minimum: 0, maximum: 1000000000 },
    total: { type: 'integer', minimum: 0, maximum: 1000000000 },
    createdAt: { type: 'string', maxLength: 64 },
    shipmentStatus: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
    awb: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
    trackingUrl: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
    latestShipmentEventStatus: { anyOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }] },
    latestShipmentEventAt: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] }
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

export const getMeSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: userSchema,
    ...standardErrorResponses
  }
} as const;

export const patchMeSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      firstName: { type: 'string', maxLength: 100 },
      lastName: { type: 'string', maxLength: 100 },
      email: { type: 'string', format: 'email', maxLength: 255 },
      /** Set/update the login mobile number, or `null` to remove it (guarded server-side). */
      phone: {
        anyOf: [
          { type: 'string', pattern: '^\\+?[0-9]{10,15}$' },
          { type: 'null' }
        ]
      }
    }
  },
  response: {
    200: userSchema,
    ...standardErrorResponses
  }
} as const;

export const listAddressesSchema = {
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
        items: {
          type: 'array',
          items: addressSchema
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
    ...standardErrorResponses
  }
} as const;

export const createAddressSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['fullName', 'phone', 'line1', 'city', 'state', 'pincode'],
    properties: {
      fullName: { type: 'string', maxLength: 100 },
      phone: { type: 'string', maxLength: 20 },
      line1: { type: 'string', maxLength: 200 },
      line2: { type: 'string', maxLength: 200 },
      city: { type: 'string', maxLength: 100 },
      state: { type: 'string', maxLength: 100 },
      pincode: { type: 'string', maxLength: 12 },
      isDefault: { type: 'boolean' }
    }
  },
  response: {
    200: addressSchema,
    ...standardErrorResponses
  }
} as const;

export const updateAddressSchema = {
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
    properties: {
      fullName: { type: 'string', maxLength: 100 },
      phone: { type: 'string', maxLength: 20 },
      line1: { type: 'string', maxLength: 200 },
      line2: { type: 'string', maxLength: 200 },
      city: { type: 'string', maxLength: 100 },
      state: { type: 'string', maxLength: 100 },
      pincode: { type: 'string', maxLength: 12 },
      isDefault: { type: 'boolean' }
    }
  },
  response: {
    200: addressSchema,
    ...standardErrorResponses
  }
} as const;

export const deleteAddressSchema = {
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

export const listOrdersSchema = {
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
        items: {
          type: 'array',
          items: orderSchema
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
    ...standardErrorResponses
  }
} as const;

const adminUserListItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email', 'phone', 'firstName', 'lastName', 'isBanned', 'totalOrders', 'totalSpendPaise', 'createdAt'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    email: { anyOf: [{ type: 'string', maxLength: 255 }, { type: 'null' }] },
    phone: { anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }] },
    firstName: { type: 'string', maxLength: 100 },
    lastName: { type: 'string', maxLength: 100 },
    isBanned: { type: 'boolean' },
    totalOrders: { type: 'integer', minimum: 0, maximum: 1000000000 },
    totalSpendPaise: { type: 'integer', minimum: 0, maximum: 1000000000000 },
    createdAt: { type: 'string', maxLength: 64 }
  }
} as const;

export const adminListUsersSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      search: { type: 'string', maxLength: 200 },
      banned: { type: 'boolean' },
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
          items: adminUserListItemSchema
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

export const adminGetUserByIdSchema = {
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
    200: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'email',
        'phone',
        'firstName',
        'lastName',
        'isBanned',
        'createdAt',
        'addresses',
        'orders'
      ],
      properties: {
        id: { type: 'string', maxLength: 64 },
        email: { anyOf: [{ type: 'string', maxLength: 255 }, { type: 'null' }] },
        phone: { anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }] },
        firstName: { type: 'string', maxLength: 100 },
        lastName: { type: 'string', maxLength: 100 },
        isBanned: { type: 'boolean' },
        bannedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        bannedReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        createdAt: { type: 'string', maxLength: 64 },
        addresses: {
          type: 'array',
          items: addressSchema
        },
        orders: {
          type: 'array',
          items: orderSchema
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminGetCustomerOrdersSchema = {
  tags: ['admin', 'users'],
  summary: 'Paginated order history for a customer',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
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
      required: ['items', 'meta'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'orderNumber', 'status', 'subtotal', 'shippingCharge', 'discountAmount', 'total', 'createdAt'],
            properties: {
              id: { type: 'string', maxLength: 64 },
              orderNumber: { type: 'string', maxLength: 64 },
              status: { type: 'string', maxLength: 40 },
              subtotal: { type: 'integer', minimum: 0 },
              shippingCharge: { type: 'integer', minimum: 0 },
              discountAmount: { type: 'integer', minimum: 0 },
              total: { type: 'integer', minimum: 0 },
              createdAt: { type: 'string', maxLength: 64 },
              shipmentStatus: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
              awb: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
              trackingUrl: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
              latestShipmentEventStatus: { anyOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }] },
              latestShipmentEventAt: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] }
            }
          }
        },
        meta: {
          type: 'object',
          additionalProperties: false,
          required: ['page', 'limit', 'total', 'totalPages'],
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

const userNoteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'userId', 'content', 'createdByAdminId', 'createdAt'],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    content: { type: 'string' },
    createdByAdminId: { type: 'string' },
    createdAt: { type: 'string' }
  }
} as const;

export const adminBanUserSchema = {
  tags: ['admin', 'users'],
  summary: 'Ban a customer account',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      reason: { type: 'string', minLength: 1, maxLength: 500 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['userId', 'isBanned'],
      properties: {
        userId: { type: 'string' },
        isBanned: { type: 'boolean' },
        bannedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        bannedReason: { anyOf: [{ type: 'string' }, { type: 'null' }] }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminUnbanUserSchema = {
  tags: ['admin', 'users'],
  summary: 'Remove ban from a customer account',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['userId', 'isBanned'],
      properties: {
        userId: { type: 'string' },
        isBanned: { type: 'boolean' }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminListUserNotesSchema = {
  tags: ['admin', 'users'],
  summary: 'List admin notes for a customer',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
  response: {
    200: {
      type: 'array',
      items: userNoteSchema
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminCreateUserNoteSchema = {
  tags: ['admin', 'users'],
  summary: 'Create an admin note for a customer',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['content'],
    properties: {
      content: { type: 'string', minLength: 1, maxLength: 2000 }
    }
  },
  response: {
    201: userNoteSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminDeleteUserNoteSchema = {
  tags: ['admin', 'users'],
  summary: 'Delete an admin note',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'noteId'],
    properties: {
      id: { type: 'string', maxLength: 64 },
      noteId: { type: 'string', maxLength: 64 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['deleted', 'noteId'],
      properties: {
        deleted: { type: 'boolean' },
        noteId: { type: 'string' }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

