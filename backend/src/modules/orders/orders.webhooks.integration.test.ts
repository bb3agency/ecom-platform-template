import { createHmac } from 'crypto';
import { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

type RedisSetResult = 'OK' | null;

type QueueJob = {
  name: string;
  payload: Record<string, unknown>;
};

class RedisIdempotencyMock {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, _mode: 'EX', _ttl: number, condition?: 'NX'): Promise<RedisSetResult> {
    if (condition === 'NX' && this.values.has(key)) {
      return null;
    }
    this.values.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.values.delete(key);
    return existed ? 1 : 0;
  }
}

function createServiceHarness() {
  const redis = new RedisIdempotencyMock();
  const orderProcessingJobs: QueueJob[] = [];
  const shippingJobs: QueueJob[] = [];

  const orderProcessingAdd = vi.fn(async (name: string, payload: Record<string, unknown>) => {
    orderProcessingJobs.push({ name, payload });
  });
  const shippingAdd = vi.fn(async (name: string, payload: Record<string, unknown>) => {
    shippingJobs.push({ name, payload });
  });

  const fastify = {
    redis,
    queues: {
      orderProcessing: { add: orderProcessingAdd },
      shipping: { add: shippingAdd }
    }
  } as unknown as FastifyInstance;

  const service = new OrdersService(fastify);

  return {
    service,
    orderProcessingJobs,
    shippingJobs,
    orderProcessingAdd,
    shippingAdd
  };
}

describe('OrdersService webhook idempotency integration', () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp-secret';
    process.env.DELHIVERY_API_KEY = 'delhivery-token';
  });

  it('enqueues payment webhook once for duplicate providerPaymentId payloads', async () => {
    const { service, orderProcessingJobs, orderProcessingAdd } = createServiceHarness();
    const payload = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_123', order_id: 'order_123' } } }
      })
    );
    const signature = createHmac('sha256', 'rzp-secret').update(payload).digest('hex');

    const start = Date.now();
    await service.processPaymentWebhook(signature, payload);
    const firstCallDurationMs = Date.now() - start;
    await service.processPaymentWebhook(signature, payload);

    expect(orderProcessingAdd).toHaveBeenCalledTimes(1);
    expect(firstCallDurationMs).toBeLessThan(200);
    expect(orderProcessingJobs).toHaveLength(1);
    expect(orderProcessingJobs[0]).toMatchObject({
      name: 'deduct-inventory',
      payload: {
        event: 'payment.captured',
        providerOrderId: 'order_123',
        providerPaymentId: 'pay_123'
      }
    });
  });

  it('keeps side effects single under parallel duplicate webhook deliveries', async () => {
    const { service, orderProcessingJobs, orderProcessingAdd } = createServiceHarness();
    const payload = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_parallel', order_id: 'order_parallel' } } }
      })
    );
    const signature = createHmac('sha256', 'rzp-secret').update(payload).digest('hex');

    await Promise.all([
      service.processPaymentWebhook(signature, payload),
      service.processPaymentWebhook(signature, payload),
      service.processPaymentWebhook(signature, payload)
    ]);

    expect(orderProcessingAdd).toHaveBeenCalledTimes(1);
    expect(orderProcessingJobs).toHaveLength(1);
  });

  it('releases webhook idempotency lock when enqueue fails so retries can proceed', async () => {
    const { service, orderProcessingAdd } = createServiceHarness();
    orderProcessingAdd.mockRejectedValueOnce(new Error('queue unavailable')).mockResolvedValueOnce(undefined);
    const payload = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_retry', order_id: 'order_retry' } } }
      })
    );
    const signature = createHmac('sha256', 'rzp-secret').update(payload).digest('hex');

    await expect(service.processPaymentWebhook(signature, payload)).resolves.toEqual({ received: true });

    await expect(service.processPaymentWebhook(signature, payload)).resolves.toEqual({ received: true });
    expect(orderProcessingAdd).toHaveBeenCalledTimes(2);
  });

  it('rejects payment webhook with invalid signature', async () => {
    const { service, orderProcessingAdd } = createServiceHarness();
    const payload = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_bad', order_id: 'order_bad' } } }
      })
    );

    await expect(service.processPaymentWebhook('invalid-signature', payload)).rejects.toMatchObject({
      statusCode: 401
    });
    expect(orderProcessingAdd).not.toHaveBeenCalled();
  });

  it('rejects malformed payment webhook payload with validation error', async () => {
    const { service, orderProcessingAdd } = createServiceHarness();
    const malformedPayload = Buffer.from('{"event":"payment.captured",');
    const signature = createHmac('sha256', 'rzp-secret').update(malformedPayload).digest('hex');
    await expect(service.processPaymentWebhook(signature, malformedPayload)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR'
    });
    expect(orderProcessingAdd).not.toHaveBeenCalled();
  });

  it('enqueues payment.failed webhook using payment-webhook job contract', async () => {
    const { service, orderProcessingJobs, orderProcessingAdd } = createServiceHarness();
    const payload = Buffer.from(
      JSON.stringify({
        event: 'payment.failed',
        payload: { payment: { entity: { id: 'pay_failed', order_id: 'order_failed' } } }
      })
    );
    const signature = createHmac('sha256', 'rzp-secret').update(payload).digest('hex');

    await service.processPaymentWebhook(signature, payload);

    expect(orderProcessingAdd).toHaveBeenCalledTimes(1);
    expect(orderProcessingJobs).toHaveLength(1);
    expect(orderProcessingJobs[0]).toMatchObject({
      name: 'payment-webhook',
      payload: {
        event: 'payment.failed',
        providerOrderId: 'order_failed',
        providerPaymentId: 'pay_failed'
      }
    });
  });

  it('enqueues shipping webhook once for duplicate status events', async () => {
    const { service, shippingJobs, shippingAdd } = createServiceHarness();
    const occurredAt = new Date().toISOString();
    const payload = Buffer.from(
      JSON.stringify({
        awb: 'awb_1',
        status: 'IN_TRANSIT',
        description: 'Shipment is moving',
        location: 'Hub A',
        occurredAt
      })
    );

    await service.processShippingWebhook('Token delhivery-token', payload);
    await service.processShippingWebhook('Token delhivery-token', payload);

    expect(shippingAdd).toHaveBeenCalledTimes(1);
    expect(shippingJobs).toHaveLength(1);
    expect(shippingJobs[0]).toMatchObject({
      name: 'update-shipment-status',
      payload: {
        awb: 'awb_1',
        status: 'IN_TRANSIT',
        description: 'Shipment is moving',
        location: 'Hub A',
        occurredAt
      }
    });
  });

  it('rejects shipping webhook when occurredAt is outside skew window', async () => {
    const { service, shippingAdd } = createServiceHarness();
    const stale = new Date(Date.now() - 400_000).toISOString();
    const payload = Buffer.from(
      JSON.stringify({
        awb: 'awb_skew',
        status: 'IN_TRANSIT',
        description: 'Old timestamp',
        occurredAt: stale
      })
    );

    await expect(service.processShippingWebhook('Token delhivery-token', payload)).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORISED'
    });
    expect(shippingAdd).not.toHaveBeenCalled();
  });

  it('rejects shipping webhook when occurredAt is not parseable', async () => {
    const { service, shippingAdd } = createServiceHarness();
    const payload = Buffer.from(
      JSON.stringify({
        awb: 'awb_bad_ts',
        status: 'IN_TRANSIT',
        description: 'Bad timestamp',
        occurredAt: 'not-a-real-date'
      })
    );

    await expect(service.processShippingWebhook('Token delhivery-token', payload)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR'
    });
    expect(shippingAdd).not.toHaveBeenCalled();
  });

  it('rejects shipping webhook with invalid auth token', async () => {
    const { service, shippingAdd } = createServiceHarness();
    const payload = Buffer.from(
      JSON.stringify({
        awb: 'awb_unauth',
        status: 'IN_TRANSIT',
        description: 'Shipment update'
      })
    );

    await expect(service.processShippingWebhook('Token wrong', payload)).rejects.toMatchObject({
      statusCode: 401
    });
    expect(shippingAdd).not.toHaveBeenCalled();
  });

  it('rejects malformed shipping webhook payload with validation error', async () => {
    const { service, shippingAdd } = createServiceHarness();
    const malformedPayload = Buffer.from('{"awb":"awb_1",');
    await expect(service.processShippingWebhook('Token delhivery-token', malformedPayload)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR'
    });
    expect(shippingAdd).not.toHaveBeenCalled();
  });

  it('accepts native Shiprocket webhook payload shape (current_status + scans)', async () => {
    // Enable dual-mode by setting both Delhivery and Shiprocket credentials.
    // The Bearer token prefix will trigger Shiprocket selection in dual mode.
    process.env.SHIPROCKET_EMAIL = 'test@shiprocket.com';
    process.env.SHIPROCKET_PASSWORD = 'shiprocket-password';
    process.env.SHIPROCKET_WEBHOOK_TOKEN = 'shiprocket-webhook-secret';
    const { service, shippingJobs, shippingAdd } = createServiceHarness();
    const payload = Buffer.from(
      JSON.stringify({
        awb: '19041424751540',
        current_status: 'IN TRANSIT',
        shipment_status: 'IN TRANSIT',
        current_timestamp: '23 05 2023 11:43:52',
        scans: [
          {
            date: '2023-05-20 10:27:56',
            activity: 'In Transit - Bag Added To Trip',
            location: 'Jaipur Hub',
            'sr-status-label': 'IN TRANSIT'
          }
        ]
      })
    );

    await service.processShippingWebhook('Bearer shiprocket-webhook-secret', payload);

    expect(shippingAdd).toHaveBeenCalledTimes(1);
    expect(shippingJobs).toHaveLength(1);
    expect(shippingJobs[0]).toMatchObject({
      name: 'update-shipment-status',
      payload: {
        awb: '19041424751540',
        status: 'IN TRANSIT',
        description: 'In Transit - Bag Added To Trip',
        location: 'Jaipur Hub'
      }
    });
  });

  it('accepts Shiprocket Bearer token format when SHIPPING_PROVIDER=shiprocket', async () => {
    // Enable dual-mode by setting both Delhivery and Shiprocket credentials
    process.env.SHIPROCKET_EMAIL = 'test@shiprocket.com';
    process.env.SHIPROCKET_PASSWORD = 'shiprocket-password';
    process.env.SHIPROCKET_WEBHOOK_TOKEN = 'shiprocket-webhook-secret';
    const { service, shippingJobs, shippingAdd } = createServiceHarness();
    const occurredAt = new Date().toISOString();
    const payload = Buffer.from(
      JSON.stringify({
        awb: 'awb_shiprocket',
        status: 'IN_TRANSIT',
        description: 'Shiprocket moving',
        location: 'Mumbai Hub',
        occurredAt
      })
    );

    await service.processShippingWebhook('Bearer shiprocket-webhook-secret', payload);
    await service.processShippingWebhook('Bearer shiprocket-webhook-secret', payload);

    expect(shippingAdd).toHaveBeenCalledTimes(1);
    expect(shippingJobs).toHaveLength(1);
    expect(shippingJobs[0]).toMatchObject({
      name: 'update-shipment-status',
      payload: {
        awb: 'awb_shiprocket',
        status: 'IN_TRANSIT',
        description: 'Shiprocket moving'
      }
    });
  });

  it('accepts Shiprocket x-api-key header format (raw token, no Bearer prefix)', async () => {
    // Enable dual-mode by setting both Delhivery and Shiprocket credentials
    process.env.SHIPROCKET_EMAIL = 'test@shiprocket.com';
    process.env.SHIPROCKET_PASSWORD = 'shiprocket-password';
    process.env.SHIPROCKET_WEBHOOK_TOKEN = 'shiprocket-xapikey-secret';
    const { service, shippingJobs, shippingAdd } = createServiceHarness();
    const occurredAt = new Date().toISOString();
    const payload = Buffer.from(
      JSON.stringify({
        awb: 'awb_sr_xapikey',
        status: 'DELIVERED',
        description: 'Delivered to customer',
        location: 'Delhi Hub',
        occurredAt
      })
    );

    await service.processShippingWebhook('shiprocket-xapikey-secret', payload);

    expect(shippingAdd).toHaveBeenCalledTimes(1);
    expect(shippingJobs).toHaveLength(1);
    expect(shippingJobs[0]).toMatchObject({
      name: 'update-shipment-status',
      payload: {
        awb: 'awb_sr_xapikey',
        status: 'DELIVERED',
        description: 'Delivered to customer'
      }
    });
  });
});

