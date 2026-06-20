import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CartService } from './cart.service';

describe('CartService price snapshot behavior', () => {
  it('keeps existing priceSnapshot unchanged when adding quantity to existing item', async () => {
    const cartItemUpdate = vi.fn().mockResolvedValue(undefined);
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ minOrderValuePaise: 0 })
        },
        cart: {
          upsert: vi.fn().mockResolvedValue({
            id: 'cart_1',
            sessionToken: null,
            coupon: null,
            items: []
          }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'cart_1',
            sessionToken: null,
            coupon: null,
            items: []
          })
        },
        cartItem: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'item_1',
            cartId: 'cart_1',
            variantId: 'variant_1',
            quantity: 1,
            priceSnapshot: 5000
          }),
          update: cartItemUpdate
        },
        productVariant: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'variant_1',
            price: 6500,
            inventory: { quantity: 10 }
          })
        }
      },
      queues: {
        analytics: {
          add: vi.fn().mockResolvedValue(undefined)
        }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    await service.addItem('user_1', undefined, { variantId: 'variant_1', quantity: 2 });

    expect(cartItemUpdate).toHaveBeenCalledWith({
      where: { id: 'item_1' },
      data: { quantity: 3 }
    });
  });

  it('keeps existing priceSnapshot unchanged when updating quantity', async () => {
    const cartItemUpdate = vi.fn().mockResolvedValue(undefined);
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ minOrderValuePaise: 0 })
        },
        cart: {
          upsert: vi.fn().mockResolvedValue({
            id: 'cart_1',
            sessionToken: null,
            coupon: null,
            items: []
          }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'cart_1',
            sessionToken: null,
            coupon: null,
            items: []
          })
        },
        cartItem: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'item_1',
            cartId: 'cart_1',
            variantId: 'variant_1',
            quantity: 1,
            priceSnapshot: 5000,
            variant: {
              id: 'variant_1',
              price: 6500,
              inventory: { quantity: 10 },
              product: { id: 'product_1', isActive: true }
            }
          }),
          update: cartItemUpdate
        }
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    await service.updateItem('user_1', undefined, 'item_1', { quantity: 4 });

    expect(cartItemUpdate).toHaveBeenCalledWith({
      where: { id: 'item_1' },
      data: { quantity: 4 }
    });
  });
});
