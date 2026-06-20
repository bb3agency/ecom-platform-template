import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  type SendResult,
  type SendSmsInput,
  type SendWhatsappInput,
  type SmsProviderAdapter,
  type WhatsappProviderAdapter
} from '@common/interfaces/notification-provider.interface';

type Msg91AdapterOptions = {
  authKey: string;
  senderId: string;
  route: string;
  baseUrl?: string;
};

export class Msg91Adapter implements SmsProviderAdapter, WhatsappProviderAdapter {
  private readonly authKey: string;
  private readonly senderId: string;
  private readonly route: string;
  private readonly baseUrl: string;

  constructor(options: Msg91AdapterOptions) {
    this.authKey = options.authKey;
    this.senderId = options.senderId;
    this.route = options.route;
    this.baseUrl = options.baseUrl ?? 'https://api.msg91.com/api/v5';
  }

  async sendSms(input: SendSmsInput): Promise<SendResult> {
    return this.sendFlowMessage(input, 'sms');
  }

  async sendWhatsapp(input: SendWhatsappInput): Promise<SendResult> {
    return this.sendFlowMessage(input, 'whatsapp');
  }

  private async sendFlowMessage(input: SendSmsInput | SendWhatsappInput, channel: 'sms' | 'whatsapp'): Promise<SendResult> {
    const normalizedPhone = this.normalizeIndianMobile(input.phone);
    const response = await fetch(`${this.baseUrl}/flow/`, {
      method: 'POST',
      headers: {
        authkey: this.authKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: this.senderId,
        route: this.route,
        mobiles: normalizedPhone,
        VAR1: input.template,
        channel,
        ...input.data
      }),
      signal: AbortSignal.timeout(10_000)
    });

    const payload = await this.parsePayload(response);
    if (!response.ok) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, `MSG91 request failed: ${response.status}`, 502);
    }

    const messageId = typeof payload.request_id === 'string' ? payload.request_id : undefined;
    return {
      ...(messageId ? { messageId } : {}),
      providerPayload: payload
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
      return `91${digits}`;
    }

    if (digits.length === 12 && digits.startsWith('91')) {
      return digits;
    }

    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid phone format for MSG91 delivery', 400);
  }
}
