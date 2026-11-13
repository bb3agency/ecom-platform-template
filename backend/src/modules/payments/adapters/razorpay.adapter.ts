import { createHmac, timingSafeEqual } from 'crypto';
import { PaymentProviderError } from '@common/errors/payment-provider-error';
import {
  CreatePaymentOrderInput,
  CreatePaymentOrderResult,
  FindRefundByReceiptInput,
  InitiateRefundInput,
  InitiateRefundResult,
  ListCapturedPaymentsInput,
  ListCapturedPaymentsResult,
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
  receipt?: string | null;
  notes?: Record<string, unknown> | unknown[] | null;
};

type RazorpayRefundListResponse = {
  items?: RazorpayRefundResponse[];
};

type RazorpayPaymentEntity = {
  id?: unknown;
  order_id?: unknown;
  status?: unknown;
  amount?: unknown;
  currency?: unknown;
  created_at?: unknown;
};

type RazorpayPaymentListResponse = {
  items?: RazorpayPaymentEntity[];
};

/** Razorpay caps `count` on collection endpoints at 100. */
const RAZORPAY_MAX_PAGE_SIZE = 100;

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
        ...(input.receipt ? { receipt: input.receipt } : {}),
        notes: {
          ...(input.notes ?? {}),
          ...(input.receipt ? { refundAttemptId: input.receipt } : {})
        }
      })
    });

    return {
      providerRefundId: response.id,
      status: response.status,
      amount: response.amount
    };
  }

  async findRefundByReceipt(input: FindRefundByReceiptInput): Promise<InitiateRefundResult | null> {
    const response = await this.request<RazorpayRefundListResponse>(
      `/payments/${encodeURIComponent(input.providerPaymentId)}/refunds?count=100`,
      { method: 'GET' }
    );
    const match = (response.items ?? []).find((refund) => {
      if (refund.status === 'failed') {
        return false;
      }
      const notes = refund.notes && !Array.isArray(refund.notes) ? refund.notes : {};
      return refund.receipt === input.receipt || notes['refundAttemptId'] === input.receipt;
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

  async listCapturedPayments(input: ListCapturedPaymentsInput): Promise<ListCapturedPaymentsResult> {
    const count = Math.min(Math.max(Math.trunc(input.count), 1), RAZORPAY_MAX_PAGE_SIZE);
    const query = new URLSearchParams({
      from: String(Math.floor(input.from.getTime() / 1000)),
      to: String(Math.floor(input.to.getTime() / 1000)),
      count: String(count),
      skip: String(Math.max(Math.trunc(input.skip), 0))
    });
    const response = await this.request<RazorpayPaymentListResponse>(`/payments?${query.toString()}`, {
      method: 'GET'
    });
    const rawItems = response.items ?? [];
    const items = rawItems.flatMap((payment) => {
      if (payment.status !== 'captured' || typeof payment.id !== 'string' || payment.id.length === 0) {
        return [];
      }
      return [
        {
          providerPaymentId: payment.id,
          providerOrderId:
            typeof payment.order_id === 'string' && payment.order_id.length > 0 ? payment.order_id : null,
          amount: typeof payment.amount === 'number' ? payment.amount : 0,
          currency: typeof payment.currency === 'string' ? payment.currency : 'INR',
          createdAt: new Date((typeof payment.created_at === 'number' ? payment.created_at : 0) * 1000)
        }
      ];
    });
    // hasMore is judged on the RAW page: filtering out non-captured payments must
    // not end the walk early.
    return { items, hasMore: rawItems.length >= count };
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
