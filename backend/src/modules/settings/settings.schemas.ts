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

const shippingSettingsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pickupPincode', 'minOrderValuePaise', 'source', 'providerAvailability'],
  properties: {
    pickupPincode: { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' },
    minOrderValuePaise: { type: 'integer', minimum: 0, maximum: 1000000000 },
    source: { type: 'string', enum: ['database', 'environment', 'default'], maxLength: 20 },
    providerAvailability: {
      type: 'object',
      additionalProperties: false,
      required: ['delhiveryConfigured', 'shiprocketConfigured', 'hasAnyProvider'],
      properties: {
        delhiveryConfigured: { type: 'boolean' },
        shiprocketConfigured: { type: 'boolean' },
        hasAnyProvider: { type: 'boolean' }
      }
    }
  }
} as const;

const storeProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['storeName', 'websiteUrl', 'logoUrl', 'contactEmail', 'contactPhone', 'gstin', 'fssaiNumber', 'sellerLegalName', 'sellerAddress', 'sellerState'],
  properties: {
    storeName: { anyOf: [{ type: 'string', maxLength: 150 }, { type: 'null' }] },
    websiteUrl: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
    logoUrl: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
    contactEmail: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
    contactPhone: { anyOf: [{ type: 'string', maxLength: 30 }, { type: 'null' }] },
    gstin: { anyOf: [{ type: 'string', maxLength: 30 }, { type: 'null' }] },
    fssaiNumber: { anyOf: [{ type: 'string', maxLength: 30 }, { type: 'null' }] },
    sellerLegalName: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
    sellerAddress: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
    sellerState: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
    facebookUrl: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
    instagramUrl: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] }
  }
} as const;

const notificationSettingsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['emailEnabled', 'smsEnabled', 'whatsappEnabled', 'primaryChannels', 'smsTemplates', 'providerAvailability'],
  properties: {
    emailEnabled: { type: 'boolean' },
    smsEnabled: { type: 'boolean' },
    whatsappEnabled: { type: 'boolean' },
    primaryChannels: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          { type: 'string', enum: ['EMAIL', 'SMS', 'WHATSAPP'] },
          {
            type: 'array',
            items: { type: 'string', enum: ['EMAIL', 'SMS', 'WHATSAPP'] },
            maxItems: 3
          }
        ]
      },
      maxProperties: 100
    },
    smsTemplates: {
      type: 'object',
      additionalProperties: { type: 'string', maxLength: 320 },
      maxProperties: 50
    },
    /**
     * Ops-layer provider availability. Read-only for admin layer.
     * Computed from resolveNotificationRuntimeConfig() — boolean flags only,
     * no API key values are exposed.
     */
    providerAvailability: {
      type: 'object',
      additionalProperties: false,
      required: ['emailProvisioned', 'smsProvisioned', 'whatsappProvisioned', 'otpWhatsappEnabled', 'smsProvider'],
      properties: {
        emailProvisioned: { type: 'boolean' },
        smsProvisioned: { type: 'boolean' },
        whatsappProvisioned: { type: 'boolean' },
        otpWhatsappEnabled: { type: 'boolean' },
        smsProvider: {
          anyOf: [
            { type: 'string', enum: ['msg91', 'fast2sms', 'noop'] },
            { type: 'null' }
          ]
        }
      }
    }
  }
} as const;

const inventorySettingsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['defaultLowStockThreshold'],
  properties: {
    defaultLowStockThreshold: { type: 'integer', minimum: 0, maximum: 1000000 }
  }
} as const;

export const getShippingSettingsSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: shippingSettingsSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const updateShippingSettingsSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['pickupPincode', 'minOrderValuePaise'],
    properties: {
      pickupPincode: { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' },
      minOrderValuePaise: { type: 'integer', minimum: 0, maximum: 1000000000 }
    }
  },
  response: {
    200: shippingSettingsSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const getStoreProfileSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: storeProfileSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const updateStoreProfileSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      storeName: { type: 'string', maxLength: 150 },
      websiteUrl: { type: 'string', maxLength: 1000 },
      logoUrl: { type: 'string', maxLength: 1000 },
      contactEmail: { type: 'string', format: 'email', maxLength: 200 },
      contactPhone: { type: 'string', maxLength: 30 },
      gstin: { type: 'string', maxLength: 30 },
      fssaiNumber: { type: 'string', maxLength: 30 },
      sellerLegalName: { type: 'string', maxLength: 200 },
      sellerAddress: { type: 'string', maxLength: 500 },
      sellerState: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
      facebookUrl: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
      instagramUrl: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] }
    }
  },
  response: {
    200: storeProfileSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const getNotificationSettingsSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: notificationSettingsSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const updateNotificationSettingsSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      emailEnabled: { type: 'boolean' },
      smsEnabled: { type: 'boolean' },
      whatsappEnabled: { type: 'boolean' },
      primaryChannels: {
        type: 'object',
        additionalProperties: {
          anyOf: [
            { type: 'string', enum: ['EMAIL', 'SMS', 'WHATSAPP'] },
            {
              type: 'array',
              items: { type: 'string', enum: ['EMAIL', 'SMS', 'WHATSAPP'] },
              maxItems: 3
            }
          ]
        },
        maxProperties: 100
      },
      smsTemplates: {
        type: 'object',
        additionalProperties: { type: 'string', maxLength: 320 },
        maxProperties: 50
      }
    }
  },
  response: {
    200: notificationSettingsSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const getInventorySettingsSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: inventorySettingsSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const updateInventorySettingsSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['defaultLowStockThreshold'],
    properties: {
      defaultLowStockThreshold: { type: 'integer', minimum: 0, maximum: 1000000 }
    }
  },
  response: {
    200: inventorySettingsSchema,
    ...standardAdminErrorResponses
  }
} as const;

const codSettingsShape = {
  type: 'object',
  additionalProperties: false,
  required: ['isCodEnabled', 'cancellationWindowHours', 'mobileOtpSignupEnabled', 'reviewsEnabled', 'returnsEnabled'],
  properties: {
    isCodEnabled: { type: 'boolean' },
    mobileOtpSignupEnabled: { type: 'boolean' },
    reviewsEnabled: { type: 'boolean' },
    returnsEnabled: { type: 'boolean' },
    cancellationWindowHours: { type: 'integer', minimum: 1 },
    sellerState: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] }
  }
} as const;

export const getCodSettingsSchema = {
  tags: ['admin', 'settings'],
  summary: 'Get COD and cancellation settings',
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: codSettingsShape,
    ...standardAdminErrorResponses
  }
} as const;

export const updateCodSettingsSchema = {
  tags: ['admin', 'settings'],
  summary: 'Update COD and cancellation settings',
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      isCodEnabled: { type: 'boolean' },
      mobileOtpSignupEnabled: { type: 'boolean' },
      reviewsEnabled: { type: 'boolean' },
      returnsEnabled: { type: 'boolean' },
      cancellationWindowHours: { type: 'integer', minimum: 1, maximum: 720 },
      sellerState: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] }
    }
  },
  response: {
    200: codSettingsShape,
    ...standardAdminErrorResponses
  }
} as const;

const boxPresetItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'lengthCm', 'widthCm', 'heightCm'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    lengthCm: { type: 'integer', minimum: 1, maximum: 10000 },
    widthCm: { type: 'integer', minimum: 1, maximum: 10000 },
    heightCm: { type: 'integer', minimum: 1, maximum: 10000 },
    // Weight of the EMPTY carton + packing material (grams). Optional — when absent,
    // packaging weight falls back to the store override or the surface-area estimate.
    boxWeightGrams: { type: 'integer', minimum: 1, maximum: 100000 }
  }
} as const;

const boxPresetsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['presets', 'packagingWeightGrams'],
  properties: {
    presets: {
      type: 'array',
      items: boxPresetItemSchema,
      maxItems: 20
    },
    // Flat packaging-weight override (grams). Null = automatic surface-area estimate.
    packagingWeightGrams: { anyOf: [{ type: 'integer', minimum: 1, maximum: 100000 }, { type: 'null' }] }
  }
} as const;

export const getBoxPresetsSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: boxPresetsResponseSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const updateBoxPresetsSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['presets'],
    properties: {
      presets: {
        type: 'array',
        items: boxPresetItemSchema,
        maxItems: 20
      },
      // Omit to leave unchanged; send null to clear back to automatic estimation.
      packagingWeightGrams: { anyOf: [{ type: 'integer', minimum: 1, maximum: 100000 }, { type: 'null' }] }
    }
  },
  response: {
    200: boxPresetsResponseSchema,
    ...standardAdminErrorResponses
  }
} as const;

/**
 * Public storefront config — no auth required.
 * Exposes only the storefront-relevant subset of StoreSettings that customer
 * UI needs to render correctly (COD availability, minimum order enforcement).
 * Never exposes sensitive fields (GSTIN, contact details, notification keys).
 */
export const getPublicStoreConfigSchema = {
  tags: ['storefront', 'settings'],
  summary: 'Public storefront configuration (COD, minimum order value)',
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: [
        'isCodEnabled',
        'minOrderValuePaise',
        'mobileOtpSignupEnabled',
        'couponsEnabled',
        'reviewsEnabled',
        'returnsEnabled',
        'wishlistEnabled',
        'gstInvoicingEnabled'
      ],
      properties: {
        isCodEnabled: { type: 'boolean' },
        minOrderValuePaise: { type: 'integer', minimum: 0 },
        mobileOtpSignupEnabled: { type: 'boolean' },
        couponsEnabled: {
          type: 'boolean',
          description: 'Mirrors StoreSettings.couponsEnabled — toggled in Admin → Coupons.'
        },
        reviewsEnabled: { type: 'boolean' },
        returnsEnabled: {
          type: 'boolean',
          description: 'Merchant returns toggle — gates the customer return-request flow.'
        },
        wishlistEnabled: { type: 'boolean' },
        gstInvoicingEnabled: { type: 'boolean' },
        storeName: { type: ['string', 'null'] },
        storeAddress: { type: ['string', 'null'] },
        storeState: { type: ['string', 'null'] },
        contactEmail: { type: ['string', 'null'] },
        contactPhone: { type: ['string', 'null'] },
        facebookUrl: { type: ['string', 'null'] },
        instagramUrl: { type: ['string', 'null'] }
      }
    }
  }
} as const;
