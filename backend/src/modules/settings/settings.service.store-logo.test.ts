import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SettingsService } from './settings.service';

// 1x1 transparent PNG — valid magic bytes for the sniffer.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
// Minimal JPEG SOI marker prefix (enough for the magic-byte sniff).
const TINY_JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);

function makeFastify(overrides: Record<string, unknown> = {}): {
  fastify: FastifyInstance;
  upsert: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
} {
  const upsert = vi.fn().mockResolvedValue({ id: 'settings_1' });
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const fastify = {
    prisma: {
      storeSettings: {
        findUnique: vi.fn().mockResolvedValue({ pickupPincode: '500001', ...overrides }),
        upsert,
        updateMany
      }
    }
  } as unknown as FastifyInstance;
  return { fastify, upsert, updateMany };
}

describe('SettingsService store logo upload', () => {
  it('stores a valid PNG with its sniffed mime type', async () => {
    const { fastify, upsert } = makeFastify();
    const service = new SettingsService(fastify);

    await expect(service.uploadStoreLogo(TINY_PNG)).resolves.toEqual({ hasUploadedLogo: true });
    const call = upsert.mock.calls[0]![0] as {
      update: { logoData: Uint8Array; logoMimeType: string };
    };
    expect(call.update.logoMimeType).toBe('image/png');
    expect(Buffer.from(call.update.logoData).equals(TINY_PNG)).toBe(true);
  });

  it('stores a valid JPEG as image/jpeg', async () => {
    const { fastify, upsert } = makeFastify();
    const service = new SettingsService(fastify);

    await service.uploadStoreLogo(TINY_JPG);
    const call = upsert.mock.calls[0]![0] as {
      update: { logoData: Uint8Array; logoMimeType: string };
    };
    expect(call.update.logoMimeType).toBe('image/jpeg');
    expect(Buffer.from(call.update.logoData).equals(TINY_JPG)).toBe(true);
  });

  it('rejects non-image bytes with a 400 (magic-byte sniff, never trusts mime)', async () => {
    const { fastify, upsert } = makeFastify();
    const service = new SettingsService(fastify);

    await expect(service.uploadStoreLogo(Buffer.from('<svg>not embeddable</svg>'))).rejects.toMatchObject({
      statusCode: 400
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects empty and oversized files with a 400', async () => {
    const { fastify } = makeFastify();
    const service = new SettingsService(fastify);

    await expect(service.uploadStoreLogo(Buffer.alloc(0))).rejects.toMatchObject({ statusCode: 400 });
    const oversized = Buffer.concat([TINY_PNG, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(service.uploadStoreLogo(oversized)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('deleteStoreLogo clears both columns', async () => {
    const { fastify, updateMany } = makeFastify();
    const service = new SettingsService(fastify);

    await expect(service.deleteStoreLogo()).resolves.toEqual({ hasUploadedLogo: false });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { logoData: null, logoMimeType: null } })
    );
  });

  it('getStoreLogo returns stored bytes + mime, and null when nothing uploaded', async () => {
    const withLogo = makeFastify({ logoData: TINY_PNG, logoMimeType: 'image/png' });
    await expect(new SettingsService(withLogo.fastify).getStoreLogo()).resolves.toEqual({
      data: TINY_PNG,
      mimeType: 'image/png'
    });

    const withoutLogo = makeFastify({ logoData: null, logoMimeType: null });
    await expect(new SettingsService(withoutLogo.fastify).getStoreLogo()).resolves.toBeNull();
  });
});
