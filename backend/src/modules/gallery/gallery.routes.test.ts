import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerMultipartPlugin } from '@common/plugins/multipart.plugin';

vi.mock('@common/guards/jwt-auth.guard', () => ({
  jwtAuthGuard: vi.fn(async () => undefined)
}));
vi.mock('@common/guards/roles.guard', () => ({
  rolesGuard: vi.fn(() => async () => undefined)
}));
vi.mock('@common/guards/admin-permissions.guard', () => ({
  adminPermissionGuard: vi.fn(() => async () => undefined)
}));
vi.mock('@common/reliability/load-shed.guard', () => ({
  loadShedGuard: vi.fn(async () => undefined)
}));
vi.mock('@common/idempotency/idempotency', () => ({
  idempotencyPreHandler: vi.fn(async () => undefined),
  idempotencyOnSend: vi.fn(async () => undefined)
}));

const serviceState = vi.hoisted(() => ({
  listPublic: vi.fn(async () => ({ enabled: true, items: [] })),
  adminList: vi.fn(async () => ({ items: [] })),
  adminCreateFromUpload: vi.fn(async () => ({
    id: 'img_1',
    imageUrl: 'https://cdn.example.com/client/gallery/img_1.png',
    caption: null,
    altText: '',
    sortOrder: 0,
    isActive: true
  })),
  adminUpdate: vi.fn(),
  adminDelete: vi.fn(),
  adminReorder: vi.fn()
}));

vi.mock('./gallery.service', () => {
  class MockGalleryService {
    constructor(_fastify: unknown) {}
    listPublic = serviceState.listPublic;
    adminList = serviceState.adminList;
    adminCreateFromUpload = serviceState.adminCreateFromUpload;
    adminUpdate = serviceState.adminUpdate;
    adminDelete = serviceState.adminDelete;
    adminReorder = serviceState.adminReorder;
  }
  return { GalleryService: MockGalleryService };
});

import { registerGalleryRoutes } from './gallery.routes';

function buildMultipartBody(boundary: string, fields: Record<string, string>, file: Buffer) {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`
    )
  );
  parts.push(file);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

describe('gallery routes', () => {
  it('POST /api/v1/admin/gallery accepts a real multipart upload with caption + altText', async () => {
    const app = Fastify();
    await registerMultipartPlugin(app);
    await registerGalleryRoutes(app);

    const boundary = '----vitestBoundary42';
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const body = buildMultipartBody(boundary, { caption: 'Our farm', altText: 'Green fields' }, pngBytes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/gallery',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body
    });

    expect(res.statusCode).toBe(200);
    expect(serviceState.adminCreateFromUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: 'Our farm',
        altText: 'Green fields',
        mimeType: 'image/png'
      })
    );
    const uploaded = serviceState.adminCreateFromUpload.mock.calls[0]![0] as { buffer: Buffer };
    expect(Buffer.compare(uploaded.buffer, pngBytes)).toBe(0);

    await app.close();
  });

  it('GET /api/v1/gallery is public and returns the enabled flag + items', async () => {
    const app = Fastify();
    await registerMultipartPlugin(app);
    await registerGalleryRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/api/v1/gallery' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, items: [] });

    await app.close();
  });
});
