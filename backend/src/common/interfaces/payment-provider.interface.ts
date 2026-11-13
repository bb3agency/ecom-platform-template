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

export type FindRefundByReceiptInput = {
  providerPaymentId: string;
  /** Value previously sent as `receipt` (and `notes.refundAttemptId`) on initiateRefund. */
  receipt: string;
};

export type ListCapturedPaymentsInput = {
  /** Inclusive lower bound on the payment's creation time. */
  from: Date;
  /** Inclusive upper bound on the payment's creation time. */
  to: Date;
  /** Page size (the provider caps it; Razorpay allows 1–100). */
  count: number;
  /** Number of payments to skip — offset pagination. */
  skip: number;
};

export type ProviderCapturedPayment = {
  providerPaymentId: string;
  /** Null for payments not taken against a provider order (cannot be ours). */
  providerOrderId: string | null;
  amount: number;
  currency: string;
  createdAt: Date;
};

export type ListCapturedPaymentsResult = {
  /** Only payments still in the captured state (fully refunded ones are excluded). */
  items: ProviderCapturedPayment[];
  /** True when the provider returned a full page, so another page may follow. */
  hasMore: boolean;
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
   * Look up a refund previously created with `receipt` for this payment (matched on
   * `receipt` or `notes.refundAttemptId`). Used before re-sending a refund whose earlier
   * attempt ended ambiguously (timeout or network error) so a refund the provider DID
   * accept is never issued twice. Refunds in status 'failed' are ignored: adopting one
   * would hold the refund reservation for money that never moved.
   * Resolves null when the provider definitely has no such (non-failed) refund;
   * rejects when the provider cannot be asked. Optional: adapters that cannot
   * refund (COD/noop) do not implement it.
   */
  findRefundByReceipt?: ((input: FindRefundByReceiptInput) => Promise<InitiateRefundResult | null>) | undefined;
  /**
   * The notes stored on a provider order, or null when it does not exist. Lets the platform
   * prove an order was created by its own checkout (notes.userId / notes.orderId) before
   * acting on a payment it has no local record of: the merchant account may also take
   * payments from links, POS or other tools that must never be auto-refunded.
   */
  fetchOrderNotes?(providerOrderId: string): Promise<Record<string, string> | null>;
  /**
   * One page of payments created in [from, to] that are still captured. Used by the
   * scheduled capture reconciliation to notice a capture whose `payment.captured`
   * webhook never arrived. Rejects when the provider cannot be asked. Optional:
   * adapters without a provider-side payment ledger (COD/noop) do not implement it.
   */
  listCapturedPayments?: ((input: ListCapturedPaymentsInput) => Promise<ListCapturedPaymentsResult>) | undefined;
}
