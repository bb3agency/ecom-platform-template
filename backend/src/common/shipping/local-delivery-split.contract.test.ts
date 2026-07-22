import { describe, expect, it } from 'vitest';
import { deliveryRatesSchema } from '@modules/cart/cart.schemas';
import { getMyOrderByIdSchema, adminGetOrderByIdSchema } from '@modules/orders/orders.schemas';
import { productListItemSchema } from '@modules/products/products.schemas';
import { errorDetailsSchema } from '@common/errors/error-response.schema';

/**
 * Response-schema contract for product-level local delivery.
 *
 * Every response schema in this codebase is `additionalProperties: false`, so a field the
 * service returns but the schema does not declare is SILENTLY dropped at serialization — the
 * API looks healthy while the feature is dead in the browser. These assertions pin each field
 * the local-delivery split feature depends on to the exact schema that must carry it.
 */

function properties(schema: unknown): Record<string, unknown> {
  return (schema as { properties: Record<string, unknown> }).properties;
}

describe('local delivery split — response schema contract', () => {
  it('delivery rates expose the split breakdown', () => {
    const props = properties(deliveryRatesSchema.response[200]);
    expect(props['split']).toBeDefined();

    const groups = properties(props['split']) as {
      groups: { items: { properties: Record<string, unknown> } };
    };
    const groupProps = groups.groups.items.properties;
    expect(groupProps['channel']).toBeDefined();
    expect(groupProps['shippingCharge']).toBeDefined();
    expect(groupProps['items']).toBeDefined();
  });

  it('customer order detail exposes the group id and sibling orders', () => {
    const props = properties(getMyOrderByIdSchema.response[200]);
    // Without these the storefront can never re-open the "why two orders?" explanation.
    expect(props['orderGroupId']).toBeDefined();
    expect(props['groupOrders']).toBeDefined();
  });

  it('admin order detail exposes the group id', () => {
    expect(properties(adminGetOrderByIdSchema.response[200])['orderGroupId']).toBeDefined();
  });

  it('product responses expose the local-delivery-only flag', () => {
    // Drives the admin toggle round-trip: without it the saved value never loads back.
    expect(properties(productListItemSchema)['isLocalDeliveryOnly']).toBeDefined();
  });

  it('error details carry the blocked-product list', () => {
    // The storefront renders these as the "remove these items to continue" list.
    const props = properties(errorDetailsSchema);
    expect(props['pincode']).toBeDefined();
    expect(props['products']).toBeDefined();
  });
});
