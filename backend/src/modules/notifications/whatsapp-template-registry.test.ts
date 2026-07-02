import { describe, expect, it } from 'vitest';

import { WhatsappTemplateRegistry } from './whatsapp-template-registry';

describe('WhatsappTemplateRegistry', () => {
  const registry = new WhatsappTemplateRegistry();

  it('maps internal template names to lowercase Meta template names', () => {
    expect(registry.resolve('OrderConfirmed', {})?.metaName).toBe('order_confirmed');
    expect(registry.resolve('OrderShipped', {})?.metaName).toBe('order_shipped');
    expect(registry.resolve('OutForDelivery', {})?.metaName).toBe('out_for_delivery');
    expect(registry.resolve('OrderDelivered', {})?.metaName).toBe('order_delivered');
    expect(registry.resolve('OrderCancelled', {})?.metaName).toBe('order_cancelled');
    expect(registry.resolve('PaymentFailed', {})?.metaName).toBe('payment_failed');
  });

  it('returns positional parameters in declared order, not alphabetical', () => {
    const data = WhatsappTemplateRegistry.composeTemplateData(
      { orderId: 'ORD-100', trackingUrl: 'https://track.example/abc' },
      'Raghava Organics'
    );

    const resolved = registry.resolve('OrderShipped', data);
    // {{1}} storeName, {{2}} orderId, {{3}} trackingInfo — order matters for Meta.
    expect(resolved?.parameters).toEqual([
      'Raghava Organics',
      'ORD-100',
      'https://track.example/abc'
    ]);
    expect(resolved?.language).toBe('en');
  });

  it('injects a fallback store name and tracking text (Meta rejects empty params)', () => {
    const data = WhatsappTemplateRegistry.composeTemplateData({ orderId: 'ORD-7' }, '   ');
    const resolved = registry.resolve('OrderShipped', data);
    expect(resolved?.parameters).toEqual(['Our Store', 'ORD-7', 'your account orders page']);
  });

  it('maps the customer OTP template as an authentication template with the code only', () => {
    const resolved = registry.resolve('CustomerOtpVerification', { otp: '123456', storeName: 'Raghava Organics' });
    expect(resolved?.metaName).toBe('otp_verification');
    expect(resolved?.language).toBe('en');
    expect(resolved?.authentication).toBe(true);
    // Authentication templates carry a SINGLE param — the code (store name is the sender, not in body).
    expect(resolved?.parameters).toEqual(['123456']);
  });

  it('marks non-authentication templates with authentication=false', () => {
    expect(registry.resolve('OrderConfirmed', {})?.authentication).toBe(false);
  });

  it('returns null for templates not mapped to a WhatsApp template', () => {
    expect(registry.resolve('OpsActionOtp', { otp: '123456' })).toBeNull();
  });
});
