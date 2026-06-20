import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CartService } from './cart.service';

describe('CartService analytics producer', () => {
  it('enqueues ADD_TO_CART analytics event after item add', async () => {
    const analyticsAdd = vi.fn().mockResolvedValue(undefined);

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
            items: [
              {
                id: 'item_1',
                variantId: 'variant_1',
                quantity: 2,
                priceSnapshot: 5000,
                variant: {
                  id: 'variant_1',
                  name: 'Variant 1',
                  sku: 'SKU-1',
                  price: 5000
                }
              }
            ]
          })
        },
        productVariant: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'variant_1',
            price: 5000,
            inventory: { quantity: 10 }
          })
        },
        cartItem: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(undefined)
        }
      },
      queues: {
        analytics: {
          add: analyticsAdd
        }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    await service.addItem('user_1', undefined, { variantId: 'variant_1', quantity: 2 });

    expect(analyticsAdd).toHaveBeenCalledWith(
      'record-event',
      expect.objectContaining({
        eventType: 'ADD_TO_CART',
        sessionId: 'user:user_1',
        userId: 'user_1',
        payload: expect.objectContaining({
          variantId: 'variant_1',
          quantity: 2
        })
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('analytics-ADD_TO_CART-user-user_1-')
      })
    );
  });

  it('enqueues REMOVE_FROM_CART analytics event after item delete', async () => {
    const analyticsAdd = vi.fn().mockResolvedValue(undefined);

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
            quantity: 2
          }),
          delete: vi.fn().mockResolvedValue(undefined)
        }
      },
      queues: {
        analytics: {
          add: analyticsAdd
        }
      },
      log: {
        error: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new CartService(fastify);
    await service.deleteItem('user_1', undefined, 'item_1');

    expect(analyticsAdd).toHaveBeenCalledWith(
      'record-event',
      expect.objectContaining({
        eventType: 'REMOVE_FROM_CART',
        sessionId: 'user:user_1',
        userId: 'user_1',
        payload: expect.objectContaining({
          variantId: 'variant_1',
          quantity: 2
        })
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('analytics-REMOVE_FROM_CART-user-user_1-')
      })
    );
  });
});

