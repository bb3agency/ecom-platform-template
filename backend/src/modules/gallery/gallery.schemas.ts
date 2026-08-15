import { standardAdminErrorResponses, standardErrorResponses } from '@common/errors/error-response.schema';

const galleryImageRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'imageUrl', 'caption', 'altText', 'sortOrder', 'isActive', 'capturedAt', 'timelineDate', 'width', 'height'],
  properties: {
    id: { type: 'string' },
    imageUrl: { type: 'string', maxLength: 1000 },
    caption: { type: ['string', 'null'], maxLength: 300 },
    altText: { type: 'string', maxLength: 200 },
    sortOrder: { type: 'integer' },
    isActive: { type: 'boolean' },
    /** Merchant-entered capture date; null when never set. */
    capturedAt: { type: ['string', 'null'], format: 'date-time' },
    /** Date the timeline groups by — capturedAt, else the upload date. Always set. */
    timelineDate: { type: 'string', format: 'date-time' },
    /** Intrinsic pixel size for aspect-preserving layout; null on legacy rows. */
    width: { type: ['integer', 'null'] },
    height: { type: ['integer', 'null'] }
  }
} as const;

export const getPublicGallerySchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled', 'items'],
      properties: {
        enabled: { type: 'boolean' },
        items: { type: 'array', items: galleryImageRecordSchema }
      }
    },
    ...standardErrorResponses
  }
} as const;

export const adminListGallerySchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: { type: 'array', items: galleryImageRecordSchema }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminUploadGalleryImageSchema = {
  response: {
    200: galleryImageRecordSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminUpdateGalleryImageSchema = {
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
    properties: {
      caption: { type: ['string', 'null'], maxLength: 300 },
      altText: { type: 'string', maxLength: 200 },
      isActive: { type: 'boolean' },
      sortOrder: { type: 'integer', minimum: 0 },
      /** ISO date the photo was taken; null clears it (falls back to upload date). */
      capturedAt: { type: ['string', 'null'], maxLength: 40 }
    }
  },
  response: {
    200: galleryImageRecordSchema,
    ...standardAdminErrorResponses
  }
} as const;

export const adminDeleteGalleryImageSchema = {
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
      required: ['message'],
      properties: { message: { type: 'string' } }
    },
    ...standardAdminErrorResponses
  }
} as const;

export const adminReorderGallerySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['orderedIds'],
    properties: {
      orderedIds: {
        type: 'array',
        items: { type: 'string', maxLength: 64 },
        minItems: 1,
        maxItems: 200
      }
    }
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: { type: 'array', items: galleryImageRecordSchema }
      }
    },
    ...standardAdminErrorResponses
  }
} as const;
