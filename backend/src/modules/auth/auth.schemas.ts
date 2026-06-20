import { OTP_INPUT_JSON_SCHEMA } from '@common/auth/otp-code.js';
import { standardErrorResponses } from '@common/errors/error-response.schema';

const idSchema = { type: 'string', maxLength: 64 } as const;
const messageSchema = { type: 'string', maxLength: 200 } as const;
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

const userSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email', 'phone', 'firstName', 'lastName', 'role', 'isVerified'],
  properties: {
    id: idSchema,
    email: { anyOf: [{ type: 'string', maxLength: 255 }, { type: 'null' }] },
    phone: { type: 'string', maxLength: 20 },
    firstName: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
    lastName: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
    role: { type: 'string', maxLength: 20 },
    isVerified: { type: 'boolean' }
  }
} as const;

export const registerSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    // phone is optional for email-based registration; OTP signup has its own endpoint
    required: ['firstName', 'lastName', 'email', 'password'],
    properties: {
      firstName: { type: 'string', maxLength: 100 },
      lastName: { type: 'string', maxLength: 100 },
      phone: { anyOf: [{ type: 'string', minLength: 7, maxLength: 20 }, { type: 'null' }] },
      email: { type: 'string', format: 'email', maxLength: 255 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      turnstileToken: { type: 'string', maxLength: 4096 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['accessToken', 'user'],
      properties: {
        accessToken: { type: 'string', maxLength: 2048 },
        user: userSchema
      }
    },
    ...standardErrorResponses
  }
} as const;

export const sendOtpSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['phone'],
    properties: {
      phone: { type: 'string', maxLength: 20 },
      channel: { type: 'string', enum: ['sms', 'whatsapp', 'email'], maxLength: 16 },
      email: { type: 'string', format: 'email', maxLength: 255 },
      turnstileToken: { type: 'string', maxLength: 4096 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: messageSchema,
        devOtp: OTP_INPUT_JSON_SCHEMA
      }
    },
    ...standardErrorResponses
  }
} as const;

export const otpChannelConfigSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['channel', 'availableChannels'],
      properties: {
        channel: { type: 'string', enum: ['sms', 'whatsapp', 'email'], maxLength: 16 },
        availableChannels: {
          type: 'array',
          items: { type: 'string', enum: ['sms', 'whatsapp', 'email'], maxLength: 16 },
          maxItems: 3
        }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const adminOtpChannelConfigSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['channel', 'availableChannels'],
      properties: {
        channel: { type: 'string', enum: ['sms', 'whatsapp', 'email'], maxLength: 16 },
        availableChannels: {
          type: 'array',
          items: { type: 'string', enum: ['sms', 'whatsapp', 'email'], maxLength: 16 },
          maxItems: 3
        }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const verifyOtpSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['phone', 'otp'],
    properties: {
      phone: { type: 'string', maxLength: 20 },
      otp: OTP_INPUT_JSON_SCHEMA
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['accessToken', 'user'],
      properties: {
        accessToken: { type: 'string', maxLength: 2048 },
        user: userSchema
      }
    },
    ...standardErrorResponses
  }
} as const;

export const signupPhoneSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['phone', 'otp'],
    properties: {
      phone: { type: 'string', maxLength: 20 },
      otp: OTP_INPUT_JSON_SCHEMA,
      firstName: { type: 'string', maxLength: 100 },
      lastName: { type: 'string', maxLength: 100 },
      email: { type: 'string', format: 'email', maxLength: 255 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['accessToken', 'user'],
      properties: {
        accessToken: { type: 'string', maxLength: 2048 },
        user: userSchema
      }
    },
    ...standardErrorResponses
  }
} as const;

export const forgotPasswordSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      turnstileToken: { type: 'string', maxLength: 4096 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: messageSchema
      }
    },
    ...standardErrorResponses
  }
} as const;

export const resetPasswordSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['token', 'password', 'confirmPassword'],
    properties: {
      token: { type: 'string', minLength: 1, maxLength: 255 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      confirmPassword: { type: 'string', minLength: 8, maxLength: 128 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: messageSchema
      }
    },
    ...standardErrorResponses
  }
} as const;

/**
 * Lightweight existence check for a phone number or email.
 * Used by login forms to give early "not registered" feedback before
 * the user even enters a password or triggers the OTP flow.
 * Rate-limited the same as other auth-sensitive endpoints.
 */
export const checkIdentifierSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['identifier'],
    properties: {
      identifier: { type: 'string', minLength: 1, maxLength: 255 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['exists', 'identifierType', 'hasPhone'],
      properties: {
        exists: { type: 'boolean' },
        identifierType: { type: 'string', enum: ['phone', 'email'], maxLength: 8 },
        hasPhone: { type: 'boolean' }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const loginSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    // `identifier` accepts either a phone number or an email address.
    required: ['identifier', 'password'],
    properties: {
      identifier: { type: 'string', minLength: 1, maxLength: 255 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      turnstileToken: { type: 'string', maxLength: 4096 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['accessToken', 'user'],
      properties: {
        accessToken: { type: 'string', maxLength: 2048 },
        user: userSchema
      }
    },
    ...standardErrorResponses
  }
} as const;

export const refreshSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: emptyBodySchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['accessToken'],
      properties: {
        accessToken: { type: 'string', maxLength: 2048 }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const logoutSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: emptyBodySchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: { message: messageSchema }
    },
    ...standardErrorResponses
  }
} as const;

export const adminLoginRequestOtpSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      turnstileToken: { type: 'string', maxLength: 4096 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['message', 'expiresAt'],
      properties: {
        message: messageSchema,
        expiresAt: { type: 'string', maxLength: 40 },
        devOtp: OTP_INPUT_JSON_SCHEMA
      }
    },
    ...standardErrorResponses
  }
} as const;

export const adminLoginVerifyOtpSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'otp'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      otp: OTP_INPUT_JSON_SCHEMA
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['accessToken', 'admin'],
      properties: {
        accessToken: { type: 'string', maxLength: 2048 },
        admin: userSchema
      }
    },
    ...standardErrorResponses
  }
} as const;

const merchantAdminPermissionSchema = {
  type: 'string',
  enum: [
    'products:read',
    'products:write',
    'categories:read',
    'categories:write',
    'inventory:read',
    'inventory:write',
    'coupons:read',
    'coupons:write',
    'settings:read',
    'settings:write',
    'reviews:read',
    'reviews:moderate',
    'dashboard:read',
    'analytics:read',
    'orders:read',
    'orders:write',
    'orders:export',
    'orders:refund',
    'orders:notify',
    'analytics:export',
    'analytics:replay',
    'users:read',
    'users:write',
    'shipments:read',
    'payments:read'
  ],
  maxLength: 40
} as const;

export const adminInviteCreateSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'name', 'setupBaseUrl', 'permissions'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      name: { type: 'string', minLength: 1, maxLength: 160 },
      setupBaseUrl: { type: 'string', minLength: 8, maxLength: 300 },
      permissions: {
        type: 'array',
        maxItems: 32,
        items: merchantAdminPermissionSchema
      }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['inviteId', 'expiresAt', 'setupUrl', 'permissions'],
      properties: {
        inviteId: idSchema,
        expiresAt: { type: 'string', maxLength: 40 },
        setupUrl: { type: 'string', maxLength: 500 },
        permissions: { type: 'array', items: merchantAdminPermissionSchema }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const adminInviteListSchema = {
  params: emptyParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['CREATED', 'EMAIL_SENT', 'CONSUMED', 'CANCELLED', 'EXPIRED_CLEANED'], maxLength: 24 },
      page: { type: 'number', minimum: 1, maximum: 100000 },
      limit: { type: 'number', minimum: 1, maximum: 100 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'page', 'limit', 'total'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'inviteEmail', 'inviteName', 'status', 'permissions', 'expiresAt', 'createdAt', 'createdByOpsUserId', 'consumedAt'],
            properties: {
              id: idSchema,
              inviteEmail: { type: 'string', maxLength: 255 },
              inviteName: { type: 'string', maxLength: 160 },
              status: { type: 'string', maxLength: 24 },
              permissions: { type: 'array', items: merchantAdminPermissionSchema },
              expiresAt: { type: 'string', maxLength: 40 },
              createdAt: { type: 'string', maxLength: 40 },
              createdByOpsUserId: { anyOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }] },
              consumedAt: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] }
            }
          }
        },
        page: { type: 'number' },
        limit: { type: 'number' },
        total: { type: 'number' }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const adminInviteRevokeSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['inviteId'],
    properties: {
      inviteId: { type: 'string', minLength: 1, maxLength: 80 }
    }
  },
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['challengeId', 'otpCode'],
    properties: {
      challengeId: { type: 'string', minLength: 1, maxLength: 80 },
      otpCode: OTP_INPUT_JSON_SCHEMA
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['inviteId', 'revoked'],
      properties: {
        inviteId: idSchema,
        revoked: { type: 'boolean' }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const adminInviteSetupOtpSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['token', 'name', 'password'],
    properties: {
      token: { type: 'string', minLength: 10, maxLength: 500 },
      name: { type: 'string', minLength: 1, maxLength: 160 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      phone: { type: 'string', minLength: 6, maxLength: 20 }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['message', 'expiresAt'],
      properties: {
        message: messageSchema,
        expiresAt: { type: 'string', maxLength: 40 }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const adminInviteConsumeSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['token', 'otp'],
    properties: {
      token: { type: 'string', minLength: 10, maxLength: 500 },
      otp: OTP_INPUT_JSON_SCHEMA
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['adminUserId', 'email', 'name', 'permissions'],
      properties: {
        adminUserId: idSchema,
        email: { type: 'string', maxLength: 255 },
        name: { type: 'string', maxLength: 160 },
        permissions: { type: 'array', items: merchantAdminPermissionSchema }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const adminInviteCleanupSchema = {
  params: emptyParamsSchema,
  querystring: emptyQuerystringSchema,
  body: emptyBodySchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['cleaned'],
      properties: { cleaned: { type: 'number' } }
    },
    ...standardErrorResponses
  }
} as const;


