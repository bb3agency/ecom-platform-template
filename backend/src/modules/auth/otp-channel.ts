import { isDevelopmentLikeNodeEnv } from '@common/auth/auth-dev-bypass';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

export type OtpChannel = 'sms' | 'whatsapp' | 'email';
export type OtpTemplateKey = 'CustomerOtpVerification' | 'OtpVerification';

export type OtpChannelFlags = {
  smsEnabled?: boolean;
  whatsappEnabled?: boolean;
  emailEnabled?: boolean;
};

function isEnabled(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized.length === 0) {
    return defaultValue;
  }
  return normalized === 'true';
}

function hasSmsProviderCredentials(): boolean {
  const provider = (process.env.SMS_PROVIDER ?? 'msg91').trim().toLowerCase();
  if (provider === 'noop') {
    return false;
  }
  if (provider === 'msg91') {
    return Boolean((process.env.MSG91_AUTH_KEY ?? '').trim());
  }
  if (provider === 'fast2sms') {
    return Boolean((process.env.FAST2SMS_API_KEY ?? '').trim());
  }
  return false;
}

export function getAvailableOtpChannels(flags?: OtpChannelFlags): OtpChannel[] {
  const smsEnabled = flags?.smsEnabled ?? isEnabled(process.env.NOTIFY_SMS_ENABLED, false);
  const whatsappEnabled = flags?.whatsappEnabled ?? isEnabled(process.env.NOTIFY_WHATSAPP_ENABLED, false);
  const emailEnabled = flags?.emailEnabled ?? isEnabled(process.env.NOTIFY_EMAIL_ENABLED, true);

  // When a flag is explicitly provided by the caller (sourced from DB settings / runtime config),
  // trust it without requiring provider credentials in env — credential validation is the worker's
  // concern at delivery time, not the routing layer's.  Credential checks only apply when the
  // flag was derived from env vars (flags parameter absent or the specific key omitted).
  const channels: OtpChannel[] = [];
  if (smsEnabled && (flags?.smsEnabled !== undefined || hasSmsProviderCredentials())) {
    channels.push('sms');
  }
  if (
    whatsappEnabled &&
    (flags?.whatsappEnabled !== undefined ||
      (Boolean((process.env.META_WHATSAPP_ACCESS_TOKEN ?? '').trim()) &&
        Boolean((process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? '').trim())))
  ) {
    channels.push('whatsapp');
  }
  if (emailEnabled && (flags?.emailEnabled !== undefined || Boolean((process.env.RESEND_API_KEY ?? '').trim()))) {
    channels.push('email');
  }
  // No dev fallback here — use getDeliverableOtpChannels() so OTP is never routed to a channel that cannot send.
  if (channels.length === 0 && isDevelopmentLikeNodeEnv()) {
    return [];
  }
  return channels;
}

export function resolvePrimaryOtpChannel(config: unknown, templateKey: OtpTemplateKey): OtpChannel | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return null;
  }
  const map = config as Record<string, unknown>;
  const channel = map[templateKey];
  if (channel === 'SMS') return 'sms';
  if (channel === 'WHATSAPP') return 'whatsapp';
  if (channel === 'EMAIL') return 'email';
  return null;
}

/** Coerce a stored routing value (single `'EMAIL'` OR an array `['EMAIL','WHATSAPP']`) to a deduped OtpChannel[]. */
export function normalizeChannelList(value: unknown): OtpChannel[] {
  const toChannel = (v: unknown): OtpChannel | null =>
    v === 'SMS' ? 'sms' : v === 'WHATSAPP' ? 'whatsapp' : v === 'EMAIL' ? 'email' : null;
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const out: OtpChannel[] = [];
  for (const item of raw) {
    const ch = toChannel(item);
    if (ch && !out.includes(ch)) {
      out.push(ch);
    }
  }
  return out;
}

/** The configured channel SET for one template from `primaryNotificationChannels` (multi-channel). */
export function resolveChannelListForTemplate(config: unknown, templateKey: string): OtpChannel[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return [];
  }
  return normalizeChannelList((config as Record<string, unknown>)[templateKey]);
}

export function resolveEffectiveOtpChannel(available: OtpChannel[], primary: OtpChannel | null): OtpChannel {
  if (available.length === 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'No login/signup communication channel is configured. Configure at least one of SMS, WhatsApp, or Email in Ops.',
      400
    );
  }
  if (primary && available.includes(primary)) {
    return primary;
  }
  const fallback = available[0];
  if (!fallback) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'No login/signup communication channel is configured. Configure at least one of SMS, WhatsApp, or Email in Ops.',
      400
    );
  }
  return fallback;
}
