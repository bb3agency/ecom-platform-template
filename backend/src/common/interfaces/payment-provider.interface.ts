export type CreatePaymentOrderInput = {
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
};

export type CreatePaymentOrderResult = {
  providerOrderId: string;
  amount: number;
  currency: string;
  status: string;
};

export type InitiateRefundInput = {
  providerPaymentId: string;
  amount?: number;
  notes?: Record<string, string>;
  /**
   * Stable per-refund-job identifier (<= 40 chars). Sent to the provider so an
   * attempt whose outcome is unknown (timeout / network error after the provider
   * accepted it) can be found again with findRefundByReceipt instead of re-sent.
   */
  receipt?: string;
};

export type InitiateRefundResult = {
  providerRefundId: string;
  status: string;
  amount: number;
};

export interface PaymentProviderAdapter {
  createOrder(input: CreatePaymentOrderInput): Promise<CreatePaymentOrderResult>;
  verifyPaymentSignature(input: {
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  }): boolean;
  verifyWebhookSignature(input: { payload: Buffer; signature: string; previousSecret?: string }): boolean;
  initiateRefund(input: InitiateRefundInput): Promise<InitiateRefundResult>;
  /**
   * Look up a refund previously created with `receipt` for this payment.
   * Resolves null when the provider definitely has no such (non-failed) refund;
   * rejects when the provider cannot be asked. Optional: adapters that cannot
   * refund do not implement it.
   */
  findRefundByReceipt?:
    | ((input: { providerPaymentId: string; receipt: string }) => Promise<InitiateRefundResult | null>)
    | undefined;
}
