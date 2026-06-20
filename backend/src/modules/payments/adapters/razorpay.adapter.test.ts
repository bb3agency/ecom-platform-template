import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { RazorpayAdapter } from './razorpay.adapter';

describe('RazorpayAdapter signature checks', () => {
  const keySecret = 'rzp_test_secret';
  const webhookSecret = 'rzp_webhook_secret';
  const adapter = new RazorpayAdapter('rzp_test_key', keySecret, webhookSecret);

  it('verifies payment signature with provider order + payment id', () => {
    const providerOrderId = 'order_123';
    const providerPaymentId = 'pay_123';
    const signature = createHmac('sha256', keySecret)
      .update(`${providerOrderId}|${providerPaymentId}`)
      .digest('hex');

    const valid = adapter.verifyPaymentSignature({
      providerOrderId,
      providerPaymentId,
      signature
    });

    expect(valid).toBe(true);
  });

  it('rejects invalid payment signature', () => {
    const valid = adapter.verifyPaymentSignature({
      providerOrderId: 'order_123',
      providerPaymentId: 'pay_123',
      signature: 'invalid-signature'
    });

    expect(valid).toBe(false);
  });

  it('verifies webhook signature against raw payload buffer', () => {
    const payload = Buffer.from(JSON.stringify({ event: 'payment.captured', id: 'evt_123' }));
    const signature = createHmac('sha256', webhookSecret).update(payload).digest('hex');

    const valid = adapter.verifyWebhookSignature({ payload, signature });

    expect(valid).toBe(true);
  });

  it('rejects invalid webhook signature', () => {
    const payload = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
    const valid = adapter.verifyWebhookSignature({ payload, signature: 'invalid-signature' });

    expect(valid).toBe(false);
  });
});
