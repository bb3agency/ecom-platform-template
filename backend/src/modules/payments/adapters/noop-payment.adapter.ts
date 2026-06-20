import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  CreatePaymentOrderInput,
  CreatePaymentOrderResult,
  InitiateRefundInput,
  InitiateRefundResult,
  PaymentProviderAdapter
} from '@common/interfaces/payment-provider.interface';

const NOOP_PAYMENT_ERROR_MESSAGE = 'No-op payment provider is enabled; live payment actions are disabled';

export class NoopPaymentAdapter implements PaymentProviderAdapter {
  async createOrder(input: CreatePaymentOrderInput): Promise<CreatePaymentOrderResult> {
    return {
      providerOrderId: `order_noop_${Date.now()}`,
      amount: input.amount,
      currency: input.currency,
      status: 'created'
    };
  }

  verifyPaymentSignature(_input: { providerOrderId: string; providerPaymentId: string; signature: string }): boolean {
    return false;
  }

  verifyWebhookSignature(_input: { payload: Buffer; signature: string; previousSecret?: string }): boolean {
    return true;
  }

  async initiateRefund(_input: InitiateRefundInput): Promise<InitiateRefundResult> {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, NOOP_PAYMENT_ERROR_MESSAGE, 503);
  }
}
