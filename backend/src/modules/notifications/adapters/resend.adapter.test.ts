import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendAdapter } from './resend.adapter';

describe('ResendAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends rendered template subject and html', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'email_123' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ResendAdapter({
      apiKey: 'resend_key',
      fromEmail: 'noreply@example.com',
      baseUrl: 'https://api.resend.com'
    });

    const result = await adapter.sendEmail({
      to: 'user@example.com',
      template: 'OrderConfirmed',
      data: { orderId: 'order_123' }
    });

    expect(result.messageId).toBe('email_123');
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    if (typeof requestInit.body !== 'string') {
      throw new Error('Expected JSON string body');
    }
    const payload = JSON.parse(requestInit.body) as {
      subject: string;
      html: string;
    };
    expect(payload.subject).toContain('order_123');
    expect(payload.html).toContain('Order Confirmed');
  });

  it('surfaces the provider message + name when Resend returns a structured error', async () => {
    // Resend's 403 in test mode is the single most common first-deploy issue.
    // The thrown error must carry enough detail for an operator to fix the config
    // (verify a domain at resend.com/domains) without tailing JSON in the worker log.
    const errorBody = {
      statusCode: 403,
      name: 'validation_error',
      message:
        'You can only send testing emails to your own email address (account@example.com). To send emails to other recipients, please verify a domain at resend.com/domains.'
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => JSON.stringify(errorBody)
      })
    );

    const adapter = new ResendAdapter({
      apiKey: 'resend_key',
      fromEmail: 'onboarding@resend.dev',
      baseUrl: 'https://api.resend.com'
    });

    await expect(
      adapter.sendEmail({
        to: 'ops@example.com',
        template: 'OpsActionOtp',
        data: { code: '123456', action: 'config-save', expiresAt: '2026-01-01T00:00:00Z' }
      })
    ).rejects.toThrow(/Resend request failed: 403.*validation_error.*verify a domain/);
  });

  it('falls back to the raw body when the response is not JSON', async () => {
    // Some upstream proxies / Resend WAF rejections return HTML or plain text. We
    // still want some signal in NotificationLog instead of a bare status code.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => '<html><body>Bad Gateway</body></html>'
      })
    );

    const adapter = new ResendAdapter({
      apiKey: 'resend_key',
      fromEmail: 'noreply@example.com'
    });

    await expect(
      adapter.sendEmail({
        to: 'user@example.com',
        template: 'OrderConfirmed',
        data: { orderId: 'order_123' }
      })
    ).rejects.toThrow(/Resend request failed: 502.*Bad Gateway/);
  });
});
