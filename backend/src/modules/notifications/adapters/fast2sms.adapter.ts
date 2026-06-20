import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { type SendResult, type SendSmsInput, type SmsProviderAdapter } from '@common/interfaces/notification-provider.interface';
import { SmsTemplateRegistry } from '../sms-template-registry';

type Fast2smsAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  templateRegistry?: SmsTemplateRegistry;
};

type Fast2smsPayload = {
  route: string;
  numbers: string;
  message?: string;
  variables_values?: string;
};

export class Fast2smsAdapter implements SmsProviderAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly templateRegistry: SmsTemplateRegistry;

  constructor(options: Fast2smsAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://www.fast2sms.com/dev/bulkV2';
    this.templateRegistry = options.templateRegistry ?? new SmsTemplateRegistry();
  }

  async sendSms(input: SendSmsInput): Promise<SendResult> {
    const normalizedPhone = this.normalizeIndianMobile(input.phone);
    const isOtp = input.template === 'OtpVerification' || input.data.otp !== undefined;

    const payload: Fast2smsPayload = {
      route: isOtp ? 'otp' : 'q',
      numbers: normalizedPhone
    };

    if (isOtp) {
      const otpValue = input.data.otp;
      payload.variables_values =
        typeof otpValue === 'string' || typeof otpValue === 'number' ? String(otpValue) : '';
    } else {
      payload.message = this.templateRegistry.resolve(input.template, input.data);
    }

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        authorization: this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    });

    const payloadData = await this.parsePayload(response);

    if (!response.ok) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Fast2SMS request failed: ${response.status} ${JSON.stringify(payloadData)}`,
        502
      );
    }

    if (payloadData.return === false) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Fast2SMS delivery failed: ${JSON.stringify(payloadData.message ?? payloadData)}`,
        502
      );
    }

    const messageId = typeof payloadData.request_id === 'string' ? payloadData.request_id : undefined;
    return {
      ...(messageId ? { messageId } : {}),
      providerPayload: payloadData
    };
  }

  private async parsePayload(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { raw: text };
    }
  }

  private normalizeIndianMobile(phone: string): string {
    const digits = phone.replace(/\D/g, '');

    if (digits.length === 10) {
      return digits;
    }

    if (digits.length === 12 && digits.startsWith('91')) {
      return digits.slice(2);
    }

    if (digits.length === 11 && digits.startsWith('0')) {
      return digits.slice(1);
    }

    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid phone format for Fast2SMS delivery', 400);
  }
}
