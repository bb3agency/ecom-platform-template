import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePaymentProviderRuntime } from './payment-provider';

describe('payment provider runtime', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to razorpay provider runtime', () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'razorpay');
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_key');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'rzp_secret');
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', 'rzp_webhook');
    const runtime = resolvePaymentProviderRuntime();
    expect(runtime.provider).toBe('razorpay');
    expect(runtime.capabilities.supportsOrderCreation).toBe(true);
  });

  it('returns unconfigured runtime when razorpay key id is missing', async () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'razorpay');
    vi.stubEnv('RAZORPAY_KEY_ID', '');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'rzp_secret');
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', 'rzp_webhook');

    const runtime = resolvePaymentProviderRuntime();
    expect(runtime.provider).toBe('unconfigured');
    await expect(
      runtime.adapter.createOrder({ amount: 100, currency: 'INR', receipt: 'x' })
    ).rejects.toThrow('Payment provider config missing');
  });

  it('returns unconfigured runtime when razorpay key secret is missing', async () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'razorpay');
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_key');
    vi.stubEnv('RAZORPAY_KEY_SECRET', '');
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', 'rzp_webhook');

    const runtime = resolvePaymentProviderRuntime();
    expect(runtime.provider).toBe('unconfigured');
    await expect(
      runtime.adapter.createOrder({ amount: 100, currency: 'INR', receipt: 'x' })
    ).rejects.toThrow('Payment provider config missing');
  });

  it('returns unconfigured runtime when razorpay webhook secret is missing', async () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'razorpay');
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_key');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'rzp_secret');
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', '');

    const runtime = resolvePaymentProviderRuntime();
    expect(runtime.provider).toBe('unconfigured');
    await expect(
      runtime.adapter.createOrder({ amount: 100, currency: 'INR', receipt: 'x' })
    ).rejects.toThrow('Payment provider config missing');
  });

  it('supports noop provider selection for fallback drills', () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'noop');
    vi.stubEnv('PAYMENT_PROVIDER_FAILOVER_ENABLED', 'true');
    const runtime = resolvePaymentProviderRuntime();
    expect(runtime.provider).toBe('noop');
    expect(runtime.failoverEnabled).toBe(true);
    expect(runtime.capabilities.supportsWebhookVerification).toBe(false);
  });

  it('returns unconfigured runtime when PAYMENT_PROVIDER is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PAYMENT_PROVIDER', '');
    const runtime = resolvePaymentProviderRuntime();
    expect(runtime.provider).toBe('unconfigured');
    await expect(
      runtime.adapter.createOrder({ amount: 100, currency: 'INR', receipt: 'x' })
    ).rejects.toThrow('Payment provider is not configured');
  });

  it('resolves COD provider with correct capabilities', () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'cod');
    const runtime = resolvePaymentProviderRuntime();
    expect(runtime.provider).toBe('cod');
    expect(runtime.capabilities.supportsOrderCreation).toBe(true);
    expect(runtime.capabilities.supportsWebhookVerification).toBe(false);
    expect(runtime.capabilities.supportsRefunds).toBe(false);
  });

  it('COD adapter createOrder returns cod_pending status', async () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'cod');
    const runtime = resolvePaymentProviderRuntime();
    const result = await runtime.adapter.createOrder({
      amount: 50000,
      currency: 'INR',
      receipt: 'ORD-2026-00099'
    });
    expect(result.status).toBe('cod_pending');
    expect(result.providerOrderId).toBe('COD-ORD-2026-00099');
  });
});
