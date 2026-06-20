import { describe, expect, it } from 'vitest';

import {
  getMetricsContentType,
  getMetricsSnapshot,
  recordAuthChallenge,
  recordCheckoutPath,
  recordFlashSaleAdmission,
  recordHttpRequest,
  recordQueueHealthSnapshot,
  recordQueueJob,
  recordReliabilityMode,
  recordWebhookEvent
} from './metrics';

describe('observability metrics', () => {
  it('records representative metric events and exposes snapshot', async () => {
    recordReliabilityMode('normal');
    recordHttpRequest({
      method: 'GET',
      route: '/api/v1/health',
      statusCode: 200,
      durationMs: 12
    });
    recordWebhookEvent({
      provider: 'razorpay',
      event: 'payment.captured',
      result: 'accepted',
      durationMs: 18
    });
    recordQueueJob('order-processing', 'confirm-order', 'success', 25);
    recordQueueHealthSnapshot({ queue: 'shipping', waiting: 2, active: 1, oldestWaitingAgeSeconds: 4 });
    recordCheckoutPath('/api/v1/orders', 'accepted');
    recordAuthChallenge('login', 'passed');
    recordFlashSaleAdmission('variant-123', 'admitted', 'not_hot');

    const metrics = await getMetricsSnapshot();

    expect(getMetricsContentType()).toContain('text/plain');
    expect(metrics).toContain('http_requests_total');
    expect(metrics).toContain('webhook_events_total');
    expect(metrics).toContain('queue_jobs_total');
    expect(metrics).toContain('checkout_requests_total');
    expect(metrics).toContain('auth_challenge_total');
    expect(metrics).toContain('flash_sale_admission_total');
  });

  it('normalizes unknown labels to bounded values', async () => {
    recordWebhookEvent({
      provider: 'shipping',
      event: 'totally_unknown_event',
      result: 'rejected',
      durationMs: 10
    });
    recordQueueJob('some-new-queue', 'some-new-job', 'failure', 13);

    const metrics = await getMetricsSnapshot();

    expect(metrics).toContain('event="other"');
    expect(metrics).toContain('queue="other"');
    expect(metrics).toContain('job_name="other"');
  });

  it('tracks rejected webhook events for invalid signature rates', async () => {
    recordWebhookEvent({
      provider: 'razorpay',
      event: 'payment.captured',
      result: 'rejected',
      durationMs: 5
    });
    recordWebhookEvent({
      provider: 'delhivery',
      event: 'unknown',
      result: 'rejected',
      durationMs: 3
    });
    recordWebhookEvent({
      provider: 'shiprocket',
      event: 'in_transit',
      result: 'rejected',
      durationMs: 4
    });

    const metrics = await getMetricsSnapshot();

    expect(metrics).toContain('provider="razorpay"');
    expect(metrics).toContain('provider="delhivery"');
    expect(metrics).toContain('provider="shiprocket"');
    expect(metrics).toContain('result="rejected"');
  });
});
