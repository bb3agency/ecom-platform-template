import { describe, expect, it } from 'vitest';
import { CodPaymentAdapter } from './cod-payment.adapter';

describe('CodPaymentAdapter', () => {
  const adapter = new CodPaymentAdapter();

  it('createOrder returns a deterministic COD order with same amount/currency', async () => {
    const result = await adapter.createOrder({
      amount: 25000,
      currency: 'INR',
      receipt: 'ORD-2026-00042'
    });
    expect(result.providerOrderId).toMatch(/^COD-/);
    expect(result.amount).toBe(25000);
    expect(result.currency).toBe('INR');
    expect(result.status).toBe('cod_pending');
  });

  it('createOrder receipt is embedded in providerOrderId', async () => {
    const result = await adapter.createOrder({
      amount: 10000,
      currency: 'INR',
      receipt: 'ORD-2026-00007'
    });
    expect(result.providerOrderId).toContain('ORD-2026-00007');
  });

  it('verifyPaymentSignature always returns true for COD', () => {
    const result = adapter.verifyPaymentSignature({
      providerOrderId: 'COD-ORD-2026-00001',
      providerPaymentId: 'irrelevant',
      signature: ''
    });
    expect(result).toBe(true);
  });

  it('verifyWebhookSignature always returns false for COD (no webhooks)', () => {
    const result = adapter.verifyWebhookSignature({
      payload: Buffer.from('{}'),
      signature: 'anything'
    });
    expect(result).toBe(false);
  });

  it('initiateRefund returns a manual refund reference', async () => {
    const result = await adapter.initiateRefund({
      providerPaymentId: 'COD-ORD-2026-00001',
      amount: 25000
    });
    expect(result.providerRefundId).toMatch(/^COD-REFUND-/);
    expect(result.status).toBe('manual_refund_required');
    expect(result.amount).toBe(25000);
  });

  it('initiateRefund uses provided amount', async () => {
    const result = await adapter.initiateRefund({
      providerPaymentId: 'COD-ORD-2026-00002',
      amount: 5000
    });
    expect(result.amount).toBe(5000);
  });
});
