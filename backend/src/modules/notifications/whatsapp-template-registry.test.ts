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
    expect(registry.resolve('ReturnRequestUpdate', {})?.metaName).toBe('return_request_update');
  });

  it('fills the return-request template with storeName, orderId and the composed status line', () => {
    const data = WhatsappTemplateRegistry.composeTemplateData(
      {
        orderId: 'ORD-K4MQ-2F9X',
        returnStatusLine: 'approved — our team will arrange the pickup of your items'
      },
      'Raghava Organics'
    );
    const resolved = registry.resolve('ReturnRequestUpdate', data);
    expect(resolved?.parameters).toEqual([
      'Raghava Organics',
      'ORD-K4MQ-2F9X',
      'approved — our team will arrange the pickup of your items'
    ]);
    expect(resolved?.authentication).toBe(false);
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

  it('renders the human-readable orderNumber for {{orderId}}, never the internal UUID', () => {
    const data = WhatsappTemplateRegistry.composeTemplateData(
      { orderId: '947f0937-d89b-4a78-950d-99aba2d73c96', orderNumber: 'ORD-G343-TRCN' },
      'Raghava Organics'
    );
    const resolved = registry.resolve('OrderConfirmed', data);
    // {{1}} storeName, {{2}} orderId — must be the order NUMBER, not the uuid.
    expect(resolved?.parameters).toEqual(['Raghava Organics', 'ORD-G343-TRCN']);
    expect(resolved?.parameters[1]).not.toContain('947f0937');
  });

  it('maps the customer OTP template as an authentication template with the code only', () => {
    const resolved = registry.resolve('CustomerOtpVerification', { otp: '123456', storeName: 'Raghava Organics' });
    expect(resolved?.metaName).toBe('otp_verify');
    expect(resolved?.language).toBe('en');
    expect(resolved?.authentication).toBe(true);
    // Authentication templates carry a SINGLE param — the code (store name is the sender, not in body).
    expect(resolved?.parameters).toEqual(['123456']);
  });

  it('maps the admin OTP template (OtpVerification) to the same otp_verify authentication template', () => {
    const resolved = registry.resolve('OtpVerification', { otp: '654321' });
    expect(resolved?.metaName).toBe('otp_verify');
    expect(resolved?.authentication).toBe(true);
    expect(resolved?.parameters).toEqual(['654321']);
  });

  it('marks non-authentication templates with authentication=false', () => {
    expect(registry.resolve('OrderConfirmed', {})?.authentication).toBe(false);
  });

  it('returns null for templates not mapped to a WhatsApp template', () => {
    expect(registry.resolve('OpsActionOtp', { otp: '123456' })).toBeNull();
  });
});

describe('AdminNewOrder whatsapp mapping', () => {
  it('resolves admin_new_order with store, order ref, customer, and amount line', () => {
    const registry = new WhatsappTemplateRegistry();
    const data = WhatsappTemplateRegistry.composeTemplateData(
      {
        orderId: 'uuid-1',
        orderNumber: 'ORD-2026-00001',
        customerName: 'Dhanush Ram',
        amount: 'Rs 450.00',
        paymentMode: 'PREPAID'
      },
      'Raghava Organics'
    );
    const resolved = registry.resolve('AdminNewOrder', data);
    expect(resolved?.metaName).toBe('admin_new_order');
    expect(resolved?.parameters).toEqual([
      'Raghava Organics',
      'ORD-2026-00001',
      'Dhanush Ram',
      'Rs 450.00 - PREPAID'
    ]);
  });

  it('amount line falls back when amount/paymentMode missing (Meta rejects empty params)', () => {
    expect(WhatsappTemplateRegistry.composeOrderAmountLine({})).toBe('see admin panel');
  });
});
