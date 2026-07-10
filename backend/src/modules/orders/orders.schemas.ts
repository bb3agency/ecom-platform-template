import { OrderStatus } from '@prisma/client';
import {
  standardAdminErrorResponses,
  standardErrorResponses
} from '@common/errors/error-response.schema';

const returnRequestStatusEnum = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'PICKED_UP',
  'REFUNDED'
] as const;

export const createReturnRequestSchema = {
  tags: ['orders'],
  summary: 'Create a return request for a delivered order',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'reason'],
    properties: {
      reason: { type: 'string', minLength: 1, maxLength: 500 },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['orderItemId', 'quantity'],
          properties: {
            orderItemId: { type: 'string', maxLength: 64 },
            quantity: { type: 'integer', minimum: 1, maximum: 10000 },
            reason: { type: 'string', maxLength: 500 }
          }
        }
      }
    }
  },
  response: {
    201: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'orderId', 'status', 'reason', 'createdAt'],
      properties: {
        id: { type: 'string' },
        orderId: { type: 'string' },
        status: { type: 'string', enum: returnRequestStatusEnum, maxLength: 30 },
        reason: { type: 'string' },
        createdAt: { type: 'string' }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const retryPaymentSchema = {
  tags: ['payments'],
  summary: 'Retry payment for a failed or pending-payment order',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['orderId'],
    properties: {
      orderId: { type: 'string', minLength: 1, maxLength: 64 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['orderId', 'provider', 'providerOrderId', 'amount', 'currency'],
      properties: {
        orderId: { type: 'string' },
        provider: { type: 'string' },
        providerOrderId: { type: 'string' },
        amount: { type: 'integer' },
        currency: { type: 'string' }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const adminListReturnRequestsSchema = {
  tags: ['admin', 'returns'],
  summary: 'List return requests',
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: returnRequestStatusEnum, maxLength: 30 },
      orderId: { type: 'string', maxLength: 36 },
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'total', 'page', 'limit'],
      properties: {
        total: { type: 'integer' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'orderId',
              'orderNumber',
              'userId',
              'customerEmail',
              'customerName',
              'status',
              'reason',
              'createdAt'
            ],
            properties: {
              id: { type: 'string' },
              orderId: { type: 'string' },
              orderNumber: { type: 'string' },
              userId: { type: 'string' },
              customerEmail: { type: 'string' },
              customerName: { type: 'string' },
              status: { type: 'string', enum: returnRequestStatusEnum, maxLength: 30 },
              reason: { type: 'string' },
              createdAt: { type: 'string' }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminGetReturnRequestSchema = {
  tags: ['admin', 'returns'],
  summary: 'Get a return request by ID',
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
      required: [
        'id',
        'orderId',
        'orderNumber',
        'userId',
        'customerEmail',
        'customerName',
        'status',
        'reason',
        'items',
        'createdAt',
        'updatedAt'
      ],
      properties: {
        id: { type: 'string' },
        orderId: { type: 'string' },
        orderNumber: { type: 'string' },
        userId: { type: 'string' },
        customerEmail: { type: 'string' },
        customerName: { type: 'string' },
        status: { type: 'string', enum: returnRequestStatusEnum, maxLength: 30 },
        reason: { type: 'string' },
        adminNote: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        items: { type: 'array', items: { type: 'object', additionalProperties: true } },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminUpdateReturnRequestSchema = {
  tags: ['admin', 'returns'],
  summary: 'Update a return request status',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['status'],
    properties: {
      status: { type: 'string', enum: returnRequestStatusEnum, maxLength: 30 },
      adminNote: { type: 'string', maxLength: 1000 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'orderId', 'status', 'updatedAt'],
      properties: {
        id: { type: 'string' },
        orderId: { type: 'string' },
        status: { type: 'string', enum: returnRequestStatusEnum, maxLength: 30 },
        adminNote: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        updatedAt: { type: 'string' }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminUpdateOrderItemsSchema = {
  tags: ['admin', 'orders'],
  summary: 'Update line item quantities for PENDING_PAYMENT or CONFIRMED orders',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
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
          required: ['orderItemId', 'quantity'],
          properties: {
            orderItemId: { type: 'string', maxLength: 64 },
            quantity: { type: 'integer', minimum: 1, maximum: 10000 }
          }
        }
      }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['orderId', 'subtotal', 'total', 'updatedItems'],
      properties: {
        orderId: { type: 'string' },
        subtotal: { type: 'integer' },
        total: { type: 'integer' },
        updatedItems: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['orderItemId', 'quantity', 'unitPrice', 'totalPrice'],
            properties: {
              orderItemId: { type: 'string' },
              quantity: { type: 'integer' },
              unitPrice: { type: 'integer' },
              totalPrice: { type: 'integer' }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

const orderStatusValues = Object.values(OrderStatus);
const emptyParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const;

export const adminGetInvoicePdfSchema = {
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
    properties: {}
  },
  response: {
    200: {
      type: 'string'
    },
    ...standardAdminErrorResponses
  }
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

const orderListItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'orderNumber',
    'userId',
    'status',
    'paymentMode',
    'subtotal',
    'shippingCharge',
    'discountAmount',
    'total',
    'createdAt',
    'customerName',
    'customerEmail',
    'customerPhone',
    'paymentMethod',
    'paymentStatus',
    'awbNumber',
    'labelUrl',
    'shipmentStatus',
    'canShipNow',
    'shipBlockReason',
    'shippingMode'
  ],
  properties: {
    id: { type: 'string', maxLength: 64 },
    orderNumber: { type: 'string', maxLength: 64 },
    userId: { type: 'string', maxLength: 64 },
    status: { type: 'string', enum: orderStatusValues, maxLength: 40 },
    paymentMode: { type: 'string', enum: ['PREPAID', 'COD'], maxLength: 10 },
    subtotal: { type: 'integer', minimum: 0, maximum: 1000000000 },
    shippingCharge: { type: 'integer', minimum: 0, maximum: 1000000000 },
    discountAmount: { type: 'integer', minimum: 0, maximum: 1000000000 },
    total: { type: 'integer', minimum: 0, maximum: 1000000000 },
    createdAt: { type: 'string', maxLength: 64 },
    customerName: { type: 'string', maxLength: 240 },
    customerEmail: { anyOf: [{ type: 'string', maxLength: 320 }, { type: 'null' }] },
    customerPhone: { anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }] },
    paymentMethod: { anyOf: [{ type: 'string', maxLength: 50 }, { type: 'null' }] },
    paymentStatus: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
    awbNumber: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
    labelUrl: { anyOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
    shipmentStatus: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
    canShipNow: { type: 'boolean' },
    shipBlockReason: { anyOf: [{ type: 'string', maxLength: 240 }, { type: 'null' }] },
    // Merchant-fulfilled local delivery (selectedShippingProvider = LOCAL) — no courier involved.
    isLocalDelivery: { type: 'boolean' },
    shippingMode: { type: 'string', enum: ['MANUAL'], maxLength: 10 }
  }
} as const;

const orderStatusHistoryItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'fromStatus', 'toStatus', 'triggeredBy', 'note', 'createdAt'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    fromStatus: {
      anyOf: [{ type: 'string', enum: orderStatusValues, maxLength: 40 }, { type: 'null' }]
    },
    toStatus: { type: 'string', enum: orderStatusValues, maxLength: 40 },
    triggeredBy: { type: 'string', maxLength: 40 },
    note: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
    createdAt: { type: 'string', maxLength: 64 }
  }
} as const;

const creditNoteItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['creditNoteNumber', 'originalInvoiceNumber', 'reason'],
  properties: {
    creditNoteNumber: { type: 'string', maxLength: 120 },
    originalInvoiceNumber: { type: 'string', maxLength: 120 },
    reason: { type: 'string', maxLength: 500 }
  }
} as const;

const orderItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'variantId',
    'productName',
    'variantName',
    'sku',
    'quantity',
    'unitPrice',
    'totalPrice'
  ],
  properties: {
    id: { type: 'string', maxLength: 64 },
    variantId: { type: 'string', maxLength: 64 },
    productName: { type: 'string', maxLength: 200 },
    variantName: { type: 'string', maxLength: 200 },
    sku: { type: 'string', maxLength: 100 },
    quantity: { type: 'integer', minimum: 1, maximum: 1000000 },
    unitPrice: { type: 'integer', minimum: 0, maximum: 1000000000 },
    totalPrice: { type: 'integer', minimum: 0, maximum: 1000000000 },
    // Optional PDP enrichment (customer order detail only): thumbnail + deep-link back to the
    // product page. Absent on admin paths that load bare order items.
    productSlug: { type: 'string', maxLength: 220 },
    imageUrl: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
    isPurchasable: { type: 'boolean' }
  }
} as const;

const shippingAddressSnapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fullName', 'phone', 'line1', 'city', 'state', 'pincode'],
  properties: {
    fullName: { type: 'string', maxLength: 100 },
    phone: { type: 'string', maxLength: 20 },
    line1: { type: 'string', maxLength: 200 },
    line2: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
    city: { type: 'string', maxLength: 100 },
    state: { type: 'string', maxLength: 100 },
    pincode: { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' }
  }
} as const;

const adminOrderDetailSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'orderNumber',
    'userId',
    'status',
    'paymentMode',
    'shippingAddress',
    'subtotal',
    'shippingCharge',
    'discountAmount',
    'total',
    'notes',
    'createdAt',
    'updatedAt',
    'items',
    'statusHistory',
    'creditNotes',
    'payment',
    'customer',
    'invoice',
    'shipment',
    'canShipNow',
    'shipBlockReason',
    'shippingMode'
  ],
  properties: {
    id: { type: 'string', maxLength: 64 },
    orderNumber: { type: 'string', maxLength: 64 },
    userId: { type: 'string', maxLength: 64 },
    status: { type: 'string', enum: orderStatusValues, maxLength: 40 },
    paymentMode: { type: 'string', enum: ['PREPAID', 'COD'], maxLength: 10 },
    shippingAddress: shippingAddressSnapshotSchema,
    subtotal: { type: 'integer', minimum: 0, maximum: 1000000000 },
    shippingCharge: { type: 'integer', minimum: 0, maximum: 1000000000 },
    shippingChargeQuotedPaise: { anyOf: [{ type: 'integer', minimum: 0, maximum: 1000000000 }, { type: 'null' }] },
    selectedShippingProvider: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
    discountAmount: { type: 'integer', minimum: 0, maximum: 1000000000 },
    couponCode: { anyOf: [{ type: 'string', maxLength: 50 }, { type: 'null' }] },
    // Applied coupon (from CouponUsage). Nullable; fields beyond `code` are present on admin
    // reads (full select) and absent on customer reads (code-only select) — hence all optional.
    coupon: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', maxLength: 64 },
            code: { type: 'string', maxLength: 50 },
            type: { type: 'string', maxLength: 30 },
            value: { type: 'integer', minimum: 0, maximum: 1000000000 },
            minOrderPaise: { type: 'integer', minimum: 0, maximum: 1000000000 },
            maxUsesTotal: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
            usesCount: { type: 'integer', minimum: 0 }
          }
        },
        { type: 'null' }
      ]
    },
    total: { type: 'integer', minimum: 0, maximum: 1000000000 },
    canShipNow: { type: 'boolean' },
    shipBlockReason: { anyOf: [{ type: 'string', maxLength: 240 }, { type: 'null' }] },
    // Merchant-fulfilled local delivery (selectedShippingProvider = LOCAL) — no courier involved.
    isLocalDelivery: { type: 'boolean' },
    shippingMode: { type: 'string', enum: ['MANUAL'], maxLength: 10 },
    notes: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
    createdAt: { type: 'string', maxLength: 64 },
    updatedAt: { type: 'string', maxLength: 64 },
    items: { type: 'array', items: orderItemSchema },
    statusHistory: { type: 'array', items: orderStatusHistoryItemSchema },
    creditNotes: { type: 'array', items: creditNoteItemSchema },
    payment: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'provider',
            'providerOrderId',
            'providerPaymentId',
            'amount',
            'status',
            'method',
            'capturedAt',
            'refundPendingAmountPaise',
            'refundedAmountPaise'
          ],
          properties: {
            id: { type: 'string', maxLength: 64 },
            provider: { type: 'string', maxLength: 30 },
            providerOrderId: { type: 'string', maxLength: 100 },
            providerPaymentId: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
            amount: { type: 'integer', minimum: 0, maximum: 1000000000 },
            status: { type: 'string', maxLength: 40 },
            method: { anyOf: [{ type: 'string', maxLength: 50 }, { type: 'null' }] },
            capturedAt: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
            refundPendingAmountPaise: { type: 'integer', minimum: 0, maximum: 1000000000 },
            refundedAmountPaise: { type: 'integer', minimum: 0, maximum: 1000000000 }
          }
        },
        { type: 'null' }
      ]
    },
    customer: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'email', 'phone'],
      properties: {
        name: { type: 'string', maxLength: 240 },
        email: { anyOf: [{ type: 'string', maxLength: 320 }, { type: 'null' }] },
        phone: { anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }] }
      }
    },
    invoice: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['invoiceNumber', 'hasPdf', 'issuedAt'],
          properties: {
            invoiceNumber: { type: 'string', maxLength: 120 },
            hasPdf: { type: 'boolean' },
            issuedAt: { type: 'string', maxLength: 64 }
          }
        },
        { type: 'null' }
      ]
    },
    shipment: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'provider', 'status', 'awb', 'trackingUrl', 'events'],
          // Field distinction:
          // - shipmentLabelUrl: derived / normalized label URL (heuristic from trackingUrl for Delhivery, preferred from explicit labelUrl for Shiprocket). Included only when exposeInternalReferences=true.
          // - labelUrl: raw Shiprocket label URL from the provider API response. Only present when provider is Shiprocket.
          // - shiprocketShipmentId: raw Shiprocket shipment ID from the provider API. Only present when provider is Shiprocket.
          // - pickupScheduledDate: set after admin calls schedule-pickup. Only relevant for Shiprocket.
          properties: {
            id: { type: 'string', maxLength: 64 },
            provider: { type: 'string', maxLength: 30 },
            status: { type: 'string', maxLength: 40 },
            awb: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
            trackingUrl: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
            shipmentLabelUrl: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
            shiprocketShipmentId: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
            labelUrl: { anyOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
            pickupScheduledDate: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
            events: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'shipmentId', 'status', 'location', 'description', 'occurredAt'],
                properties: {
                  id: { type: 'string', maxLength: 64 },
                  shipmentId: { type: 'string', maxLength: 64 },
                  status: { type: 'string', maxLength: 80 },
                  location: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] },
                  description: { type: 'string', maxLength: 500 },
                  occurredAt: { type: 'string', maxLength: 64 }
                }
              }
            }
          }
        },
        { type: 'null' }
      ]
    },
    packingBox: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['lengthCm', 'widthCm', 'heightCm', 'weightGrams', 'packagingWeightGrams', 'source', 'boxName'],
          properties: {
            lengthCm: { type: 'integer', minimum: 1, maximum: 100000 },
            widthCm: { type: 'integer', minimum: 1, maximum: 100000 },
            heightCm: { type: 'integer', minimum: 1, maximum: 100000 },
            // Full sealed-parcel weight = items + packaging (matches courier declaration).
            weightGrams: { type: 'integer', minimum: 1, maximum: 100000000 },
            // The packaging (carton + tape + void fill) portion of weightGrams.
            packagingWeightGrams: { type: 'integer', minimum: 0, maximum: 1000000 },
            source: {
              type: 'string',
              enum: ['catalog', 'computed', 'single-item', 'default-fallback'],
              maxLength: 24
            },
            boxName: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] }
          }
        },
        { type: 'null' }
      ]
    }
  }
} as const;

const adminOrderDetailSchemaWithoutUserIdProperties = Object.fromEntries(
  Object.entries(adminOrderDetailSchema.properties).filter(([key]) => key !== 'userId')
) as typeof adminOrderDetailSchema.properties;

const customerOrderDetailSchema = {
  ...adminOrderDetailSchema,
  required: adminOrderDetailSchema.required.filter((field) => field !== 'userId'),
  properties: {
    ...adminOrderDetailSchemaWithoutUserIdProperties,
    // Customer-visible return requests for this order (admin audit markers stripped from notes).
    returnRequests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status', 'reason', 'adminNote', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', maxLength: 64 },
          status: { type: 'string', maxLength: 30 },
          reason: { type: 'string', maxLength: 2000 },
          adminNote: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
          createdAt: { type: 'string', maxLength: 64 },
          updatedAt: { type: 'string', maxLength: 64 }
        }
      }
    },
    payment: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'provider',
            'amount',
            'status',
            'method',
            'capturedAt',
            'refundPendingAmountPaise',
            'refundedAmountPaise'
          ],
          properties: {
            provider: { type: 'string', maxLength: 30 },
            amount: { type: 'integer', minimum: 0, maximum: 1000000000 },
            status: { type: 'string', maxLength: 40 },
            method: { anyOf: [{ type: 'string', maxLength: 50 }, { type: 'null' }] },
            capturedAt: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
            refundPendingAmountPaise: { type: 'integer', minimum: 0, maximum: 1000000000 },
            refundedAmountPaise: { type: 'integer', minimum: 0, maximum: 1000000000 }
          }
        },
        { type: 'null' }
      ]
    },
    shipment: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['provider', 'status', 'awb', 'trackingUrl', 'events'],
          properties: {
            provider: { type: 'string', maxLength: 30 },
            status: { type: 'string', maxLength: 40 },
            awb: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
            trackingUrl: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
            events: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'status', 'location', 'description', 'occurredAt'],
                properties: {
                  id: { type: 'string', maxLength: 64 },
                  status: { type: 'string', maxLength: 80 },
                  location: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] },
                  description: { type: 'string', maxLength: 500 },
                  occurredAt: { type: 'string', maxLength: 64 }
                }
              }
            }
          }
        },
        { type: 'null' }
      ]
    }
  }
} as const;

export const adminListOrdersSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      status: { type: 'string', enum: orderStatusValues, maxLength: 40 },
      from: { type: 'string', format: 'date-time', maxLength: 64 },
      to: { type: 'string', format: 'date-time', maxLength: 64 },
      search: { type: 'string', maxLength: 100 },
      paymentMode: { type: 'string', enum: ['PREPAID', 'COD'], maxLength: 10 },
      sort: { type: 'string', enum: ['newest', 'oldest'], maxLength: 10 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'meta'],
      properties: {
        items: { type: 'array', items: orderListItemSchema },
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

export const adminExportOrdersCsvSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['from', 'to'],
    properties: {
      from: { type: 'string', format: 'date-time', maxLength: 64 },
      to: { type: 'string', format: 'date-time', maxLength: 64 },
      status: { type: 'string', enum: orderStatusValues, maxLength: 40 },
      search: { type: 'string', maxLength: 100 },
      paymentMode: { type: 'string', enum: ['PREPAID', 'COD'], maxLength: 10 }
    }
  },
  response: {
    200: {
      type: 'string'
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminGetOrderByIdSchema = {
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
    200: adminOrderDetailSchema,
    ...standardAdminErrorResponses
  }
} as const;

// DEFERRED STATUS NOTE — transitioning to OrderStatus.REFUNDED:
// Setting status = 'REFUNDED' does NOT immediately flip the order status in the response.
// Instead it enqueues a refund job via the `refunds` BullMQ queue (worker: refunds).
// The order remains in its current status (e.g. CANCELLED) until the refund worker
// successfully confirms the Razorpay refund and updates the order status to REFUNDED.
// This means the 200 response will still show the pre-refund status; poll or listen for
// the payment.refundStatus change.  If the refund job fails it will be retried up to the
// configured BullMQ attempt limit before moving to the dead-letter queue.
export const adminUpdateOrderStatusSchema = {
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
    required: ['status'],
    properties: {
      status: { type: 'string', enum: orderStatusValues, maxLength: 40 },
      note: { type: 'string', maxLength: 500 },
      refundAmountPaise: { type: 'integer', minimum: 1, maximum: 1000000000 }
    }
  },
  querystring: emptyQuerystringSchema,
  response: {
    200: adminOrderDetailSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const createOrderSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      addressId: { type: 'string', maxLength: 64 },
      shippingAddress: {
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
          pincode: { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' }
        }
      },
      notes: { type: 'string', maxLength: 2000 },
      paymentMode: { type: 'string', enum: ['PREPAID', 'COD'], maxLength: 10 },
      // 'LOCAL' is accepted (checkout echoes the quote back) but never trusted — the
      // server re-derives the local-delivery decision from the whitelist.
      selectedShippingProvider: { type: 'string', enum: ['DELHIVERY', 'SHIPROCKET', 'LOCAL'], maxLength: 20 },
      shippingChargePaise: { type: 'integer', minimum: 0, maximum: 10000000 },
      courierCompanyId: { type: 'integer', minimum: 1 }
    },
    anyOf: [{ required: ['addressId'] }, { required: ['shippingAddress'] }]
  },
  response: {
    200: customerOrderDetailSchema,
    ...standardErrorResponses
  }
} as const;

export const getMyOrderByIdSchema = {
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
    200: customerOrderDetailSchema,
    ...standardErrorResponses
  }
} as const;

export const getMyInvoicePdfSchema = {
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
      type: 'string'
    },
    ...standardErrorResponses
  }
} as const;

export const cancelMyOrderSchema = {
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
    properties: {
      reason: { type: 'string', maxLength: 500 },
      refundAmountPaise: { type: 'integer', minimum: 1, maximum: 1000000000 }
    }
  },
  response: {
    200: customerOrderDetailSchema,
    ...standardErrorResponses
  }
} as const;

export const initiatePaymentSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
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
      required: ['orderId', 'provider', 'providerOrderId', 'amount', 'currency'],
      properties: {
        orderId: { type: 'string', maxLength: 64 },
        provider: { type: 'string', maxLength: 30 },
        providerOrderId: { type: 'string', maxLength: 100 },
        amount: { type: 'integer', minimum: 0, maximum: 1000000000 },
        currency: { type: 'string', maxLength: 10 }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const verifyPaymentSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['orderId', 'razorpayPaymentId', 'razorpaySignature'],
    properties: {
      orderId: { type: 'string', maxLength: 64 },
      razorpayPaymentId: { type: 'string', maxLength: 100 },
      razorpaySignature: { type: 'string', maxLength: 256 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { type: 'string', maxLength: 120 }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const prepareCheckoutSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      addressId: { type: 'string', maxLength: 64 },
      shippingAddress: {
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
          pincode: { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' }
        }
      },
      notes: { type: 'string', maxLength: 2000 },
      // 'LOCAL' is accepted (checkout echoes the quote back) but never trusted — the
      // server re-derives the local-delivery decision from the whitelist.
      selectedShippingProvider: { type: 'string', enum: ['DELHIVERY', 'SHIPROCKET', 'LOCAL'], maxLength: 20 },
      shippingChargePaise: { type: 'integer', minimum: 0, maximum: 10000000 },
      courierCompanyId: { type: 'integer', minimum: 1 }
    },
    anyOf: [{ required: ['addressId'] }, { required: ['shippingAddress'] }]
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['checkoutSessionId', 'razorpayOrderId', 'amount', 'currency'],
      properties: {
        checkoutSessionId: { type: 'string', maxLength: 120 },
        razorpayOrderId: { type: 'string', maxLength: 100 },
        amount: { type: 'integer', minimum: 0, maximum: 1000000000 },
        currency: { type: 'string', maxLength: 10 }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const confirmPrepaidSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['checkoutSessionId', 'razorpayOrderId', 'razorpayPaymentId', 'razorpaySignature'],
    properties: {
      checkoutSessionId: { type: 'string', maxLength: 120 },
      razorpayOrderId: { type: 'string', maxLength: 100 },
      razorpayPaymentId: { type: 'string', maxLength: 100 },
      razorpaySignature: { type: 'string', maxLength: 256 }
    }
  },
  response: {
    200: customerOrderDetailSchema,
    ...standardErrorResponses
  }
} as const;

export const paymentWebhookSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    properties: {}
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {}
  },
  headers: {
    type: 'object',
    additionalProperties: true,
    required: ['x-razorpay-signature'],
    properties: {
      'x-razorpay-signature': { type: 'string', maxLength: 512 },
      'x-razorpay-event-id': { type: 'string', maxLength: 256 }
    }
  },
  body: {
    anyOf: [{ type: 'string', maxLength: 2000000 }, { type: 'object' }]
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['received'],
      properties: {
        received: { type: 'boolean' }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const shippingTrackSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['awb'],
    properties: {
      awb: { type: 'string', maxLength: 100 }
    }
  },
  querystring: emptyQuerystringSchema,
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status', 'location', 'description', 'occurredAt'],
        properties: {
          id: { type: 'string', maxLength: 64 },
          status: { type: 'string', maxLength: 80 },
          location: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] },
          description: { type: 'string', maxLength: 500 },
          occurredAt: { type: 'string', maxLength: 64 }
        }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const shippingWebhookSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    properties: {}
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {}
  },
  headers: {
    type: 'object',
    additionalProperties: true,
    properties: {
      authorization: { type: 'string', maxLength: 512 },
      'x-api-key': { type: 'string', maxLength: 512 },
      'x-shiprocket-token': { type: 'string', maxLength: 512 }
    }
  },
  body: {
    anyOf: [{ type: 'string', maxLength: 2000000 }, { type: 'object' }]
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['received'],
      properties: {
        received: { type: 'boolean' }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const adminShipOrderSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  querystring: emptyQuerystringSchema,
  body: emptyBodySchema,
  response: {
    200: adminOrderDetailSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminCancelOrderSchema = {
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
    properties: {
      reason: { type: 'string', maxLength: 500 },
      refundAmountPaise: { type: 'integer', minimum: 1, maximum: 1000000000 }
    }
  },
  response: {
    200: adminOrderDetailSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminSchedulePickupSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  querystring: emptyQuerystringSchema,
  body: emptyBodySchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['scheduled'],
      properties: {
        scheduled: { type: 'boolean' },
        alreadyScheduled: { type: 'boolean' },
        pickupScheduledDate: { type: 'string', maxLength: 64 },
        pickupTokenNumber: { type: 'string', maxLength: 64 }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminPrintLabelSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  querystring: emptyQuerystringSchema,
  body: emptyBodySchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      // Either labelUrl (Shiprocket PDF) or labelHtml (Delhivery rendered HTML) is present.
      properties: {
        labelUrl: { anyOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
        labelHtml: { anyOf: [{ type: 'string', maxLength: 524288 }, { type: 'null' }] }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

const boardOrderItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'orderNumber',
    'status',
    'paymentMode',
    'total',
    'createdAt',
    'customerName',
    'customerPhone',
    'awbNumber',
    'labelUrl',
    'shipmentStatus',
    'canShipNow',
    'shipBlockReason',
    'shippingMode'
  ],
  properties: {
    id: { type: 'string', maxLength: 64 },
    orderNumber: { type: 'string', maxLength: 64 },
    status: { type: 'string', enum: orderStatusValues, maxLength: 40 },
    paymentMode: { type: 'string', enum: ['PREPAID', 'COD'], maxLength: 10 },
    total: { type: 'integer', minimum: 0, maximum: 1000000000 },
    createdAt: { type: 'string', maxLength: 64 },
    customerName: { type: 'string', maxLength: 240 },
    customerPhone: { anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }] },
    awbNumber: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
    labelUrl: { anyOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
    shipmentStatus: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
    canShipNow: { type: 'boolean' },
    shipBlockReason: { anyOf: [{ type: 'string', maxLength: 240 }, { type: 'null' }] },
    // Merchant-fulfilled local delivery (selectedShippingProvider = LOCAL) — no courier involved.
    isLocalDelivery: { type: 'boolean' },
    shippingMode: { type: 'string', enum: ['MANUAL'], maxLength: 10 }
  }
} as const;

export const adminOrderBoardSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['columns'],
      properties: {
        columns: {
          type: 'object',
          additionalProperties: false,
          required: [
            'CONFIRMED',
            'PROCESSING',
            'SHIPPED',
            'OUT_FOR_DELIVERY',
            'DELIVERED',
            'CANCELLED'
          ],
          properties: {
            CONFIRMED: { type: 'array', items: boardOrderItemSchema },
            PROCESSING: { type: 'array', items: boardOrderItemSchema },
            SHIPPED: { type: 'array', items: boardOrderItemSchema },
            OUT_FOR_DELIVERY: { type: 'array', items: boardOrderItemSchema },
            DELIVERED: { type: 'array', items: boardOrderItemSchema },
            CANCELLED: { type: 'array', items: boardOrderItemSchema }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

const paginationMetaSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['page', 'limit', 'total', 'totalPages'],
  properties: {
    page: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1 },
    total: { type: 'integer', minimum: 0 },
    totalPages: { type: 'integer', minimum: 0 }
  }
} as const;

export const adminListShipmentsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      status: { type: 'string', maxLength: 40 },
      awbNumber: { type: 'string', maxLength: 100 },
      orderId: { type: 'string', maxLength: 64 },
      search: { type: 'string', maxLength: 100 },
      from: { type: 'string', maxLength: 64 },
      to: { type: 'string', maxLength: 64 }
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
            required: [
              'id',
              'orderId',
              'orderNumber',
              'customerName',
              'provider',
              'status',
              'createdAt',
              'updatedAt'
            ],
            properties: {
              id: { type: 'string', maxLength: 64 },
              orderId: { type: 'string', maxLength: 64 },
              orderNumber: { type: 'string', maxLength: 64 },
              customerName: { type: 'string', maxLength: 200 },
              provider: { type: 'string', maxLength: 40 },
              status: { type: 'string', maxLength: 40 },
              awbNumber: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
              trackingUrl: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
              shiprocketShipmentId: {
                anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }]
              },
              labelUrl: { anyOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
              pickupScheduledDate: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
              createdAt: { type: 'string', maxLength: 64 },
              updatedAt: { type: 'string', maxLength: 64 }
            }
          }
        },
        meta: paginationMetaSchema
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminListPaymentsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      status: { type: 'string', maxLength: 40 },
      method: { type: 'string', maxLength: 40 },
      orderId: { type: 'string', maxLength: 64 },
      search: { type: 'string', maxLength: 100 },
      from: { type: 'string', maxLength: 64 },
      to: { type: 'string', maxLength: 64 }
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
            required: [
              'id',
              'orderId',
              'orderNumber',
              'provider',
              'status',
              'amount',
              'currency',
              'createdAt',
              'updatedAt'
            ],
            properties: {
              id: { type: 'string', maxLength: 64 },
              orderId: { type: 'string', maxLength: 64 },
              orderNumber: { type: 'string', maxLength: 64 },
              customerName: { type: 'string', maxLength: 240 },
              customerEmail: { anyOf: [{ type: 'string', maxLength: 320 }, { type: 'null' }] },
              provider: { type: 'string', maxLength: 40 },
              method: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
              status: { type: 'string', maxLength: 40 },
              amount: { type: 'integer', minimum: 0 },
              currency: { type: 'string', maxLength: 10 },
              providerPaymentId: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
              providerOrderId: { type: 'string', maxLength: 100 },
              capturedAt: { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
              refundPendingAmountPaise: { type: 'integer', minimum: 0 },
              refundedAmountPaise: { type: 'integer', minimum: 0 },
              createdAt: { type: 'string', maxLength: 64 },
              updatedAt: { type: 'string', maxLength: 64 }
            }
          }
        },
        meta: paginationMetaSchema
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminRetriggerNotificationSchema = {
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
    // `template` optional: when omitted, the backend derives it from the
    // order's CURRENT status so "Resend notification" always reflects the
    // exact state of the order at that moment.
    properties: {
      template: {
        type: 'string',
        enum: [
          'OrderConfirmed',
          'PaymentFailed',
          'OrderShipped',
          'OutForDelivery',
          'OrderDelivered',
          'OrderCancelled'
        ],
        maxLength: 40
      },
      channels: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
        items: {
          type: 'string',
          enum: ['EMAIL', 'SMS', 'WHATSAPP'],
          maxLength: 20
        }
      }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['orderId', 'template', 'channels', 'queuedJobs'],
      properties: {
        orderId: { type: 'string', maxLength: 64 },
        template: { type: 'string', maxLength: 40 },
        channels: {
          type: 'array',
          items: { type: 'string', maxLength: 20 }
        },
        queuedJobs: { type: 'integer', minimum: 0, maximum: 10 }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminGetShipmentByIdSchema = {
  tags: ['admin', 'shipments'],
  summary: 'Get a single shipment by ID',
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
      required: [
        'id',
        'orderId',
        'orderNumber',
        'userId',
        'provider',
        'status',
        'createdAt',
        'updatedAt'
      ],
      properties: {
        id: { type: 'string' },
        orderId: { type: 'string' },
        orderNumber: { type: 'string' },
        userId: { type: 'string' },
        provider: { type: 'string' },
        status: { type: 'string' },
        awbNumber: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        trackingUrl: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        shiprocketShipmentId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        labelUrl: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        pickupScheduledDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminSyncShipmentStatusSchema = {
  tags: ['admin', 'shipments'],
  summary: 'Force-sync shipment status from shipping provider',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', maxLength: 64 } }
  },
  response: {
    // MUST mirror adminSyncShipmentStatus's actual return shape. The previous
    // schema declared { id, status, updatedAt } — fields the service never
    // returned — so fast-json-stringify failed the required check and turned
    // EVERY sync into a 500 (after the sync work had already committed).
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['synced', 'message', 'shipmentStatus', 'orderStatus'],
      properties: {
        synced: { type: 'boolean' },
        message: { type: 'string' },
        shipmentStatus: { type: 'string' },
        orderStatus: { type: 'string' }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminGetPaymentByIdSchema = {
  tags: ['admin', 'payments'],
  summary: 'Get a single payment by ID',
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
      required: [
        'id',
        'orderId',
        'orderNumber',
        'provider',
        'status',
        'amount',
        'currency',
        'createdAt',
        'updatedAt'
      ],
      properties: {
        id: { type: 'string' },
        orderId: { type: 'string' },
        orderNumber: { type: 'string' },
        provider: { type: 'string' },
        method: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        status: { type: 'string' },
        amount: { type: 'integer' },
        currency: { type: 'string' },
        providerPaymentId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        providerOrderId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        capturedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        refundPendingAmountPaise: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        refundedAmountPaise: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminGetOrderTimelineSchema = {
  tags: ['admin', 'orders'],
  summary: 'Get the status transition timeline for an order',
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
      required: ['orderId', 'orderNumber', 'currentStatus', 'timeline'],
      properties: {
        orderId: { type: 'string' },
        orderNumber: { type: 'string' },
        currentStatus: { type: 'string', enum: Object.values(OrderStatus) },
        timeline: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'toStatus', 'createdAt'],
            properties: {
              id: { type: 'string' },
              fromStatus: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              toStatus: { type: 'string' },
              triggeredBy: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              createdAt: { type: 'string' }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;
