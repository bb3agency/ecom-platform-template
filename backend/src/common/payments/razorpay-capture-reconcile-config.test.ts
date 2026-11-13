import { describe, expect, it } from 'vitest';
import { isRazorpayCaptureReconcileEnabled } from './razorpay-capture-reconcile-config';

const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars as NodeJS.ProcessEnv;

describe('isRazorpayCaptureReconcileEnabled', () => {
  it('defaults to on when Razorpay is the provider', () => {
    expect(isRazorpayCaptureReconcileEnabled(env({ PAYMENT_PROVIDER: 'razorpay' }))).toBe(true);
    expect(isRazorpayCaptureReconcileEnabled(env({ PAYMENT_PROVIDER: ' Razorpay ', RAZORPAY_RECONCILE_ENABLED: '' }))).toBe(true);
  });

  it('honours an explicit switch', () => {
    expect(isRazorpayCaptureReconcileEnabled(env({ PAYMENT_PROVIDER: 'razorpay', RAZORPAY_RECONCILE_ENABLED: 'false' }))).toBe(false);
    expect(isRazorpayCaptureReconcileEnabled(env({ PAYMENT_PROVIDER: 'razorpay', RAZORPAY_RECONCILE_ENABLED: '0' }))).toBe(false);
    expect(isRazorpayCaptureReconcileEnabled(env({ PAYMENT_PROVIDER: 'razorpay', RAZORPAY_RECONCILE_ENABLED: 'TRUE' }))).toBe(true);
    expect(isRazorpayCaptureReconcileEnabled(env({ PAYMENT_PROVIDER: 'razorpay', RAZORPAY_RECONCILE_ENABLED: '1' }))).toBe(true);
  });

  it('is always off for other providers, even when the flag says true', () => {
    for (const provider of ['cod', 'noop', '']) {
      expect(isRazorpayCaptureReconcileEnabled(env({ PAYMENT_PROVIDER: provider, RAZORPAY_RECONCILE_ENABLED: 'true' }))).toBe(false);
    }
    expect(isRazorpayCaptureReconcileEnabled(env({}))).toBe(false);
  });
});
