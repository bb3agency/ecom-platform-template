import { afterEach, describe, expect, it, vi } from 'vitest';

import { Msg91Adapter } from './msg91.adapter';

describe('Msg91Adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes 10-digit number to 91-prefixed mobiles payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ request_id: 'msg_123' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new Msg91Adapter({
      authKey: 'msg91_key',
      senderId: 'ECOMTM',
      route: '4',
      baseUrl: 'https://api.msg91.com/api/v5'
    });

    const result = await adapter.sendSms({
      phone: '9876543210',
      template: 'OrderConfirmed',
      data: { orderId: 'order_1' }
    });

    expect(result.messageId).toBe('msg_123');
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    if (typeof requestInit.body !== 'string') {
      throw new Error('Expected JSON string body');
    }
    const payload = JSON.parse(requestInit.body) as { mobiles: string };
    expect(payload.mobiles).toBe('919876543210');
  });

  it('accepts already 91-prefixed number', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ request_id: 'msg_456' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new Msg91Adapter({
      authKey: 'msg91_key',
      senderId: 'ECOMTM',
      route: '4'
    });

    await adapter.sendWhatsapp({
      phone: '+91 9876543210',
      template: 'OrderConfirmed',
      data: { orderId: 'order_2' }
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    if (typeof requestInit.body !== 'string') {
      throw new Error('Expected JSON string body');
    }
    const payload = JSON.parse(requestInit.body) as { mobiles: string };
    expect(payload.mobiles).toBe('919876543210');
  });

  it('rejects invalid phone format', async () => {
    const adapter = new Msg91Adapter({
      authKey: 'msg91_key',
      senderId: 'ECOMTM',
      route: '4'
    });

    await expect(
      adapter.sendSms({
        phone: '12345',
        template: 'OrderConfirmed',
        data: { orderId: 'order_3' }
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
