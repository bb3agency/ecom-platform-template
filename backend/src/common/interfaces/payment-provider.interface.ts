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

export interface PaymentProviderAdapter {
  createOrder(input: CreatePaymentOrderInput): Promise<CreatePaymentOrderResult>;
  verifyPaymentSignature(input: {
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  }): boolean;
  verifyWebhookSignature(input: { payload: Buffer; signature: string; previousSecret?: string }): boolean;
  initiateRefund(input: InitiateRefundInput): Promise<InitiateRefundResult>;
}
