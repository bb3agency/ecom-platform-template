import { standardAdminErrorResponses } from '@common/errors/error-response.schema';

const granularityValues = ['hour', 'day', 'week'] as const;

const emptyParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const;

const replayPreviewCurrentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'updatedAt'],
  properties: {
    status: { type: 'string', maxLength: 32 },
    attemptCount: { type: 'integer', minimum: 0, maximum: 1000000 },
    lastError: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
    updatedAt: { type: 'string', maxLength: 64 }
  }
} as const;

const replayPreviewProposedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', maxLength: 64 },
    nextJobName: { type: 'string', maxLength: 64 },
    nextAttemptCount: { type: 'integer', minimum: 0, maximum: 1000000 },
    operationType: { type: 'string', enum: ['canonical_reprocess', 'mark_processing'], maxLength: 32 },
    nextStatus: { type: 'string', maxLength: 32 }
  }
} as const;

const replayPreviewDiffSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fields'],
  properties: {
    fields: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'string', maxLength: 64 }
    },
    payloadFingerprint: { type: 'string', maxLength: 128 },
    eventRef: { type: 'string', maxLength: 256 },
    idempotencyKeyMapping: {
      type: 'object',
      additionalProperties: false,
      required: ['provider', 'eventKey'],
      properties: {
        provider: { type: 'string', maxLength: 64 },
        eventKey: { type: 'string', maxLength: 180 }
      }
    }
  }
} as const;

const reconciliationDetailsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['healPolicy', 'severity'],
  properties: {
    healPolicy: { type: 'string', maxLength: 32 },
    severity: { type: 'string', maxLength: 32 },
    retryable: { type: 'boolean' },
    retryAfterSeconds: { anyOf: [{ type: 'integer', minimum: 0, maximum: 86400 }, { type: 'null' }] },
    recommendation: { type: 'string', maxLength: 300 },
    correlationId: { type: 'string', maxLength: 128 },
    traceId: { type: 'string', maxLength: 128 }
  }
} as const;

const dateRangeQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: { type: 'string', format: 'date-time', maxLength: 64 },
    to: { type: 'string', format: 'date-time', maxLength: 64 }
  }
} as const;

export const analyticsRevenueSchema = {
  params: emptyParamsSchema,
  querystring: {
    ...dateRangeQuerySchema,
    properties: {
      ...dateRangeQuerySchema.properties,
      granularity: { type: 'string', enum: granularityValues, maxLength: 10 }
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
            required: ['bucket', 'revenuePaise', 'ordersCount'],
            properties: {
              bucket: { type: 'string', maxLength: 64 },
              revenuePaise: { type: 'integer', minimum: 0, maximum: 1000000000000 },
              ordersCount: { type: 'integer', minimum: 0, maximum: 1000000000 }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const analyticsFunnelSchema = {
  params: emptyParamsSchema,
  querystring: dateRangeQuerySchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['steps'],
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['eventType', 'count', 'conversionRatePercent'],
            properties: {
              eventType: { type: 'string', maxLength: 50 },
              count: { type: 'integer', minimum: 0, maximum: 1000000000 },
              conversionRatePercent: { type: 'number', minimum: 0, maximum: 100 }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const analyticsInventoryAlertsSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {}
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
            required: ['variantId', 'sku', 'variantName', 'quantity', 'lowStockThreshold', 'productName', 'occurredAt'],
            properties: {
              variantId: { type: 'string', maxLength: 64 },
              sku: { type: 'string', maxLength: 100 },
              variantName: { type: 'string', maxLength: 200 },
              quantity: { type: 'integer', minimum: 0, maximum: 1000000000 },
              lowStockThreshold: { type: 'integer', minimum: 0, maximum: 1000000000 },
              productName: { type: 'string', maxLength: 200 },
              occurredAt: { type: 'string', maxLength: 64 }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const analyticsRevenueCsvSchema = {
  params: emptyParamsSchema,
  querystring: {
    ...dateRangeQuerySchema,
    properties: {
      ...dateRangeQuerySchema.properties,
      granularity: { type: 'string', enum: granularityValues, maxLength: 10 }
    }
  },
  response: {
    200: {
      type: 'string'
    },
    ...standardAdminErrorResponses
  }
} as const;

export const analyticsNotificationsSchema = {
  params: emptyParamsSchema,
  querystring: dateRangeQuerySchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['channels'],
      properties: {
        channels: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['channel', 'total', 'sent', 'failed', 'deliveryRatePercent'],
            properties: {
              channel: { type: 'string', maxLength: 30 },
              total: { type: 'integer', minimum: 0, maximum: 1000000000 },
              sent: { type: 'integer', minimum: 0, maximum: 1000000000 },
              failed: { type: 'integer', minimum: 0, maximum: 1000000000 },
              deliveryRatePercent: { type: 'number', minimum: 0, maximum: 100 }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const analyticsCategoryBreakdownSchema = {
  params: emptyParamsSchema,
  querystring: dateRangeQuerySchema,
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
            required: ['categoryId', 'categoryName', 'revenuePaise', 'sharePercent'],
            properties: {
              categoryId: { type: 'string', maxLength: 64 },
              categoryName: { type: 'string', maxLength: 150 },
              revenuePaise: { type: 'integer', minimum: 0, maximum: 1000000000000 },
              sharePercent: { type: 'number', minimum: 0, maximum: 100 }
            }
          }
        }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const analyticsReconciliationIssuesSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, maximum: 1000000 },
      limit: { type: 'integer', minimum: 1, maximum: 100 }
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
              'issueType',
              'aggregateRef',
              'isResolved',
              'severity',
              'classification',
              'ageSeconds',
              'resolutionAction',
              'detectedAt',
              'details'
            ],
            properties: {
              id: { type: 'string', maxLength: 64 },
              issueType: { type: 'string', maxLength: 120 },
              aggregateRef: { type: 'string', maxLength: 180 },
              isResolved: { type: 'boolean' },
              severity: { type: 'string', maxLength: 32 },
              classification: { type: 'string', maxLength: 64 },
              ageSeconds: { type: 'integer', minimum: 0, maximum: 1000000000 },
              resolutionAction: { type: 'string', maxLength: 32 },
              detectedAt: { type: 'string', maxLength: 64 },
              resolvedAt: { type: 'string', maxLength: 64 },
              details: reconciliationDetailsSchema
            }
          }
        },
        meta: {
          type: 'object',
          additionalProperties: false,
          required: ['page', 'limit', 'total', 'totalPages'],
          properties: {
            page: { type: 'integer', minimum: 1, maximum: 1000000 },
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

export const analyticsOutboxReplaySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  querystring: emptyParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['reason', 'approvalToken'],
    properties: {
      reason: { type: 'string', minLength: 8, maxLength: 300 },
      dryRun: { type: 'boolean' },
      approvalToken: { type: 'string', maxLength: 128 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'status', 'queueName', 'jobName', 'attemptCount', 'mode'],
      properties: {
        id: { type: 'string', maxLength: 64 },
        status: { type: 'string', maxLength: 32 },
        queueName: { type: 'string', maxLength: 64 },
        jobName: { type: 'string', maxLength: 64 },
        attemptCount: { type: 'integer', minimum: 0, maximum: 1000 },
        lastError: { type: 'string', maxLength: 1000 },
        mode: { type: 'string', enum: ['dry-run', 'enqueued'], maxLength: 32 }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const analyticsOutboxReplayPreviewSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  querystring: emptyParamsSchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'current', 'proposed', 'diff'],
      properties: {
        id: { type: 'string', maxLength: 64 },
        current: replayPreviewCurrentSchema,
        proposed: replayPreviewProposedSchema,
        diff: replayPreviewDiffSchema
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const analyticsOutboxDeadLettersSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, maximum: 1000000 },
      limit: { type: 'integer', minimum: 1, maximum: 100 }
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
            required: ['id', 'queueName', 'jobName', 'attemptCount', 'createdAt', 'updatedAt'],
            properties: {
              id: { type: 'string', maxLength: 64 },
              queueName: { type: 'string', maxLength: 64 },
              jobName: { type: 'string', maxLength: 64 },
              attemptCount: { type: 'integer', minimum: 0, maximum: 1000 },
              createdAt: { type: 'string', maxLength: 64 },
              updatedAt: { type: 'string', maxLength: 64 },
              lastError: { type: 'string', maxLength: 1000 }
            }
          }
        },
        meta: {
          type: 'object',
          additionalProperties: false,
          required: ['page', 'limit', 'total', 'totalPages'],
          properties: {
            page: { type: 'integer', minimum: 1, maximum: 1000000 },
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

export const analyticsInboxFailuresSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, maximum: 1000000 },
      limit: { type: 'integer', minimum: 1, maximum: 100 }
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
            required: ['id', 'provider', 'eventKey', 'status', 'createdAt', 'updatedAt'],
            properties: {
              id: { type: 'string', maxLength: 64 },
              provider: { type: 'string', maxLength: 64 },
              eventKey: { type: 'string', maxLength: 180 },
              eventName: { type: 'string', maxLength: 120 },
              status: { type: 'string', maxLength: 32 },
              createdAt: { type: 'string', maxLength: 64 },
              updatedAt: { type: 'string', maxLength: 64 },
              lastError: { type: 'string', maxLength: 1000 }
            }
          }
        },
        meta: {
          type: 'object',
          additionalProperties: false,
          required: ['page', 'limit', 'total', 'totalPages'],
          properties: {
            page: { type: 'integer', minimum: 1, maximum: 1000000 },
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

export const analyticsInboxReplayPreviewSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  querystring: emptyParamsSchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'current', 'proposed', 'diff'],
      properties: {
        id: { type: 'string', maxLength: 64 },
        current: replayPreviewCurrentSchema,
        proposed: replayPreviewProposedSchema,
        diff: replayPreviewDiffSchema
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const analyticsShippingProviderStatsSchema = {
  params: emptyParamsSchema,
  querystring: dateRangeQuerySchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['providers', 'totalShipments'],
      properties: {
        providers: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['provider', 'shipmentsCount', 'revenuePaise', 'deliveredCount', 'sharePercent'],
            properties: {
              provider: { type: 'string', maxLength: 32 },
              shipmentsCount: { type: 'integer', minimum: 0, maximum: 1000000000 },
              revenuePaise: { type: 'integer', minimum: 0, maximum: 1000000000000 },
              deliveredCount: { type: 'integer', minimum: 0, maximum: 1000000000 },
              sharePercent: { type: 'number', minimum: 0, maximum: 100 }
            }
          }
        },
        totalShipments: { type: 'integer', minimum: 0, maximum: 1000000000 }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const analyticsEventRecordSchema = {
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
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['eventType', 'sessionId'],
    properties: {
      eventType: {
        type: 'string',
        enum: ['PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_STARTED', 'PAYMENT_INITIATED', 'PURCHASE', 'SEARCH'],
        maxLength: 50
      },
      sessionId: { type: 'string', minLength: 1, maxLength: 128 },
      userId: { type: 'string', maxLength: 64 },
      payload: { type: 'object' }
    }
  },
  response: {
    201: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    }
  }
} as const;

export const analyticsInboxReplaySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', maxLength: 64 }
    }
  },
  querystring: emptyParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['reason', 'approvalToken'],
    properties: {
      reason: { type: 'string', minLength: 8, maxLength: 300 },
      dryRun: { type: 'boolean' },
      approvalToken: { type: 'string', maxLength: 128 },
      operationType: { type: 'string', enum: ['canonical_reprocess', 'mark_processing'], maxLength: 32 },
      rawPayload: { type: 'string', maxLength: 200000 },
      verificationHeader: { type: 'string', maxLength: 1024 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'provider', 'eventKey', 'status', 'mode'],
      properties: {
        id: { type: 'string', maxLength: 64 },
        provider: { type: 'string', maxLength: 64 },
        eventKey: { type: 'string', maxLength: 180 },
        status: { type: 'string', maxLength: 32 },
        mode: { type: 'string', enum: ['dry-run', 'enqueued', 'canonical_reprocess'], maxLength: 32 }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

