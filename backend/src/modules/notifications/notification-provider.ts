import {
  EmailProviderAdapter,
  SmsProviderAdapter,
  WhatsappProviderAdapter
} from '@common/interfaces/notification-provider.interface';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { Msg91Adapter } from './adapters/msg91.adapter';
import { Fast2smsAdapter } from './adapters/fast2sms.adapter';
import { MetaWhatsAppAdapter } from './adapters/meta-whatsapp.adapter';
import { ResendAdapter } from './adapters/resend.adapter';
import { SmsTemplateRegistry } from './sms-template-registry';

type NotificationProviders = {
  email: EmailProviderAdapter;
  sms: SmsProviderAdapter;
  whatsapp: WhatsappProviderAdapter;
};

function isEnabled(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized.length === 0) {
    return defaultValue;
  }
  return normalized === 'true';
}

function createUnavailableEmailAdapter(): EmailProviderAdapter {
  return {
    async sendEmail() {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Email notifications are disabled', 500);
    }
  };
}

function createUnavailableSmsAdapter(): SmsProviderAdapter {
  return {
    async sendSms() {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'SMS notifications are disabled', 500);
    }
  };
}

function createUnavailableWhatsappAdapter(): WhatsappProviderAdapter {
  return {
    async sendWhatsapp() {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'WhatsApp notifications are disabled', 500);
    }
  };
}

export function createNotificationProviders(runtimeConfig: NodeJS.ProcessEnv = process.env): NotificationProviders {
  const emailEnabled = isEnabled(runtimeConfig.NOTIFY_EMAIL_ENABLED, true);
  const smsEnabled = isEnabled(runtimeConfig.NOTIFY_SMS_ENABLED, false);
  const whatsappEnabled = isEnabled(runtimeConfig.NOTIFY_WHATSAPP_ENABLED, false);

  const resendApiKey = (runtimeConfig.RESEND_API_KEY ?? '').trim();
  if (emailEnabled && !resendApiKey) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'RESEND_API_KEY must be set for notification providers', 500);
  }

  const smsProvider = (runtimeConfig.SMS_PROVIDER ?? 'msg91').trim().toLowerCase();
  if (smsEnabled && smsProvider !== 'noop') {
    if (smsProvider === 'msg91') {
      const msg91AuthKey = (runtimeConfig.MSG91_AUTH_KEY ?? '').trim();
      if (!msg91AuthKey) {
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'MSG91_AUTH_KEY must be set for notification providers', 500);
      }
    } else if (smsProvider === 'fast2sms') {
      const fast2smsApiKey = (runtimeConfig.FAST2SMS_API_KEY ?? '').trim();
      if (!fast2smsApiKey) {
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'FAST2SMS_API_KEY must be set for notification providers', 500);
      }
    } else {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, `Unsupported SMS_PROVIDER: ${smsProvider}`, 500);
    }
  }

  const metaAccessToken = (runtimeConfig.META_WHATSAPP_ACCESS_TOKEN ?? '').trim();
  if (whatsappEnabled && !metaAccessToken) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'META_WHATSAPP_ACCESS_TOKEN must be set for WhatsApp provider', 500);
  }

  const metaPhoneNumberId = (runtimeConfig.META_WHATSAPP_PHONE_NUMBER_ID ?? '').trim();
  if (whatsappEnabled && !metaPhoneNumberId) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'META_WHATSAPP_PHONE_NUMBER_ID must be set for WhatsApp provider', 500);
  }

  return {
    email: emailEnabled
      ? new ResendAdapter({
          apiKey: resendApiKey,
          fromEmail: runtimeConfig.RESEND_FROM ?? 'noreply@example.com'
        })
      : createUnavailableEmailAdapter(),
    sms:
      smsEnabled && smsProvider !== 'noop'
        ? smsProvider === 'fast2sms'
          ? new Fast2smsAdapter({
              apiKey: runtimeConfig.FAST2SMS_API_KEY!,
              templateRegistry: new SmsTemplateRegistry()
            })
          : new Msg91Adapter({
              authKey: runtimeConfig.MSG91_AUTH_KEY!,
              senderId: runtimeConfig.MSG91_SENDER_ID ?? 'ECOMTM',
              route: runtimeConfig.MSG91_ROUTE ?? '4'
            })
        : createUnavailableSmsAdapter(),
    whatsapp: whatsappEnabled
      ? new MetaWhatsAppAdapter({
          accessToken: metaAccessToken,
          phoneNumberId: metaPhoneNumberId,
          apiVersion: runtimeConfig.META_WHATSAPP_API_VERSION ?? 'v25.0'
        })
      : createUnavailableWhatsappAdapter()
  };
}
