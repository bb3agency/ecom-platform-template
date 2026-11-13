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

describe('RazorpayAdapter.listCapturedPayments (capture reconciliation)', () => {
  const adapter = new RazorpayAdapter('rzp_test_key', 'rzp_test_secret', 'rzp_webhook_secret');

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pages GET /payments with unix-second from/to and count/skip', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await adapter.listCapturedPayments({
      from: new Date('2026-11-10T00:00:00Z'),
      to: new Date('2026-11-12T00:00:00Z'),
      count: 100,
      skip: 200
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/v1/payments');
    expect(url.searchParams.get('from')).toBe(String(Date.parse('2026-11-10T00:00:00Z') / 1000));
    expect(url.searchParams.get('to')).toBe(String(Date.parse('2026-11-12T00:00:00Z') / 1000));
    expect(url.searchParams.get('count')).toBe('100');
    expect(url.searchParams.get('skip')).toBe('200');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('GET');
  });

  it('clamps count to the Razorpay maximum of 100', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await adapter.listCapturedPayments({ from: new Date(0), to: new Date(1000), count: 500, skip: 0 });

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('count')).toBe('100');
  });

  it('returns only captured payments and judges hasMore on the raw page size', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            { id: 'pay_cap', order_id: 'order_1', status: 'captured', amount: 5000, currency: 'INR', created_at: 1_700_000_000 },
            { id: 'pay_ref', order_id: 'order_2', status: 'refunded', amount: 5000, currency: 'INR', created_at: 1_700_000_000 },
            { id: 'pay_nolink', status: 'captured', amount: 700, currency: 'INR', created_at: 1_700_000_100 }
          ]
        })
      })
    );

    const result = await adapter.listCapturedPayments({ from: new Date(0), to: new Date(1000), count: 3, skip: 0 });

    expect(result.hasMore).toBe(true);
    expect(result.items).toEqual([
      {
        providerPaymentId: 'pay_cap',
        providerOrderId: 'order_1',
        amount: 5000,
        currency: 'INR',
        createdAt: new Date(1_700_000_000 * 1000)
      },
      {
        providerPaymentId: 'pay_nolink',
        providerOrderId: null,
        amount: 700,
        currency: 'INR',
        createdAt: new Date(1_700_000_100 * 1000)
      }
    ]);
  });

  it('reports no further pages on a short page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));
    const result = await adapter.listCapturedPayments({ from: new Date(0), to: new Date(1000), count: 100, skip: 0 });
    expect(result).toEqual({ items: [], hasMore: false });
  });

  it('rejects when Razorpay cannot be asked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
    await expect(
      adapter.listCapturedPayments({ from: new Date(0), to: new Date(1000), count: 100, skip: 0 })
    ).rejects.toThrow();
  });
});
