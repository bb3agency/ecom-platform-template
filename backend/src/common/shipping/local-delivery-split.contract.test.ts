import { describe, expect, it } from 'vitest';
import { productListItemSchema } from '@modules/products/products.schemas';
import { errorDetailsSchema } from '@common/errors/error-response.schema';

/**
 * Response-schema contract for product-level local delivery.
 *
 * Every response schema in this codebase is `additionalProperties: false`, so a field the
 * service returns but the schema does not declare is SILENTLY dropped at serialization — the
 * API looks healthy while the feature is dead in the browser. These assertions pin each field
 * the feature depends on to the exact schema that must carry it.
 */

function properties(schema: unknown): Record<string, unknown> {
  return (schema as { properties: Record<string, unknown> }).properties;
}

describe('local delivery — response schema contract', () => {
  it('product responses expose the local-delivery-only flag', () => {
    // Drives the admin toggle round-trip: without it the saved value never loads back.
    expect(properties(productListItemSchema)['isLocalDeliveryOnly']).toBeDefined();
  });

  it('error details carry the blocked-product list', () => {
    // The storefront renders these as the "remove these items to continue" list when a
    // local-delivery-only product cannot reach a non-whitelisted pincode.
    const props = properties(errorDetailsSchema);
    expect(props['pincode']).toBeDefined();
    expect(props['products']).toBeDefined();
  });
});
