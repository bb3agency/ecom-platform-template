export type AdminPaymentMode = "PREPAID" | "COD";

export interface AdminOrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  paymentMode: AdminPaymentMode;
  paymentStatus: string | null;
  canShipNow: boolean;
}

export interface AdminOrdersListResponse {
  items: AdminOrderListItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type ShippingProviderEnum = "DELHIVERY" | "SHIPROCKET" | "SELF";

export interface AdminOrderShipment {
  id: string;
  provider: ShippingProviderEnum;
  status: string;
  awb: string | null;
  trackingUrl: string | null;
  shipmentLabelUrl?: string | null;
  /** Only present for Shiprocket shipments */
  shiprocketShipmentId?: string | null;
  labelUrl?: string | null;
  pickupScheduledDate?: string | null;
}

export interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  paymentMode: AdminPaymentMode;
  canShipNow: boolean;
  shipBlockReason: string | null;
  shippingMode: "MANUAL";
  /** Provider locked at checkout — must be used for AWB assignment */
  selectedShippingProvider: ShippingProviderEnum | null;
  /** Shipping rate quoted to customer at checkout (paise). Immutable after creation. */
  shippingChargeQuotedPaise: number | null;
  payment: {
    status: string;
    provider: string;
    capturedAt: string | null;
  } | null;
  shipment: AdminOrderShipment | null;
  invoice: {
    invoiceNumber: string;
    hasPdf: boolean;
  } | null;
}

export interface AdminPrintLabelResponse {
  /** Shiprocket: direct PDF URL */
  labelUrl?: string | null;
  /** Delhivery: self-contained HTML to render in a new tab */
  labelHtml?: string | null;
}

export interface AdminSchedulePickupResponse {
  scheduled?: boolean;
  /**
   * True when the courier pickup was already arranged for this warehouse and now
   * also covers this shipment — the action succeeded without creating a new slot.
   */
  alreadyScheduled?: boolean;
  pickupScheduledDate?: string;
  /** Provider pickup reference (Delhivery pickup_id / Shiprocket pickup token). */
  pickupTokenNumber?: string;
}
