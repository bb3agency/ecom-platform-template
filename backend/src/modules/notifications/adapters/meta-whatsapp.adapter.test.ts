import { afterEach, describe, expect, it, vi } from 'vitest';

import { MetaWhatsAppAdapter } from './meta-whatsapp.adapter';

describe('MetaWhatsAppAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends mapped template payload with positional params and returns message id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.123' }] })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MetaWhatsAppAdapter({
      accessToken: 'meta_token',
      phoneNumberId: '123456789',
      apiVersion: 'v25.0',
      baseUrl: 'https://graph.facebook.com'
    });

    const result = await adapter.sendWhatsapp({
      phone: '+91 9876543210',
      // Internal PascalCase name — the adapter must translate it to the
      // lowercase Meta template name via the registry.
      template: 'OrderShipped',
      data: {
        storeName: 'Raghava Organics',
        orderId: 'order_1',
        trackingInfo: 'https://track.example/abc'
      }
    });

    expect(result.messageId).toBe('wamid.123');
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe('https://graph.facebook.com/v25.0/123456789/messages');
    expect(requestInit.headers).toMatchObject({
      Authorization: 'Bearer meta_token'
    });

    const body = JSON.parse(requestInit.body as string) as {
      to: string;
      type: string;
      template: { name: string; language: { code: string }; components: unknown[] };
    };
    expect(body.to).toBe('919876543210');
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('order_shipped');
    expect(body.template.language.code).toBe('en');
    expect(body.template.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Raghava Organics' },
          { type: 'text', text: 'order_1' },
          { type: 'text', text: 'https://track.example/abc' }
        ]
      }
    ]);
  });

  it('throws validation error for invalid phone number', async () => {
    const adapter = new MetaWhatsAppAdapter({
      accessToken: 'meta_token',
      phoneNumberId: '123456789'
    });

    await expect(
      adapter.sendWhatsapp({
        phone: '12',
        template: 'order_shipped',
        data: {}
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
