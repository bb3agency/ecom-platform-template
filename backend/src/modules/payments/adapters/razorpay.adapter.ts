import { createHmac, timingSafeEqual } from 'crypto';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  CreatePaymentOrderInput,
  CreatePaymentOrderResult,
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
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, `Razorpay request failed: ${response.status}`, 502);
    }

    return (await response.json()) as T;
  }
}
