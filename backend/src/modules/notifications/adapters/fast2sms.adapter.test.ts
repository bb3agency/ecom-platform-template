import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Fast2smsAdapter } from './fast2sms.adapter';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { SmsTemplateRegistry } from '../sms-template-registry';

describe('Fast2smsAdapter', () => {
  const apiKey = 'test-api-key';
  let adapter: Fast2smsAdapter;

  beforeEach(() => {
    adapter = new Fast2smsAdapter({ apiKey });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends Quick SMS with resolved template message', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ return: true, request_id: 'req-123', message: ['Message sent'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await adapter.sendSms({
      phone: '9876543210',
      template: 'OrderConfirmed',
      data: { orderId: 'ORD-42' }
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.route).toBe('q');
    expect(body.numbers).toBe('9876543210');
    expect(body.message).toBe(': Your order ORD-42 is confirmed! We are preparing it for dispatch. You will be notified when it ships.');
    expect(body.variables_values).toBeUndefined();

    expect(result.messageId).toBe('req-123');
    expect(result.providerPayload).toMatchObject({ return: true, request_id: 'req-123' });
  });

  it('sends OTP route when data.otp is present', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ return: true, request_id: 'otp-req-99' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await adapter.sendSms({
      phone: '9876543210',
      template: 'OtpVerification',
      data: { otp: '123456' }
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.route).toBe('otp');
    expect(body.variables_values).toBe('123456');
    expect(body.message).toBeUndefined();
    expect(result.messageId).toBe('otp-req-99');
  });

  it('sends OTP route when template is OpsInviteSetup', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ return: true, request_id: 'otp-req-88' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await adapter.sendSms({
      phone: '9876543210',
      template: 'OpsInviteSetup',
      data: { otp: '999888' }
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.route).toBe('otp');
    expect(body.variables_values).toBe('999888');
  });

  it('normalizes +91 prefix to 10 digits', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ return: true, request_id: 'req-1' }), { status: 200 })
    );

    await adapter.sendSms({ phone: '+919876543210', template: 'OrderConfirmed', data: { orderId: '1' } });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.numbers).toBe('9876543210');
  });

  it('normalizes 0-prefixed 11-digit number to 10 digits', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ return: true, request_id: 'req-1' }), { status: 200 })
    );

    await adapter.sendSms({ phone: '09876543210', template: 'OrderConfirmed', data: { orderId: '1' } });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.numbers).toBe('9876543210');
  });

  it('throws VALIDATION_ERROR for invalid phone format', async () => {
    await expect(
      adapter.sendSms({ phone: '12345', template: 'OrderConfirmed', data: {} })
    ).rejects.toThrow(
      new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid phone format for Fast2SMS delivery', 400)
    );
  });

  it('throws INTERNAL_ERROR on HTTP failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ return: false, message: ['Auth failed'] }), { status: 401 })
    );

    await expect(
      adapter.sendSms({ phone: '9876543210', template: 'OrderConfirmed', data: { orderId: '1' } })
    ).rejects.toThrow(AppError);
  });

  it('throws INTERNAL_ERROR on return: false', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ return: false, message: ['Invalid number'] }), { status: 200 })
    );

    await expect(
      adapter.sendSms({ phone: '9876543210', template: 'OrderConfirmed', data: { orderId: '1' } })
    ).rejects.toThrow(
      new AppError(ERROR_CODES.INTERNAL_ERROR, 'Fast2SMS delivery failed: ["Invalid number"]', 502)
    );
  });

  it('passes custom templateRegistry if provided', async () => {
    const customRegistry = new SmsTemplateRegistry({ CustomTmpl: 'Custom: {{val}}' });
    const customAdapter = new Fast2smsAdapter({ apiKey, templateRegistry: customRegistry });

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ return: true, request_id: 'req-c' }), { status: 200 })
    );

    await customAdapter.sendSms({ phone: '9876543210', template: 'CustomTmpl', data: { val: 'X' } });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe('Custom: X');
  });

  it('falls back to template name + JSON data for unknown templates', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ return: true, request_id: 'req-fb' }), { status: 200 })
    );

    await adapter.sendSms({ phone: '9876543210', template: 'UnknownAlert', data: { foo: 'bar' } });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe('UnknownAlert{"foo":"bar"}');
  });
});
