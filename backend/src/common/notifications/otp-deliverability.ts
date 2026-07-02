import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  getAvailableOtpChannels,
  type OtpChannel,
  type OtpChannelFlags,
  type OtpTemplateKey,
  resolveChannelListForTemplate,
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
 * Resolves the full set of channels an OTP should be delivered to (MULTI-channel).
 *
 * The merchant selects a SET of channels per OTP template in Admin → Settings → Notifications
 * (`primaryNotificationChannels[templateKey]` = e.g. `['EMAIL','WHATSAPP']`). We keep the ones that
 * are actually deliverable (enabled + provider credentials present). WhatsApp for OTP carries an
 * ADDITIONAL platform kill-switch: it is only included when the ops `OTP_WHATSAPP_ENABLED` flag is
 * on (a paid-feature gate) — so a merchant toggling WhatsApp for OTP has no effect until ops enables
 * it. If nothing is configured/deliverable, we fall back to the first deliverable channel (email-first).
 * The same OTP (one hash) is sent to every returned channel; verifying it once consumes it.
 */
export function resolveOtpDeliveryChannels(input: {
  templateKey: OtpTemplateKey;
  storeFlags?: OtpChannelFlags | undefined;
  primaryChannels: unknown;
  runtime: NodeJS.ProcessEnv;
  preferEmail?: boolean;
}): { channels: OtpChannel[]; primaryChannel: OtpChannel; toggles: OtpNotifyToggles } {
  const toggles = resolveOtpNotifyToggles(input.storeFlags, input.runtime);
  const deliverable = getDeliverableOtpChannels(input.storeFlags, input.runtime);
  const otpWhatsappEnabled = parseEnabledFlag(input.runtime.OTP_WHATSAPP_ENABLED, false);

  const configured = resolveChannelListForTemplate(input.primaryChannels, input.templateKey);
  let channels = configured.filter(
    (ch) => deliverable.includes(ch) && (ch !== 'whatsapp' || otpWhatsappEnabled)
  );

  // Admin login OTP (`preferEmail`) always includes email when deliverable — a security floor so a
  // misconfigured routing can never lock an admin out of their email OTP; configured extras stay.
  if (input.preferEmail && deliverable.includes('email') && !channels.includes('email')) {
    channels = ['email', ...channels];
  }

  // Nothing configured is deliverable (e.g. only WhatsApp selected but it's off) → fall back to the
  // first deliverable channel. (We can't blindly prefer email here: phone-only signups have no email
  // address, so email-first would strand them; when the customer HAS an email it's normally kept in
  // the configured set and survives above. The `preferEmail` admin path already forces email in.)
  if (channels.length === 0) {
    const fallback = deliverable[0];
    if (!fallback) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'OTP delivery is not configured. Enable Email in Admin → Settings → Notifications, set RESEND_API_KEY and a verified RESEND_FROM domain, ensure NOTIFY_EMAIL_ENABLED=true on API and workers, and run the notifications worker process.',
        400
      );
    }
    channels = [fallback];
  }

  // preferEmail (admin login) — surface email as the primary/first channel when present.
  const primaryChannel: OtpChannel =
    input.preferEmail && channels.includes('email') ? 'email' : (channels[0] as OtpChannel);
  const ordered = [primaryChannel, ...channels.filter((ch) => ch !== primaryChannel)];

  return { channels: ordered, primaryChannel, toggles };
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
