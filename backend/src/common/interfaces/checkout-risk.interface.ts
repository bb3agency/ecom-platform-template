export type InitiatePaymentRiskContext = {
  userId: string;
  orderId: string;
  orderTotalPaise: number;
  /** Fastify-derived client IP when trustProxy is configured */
  clientIp?: string;
};

export interface CheckoutRiskAssessmentPort {
  assertInitiatePaymentAllowed(ctx: InitiatePaymentRiskContext): Promise<void>;
}
