/**
 * Maps abstract notification template names (e.g. 'OrderConfirmed') to the
 * approved Meta WhatsApp Cloud API template that must exist in WhatsApp Manager.
 *
 * Two things MUST line up for a WhatsApp template send to succeed:
 *   1. `metaName` — Meta template names are lowercase + underscores. Our internal
 *      template names are PascalCase, so they can never match directly; this map
 *      is the translation layer (mismatch => Meta error 132001 "template does not exist").
 *   2. `params`  — Meta templates use POSITIONAL body parameters ({{1}}, {{2}}, ...).
 *      The order of values we send must match the placeholder order in the approved
 *      template exactly, and the count must match (mismatch => Meta error 132000).
 *
 * Because we control both this registry and the template bodies created in WhatsApp
 * Manager, they are kept in lockstep. The canonical body text + sample values for
 * each template live in `docs/WHATSAPP_TEMPLATE_REGISTRY.md`.
 *
 * Template bodies are intentionally store-name-agnostic — the store name is passed
 * as a positional parameter ({{1}}) so the SAME approved templates work for every
 * client on the platform.
 */

const DEFAULT_STORE_NAME = 'Our Store';

type TemplateData = Record<string, unknown>;

export type WhatsappTemplateDescriptor = {
  /** Approved Meta WhatsApp template name (lowercase + underscores). */
  metaName: string;
  /** BCP-47 language code the template was created with (must match exactly). */
  language: string;
  /**
   * Ordered list of `data` keys that fill the template's positional body
   * parameters {{1}}, {{2}}, ... — index 0 fills {{1}}, index 1 fills {{2}}, etc.
   */
  params: readonly string[];
  /**
   * True for Meta AUTHENTICATION-category templates (OTP). These have a fixed body
   * ("{{1}} is your verification code.") with a SINGLE parameter (the code) AND require
   * a matching copy-code button component that echoes the same code. The adapter builds
   * both the body and button components from the single param when this is set.
   */
  authentication?: boolean;
};

export type ResolvedWhatsappTemplate = {
  metaName: string;
  language: string;
  /** Positional body parameter values in {{1}}..{{n}} order. */
  parameters: string[];
  /** True for Meta AUTHENTICATION templates — adapter must add the copy-code button component. */
  authentication: boolean;
};

export class WhatsappTemplateRegistry {
  private readonly templates: Readonly<Record<string, WhatsappTemplateDescriptor>>;

  constructor(overrides?: Record<string, WhatsappTemplateDescriptor>) {
    this.templates = Object.freeze({
      ...WhatsappTemplateRegistry.defaultTemplates(),
      ...overrides
    });
  }

  /**
   * Default internal-name -> Meta-template map. Every entry here MUST have a
   * matching approved template in WhatsApp Manager with the same number of
   * positional parameters in the same order. Keep in sync with
   * docs/WHATSAPP_TEMPLATE_REGISTRY.md.
   */
  static defaultTemplates(): Record<string, WhatsappTemplateDescriptor> {
    return {
      // Customer signup/login OTP. Meta AUTHENTICATION-category template (verification
      // codes are NOT allowed in Utility — Meta rejects them). The body is fixed by Meta
      // ("{{1}} is your verification code.") with a SINGLE param = the code; a copy-code
      // button echoes the same code. The store name is NOT in the body (Authentication
      // templates forbid custom copy) — it shows as the message sender.
      CustomerOtpVerification: {
        metaName: 'otp_verify',
        language: 'en',
        params: ['otp'],
        authentication: true
      },
      // Admin login OTP — same Authentication template as the customer OTP (generic
      // "your verification code"); single param = the code, copy-code button.
      OtpVerification: {
        metaName: 'otp_verify',
        language: 'en',
        params: ['otp'],
        authentication: true
      },
      OrderConfirmed: {
        metaName: 'order_confirmed',
        language: 'en',
        params: ['storeName', 'orderId']
      },
      OrderShipped: {
        metaName: 'order_shipped',
        language: 'en',
        params: ['storeName', 'orderId', 'trackingInfo']
      },
      OutForDelivery: {
        metaName: 'out_for_delivery',
        language: 'en',
        params: ['storeName', 'orderId']
      },
      OrderDelivered: {
        metaName: 'order_delivered',
        language: 'en',
        params: ['storeName', 'orderId']
      },
      OrderCancelled: {
        metaName: 'order_cancelled',
        language: 'en',
        params: ['storeName', 'orderId']
      },
      PaymentFailed: {
        metaName: 'payment_failed',
        language: 'en',
        params: ['storeName', 'orderId']
      },
      // Merchant/admin alert: sent only to admins who opted in (per-admin
      // channel prefs). Params: store, order ref, customer, amount+mode line.
      AdminNewOrder: {
        metaName: 'admin_new_order',
        language: 'en',
        params: ['storeName', 'orderId', 'customerName', 'orderAmountLine']
      },
      // Merchant/admin alert for LOCAL DELIVERY orders (whitelisted pincode — the merchant
      // delivers it himself, no courier is booked). Includes the delivery address + phone
      // line ({{5}}) because the admin is the courier for this order.
      AdminLocalOrder: {
        metaName: 'admin_local_order',
        language: 'en',
        params: ['storeName', 'orderId', 'customerName', 'orderAmountLine', 'deliveryAddressLine']
      },
      // Return-request decision updates (approved / declined / picked up / refunded).
      // {{3}} is a full human-readable status line composed by the service so the SAME
      // approved Utility template covers every lifecycle stage.
      ReturnRequestUpdate: {
        metaName: 'return_request_update',
        language: 'en',
        params: ['storeName', 'orderId', 'returnStatusLine']
      }
    };
  }

  /**
   * Builds safe WhatsApp template data: injects the store name and derives any
   * synthetic params the templates reference (e.g. `trackingInfo`, which falls
   * back to a non-empty string because Meta rejects empty positional parameters).
   */
  static composeTemplateData(input: TemplateData, storeName?: string | null): TemplateData {
    const trackingUrl = typeof input.trackingUrl === 'string' ? input.trackingUrl.trim() : '';
    return {
      ...input,
      storeName: WhatsappTemplateRegistry.normalizeStoreName(storeName),
      // `{{orderId}}` must render the HUMAN-READABLE order number (e.g. ORD-G343-TRCN), never the
      // internal UUID. Enqueue sites pass both `orderId` (uuid) and `orderNumber`; prefer the
      // latter so customers see the same reference shown in their account + admin.
      orderId: WhatsappTemplateRegistry.resolveOrderRef(input),
      trackingInfo: trackingUrl.length > 0 ? trackingUrl : 'your account orders page',
      // AdminNewOrder {{4}}: 'Rs 1,234.00 - PREPAID' (Meta rejects empty params).
      orderAmountLine: WhatsappTemplateRegistry.composeOrderAmountLine(input),
      // AdminLocalOrder {{5}}: 'address, Ph: phone' (Meta rejects empty params).
      deliveryAddressLine: WhatsappTemplateRegistry.composeDeliveryAddressLine(input)
    };
  }

  /** 'address — Ph: phone' line for the admin local-order template; never empty. */
  static composeDeliveryAddressLine(input: TemplateData): string {
    const address = typeof input.deliveryAddress === 'string' ? input.deliveryAddress.trim() : '';
    const phone = typeof input.customerPhone === 'string' ? input.customerPhone.trim() : '';
    const line = [address, phone ? `Ph: ${phone}` : ''].filter(Boolean).join(' — ');
    return line.length > 0 ? line : 'see admin panel';
  }

  /** 'amount - paymentMode' line for the admin new-order template; never empty. */
  static composeOrderAmountLine(input: TemplateData): string {
    const amount = typeof input.amount === 'string' ? input.amount.trim() : '';
    const paymentMode = typeof input.paymentMode === 'string' ? input.paymentMode.trim() : '';
    const line = [amount, paymentMode].filter(Boolean).join(' - ');
    return line.length > 0 ? line : 'see admin panel';
  }

  /** Human-readable order reference: orderNumber when present, else the raw orderId. */
  static resolveOrderRef(input: TemplateData): string {
    const orderNumber = typeof input.orderNumber === 'string' ? input.orderNumber.trim() : '';
    if (orderNumber.length > 0) {
      return orderNumber;
    }
    return typeof input.orderId === 'string' ? input.orderId : '';
  }

  /**
   * Resolves the effective store name with fallback (Meta rejects empty params).
   */
  static normalizeStoreName(storeName?: string | null): string {
    const trimmed = (storeName ?? '').trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_STORE_NAME;
  }

  /**
   * Returns the Meta template descriptor + ordered positional parameter values
   * for an internal template name, or `null` if the template is not mapped to a
   * WhatsApp template (caller decides how to handle unmapped templates).
   */
  resolve(name: string, data: Record<string, unknown>): ResolvedWhatsappTemplate | null {
    const descriptor = this.templates[name];
    if (!descriptor) {
      return null;
    }

    const parameters = descriptor.params.map((key) => {
      const value = data[key];
      if (value === null || value === undefined) {
        return '';
      }
      return typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean);
    });

    return {
      metaName: descriptor.metaName,
      language: descriptor.language,
      parameters,
      authentication: descriptor.authentication === true
    };
  }
}
