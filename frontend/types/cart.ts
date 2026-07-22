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

/** One line of a split-cart group, as described by the delivery-rates response. */
export interface FulfilmentGroupItem {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantity: number;
}

/** One future order's worth of a cart that splits across fulfilment channels. */
export interface FulfilmentGroup {
  /** LOCAL = delivered by the store directly; COURIER = shipped by Delhivery/Shiprocket. */
  channel: "LOCAL" | "COURIER";
  shippingCharge: number;
  estimatedDays: number;
  selectedShippingProvider?: "DELHIVERY" | "SHIPROCKET" | "LOCAL";
  items: FulfilmentGroupItem[];
}

/**
 * Present only when the cart must be split into two orders: some products are local-delivery
 * only (the store delivers them itself) and the rest go by courier.
 */
export interface DeliverySplit {
  mode: "SPLIT";
  groups: FulfilmentGroup[];
}

export interface DeliveryRates {
  pincode: string;
  /** Combined across both groups when the cart splits — `split` carries the per-order detail. */
  shippingCharge: number;
  estimatedDays: number;
  split?: DeliverySplit;
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
