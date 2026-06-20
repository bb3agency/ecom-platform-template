import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNotificationProviders } from './notification-provider';

describe('createNotificationProviders', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubBaseEnv(): void {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'true');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'true');
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('MSG91_AUTH_KEY', 'msg91_test_key');
    vi.stubEnv('RESEND_API_KEY', 'resend_test_key');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'meta_access_token');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '123456789');
  }

  it('fails fast when MSG91 auth key is missing with SMS_PROVIDER=msg91', () => {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'true');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'true');
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('MSG91_AUTH_KEY', '');
    vi.stubEnv('RESEND_API_KEY', 'resend_test_key');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'meta_access_token');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '123456789');

    expect(() => createNotificationProviders()).toThrow('MSG91_AUTH_KEY must be set');
  });

  it('fails fast when Fast2SMS API key is missing with SMS_PROVIDER=fast2sms', () => {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'true');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'true');
    vi.stubEnv('SMS_PROVIDER', 'fast2sms');
    vi.stubEnv('FAST2SMS_API_KEY', '');
    vi.stubEnv('RESEND_API_KEY', 'resend_test_key');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'meta_access_token');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '123456789');

    expect(() => createNotificationProviders()).toThrow('FAST2SMS_API_KEY must be set');
  });

  it('fails fast for unsupported SMS_PROVIDER value', () => {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'true');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'false');
    vi.stubEnv('SMS_PROVIDER', 'unknown');
    vi.stubEnv('RESEND_API_KEY', 'resend_test_key');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', '');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '');

    expect(() => createNotificationProviders()).toThrow('Unsupported SMS_PROVIDER: unknown');
  });

  it('creates Fast2smsAdapter when SMS_PROVIDER=fast2sms and key is present', () => {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'false');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'false');
    vi.stubEnv('SMS_PROVIDER', 'fast2sms');
    vi.stubEnv('FAST2SMS_API_KEY', 'fast2sms_test_key');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', '');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '');

    const providers = createNotificationProviders();
    expect(providers.sms).toBeDefined();
  });

  it('creates unavailable SMS adapter when SMS_PROVIDER=noop', async () => {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'false');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'false');
    vi.stubEnv('SMS_PROVIDER', 'noop');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', '');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '');

    const providers = createNotificationProviders();
    expect(providers.sms).toBeDefined();
    await expect(providers.sms.sendSms({ phone: '9876543210', template: 'T', data: {} })).rejects.toThrow(
      'SMS notifications are disabled'
    );
  });

  it('fails fast when Resend API key is missing', () => {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'true');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'true');
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('MSG91_AUTH_KEY', 'msg91_test_key');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'meta_access_token');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '123456789');

    expect(() => createNotificationProviders()).toThrow('RESEND_API_KEY must be set');
  });

  it('fails fast when Meta WhatsApp access token is missing', () => {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'true');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'true');
    vi.stubEnv('MSG91_AUTH_KEY', 'msg91_test_key');
    vi.stubEnv('RESEND_API_KEY', 'resend_test_key');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', '');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '123456789');

    expect(() => createNotificationProviders()).toThrow('META_WHATSAPP_ACCESS_TOKEN must be set');
  });

  it('fails fast when Meta WhatsApp phone number id is missing', () => {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'true');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'true');
    vi.stubEnv('MSG91_AUTH_KEY', 'msg91_test_key');
    vi.stubEnv('RESEND_API_KEY', 'resend_test_key');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'meta_access_token');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '');

    expect(() => createNotificationProviders()).toThrow('META_WHATSAPP_PHONE_NUMBER_ID must be set');
  });

  it('creates providers when required keys are present', () => {
    stubBaseEnv();

    const providers = createNotificationProviders();

    expect(providers.email).toBeDefined();
    expect(providers.sms).toBeDefined();
    expect(providers.whatsapp).toBeDefined();
  });

  it('does not require Meta credentials when WhatsApp flag is unset', () => {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'true');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'true');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', '');
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('MSG91_AUTH_KEY', 'msg91_test_key');
    vi.stubEnv('RESEND_API_KEY', 'resend_test_key');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', '');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '');

    const providers = createNotificationProviders();

    expect(providers.email).toBeDefined();
    expect(providers.sms).toBeDefined();
    expect(providers.whatsapp).toBeDefined();
  });

  it('creates providers without credentials when all channels are disabled', () => {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'false');
    vi.stubEnv('NOTIFY_SMS_ENABLED', 'false');
    vi.stubEnv('NOTIFY_WHATSAPP_ENABLED', 'false');
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('MSG91_AUTH_KEY', '');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', '');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '');

    const providers = createNotificationProviders();

    expect(providers.email).toBeDefined();
    expect(providers.sms).toBeDefined();
    expect(providers.whatsapp).toBeDefined();
  });
});
