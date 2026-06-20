import { describe, expect, it } from 'vitest';
import { CartService } from './cart.service';

describe('CartService serializeCart couponsEnabled', () => {
  it('hides coupon and discount when storefront coupons are disabled', () => {
    const service = new CartService({} as never);
    const result = (
      service as unknown as {
        serializeCart: (cart: unknown, isGuest: boolean, couponsEnabled: boolean) => Record<string, unknown>;
      }
    ).serializeCart(
      {
        id: 'cart_1',
        sessionToken: null,
        coupon: {
          id: 'coupon_1',
          code: 'SAVE10',
          type: 'PERCENTAGE_OFF',
          value: 10,
          minOrderPaise: 0,
          maxUsesTotal: null,
          maxUsesPerUser: null,
          usesCount: 0,
          isActive: true,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2026-12-31T23:59:59.000Z'),
          applicableTo: null
        },
        reservations: [],
        items: [
          {
            id: 'item_1',
            variantId: 'variant_1',
            quantity: 1,
            priceSnapshot: 1000,
            variant: {
              id: 'variant_1',
              name: 'Variant 1',
              sku: 'SKU-1',
              price: 1000,
              productId: 'product_1',
              product: {
                categoryId: 'category_1',
                name: 'Product 1',
                metaDescription: 'Short description',
                images: [{ url: '/api/v1/media/products/product_1/hero.webp', altText: 'Product 1' }]
              }
            }
          }
        ]
      },
      false,
      false
    );

    expect(result.coupon).toBeNull();
    expect(result.discountAmount).toBe(0);
    expect(result.total).toBe(1000);
  });
});
