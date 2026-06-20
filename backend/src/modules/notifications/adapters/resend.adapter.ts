import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { type EmailProviderAdapter, type SendEmailInput, type SendResult } from '@common/interfaces/notification-provider.interface';
import { renderNotificationEmail } from '@modules/notifications/templates/email-templates';

type ResendAdapterOptions = {
  apiKey: string;
  fromEmail: string;
  baseUrl?: string;
};

export class ResendAdapter implements EmailProviderAdapter {
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly baseUrl: string;

  constructor(options: ResendAdapterOptions) {
    this.apiKey = options.apiKey;
    this.fromEmail = options.fromEmail;
    this.baseUrl = options.baseUrl ?? 'https://api.resend.com';
  }

  async sendEmail(input: SendEmailInput): Promise<SendResult> {
    const rendered = await renderNotificationEmail(input.template, input.data);

    const response = await fetch(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: this.fromEmail,
        to: [input.to],
        subject: rendered.subject,
        html: rendered.html
      }),
      signal: AbortSignal.timeout(10_000)
    });

    const payload = await this.parsePayload(response);
    if (!response.ok) {
      // Resend returns a structured body on every failure, e.g.:
      //   { "statusCode": 403, "name": "validation_error",
      //     "message": "You can only send testing emails to your own email address ..." }
      //   { "statusCode": 401, "name": "missing_api_key", "message": "API key not found" }
      //   { "statusCode": 422, "name": "validation_error",
      //     "message": "The `from` domain is not verified ..." }
      // The body's `message` field is the only field that tells an operator how to fix
      // the problem. Including it in the thrown error means it ends up in
      // NotificationLog.errorMessage (capped to a reasonable length to keep DB rows lean).
      const providerMessage = this.extractMessage(payload);
      const providerName = this.extractName(payload);
      const detail = providerMessage
        ? ` — ${providerName ? `[${providerName}] ` : ''}${providerMessage}`
        : '';
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Resend request failed: ${response.status}${detail}`,
        502
      );
    }

    const messageId = typeof payload.id === 'string' ? payload.id : undefined;
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

  private extractMessage(payload: Record<string, unknown>): string | null {
    const raw = typeof payload['message'] === 'string' ? payload['message'] : null;
    if (!raw) {
      // Fall back to the unparsed body if we have one — covers HTML error pages or
      // gateway-level rejections that don't return JSON.
      const rawText = typeof payload['raw'] === 'string' ? payload['raw'].trim() : '';
      return rawText.length > 0 ? rawText.slice(0, 280) : null;
    }
    return raw.slice(0, 280);
  }

  private extractName(payload: Record<string, unknown>): string | null {
    return typeof payload['name'] === 'string' ? payload['name'] : null;
  }
}
