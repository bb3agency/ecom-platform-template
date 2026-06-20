import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDeliverableOtpChannels,
  isOtpChannelDeliverable,
  resolveOtpChannelForTemplate,
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
});
