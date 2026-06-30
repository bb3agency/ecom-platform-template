import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CartService } from './cart.service';

/**
 * Regression: a guest cart MUST be keyed to the sessionToken the route supplies
 * (the value it writes back to the `cart_session` cookie). The bug was that the
 * create path minted a fresh random token, so the cookie token never matched any
 * cart row — every request created a new empty cart, guest carts never persisted,
 * and the post-login merge found nothing.
 */
describe('CartService guest session token', () => {
  function buildFastify(upsertSpy: ReturnType<typeof vi.fn>) {
    return {
      prisma: {
        storeSettings: {
          findUnique: vi.fn().mockResolvedValue({ minOrderValuePaise: 0 })
        },
        cart: {
          // No existing cart for this guest token (first touch).
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: upsertSpy,
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'cart_1',
            sessionToken: 'guest-token-123',
            coupon: null,
            items: []
          })
        }
      },
      log: { error: vi.fn() }
    } as unknown as FastifyInstance;
  }

  it('creates the guest cart with the supplied sessionToken, not a fresh random one', async () => {
    const upsertSpy = vi.fn().mockResolvedValue({
      id: 'cart_1',
      sessionToken: 'guest-token-123',
      coupon: null,
      reservations: [],
      items: []
    });
    const service = new CartService(buildFastify(upsertSpy));

    const cart = await service.getCart(undefined, 'guest-token-123');

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const args = upsertSpy.mock.calls[0]![0] as {
      where: { sessionToken: string };
      create: { sessionToken: string };
    };
    expect(args.where.sessionToken).toBe('guest-token-123');
    expect(args.create.sessionToken).toBe('guest-token-123');
    expect(cart.id).toBe('cart_1');
  });

  it('falls back to a fresh UUID for a blank/whitespace token instead of storing an empty string', async () => {
    const upsertSpy = vi.fn().mockResolvedValue({
      id: 'cart_1',
      sessionToken: 'generated',
      coupon: null,
      reservations: [],
      items: []
    });
    const fastify = buildFastify(upsertSpy);
    const service = new CartService(fastify);

    await service.getCart(undefined, '   ');

    // Blank token must not be looked up (it is not a real token) and must never be
    // persisted as '' — otherwise all blank-cookie guests collide on one shared cart.
    expect((fastify.prisma.cart.findUnique as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    const args = upsertSpy.mock.calls[0]![0] as {
      where: { sessionToken: string };
      create: { sessionToken: string };
    };
    expect(args.where.sessionToken).not.toBe('');
    expect(args.create.sessionToken).not.toBe('');
    expect(args.create.sessionToken).toHaveLength(36);
  });
});
