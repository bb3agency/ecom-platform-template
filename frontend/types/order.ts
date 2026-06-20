export type PaymentMode = "PREPAID" | "COD";

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  totalPaise: number;
  paymentMode: PaymentMode;
  createdAt: string;
}
