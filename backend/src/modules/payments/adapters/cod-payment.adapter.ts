import {
  CreatePaymentOrderInput,
  CreatePaymentOrderResult,
  InitiateRefundInput,
  InitiateRefundResult,
  PaymentProviderAdapter
} from '@common/interfaces/payment-provider.interface';

/**
 * COD (Cash on Delivery) adapter.
 * No online payment order is created — the order is confirmed directly on checkout.
 * Signature verification always returns true (no online sig for COD).
 * Refunds are handled offline / via manual credit note.
 */
export class CodPaymentAdapter implements PaymentProviderAdapter {
  async createOrder(input: CreatePaymentOrderInput): Promise<CreatePaymentOrderResult> {
    return {
      providerOrderId: `COD-${input.receipt}`,
      amount: input.amount,
      currency: input.currency,
      status: 'cod_pending'
    };
  }

  verifyPaymentSignature(_input: { providerOrderId: string; providerPaymentId: string; signature: string }): boolean {
    return true;
  }

  verifyWebhookSignature(_input: { payload: Buffer; signature: string; previousSecret?: string }): boolean {
    return false;
  }

  async initiateRefund(_input: InitiateRefundInput): Promise<InitiateRefundResult> {
    return {
      providerRefundId: `COD-REFUND-${Date.now()}`,
      status: 'manual_refund_required',
      amount: _input.amount ?? 0
    };
  }
}
