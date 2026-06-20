/**
 * Maps abstract template names to human-readable SMS message text
 * with simple {{variable}} substitution.
 */
const DEFAULT_STORE_NAME = 'Our Store';

type TemplateData = Record<string, unknown>;

export class SmsTemplateRegistry {
  private readonly templates: Readonly<Record<string, string>>;

  constructor(overrides?: Record<string, string>) {
    this.templates = Object.freeze({
      ...SmsTemplateRegistry.defaultTemplates(),
      ...overrides
    });
  }

  /**
   * Returns default SMS template map used when no merchant overrides exist.
   */
  static defaultTemplates(): Record<string, string> {
    return {
      OrderConfirmed:
        '{{storeName}}: Your order {{orderId}} is confirmed! We are preparing it for dispatch. You will be notified when it ships.',
      OrderShipped:
        '{{storeName}}: Order {{orderId}} has been shipped! {{estimatedDeliveryText}}Track your shipment: {{trackingUrl}}',
      OutForDelivery:
        '{{storeName}}: Your order {{orderId}} is out for delivery today! Please keep your phone reachable. Our courier will attempt delivery at your registered address.',
      OrderDelivered:
        '{{storeName}}: Order {{orderId}} has been delivered. We hope you love your products! Share your feedback in the app.',
      OrderCancelled:
        '{{storeName}}: Your order {{orderId}} has been cancelled. If a payment was made, your refund will be processed within 5-7 business days. Contact support for help.',
      PaymentFailed:
        '{{storeName}} Payment Alert: Payment for order {{orderId}} could not be processed. Please retry payment from your order page to avoid cancellation.',
      FailedDelivery:
        '{{storeName}} Delivery Alert: Delivery attempt failed for order {{orderId}} (AWB: {{awb}}). Please contact support to reschedule delivery.',
      OpsInviteSetup:
        '{{storeName}} Security: Your ops account setup OTP is {{otp}}. Valid for 10 minutes. Do NOT share this code with anyone.',
      OpsActionOtp:
        '{{storeName}} Security: Your ops action authorization code is {{otp}}. Valid for 10 minutes. Do NOT share this code with anyone.'
    };
  }

  /**
   * Builds safe SMS template data with store name injected.
   */
  static composeTemplateData(input: TemplateData, storeName?: string | null): TemplateData {
    return {
      ...input,
      storeName: SmsTemplateRegistry.normalizeStoreName(storeName)
    };
  }

  /**
   * Validates and normalizes merchant-provided SMS templates.
   */
  static normalizeTemplateOverrides(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object') {
      return {};
    }

    const result: Record<string, string> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, templateValue] of entries) {
      if (typeof templateValue !== 'string') {
        continue;
      }
      const trimmedKey = key.trim();
      const trimmedValue = templateValue.trim();
      if (!trimmedKey || !trimmedValue) {
        continue;
      }
      result[trimmedKey] = trimmedValue;
    }

    return result;
  }

  /**
   * Resolves effective store name with fallback.
   */
  static normalizeStoreName(storeName?: string | null): string {
    const trimmed = (storeName ?? '').trim();
    if (trimmed) {
      return trimmed;
    }

    return DEFAULT_STORE_NAME;
  }

  resolve(name: string, data: Record<string, unknown>): string {
    const template = this.templates[name];
    if (!template) {
      return `${name}${JSON.stringify(data)}`;
    }

    return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      const value = data[key];
      return value !== undefined && value !== null && (typeof value === 'string' || typeof value === 'number')
        ? String(value)
        : '';
    });
  }
}
