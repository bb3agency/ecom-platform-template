import { createHmac } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('RazorpayAdapter refund idempotency (be-rel-03)', () => {
  const adapter = new RazorpayAdapter('rzp_test_key', 'rzp_test_secret', 'rzp_webhook_secret');

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the receipt and mirrors it into notes.refundAttemptId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rfnd_1', amount: 5000, status: 'processed' })
    });
    vi.stubGlobal('fetch', fetchMock);

    await adapter.initiateRefund({ providerPaymentId: 'pay_1', amount: 5000, receipt: 'rf_abc', notes: { orderId: 'o1' } });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>;
    expect(body).toMatchObject({ amount: 5000, receipt: 'rf_abc', notes: { orderId: 'o1', refundAttemptId: 'rf_abc' } });
  });

  it('finds a non-failed refund by receipt and ignores failed ones', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { id: 'rfnd_failed', amount: 5000, status: 'failed', receipt: 'rf_abc' },
          { id: 'rfnd_ok', amount: 5000, status: 'processed', receipt: null, notes: { refundAttemptId: 'rf_abc' } }
        ]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(adapter.findRefundByReceipt({ providerPaymentId: 'pay_1', receipt: 'rf_abc' })).resolves.toEqual({
      providerRefundId: 'rfnd_ok',
      status: 'processed',
      amount: 5000
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/payments/pay_1/refunds');
  });

  it('returns null when no refund carries the receipt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));
    await expect(adapter.findRefundByReceipt({ providerPaymentId: 'pay_1', receipt: 'rf_x' })).resolves.toBeNull();
  });
});
