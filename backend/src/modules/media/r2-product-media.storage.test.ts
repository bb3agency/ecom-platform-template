import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send = sendMock;
  },
  PutObjectCommand: class MockPutObjectCommand {
    constructor(public input: unknown) {}
  },
  DeleteObjectCommand: class MockDeleteObjectCommand {
    constructor(public input: unknown) {}
  }
}));

import { createR2ProductMediaStorage } from './r2-product-media.storage';

describe('createR2ProductMediaStorage', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  it('uploads to R2 and returns a CDN-facing public URL', async () => {
    const storage = createR2ProductMediaStorage({
      accountId: 'acct',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucketName: 'product-images',
      publicBaseUrl: 'https://cdn.example.com',
      clientId: 'raghava'
    });

    const result = await storage.saveProductImage({
      productId: 'prod_1',
      imageId: 'img_1',
      mime: 'image/jpeg',
      content: Buffer.from('jpeg-bytes')
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.publicUrl).toBe(
      'https://cdn.example.com/raghava/products/prod_1/img_1.jpg'
    );
    expect(result.storageReference).toBe('raghava/products/prod_1/img_1.jpg');
    expect(storage.isManagedPublicUrl(result.publicUrl)).toBe(true);
  });

  it('deletes object by storage reference', async () => {
    const storage = createR2ProductMediaStorage({
      accountId: 'acct',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucketName: 'product-images',
      publicBaseUrl: 'https://cdn.example.com',
      clientId: 'raghava'
    });

    await storage.deleteProductImage('raghava/products/prod_1/img_1.jpg');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
