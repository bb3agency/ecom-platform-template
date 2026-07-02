import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  type SendResult,
  type SendWhatsappInput,
  type WhatsappProviderAdapter
} from '@common/interfaces/notification-provider.interface';
import { WhatsappTemplateRegistry } from '../whatsapp-template-registry';

type MetaWhatsAppAdapterOptions = {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  baseUrl?: string;
  templateRegistry?: WhatsappTemplateRegistry;
};

export class MetaWhatsAppAdapter implements WhatsappProviderAdapter {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly templateRegistry: WhatsappTemplateRegistry;

  constructor(options: MetaWhatsAppAdapterOptions) {
    this.accessToken = options.accessToken;
    this.phoneNumberId = options.phoneNumberId;
    this.apiVersion = options.apiVersion ?? 'v25.0';
    this.baseUrl = options.baseUrl ?? 'https://graph.facebook.com';
    this.templateRegistry = options.templateRegistry ?? new WhatsappTemplateRegistry();
  }

  async sendWhatsapp(input: SendWhatsappInput): Promise<SendResult> {
    const recipient = this.normalizePhone(input.phone);
    const response = await fetch(`${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(this.buildPayload(recipient, input)),
      signal: AbortSignal.timeout(10_000)
    });

    const providerPayload = await this.parsePayload(response);
    if (!response.ok) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Meta WhatsApp request failed: ${response.status}`,
        502
      );
    }

    const messageId = this.extractMessageId(providerPayload);
    return {
      ...(messageId ? { messageId } : {}),
      providerPayload
    };
  }

  private buildPayload(recipient: string, input: SendWhatsappInput): Record<string, unknown> {
    const resolved = this.templateRegistry.resolve(input.template, input.data);

    // Mapped AUTHENTICATION template (OTP): Meta requires the code in BOTH the body
    // parameter AND a copy-code button component (sub_type 'url', index 0) that echoes
    // the same code. There is exactly one parameter — the verification code.
    if (resolved && resolved.authentication) {
      const code = resolved.parameters[0] ?? '';
      return {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: resolved.metaName,
          language: { code: resolved.language },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            {
              type: 'button',
              sub_type: 'url',
              index: 0,
              parameters: [{ type: 'text', text: code }]
            }
          ]
        }
      };
    }

    // Mapped template: use the approved Meta template name, its language, and the
    // body parameters in the exact positional order the template expects.
    if (resolved) {
      const parameters = resolved.parameters.map((text) => ({ type: 'text', text }));
      return {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: resolved.metaName,
          language: { code: resolved.language },
          ...(parameters.length > 0
            ? { components: [{ type: 'body', parameters }] }
            : {})
        }
      };
    }

    // Legacy fallback for templates not mapped to a WhatsApp template: pass the
    // raw template name with alphabetically-ordered params. These will only
    // succeed if a same-named template happens to exist in WhatsApp Manager.
    const values = Object.keys(input.data)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => {
        const raw = input.data[key];
        const text =
          raw === null || raw === undefined
            ? ''
            : typeof raw === 'object'
              ? JSON.stringify(raw)
              : String(raw as string | number | boolean);
        return { type: 'text', text };
      });

    return {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'template',
      template: {
        name: input.template,
        language: { code: 'en' },
        ...(values.length > 0
          ? {
              components: [
                {
                  type: 'body',
                  parameters: values
                }
              ]
            }
          : {})
      }
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

  private extractMessageId(payload: Record<string, unknown>): string | undefined {
    const messages = payload.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return undefined;
    }

    const firstMessage = messages[0];
    if (!firstMessage || typeof firstMessage !== 'object') {
      return undefined;
    }

    const messageId = (firstMessage as Record<string, unknown>).id;
    return typeof messageId === 'string' ? messageId : undefined;
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid phone format for Meta WhatsApp delivery', 400);
    }
    return digits;
  }
}
