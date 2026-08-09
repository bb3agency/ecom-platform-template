import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerGlobalErrorHandler } from '@common/errors/error-handler';
import { registerMultipartPlugin } from '@common/plugins/multipart.plugin';
import { registerSettingsRoutes } from './settings.routes';

// 1x1 transparent PNG — valid magic bytes for the sniffer.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const BOUNDARY = '----vitestLogoBoundary';

/** Real multipart/form-data body with one `file` part — mirrors the browser upload. */
function multipartBody(fileBytes: Buffer, filename = 'logo.png', mime = 'image/png'): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`
    ),
    fileBytes,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`)
  ]);
}

async function createApp() {
  const app = Fastify();
  app.decorateRequest('jwtVerify', async function () {
    (this as unknown as { user: unknown }).user = {
      sub: 'user-1',
      role: 'ADMIN',
      permissions: ['settings:read', 'settings:write']
    };
  });
  const upsert = vi.fn(async () => ({ id: 'settings_1' }));
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const findUnique = vi.fn(async () => ({
    pickupPincode: '522006',
    logoData: null,
    logoMimeType: null
  }));
  app.decorate('prisma', {
    storeSettings: { findUnique, upsert, updateMany }
  } as unknown as Parameters<typeof app.decorate>[1] & { storeSettings: unknown });
  await registerMultipartPlugin(app);
  // The REAL global error handler — status mapping in these tests must match production
  // exactly (that is where the masked-500 defect hid).
  await registerGlobalErrorHandler(app);
  await registerSettingsRoutes(app);
  return { app, upsert, updateMany, findUnique };
}

describe('POST /api/v1/admin/settings/store/logo', () => {
  it('accepts a real multipart PNG upload and persists it', async () => {
    const { app, upsert } = await createApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/settings/store/logo',
      headers: {
        authorization: 'Bearer token',
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`
      },
      payload: multipartBody(TINY_PNG)
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hasUploadedLogo: true });
    expect(upsert).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('rejects a non-image upload with 400 (not a masked 500)', async () => {
    const { app, upsert } = await createApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/settings/store/logo',
      headers: {
        authorization: 'Bearer token',
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`
      },
      payload: multipartBody(Buffer.from('<svg></svg>'), 'logo.svg', 'image/svg+xml')
    });

    expect(res.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();

    await app.close();
  });

  it('rejects a non-multipart POST with 400', async () => {
    const { app } = await createApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/settings/store/logo',
      headers: { authorization: 'Bearer token' },
      payload: { nope: true }
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('DELETE clears the stored logo', async () => {
    const { app, updateMany } = await createApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/settings/store/logo',
      headers: { authorization: 'Bearer token' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hasUploadedLogo: false });
    expect(updateMany).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('GET /api/v1/store/logo serves the stored bytes with the stored mime type', async () => {
    const app = Fastify();
    app.decorateRequest('jwtVerify', async function () {
      (this as unknown as { user: unknown }).user = { sub: 'u', role: 'ADMIN', permissions: [] };
    });
    app.decorate('prisma', {
      storeSettings: {
        findUnique: vi.fn(async () => ({
          pickupPincode: '522006',
          logoData: TINY_PNG,
          logoMimeType: 'image/png'
        }))
      }
    } as unknown as Parameters<typeof app.decorate>[1] & { storeSettings: unknown });
    await registerSettingsRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/api/v1/store/logo' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(Buffer.from(res.rawPayload).equals(TINY_PNG)).toBe(true);

    await app.close();
  });
});
