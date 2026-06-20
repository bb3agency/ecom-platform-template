import { afterEach, describe, expect, it, vi } from 'vitest';

import { MetaWhatsAppAdapter } from './meta-whatsapp.adapter';

describe('MetaWhatsAppAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends template payload to Meta Graph API and returns message id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.123' }] })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MetaWhatsAppAdapter({
      accessToken: 'meta_token',
      phoneNumberId: '123456789',
      apiVersion: 'v21.0',
      baseUrl: 'https://graph.facebook.com'
    });

    const result = await adapter.sendWhatsapp({
      phone: '+91 9876543210',
      template: 'order_shipped',
      data: { orderId: 'order_1' }
    });

    expect(result.messageId).toBe('wamid.123');
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe('https://graph.facebook.com/v21.0/123456789/messages');
    expect(requestInit.headers).toMatchObject({
      Authorization: 'Bearer meta_token'
    });
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
