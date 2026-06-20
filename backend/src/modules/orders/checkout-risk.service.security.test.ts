import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutRiskService } from './checkout-risk.service';

describe('CheckoutRiskService', () => {
  beforeEach(() => {
    vi.stubEnv('RISK_VELOCITY_ENABLED', 'true');
    vi.stubEnv('RISK_PAYMENT_INIT_MAX_PER_HOUR', '2');
  });

  it('allows when velocity is below threshold', async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1)
    };
    const fastify = { redis } as unknown as FastifyInstance;
    const svc = new CheckoutRiskService(fastify);
    await expect(
      svc.assertInitiatePaymentAllowed({
        userId: 'user_1',
        orderId: 'order_1',
        orderTotalPaise: 100
      })
    ).resolves.toBeUndefined();
    expect(redis.incr).toHaveBeenCalledWith(expect.stringMatching(/^risk:velocity:payment-init:user:user_1:hour:\d+$/));
  });

  it('blocks when velocity exceeds threshold', async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(3),
      expire: vi.fn().mockResolvedValue(1)
    };
    const fastify = { redis } as unknown as FastifyInstance;
    const svc = new CheckoutRiskService(fastify);
    await expect(
      svc.assertInitiatePaymentAllowed({
        userId: 'user_1',
        orderId: 'order_1',
        orderTotalPaise: 100
      })
    ).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 });
  });

  it('no-ops when RISK_VELOCITY_ENABLED is not true', async () => {
    vi.stubEnv('RISK_VELOCITY_ENABLED', 'false');
    const redis = { incr: vi.fn(), expire: vi.fn() };
    const svc = new CheckoutRiskService({ redis } as unknown as FastifyInstance);
    await svc.assertInitiatePaymentAllowed({
      userId: 'user_1',
      orderId: 'order_1',
      orderTotalPaise: 100
    });
    expect(redis.incr).not.toHaveBeenCalled();
  });
});
