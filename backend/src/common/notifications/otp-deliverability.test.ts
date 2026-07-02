import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDeliverableOtpChannels,
  isOtpChannelDeliverable,
  resolveOtpChannelForTemplate,
  resolveOtpDeliveryChannels,
  resolveOtpNotifyToggles
} from './otp-deliverability';

describe('otp-deliverability', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('treats email as undeliverable when NOTIFY_EMAIL_ENABLED is false and no Resend key', () => {
    vi.stubEnv('NOTIFY_EMAIL_ENABLED', 'false');
    vi.stubEnv('RESEND_API_KEY', '');
    const runtime = { NOTIFY_EMAIL_ENABLED: 'false', RESEND_API_KEY: '' };
    const toggles = resolveOtpNotifyToggles({ emailEnabled: true }, runtime);
    expect(isOtpChannelDeliverable('email', toggles, runtime)).toBe(false);
    expect(getDeliverableOtpChannels({ emailEnabled: true }, runtime)).toEqual([]);
  });

  it('treats email as deliverable when enabled and RESEND_API_KEY is set', () => {
    const runtime = { NOTIFY_EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_test' };
    const toggles = resolveOtpNotifyToggles({ emailEnabled: true }, runtime);
    expect(isOtpChannelDeliverable('email', toggles, runtime)).toBe(true);
  });

  it('prefers email for admin OtpVerification when email is deliverable', () => {
    const runtime = {
      NOTIFY_EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 're_test',
      NOTIFY_SMS_ENABLED: 'true',
      MSG91_AUTH_KEY: 'msg91'
    };
    const resolved = resolveOtpChannelForTemplate({
      templateKey: 'OtpVerification',
      storeFlags: {
        emailEnabled: true,
        smsEnabled: true,
        whatsappEnabled: false
      },
      primaryChannels: { OtpVerification: 'SMS' },
      runtime,
      preferEmail: true
    });
    expect(resolved.channel).toBe('email');
  });

  it('sends OTP to email only when OTP_WHATSAPP_ENABLED is off', () => {
    const runtime = {
      NOTIFY_EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 're_test',
      NOTIFY_WHATSAPP_ENABLED: 'true',
      META_WHATSAPP_ACCESS_TOKEN: 'tok',
      META_WHATSAPP_PHONE_NUMBER_ID: 'pid',
      OTP_WHATSAPP_ENABLED: 'false'
    };
    const { channels, primaryChannel } = resolveOtpDeliveryChannels({
      templateKey: 'CustomerOtpVerification',
      storeFlags: { emailEnabled: true, smsEnabled: false, whatsappEnabled: true },
      primaryChannels: { CustomerOtpVerification: 'EMAIL' },
      runtime
    });
    expect(primaryChannel).toBe('email');
    expect(channels).toEqual(['email']);
  });

  it('adds WhatsApp alongside the primary channel when OTP_WHATSAPP_ENABLED is on and deliverable', () => {
    const runtime = {
      NOTIFY_EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 're_test',
      NOTIFY_WHATSAPP_ENABLED: 'true',
      META_WHATSAPP_ACCESS_TOKEN: 'tok',
      META_WHATSAPP_PHONE_NUMBER_ID: 'pid',
      OTP_WHATSAPP_ENABLED: 'true'
    };
    const { channels, primaryChannel } = resolveOtpDeliveryChannels({
      templateKey: 'CustomerOtpVerification',
      storeFlags: { emailEnabled: true, smsEnabled: false, whatsappEnabled: true },
      primaryChannels: { CustomerOtpVerification: 'EMAIL' },
      runtime
    });
    expect(primaryChannel).toBe('email');
    expect(channels).toEqual(['email', 'whatsapp']);
  });

  it('does not duplicate WhatsApp when it is already the primary channel', () => {
    const runtime = {
      NOTIFY_WHATSAPP_ENABLED: 'true',
      META_WHATSAPP_ACCESS_TOKEN: 'tok',
      META_WHATSAPP_PHONE_NUMBER_ID: 'pid',
      OTP_WHATSAPP_ENABLED: 'true'
    };
    const { channels } = resolveOtpDeliveryChannels({
      templateKey: 'CustomerOtpVerification',
      storeFlags: { emailEnabled: false, smsEnabled: false, whatsappEnabled: true },
      primaryChannels: { CustomerOtpVerification: 'WHATSAPP' },
      runtime
    });
    expect(channels).toEqual(['whatsapp']);
  });

  it('does not add WhatsApp when the toggle is on but WhatsApp is not deliverable', () => {
    const runtime = {
      NOTIFY_EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 're_test',
      NOTIFY_WHATSAPP_ENABLED: 'true',
      // No META_WHATSAPP_* credentials => WhatsApp undeliverable.
      OTP_WHATSAPP_ENABLED: 'true'
    };
    const { channels } = resolveOtpDeliveryChannels({
      templateKey: 'CustomerOtpVerification',
      storeFlags: { emailEnabled: true, smsEnabled: false, whatsappEnabled: true },
      primaryChannels: { CustomerOtpVerification: 'EMAIL' },
      runtime
    });
    expect(channels).toEqual(['email']);
  });
});
