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
};

export type InitiateRefundResult = {
  providerRefundId: string;
  status: string;
  amount: number;
};

export type FindRefundByReferenceInput = {
  providerPaymentId: string;
  /** Value previously sent as `notes.refundReference` on initiateRefund. */
  reference: string;
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
   * Look up a refund this platform already asked for (matched on `notes.refundReference`).
   * Used before re-sending a refund whose earlier attempt ended ambiguously (timeout or
   * network error) so a refund the provider DID accept is never issued twice.
   * Optional: providers without refunds (COD/noop) omit it.
   */
  findRefundByReference?(input: FindRefundByReferenceInput): Promise<InitiateRefundResult | null>;
  /**
   * The notes stored on a provider order, or null when it does not exist. Lets the platform
   * prove an order was created by its own checkout (notes.userId / notes.orderId) before
   * acting on a payment it has no local record of: the merchant account may also take
   * payments from links, POS or other tools that must never be auto-refunded.
   */
  fetchOrderNotes?(providerOrderId: string): Promise<Record<string, string> | null>;
}
