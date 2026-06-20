import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

vi.mock('@modules/payments/payment-provider', () => ({
  createPaymentProvider: () => ({
    verifyWebhookSignature: () => true,
    verifyPaymentSignature: () => true
  })
}));

class RedisMock {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, _mode: 'EX', _ttl: number, condition?: 'NX'): Promise<'OK' | null> {
    if (condition === 'NX' && this.values.has(key)) {
      return null;
    }
    this.values.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
}

function p99(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1);
  return sorted[idx] ?? 0;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx] ?? 0;
}

function createService() {
  const redis = new RedisMock();
  const addOrderProcessing = vi.fn(async () => undefined);
  const addShipping = vi.fn(async () => undefined);
  return {
    service: new OrdersService({
      redis,
      queues: {
        orderProcessing: { add: addOrderProcessing },
        shipping: { add: addShipping }
      }
    } as unknown as ConstructorParameters<typeof OrdersService>[0]),
    addOrderProcessing,
    addShipping
  };
}

describe('OrdersService webhook ack latency guards', () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp-secret';
    process.env.DELHIVERY_API_KEY = 'delhivery-token';
    process.env.DELHIVERY_WEBHOOK_TOKEN = 'delhivery-token';
  });

  it('keeps payment webhook duplicate storm ack p99 below 200ms', async () => {
    const { service, addOrderProcessing } = createService();
    const payload = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_123', order_id: 'order_123' } } }
      })
    );
    const signature = createHmac('sha256', 'rzp-secret').update(payload).digest('hex');
    const samples: number[] = [];

    for (let i = 0; i < 30; i += 1) {
      const startedAt = Date.now();
      await service.processPaymentWebhook(signature, payload);
      samples.push(Date.now() - startedAt);
    }

    expect(p95(samples)).toBeLessThan(150);
    expect(p99(samples)).toBeLessThan(200);
    expect(addOrderProcessing).toHaveBeenCalledTimes(1);
  });

  it('keeps shipping webhook duplicate storm ack p99 below 200ms', async () => {
    const { service, addShipping } = createService();
    const payload = Buffer.from(
      JSON.stringify({
        awb: 'awb_1',
        status: 'IN_TRANSIT',
        description: 'Shipment moving',
        occurredAt: new Date().toISOString()
      })
    );
    const samples: number[] = [];

    for (let i = 0; i < 30; i += 1) {
      const startedAt = Date.now();
      await service.processShippingWebhook('Token delhivery-token', payload);
      samples.push(Date.now() - startedAt);
    }

    expect(p95(samples)).toBeLessThan(150);
    expect(p99(samples)).toBeLessThan(200);
    expect(addShipping).toHaveBeenCalledTimes(1);
  });
});
