import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  getAvailableOtpChannels,
  type OtpChannel,
  type OtpChannelFlags,
  type OtpTemplateKey,
  resolveEffectiveOtpChannel,
  resolvePrimaryOtpChannel
} from '@modules/auth/otp-channel';

export type OtpNotifyToggles = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
};

function parseEnabledFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return value.trim().toLowerCase() === 'true';
}

export function resolveOtpNotifyToggles(
  storeFlags?: OtpChannelFlags,
  runtime?: NodeJS.ProcessEnv
): OtpNotifyToggles {
  const env = runtime ?? process.env;
  return {
    emailEnabled: storeFlags?.emailEnabled ?? parseEnabledFlag(env.NOTIFY_EMAIL_ENABLED, true),
    smsEnabled: storeFlags?.smsEnabled ?? parseEnabledFlag(env.NOTIFY_SMS_ENABLED, false),
    whatsappEnabled: storeFlags?.whatsappEnabled ?? parseEnabledFlag(env.NOTIFY_WHATSAPP_ENABLED, false)
  };
}

function hasSmsCredentials(runtime: NodeJS.ProcessEnv): boolean {
  const provider = (runtime.SMS_PROVIDER ?? process.env.SMS_PROVIDER ?? 'msg91').trim().toLowerCase();
  if (provider === 'noop') {
    return false;
  }
  if (provider === 'msg91') {
    return Boolean((runtime.MSG91_AUTH_KEY ?? '').trim());
  }
  if (provider === 'fast2sms') {
    return Boolean((runtime.FAST2SMS_API_KEY ?? '').trim());
  }
  return false;
}

function hasWhatsappCredentials(runtime: NodeJS.ProcessEnv): boolean {
  return (
    Boolean((runtime.META_WHATSAPP_ACCESS_TOKEN ?? '').trim()) &&
    Boolean((runtime.META_WHATSAPP_PHONE_NUMBER_ID ?? '').trim())
  );
}

export function isOtpChannelDeliverable(
  channel: OtpChannel,
  toggles: OtpNotifyToggles,
  runtime: NodeJS.ProcessEnv
): boolean {
  if (channel === 'email') {
    return toggles.emailEnabled && Boolean((runtime.RESEND_API_KEY ?? '').trim());
  }
  if (channel === 'sms') {
    return toggles.smsEnabled && hasSmsCredentials(runtime);
  }
  return toggles.whatsappEnabled && hasWhatsappCredentials(runtime);
}

export function getDeliverableOtpChannels(
  storeFlags: OtpChannelFlags | undefined,
  runtime: NodeJS.ProcessEnv
): OtpChannel[] {
  const toggles = resolveOtpNotifyToggles(storeFlags, runtime);
  const candidates = getAvailableOtpChannels(storeFlags);
  return candidates.filter((channel) => isOtpChannelDeliverable(channel, toggles, runtime));
}

export function resolveOtpChannelForTemplate(input: {
  templateKey: OtpTemplateKey;
  storeFlags?: OtpChannelFlags | undefined;
  primaryChannels: unknown;
  runtime: NodeJS.ProcessEnv;
  /** Merchant admin login always uses email when it can be delivered. */
  preferEmail?: boolean;
}): { channel: OtpChannel; availableChannels: OtpChannel[]; toggles: OtpNotifyToggles } {
  const toggles = resolveOtpNotifyToggles(input.storeFlags, input.runtime);
  const availableChannels = getDeliverableOtpChannels(input.storeFlags, input.runtime);

  if (availableChannels.length === 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'OTP delivery is not configured. Enable Email in Admin → Settings → Notifications, set RESEND_API_KEY and a verified RESEND_FROM domain, ensure NOTIFY_EMAIL_ENABLED=true on API and workers, and run the notifications worker process.',
      400
    );
  }

  const primary = resolvePrimaryOtpChannel(input.primaryChannels, input.templateKey);
  let channel = resolveEffectiveOtpChannel(availableChannels, primary);

  if (input.preferEmail && availableChannels.includes('email')) {
    channel = 'email';
  }

  return { channel, availableChannels, toggles };
}

/**
 * Resolves the full set of channels an OTP should be delivered to.
 *
 * Base behaviour is unchanged: the primary channel (from primaryChannels config, or the
 * first deliverable channel) is always included. When `OTP_WHATSAPP_ENABLED=true` and
 * WhatsApp is deliverable, WhatsApp is ALSO added, so the same OTP goes to e.g. email +
 * WhatsApp together. Channels are de-duplicated and returned in a stable order
 * (primary first, then any extra channels).
 */
export function resolveOtpDeliveryChannels(input: {
  templateKey: OtpTemplateKey;
  storeFlags?: OtpChannelFlags | undefined;
  primaryChannels: unknown;
  runtime: NodeJS.ProcessEnv;
  preferEmail?: boolean;
}): { channels: OtpChannel[]; primaryChannel: OtpChannel; toggles: OtpNotifyToggles } {
  const { channel: primaryChannel, toggles } = resolveOtpChannelForTemplate(input);

  const channels: OtpChannel[] = [primaryChannel];

  const otpWhatsappEnabled = parseEnabledFlag(input.runtime.OTP_WHATSAPP_ENABLED, false);
  if (
    otpWhatsappEnabled &&
    !channels.includes('whatsapp') &&
    isOtpChannelDeliverable('whatsapp', toggles, input.runtime)
  ) {
    channels.push('whatsapp');
  }

  return { channels, primaryChannel, toggles };
}

export function assertOtpChannelDeliverable(
  channel: OtpChannel,
  toggles: OtpNotifyToggles,
  runtime: NodeJS.ProcessEnv
): void {
  if (isOtpChannelDeliverable(channel, toggles, runtime)) {
    return;
  }

  if (channel === 'email') {
    const parts: string[] = [];
    if (!toggles.emailEnabled) {
      parts.push('email notifications are disabled (check Store Settings and NOTIFY_EMAIL_ENABLED)');
    }
    if (!(runtime.RESEND_API_KEY ?? '').trim()) {
      parts.push('RESEND_API_KEY is missing (set in backend .env or Ops → Config)');
    }
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Cannot send login OTP by email: ${parts.join('; ')}.`,
      503
    );
  }

  if (channel === 'sms') {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'Cannot send OTP by SMS: SMS is disabled or provider credentials are missing.',
      503
    );
  }

  throw new AppError(
    ERROR_CODES.VALIDATION_ERROR,
    'Cannot send OTP by WhatsApp: WhatsApp is disabled or provider credentials are missing.',
    503
  );
}
