import { describe, expect, it } from 'vitest';
import { renderNotificationEmail } from './email-templates';

describe('renderNotificationEmail', () => {
  it('renders OrderConfirmed with order-aware subject', async () => {
    const rendered = await renderNotificationEmail('OrderConfirmed', { orderId: 'order_123' });
    expect(rendered.subject).toContain('order_123');
    expect(rendered.html).toContain('Order Confirmed');
  });

  it('rejects unsupported template names', async () => {
    await expect(
      renderNotificationEmail('UnknownTemplate', {
        orderId: 'order_123'
      })
    ).rejects.toThrow('Unsupported email template');
  });

  it('renders PasswordReset template with email in body', async () => {
    const rendered = await renderNotificationEmail('PasswordReset', {
      email: 'user@example.com',
      resetUrl: 'http://localhost:3101/reset-password?token=abc123'
    });
    expect(rendered.subject).toContain('password');
    expect(rendered.html).toContain('user@example.com');
    expect(rendered.html).toContain('http://localhost:3101/reset-password?token=abc123');
  });

  it('renders OtpVerification template with otp in body', async () => {
    const rendered = await renderNotificationEmail('OtpVerification', {
      otp: '123456'
    });
    expect(rendered.subject).toContain('login code');
    expect(rendered.html).toContain('123456');
  });

  it('renders CustomerOtpVerification with store-branded subject and anti-sharing message', async () => {
    const rendered = await renderNotificationEmail('CustomerOtpVerification', {
      otp: '654321',
      storeName: 'Acme Shop'
    });
    expect(rendered.subject).toContain('Acme Shop');
    expect(rendered.html).toContain('654321');
    expect(rendered.html).toContain('Acme Shop');
    expect(rendered.html).toContain('never ask you for it');
  });

  it('renders CustomerOtpVerification with Our Store fallback when storeName is missing', async () => {
    const rendered = await renderNotificationEmail('CustomerOtpVerification', {
      otp: '111222'
    });
    expect(rendered.subject).toContain('Our Store');
    expect(rendered.html).toContain('111222');
    expect(rendered.html).toContain('Our Store');
  });

  it('renders NotificationDeliveryFailure with channel and recipient context', async () => {
    const rendered = await renderNotificationEmail('NotificationDeliveryFailure', {
      template: 'OrderShipped',
      channel: 'WHATSAPP',
      recipient: '9876543210',
      errorMessage: 'Meta API timeout',
      failureStage: 'OUTBOX_DISPATCH',
      queueName: 'notifications',
      jobName: 'send-primary',
      jobId: 'job_123',
      outboxMessageId: 'outbox_123'
    });
    expect(rendered.subject).toContain('Notification delivery failure');
    expect(rendered.html).toContain('WHATSAPP');
    expect(rendered.html).toContain('9876543210');
    expect(rendered.html).toContain('Meta API timeout');
    expect(rendered.html).toContain('OUTBOX_DISPATCH');
    expect(rendered.html).toContain('send-primary');
    expect(rendered.html).toContain('outbox_123');
  });

  it('renders AdminInviteSetup template with admin setup URL and expiry', async () => {
    const rendered = await renderNotificationEmail('AdminInviteSetup', {
      email: 'merchant@example.com',
      setupUrl: 'https://client.example.com/admin/setup?token=abc',
      expiresAt: '2026-05-13T00:00:00.000Z'
    });
    expect(rendered.subject).toContain('merchant admin setup invite');
    expect(rendered.html).toContain('merchant@example.com');
    expect(rendered.html).toContain('/admin/setup?token=abc');
    expect(rendered.html).toContain('2026-05-13T00:00:00.000Z');
  });

  it('renders LowStockAlert with sku rows in body', async () => {
    const rendered = await renderNotificationEmail('LowStockAlert', {
      items: [{ sku: 'SKU-123', quantity: 2, lowStockThreshold: 5 }]
    });
    expect(rendered.subject).toContain('Low stock alert');
    expect(rendered.html).toContain('SKU-123');
  });
});
