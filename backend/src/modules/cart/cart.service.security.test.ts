import { describe, expect, it } from 'vitest';
import { CartService } from './cart.service';

describe('CartService secure response contracts', () => {
  it('does not expose cart session token in customer response metadata', () => {
    const service = new CartService({} as never);
    const result = (service as unknown as {
      serializeCart: (cart: unknown, isGuest: boolean, couponsEnabled: boolean) => Record<string, unknown>;
    })
      .serializeCart(
        {
          id: 'cart_1',
          sessionToken: 'session_abc',
          coupon: null,
          reservations: [],
          items: []
        },
        true,
        true
      );

    expect(result.meta).toEqual(
      expect.objectContaining({
        isGuest: true,
        reservationExpiresAt: null,
        reservedItemCount: 0
      })
    );
    expect(result.meta).not.toHaveProperty('sessionToken');
  });

  it('includes product name, short description, and primary image on cart items', () => {
    const service = new CartService({} as never);
    const result = (service as unknown as {
      serializeCart: (cart: unknown, isGuest: boolean, couponsEnabled: boolean) => Record<string, unknown>;
    })
      .serializeCart(
        {
          id: 'cart_1',
          sessionToken: 'session_abc',
          coupon: null,
          reservations: [],
          items: [
            {
              id: 'item_1',
              variantId: 'variant_1',
              quantity: 2,
              priceSnapshot: 5000,
              variant: {
                id: 'variant_1',
                name: '500g',
                sku: 'SKU-500',
                price: 5000,
                productId: 'product_1',
                product: {
                  categoryId: 'category_1',
                  name: 'Organic Honey',
                  slug: 'organic-honey',
                  metaDescription: 'Pure organic honey from Kerala.',
                  images: [{ url: '/api/v1/media/products/product_1/hero.webp', altText: 'Organic honey jar' }]
                }
              }
            }
          ]
        },
        true,
        true
      );

    expect(result.items).toEqual([
      expect.objectContaining({
        product: {
          name: 'Organic Honey',
          slug: 'organic-honey',
          metaDescription: 'Pure organic honey from Kerala.',
          imageUrl: '/api/v1/media/products/product_1/hero.webp',
          imageAlt: 'Organic honey jar'
        }
      })
    ]);
  });
});
