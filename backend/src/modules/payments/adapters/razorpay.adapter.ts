import { createHmac, timingSafeEqual } from 'crypto';
import { PaymentProviderError } from '@common/errors/payment-provider-error';
import {
  CreatePaymentOrderInput,
  CreatePaymentOrderResult,
  FindRefundByReferenceInput,
  InitiateRefundInput,
  InitiateRefundResult,
  PaymentProviderAdapter
} from '@common/interfaces/payment-provider.interface';

type RazorpayOrderResponse = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

type RazorpayRefundResponse = {
  id: string;
  amount: number;
  status: string;
  notes?: Record<string, unknown> | unknown[];
};

type RazorpayRefundListResponse = {
  items?: RazorpayRefundResponse[];
};

export class RazorpayAdapter implements PaymentProviderAdapter {
  private signaturesEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private readonly apiBaseUrl = 'https://api.razorpay.com/v1';

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
    private readonly previousWebhookSecret?: string
  ) {}

  async createOrder(input: CreatePaymentOrderInput): Promise<CreatePaymentOrderResult> {
    const response = await this.request<RazorpayOrderResponse>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes ?? {}
      })
    });

    return {
      providerOrderId: response.id,
      amount: response.amount,
      currency: response.currency,
      status: response.status
    };
  }

  verifyPaymentSignature(input: {
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  }): boolean {
    const expected = createHmac('sha256', this.keySecret)
      .update(`${input.providerOrderId}|${input.providerPaymentId}`)
      .digest('hex');
    return this.signaturesEqual(expected, input.signature);
  }

  verifyWebhookSignature(input: { payload: Buffer; signature: string; previousSecret?: string }): boolean {
    const expected = createHmac('sha256', this.webhookSecret).update(input.payload).digest('hex');
    if (this.signaturesEqual(expected, input.signature)) {
      return true;
    }
    const fallbackSecret = input.previousSecret ?? this.previousWebhookSecret;
    if (!fallbackSecret) {
      return false;
    }
    const expectedWithOldSecret = createHmac('sha256', fallbackSecret).update(input.payload).digest('hex');
    return this.signaturesEqual(expectedWithOldSecret, input.signature);
  }

  async initiateRefund(input: InitiateRefundInput): Promise<InitiateRefundResult> {
    const response = await this.request<RazorpayRefundResponse>(`/payments/${input.providerPaymentId}/refund`, {
      method: 'POST',
      body: JSON.stringify({
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        notes: input.notes ?? {}
      })
    });

    return {
      providerRefundId: response.id,
      status: response.status,
      amount: response.amount
    };
  }

  async findRefundByReference(input: FindRefundByReferenceInput): Promise<InitiateRefundResult | null> {
    const response = await this.request<RazorpayRefundListResponse>(
      `/payments/${encodeURIComponent(input.providerPaymentId)}/refunds?count=100`,
      { method: 'GET' }
    );
    const match = (response.items ?? []).find((refund) => {
      const notes = refund.notes;
      return (
        notes !== undefined &&
        !Array.isArray(notes) &&
        notes['refundReference'] === input.reference
      );
    });
    return match ? { providerRefundId: match.id, status: match.status, amount: match.amount } : null;
  }

  async fetchOrderNotes(providerOrderId: string): Promise<Record<string, string> | null> {
    const order = await this.request<{ id?: string; notes?: Record<string, unknown> | unknown[] }>(
      `/orders/${encodeURIComponent(providerOrderId)}`,
      { method: 'GET' }
    );
    if (!order.id) {
      return null;
    }
    const notes = order.notes;
    if (!notes || Array.isArray(notes)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(notes).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const authToken = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      // Razorpay error body: { error: { code, description, reason, ... } }.
      let providerCode: string | null = null;
      let providerDescription: string | null = null;
      try {
        const body = (await response.json()) as { error?: { code?: unknown; description?: unknown } };
        providerCode = typeof body.error?.code === 'string' ? body.error.code : null;
        providerDescription = typeof body.error?.description === 'string' ? body.error.description : null;
      } catch {
        // Non-JSON error body — the HTTP status is all we have.
      }
      throw new PaymentProviderError({
        provider: 'Razorpay',
        httpStatus: response.status,
        providerCode,
        providerDescription
      });
    }

    return (await response.json()) as T;
  }
}
