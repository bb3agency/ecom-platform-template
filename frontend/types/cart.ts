export interface CartLineItem {
  id: string;
  variantId: string;
  lineTotal: number;
  priceSnapshot: number;
  quantity: number;
  /** Present on API responses; optional for legacy persisted cart snapshots. */
  product?: {
    name: string;
    slug: string | null;
    metaDescription: string | null;
    imageUrl: string | null;
    imageAlt: string | null;
  };
  variant: {
    id: string;
    name: string;
    sku: string;
    price: number;
  };
}

export interface Cart {
  id: string;
  items: CartLineItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  /** From GET /cart — authoritative minimum order threshold in paise. */
  minOrderValuePaise?: number;
  /** From GET /cart — whether subtotal meets store minimum. */
  meetsMinimumOrder?: boolean;
  coupon: {
    id: string;
    code: string;
    type: "PERCENTAGE_OFF" | "FLAT_AMOUNT_OFF" | "FREE_SHIPPING" | "BUY_X_GET_Y";
    value: number;
  } | null;
  meta: {
    isGuest: boolean;
    reservationExpiresAt: string | null;
    reservedItemCount: number;
  };
}

export interface DeliveryRates {
  pincode: string;
  shippingCharge: number;
  estimatedDays: number;
  /** Backend-selected provider — LOCAL = merchant-fulfilled local delivery (whitelisted pincode). */
  selectedShippingProvider?: "DELHIVERY" | "SHIPROCKET" | "LOCAL";
  /** Shiprocket courier company ID for the quoted rate — must be passed back to lock AWB to the same courier. */
  courierCompanyId?: number;
  availableCouriers?: Array<{
    courierCompanyId: number;
    courierName: string;
    shippingChargePaise: number;
    estimatedDays: number;
  }>;
}
