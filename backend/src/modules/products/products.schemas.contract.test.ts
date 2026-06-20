import { describe, expect, it } from 'vitest';
import { adminImportProductsCsvSchema } from './products.schemas';

describe('products schema contracts', () => {
  it('declares multipart CSV upload contract for admin import', () => {
    expect(adminImportProductsCsvSchema.consumes).toEqual(['multipart/form-data']);
    expect(adminImportProductsCsvSchema.body).toEqual(
      expect.objectContaining({
        required: ['csvFile'],
        properties: expect.objectContaining({
          csvFile: expect.objectContaining({
            type: 'string',
            format: 'binary'
          })
        })
      })
    );
  });
});
