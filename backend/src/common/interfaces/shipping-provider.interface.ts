export type CreateShipmentInput = {
  orderNumber: string;
  amountRupees: number;
  /** Product subtotal before shipping/discount (rupees). Falls back to amountRupees when omitted. */
  subtotalRupees?: number;
  shippingChargeRupees?: number;
  discountRupees?: number;
  destinationPincode: string;
  originPincode: string;
  totalWeightGrams: number;
  paymentMode: 'Prepaid' | 'COD';
  sellerGstTin: string;
  hsnCode: string;
  customer: {
    fullName: string;
    phone: string;
    email?: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
  };
  /** Store contact email used when customer email is absent (Shiprocket requires billing_email). */
  storeContactEmail?: string;
  items?: Array<{
    name: string;
    sku: string;
    quantity: number;
    /** Per-unit selling price in rupees (after line-level discounts). */
    unitPriceRupees: number;
    hsnCode?: string;
  }>;
  courierCompanyId?: number;
  dimensions?: {
    lengthCm: number;
    breadthCm: number;
    heightCm: number;
  };
  /**
   * In-flight booking recovery: the courier already holds an order for this
   * client reference (found via `findShipmentByReference`) but no AWB was
   * assigned yet. Adapters that book in two steps (Shiprocket: create order →
   * assign AWB) skip the create step and only assign the AWB, so a retry never
   * creates a second courier order. Ignored by single-step adapters.
   */
  existingProviderOrder?: {
    shiprocketOrderId?: string;
    shiprocketShipmentId: string;
  };
};

export type CreateShipmentResult = {
  awbNumber: string;
  trackingUrl?: string;
  estimatedDays?: number;
  providerPayload: Record<string, unknown>;
  shiprocketOrderId?: string;
  shiprocketShipmentId?: string;
  courierName?: string;
  labelUrl?: string;
};

export type TrackShipmentResult = {
  status: string;
  events: Array<{
    status: string;
    location?: string;
    description: string;
    occurredAt?: string;
  }>;
  providerPayload: Record<string, unknown>;
};

export type ServiceabilityResult = {
  pincode: string;
  serviceable: boolean;
  providerPayload: Record<string, unknown>;
};

export type DeliveryRateInput = {
  destinationPincode: string;
  originPincode: string;
  totalWeightGrams: number;
  /** When COD, adapters quote COD freight instead of prepaid. */
  paymentMode?: 'COD' | 'PREPAID';
};

export type CourierOption = {
  courierCompanyId: number;
  courierName: string;
  shippingChargePaise: number;
  estimatedDays: number;
  estimatedDeliveryDate?: string;
};

export type DeliveryRateResult = {
  shippingChargePaise: number;
  estimatedDays: number;
  courierName?: string;
  courierCompanyId?: number;
  estimatedDeliveryDate?: string;
  availableCouriers?: CourierOption[];
  providerPayload: Record<string, unknown>;
};

export type SchedulePickupResult = {
  scheduled: boolean;
  pickupScheduledDate?: string;
  pickupTokenNumber?: string;
  /**
   * True when the provider reports a pickup is already arranged for this
   * warehouse/shipment (e.g. an earlier open pickup request that will collect
   * this AWB too). The action succeeded — the shipment is covered — even though
   * no new pickup slot was created. Pickup is warehouse-level, not per-order.
   */
  alreadyScheduled?: boolean;
  providerPayload: Record<string, unknown>;
};

export type GenerateLabelResult = {
  /** Direct URL to the label PDF (Shiprocket). Mutually exclusive with labelHtml. */
  labelUrl?: string;
  /** Self-contained HTML label page (Delhivery). Mutually exclusive with labelUrl. */
  labelHtml?: string;
  providerPayload: Record<string, unknown>;
};

/**
 * Result of looking a booking up at the courier by OUR client reference (the
 * order number sent as Shiprocket `order_id` / Delhivery `order`). Used to recover
 * bookings that were in flight when a worker crashed or stalled. A lookup that
 * cannot reach a definite answer MUST throw — callers never book blind.
 */
export type ShipmentLookupResult =
  | {
      state: 'not_found';
      providerPayload: Record<string, unknown>;
    }
  | {
      /** The courier holds this reference only as a cancelled booking. */
      state: 'cancelled';
      awbNumber?: string;
      shiprocketOrderId?: string;
      providerPayload: Record<string, unknown>;
    }
  | {
      /** A live booking exists. `awbNumber` is absent when the AWB was never assigned. */
      state: 'found';
      awbNumber?: string;
      trackingUrl?: string;
      labelUrl?: string;
      courierName?: string;
      shiprocketOrderId?: string;
      shiprocketShipmentId?: string;
      providerPayload: Record<string, unknown>;
    };

export interface ShippingProviderAdapter {
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  trackShipment(awbNumber: string): Promise<TrackShipmentResult>;
  cancelShipment(awbNumber: string): Promise<{ cancelled: boolean; providerPayload: Record<string, unknown> }>;
  checkServiceability(pincode: string, originPincode?: string): Promise<ServiceabilityResult>;
  calculateDeliveryRate(input: DeliveryRateInput): Promise<DeliveryRateResult>;
  schedulePickup?(shiprocketShipmentId: string): Promise<SchedulePickupResult>;
  generateLabel?(shiprocketShipmentId: string): Promise<GenerateLabelResult>;
  /** Look a booking up by our client reference (order number). Throws when the answer is not definite. */
  findShipmentByReference?(clientReference: string): Promise<ShipmentLookupResult>;
}
