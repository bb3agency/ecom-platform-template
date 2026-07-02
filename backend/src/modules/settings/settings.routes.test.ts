import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSettingsRoutes } from './settings.routes';

// Define mock types for test fixtures
interface MockError {
  statusCode?: number;
  code?: string;
  message?: string;
}

function createApp() {
  const app = Fastify();
  app.decorateRequest('jwtVerify', async function () {
    (this as unknown as { user: unknown }).user = {
      sub: 'user-1',
      role: 'ADMIN',
      permissions: ['settings:read', 'settings:write']
    };
  });
  app.setErrorHandler((err, _request, reply) => {
    const error = err as MockError;
    reply.status(error.statusCode ?? 500).send({
      success: false,
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: error.message,
        statusCode: error.statusCode ?? 500,
        details: { kind: 'internal', hintKey: 'unknown', retryable: false, remediation: '' }
      }
    });
  });
  const fullSettingsRecord = {
    singletonKey: 'default',
    pickupPincode: '522006',
    minOrderValuePaise: 10000,
    defaultLowStockThreshold: 7,
    storeName: 'Test Store',
    websiteUrl: null,
    logoUrl: null,
    contactEmail: null,
    contactPhone: null,
    gstin: null,
    fssaiNumber: null,
    sellerLegalName: null,
    sellerAddress: null,
    sellerState: null,
    notifyEmailEnabled: true,
    notifySmsEnabled: false,
    notifyWhatsappEnabled: false,
    primaryNotificationChannels: null,
    smsTemplates: null,
    isCodEnabled: false,
    mobileOtpSignupEnabled: false,
    cancellationWindowHours: 24
  };
  const storeSettingsFindUnique = vi.fn(async () => fullSettingsRecord);
  const storeSettingsUpsert = vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
    ...fullSettingsRecord,
    ...args.update
  }));
  app.decorate('prisma', {
    storeSettings: {
      findUnique: storeSettingsFindUnique,
      upsert: storeSettingsUpsert
    }
  } as unknown as Parameters<typeof app.decorate>[1] & { storeSettings: unknown });
  return app;
}

describe('settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serves shipping and inventory settings routes', async () => {
    const app = createApp();
    await registerSettingsRoutes(app);

    const shippingGet = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/shipping',
      headers: { authorization: 'Bearer token' }
    });
    expect(shippingGet.statusCode).toBe(200);

    const shippingPatch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/settings/shipping',
      headers: { authorization: 'Bearer token' },
      payload: {
        pickupPincode: '560001',
        minOrderValuePaise: 15000
      }
    });
    expect(shippingPatch.statusCode).toBe(200);

    const inventoryGet = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/inventory',
      headers: { authorization: 'Bearer token' }
    });
    expect(inventoryGet.statusCode).toBe(200);

    const inventoryPatch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/settings/inventory',
      headers: { authorization: 'Bearer token' },
      payload: {
        defaultLowStockThreshold: 10
      }
    });
    expect(inventoryPatch.statusCode).toBe(200);

    await app.close();
  });

  it('serves store profile routes', async () => {
    const app = createApp();
    await registerSettingsRoutes(app);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/store',
      headers: { authorization: 'Bearer token' }
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json() as Record<string, unknown>;
    expect(getBody).toEqual(
      expect.objectContaining({
        sellerLegalName: null,
        sellerAddress: null,
        sellerState: null
      })
    );

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/settings/store',
      headers: { authorization: 'Bearer token' },
      payload: {
        sellerLegalName: 'Acme Foods Pvt Ltd',
        sellerAddress: '123 Market Road',
        sellerState: 'Telangana'
      }
    });
    expect(patchRes.statusCode).toBe(200);
    const patchBody = patchRes.json() as Record<string, unknown>;
    expect(patchBody).toEqual(
      expect.objectContaining({
        sellerLegalName: 'Acme Foods Pvt Ltd',
        sellerAddress: '123 Market Road',
        sellerState: 'Telangana'
      })
    );

    await app.close();
  });

  it('serves notification settings routes', async () => {
    const app = createApp();
    await registerSettingsRoutes(app);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/notifications',
      headers: { authorization: 'Bearer token' }
    });
    expect(getRes.statusCode).toBe(200);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/settings/notifications',
      headers: { authorization: 'Bearer token' },
      payload: { notifyEmailEnabled: true }
    });
    expect(patchRes.statusCode).toBe(200);

    await app.close();
  });

  // Regression: the multi-channel routing UI PATCHes `primaryChannels` as ARRAYS
  // (e.g. { OrderConfirmed: ['EMAIL','WHATSAPP'] }). The update body schema must accept
  // arrays, not just single strings — otherwise every save 400s with VALIDATION_ERROR.
  it('accepts and persists array-valued primaryChannels (multi-channel routing)', async () => {
    const app = createApp();
    await registerSettingsRoutes(app);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/settings/notifications',
      headers: { authorization: 'Bearer token' },
      payload: {
        whatsappEnabled: true,
        primaryChannels: {
          OrderConfirmed: ['EMAIL', 'WHATSAPP'],
          OtpVerification: ['EMAIL', 'WHATSAPP'],
          PaymentFailed: 'EMAIL'
        }
      }
    });
    expect(patchRes.statusCode).toBe(200);
    const body = patchRes.json() as { primaryChannels: Record<string, string[]> };
    expect(body.primaryChannels.OrderConfirmed).toEqual(['EMAIL', 'WHATSAPP']);
    expect(body.primaryChannels.OtpVerification).toEqual(['EMAIL', 'WHATSAPP']);
    // A legacy single-string value is coerced to a one-element array on the way out.
    expect(body.primaryChannels.PaymentFailed).toEqual(['EMAIL']);

    await app.close();
  });

  // Regression: a single-string value must NOT be rejected (backwards compatibility with
  // any client still sending the pre-multi-channel shape).
  it('accepts legacy single-string primaryChannels values', async () => {
    const app = createApp();
    await registerSettingsRoutes(app);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/settings/notifications',
      headers: { authorization: 'Bearer token' },
      payload: { primaryChannels: { OrderConfirmed: 'WHATSAPP' } }
    });
    expect(patchRes.statusCode).toBe(200);

    await app.close();
  });

  it('serves COD settings routes', async () => {
    const app = createApp();
    await registerSettingsRoutes(app);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/cod',
      headers: { authorization: 'Bearer token' }
    });
    expect(getRes.statusCode).toBe(200);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/settings/cod',
      headers: { authorization: 'Bearer token' },
      payload: { isCodEnabled: true }
    });
    expect(patchRes.statusCode).toBe(200);

    await app.close();
  });
});
