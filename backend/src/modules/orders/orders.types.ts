import { OrderStatus, ReturnRequestStatus } from '@prisma/client';

export type { ReturnRequestStatus };

export type AdminOrderListQuery = {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  from?: string;
  to?: string;
  search?: string;
  paymentMode?: 'PREPAID' | 'COD';
  sort?: 'newest' | 'oldest';
};

export type AdminOrderExportQuery = {
  from: string;
  to: string;
  status?: OrderStatus;
  search?: string;
  paymentMode?: 'PREPAID' | 'COD';
};

export type UpdateOrderStatusInput = {
  status: OrderStatus;
  note?: string;
  refundAmountPaise?: number;
};

export type CreateOrderInput = {
  addressId?: string;
  shippingAddress?: {
    fullName: string;
    phone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  notes?: string;
  paymentMode?: 'PREPAID' | 'COD';
  selectedShippingProvider?: 'DELHIVERY' | 'SHIPROCKET';
  /** Rate shown to the customer by getDeliveryRates (paise). Used as-is if within ±30% of re-computed rate. */
  shippingChargePaise?: number;
  /** Shiprocket courier company ID from the rate quote — stored on order and passed to AWB assignment. */
  courierCompanyId?: number;
};

export type RetryPaymentInput = {
  orderId: string;
};

export type CreateReturnRequestInput = {
  items: Array<{
    orderItemId: string;
    quantity: number;
    reason?: string;
  }>;
  reason: string;
};

export type UpdateReturnRequestInput = {
  status: ReturnRequestStatus;
  adminNote?: string;
};

export type InitiatePaymentInput = {
  orderId: string;
};

export type VerifyPaymentInput = {
  orderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
};

export type PrepareCheckoutInput = {
  addressId?: string;
  shippingAddress?: {
    fullName: string;
    phone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  notes?: string;
  selectedShippingProvider?: 'DELHIVERY' | 'SHIPROCKET';
  /** Rate shown to the customer by getDeliveryRates (paise). Used as-is if within ±30% of re-computed rate. */
  shippingChargePaise?: number;
  /** Shiprocket courier company ID from the rate quote — stored on order and passed to AWB assignment. */
  courierCompanyId?: number;
};

export type ConfirmPrepaidInput = {
  checkoutSessionId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
};

export type CancelOrderInput = {
  reason?: string;
  refundAmountPaise?: number;
};

export type ShippingTrackParams = {
  awb: string;
};

export type AdminShipmentListQuery = {
  page?: number;
  limit?: number;
  status?: string;
  awbNumber?: string;
  orderId?: string;
  /** Matches AWB or order number (case-insensitive contains). */
  search?: string;
  from?: string;
  to?: string;
};

export type AdminPaymentListQuery = {
  page?: number;
  limit?: number;
  status?: string;
  method?: string;
  orderId?: string;
  /** Matches order number, provider payment ID, or customer name */
  search?: string;
  from?: string;
  to?: string;
};

export type AdminRetriggerNotificationInput = {
  /** Omitted → derived from the order's current status at send time. */
  template?: 'OrderConfirmed' | 'PaymentFailed' | 'OrderShipped' | 'OutForDelivery' | 'OrderDelivered' | 'OrderCancelled';
  channels?: Array<'EMAIL' | 'SMS' | 'WHATSAPP'>;
};

