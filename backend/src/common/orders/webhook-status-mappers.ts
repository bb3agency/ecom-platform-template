type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

type PaymentStatus = 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

type ShipmentStatus =
  | 'PENDING'
  | 'BOOKED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED_DELIVERY'
  | 'RTO_INITIATED'
  | 'RTO_DELIVERED'
  | 'CANCELLED';

const ORDER_STATUS = {
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  CONFIRMED: 'CONFIRMED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  REFUNDED: 'REFUNDED'
} as const;

const PAYMENT_STATUS = {
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED'
} as const;

const SHIPMENT_STATUS = {
  BOOKED: 'BOOKED',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED_DELIVERY: 'FAILED_DELIVERY',
  RTO_INITIATED: 'RTO_INITIATED',
  RTO_DELIVERED: 'RTO_DELIVERED',
  CANCELLED: 'CANCELLED'
} as const;

export function mapPaymentEventToStatuses(event: string): {
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
} | null {
  const normalized = event.trim().toLowerCase();
  if (normalized === 'payment.captured') {
    return {
      paymentStatus: PAYMENT_STATUS.CAPTURED,
      orderStatus: ORDER_STATUS.CONFIRMED
    };
  }

  if (normalized === 'payment.failed') {
    return {
      paymentStatus: PAYMENT_STATUS.FAILED,
      orderStatus: ORDER_STATUS.PAYMENT_FAILED
    };
  }

  if (normalized === 'refund.processed') {
    return {
      paymentStatus: PAYMENT_STATUS.REFUNDED,
      orderStatus: ORDER_STATUS.REFUNDED
    };
  }

  return null;
}

export function mapShipmentWebhookStatus(status: string): ShipmentStatus | null {
  const normalized = status.trim().toUpperCase().replace(/\s+/g, '_');

  // Delhivery StatusType short codes (used in both webhook Push API and track Pull API)
  if (normalized === 'BO') return SHIPMENT_STATUS.BOOKED;
  if (normalized === 'PP') return SHIPMENT_STATUS.BOOKED;      // Pickup Pending
  if (normalized === 'PU') return SHIPMENT_STATUS.PICKED_UP;
  if (normalized === 'IT') return SHIPMENT_STATUS.IN_TRANSIT;
  if (normalized === 'OFD') return SHIPMENT_STATUS.OUT_FOR_DELIVERY;
  if (normalized === 'DL') return SHIPMENT_STATUS.DELIVERED;
  // "UD" is Delhivery's StatusType BUCKET for the entire forward journey —
  // their own webhook sample pairs Status:"Manifested" with StatusType:"UD".
  // Mapping it to FAILED_DELIVERY marked every freshly-booked AWB as a failed
  // delivery. Actual delivery failures arrive as Status text ("Undelivered",
  // "Failed Delivery") or NDR/CC codes below.
  if (normalized === 'UD') return SHIPMENT_STATUS.IN_TRANSIT;
  if (normalized === 'NDR') return SHIPMENT_STATUS.FAILED_DELIVERY; // Non-Delivery Report
  if (normalized === 'CC') return SHIPMENT_STATUS.FAILED_DELIVERY;  // Call Center (post-NDR follow-up)
  if (normalized === 'RTO') return SHIPMENT_STATUS.RTO_INITIATED;
  if (normalized === 'RTD') return SHIPMENT_STATUS.RTO_DELIVERED;
  if (normalized === 'RT') return SHIPMENT_STATUS.RTO_DELIVERED;    // Returned (RVP/reverse shipment)
  if (normalized === 'CN') return SHIPMENT_STATUS.CANCELLED;        // Cancelled
  if (normalized === 'REV') return SHIPMENT_STATUS.IN_TRANSIT; // reverse pickup in transit
  if (normalized === 'EXP') return SHIPMENT_STATUS.CANCELLED; // shipment expired without pickup
  if (normalized === 'MIS') return SHIPMENT_STATUS.IN_TRANSIT; // Misrouted — still in transit

  // Delhivery + Shiprocket shared human-readable mappings
  // "Not Picked" is Delhivery's manifested-but-awaiting-pickup state (AWB
  // booked, courier hasn't collected) — same bucket as Manifested.
  //
  // Shiprocket status master (current_status text) up to the collection scan
  // all mean "booked, not yet collected": the courier prints a label, the
  // pickup request is queued/generated, a manifest is generated — none of these
  // is a physical pickup. Shiprocket only reports collection as "Picked Up"
  // (status id 42). Mapping "AWB Assigned"/"Pickup Scheduled" to PICKED_UP
  // overstated fulfilment progress on every fresh Shiprocket shipment.
  if (
    normalized === 'BOOKED' ||
    normalized === 'MANIFESTED' ||
    normalized === 'MANIFEST_GENERATED' ||
    normalized === 'NOT_PICKED' ||
    normalized === 'AWB_ASSIGNED' ||
    normalized === 'LABEL_GENERATED' ||
    normalized === 'PICKUP_SCHEDULED' ||
    normalized === 'PICKUP_GENERATED' ||
    normalized === 'PICKUP_QUEUED' ||
    normalized === 'PICKUP_BOOKED' ||
    normalized === 'PICKUP_RESCHEDULED' ||
    normalized === 'PICKUP_EXCEPTION' ||
    normalized === 'OUT_FOR_PICKUP'
  ) {
    return SHIPMENT_STATUS.BOOKED;
  }
  if (normalized === 'SHIPPED' || normalized === 'DISPATCHED' || normalized === 'SHIPMENT_DISPATCHED') return SHIPMENT_STATUS.IN_TRANSIT;
  if (
    normalized === 'PICKED_UP' ||
    normalized === 'PICKUP_COMPLETE'
  ) return SHIPMENT_STATUS.PICKED_UP;
  if (
    normalized === 'IN_TRANSIT' ||
    normalized === 'REACHED_AT_DESTINATION_HUB' ||
    normalized === 'REACHED_AT_ORIGIN_HUB' ||
    normalized === 'REACHED_WAREHOUSE' ||
    normalized === 'MISROUTED' ||
    normalized === 'DELAYED'
  ) return SHIPMENT_STATUS.IN_TRANSIT;
  if (normalized === 'OUT_FOR_DELIVERY') return SHIPMENT_STATUS.OUT_FOR_DELIVERY;
  if (
    normalized === 'DELIVERED' ||
    normalized === 'SHIPMENT_DELIVERED' ||
    normalized === 'PARTIAL_DELIVERED' ||
    normalized === 'PARTIALLY_DELIVERED'
  ) return SHIPMENT_STATUS.DELIVERED;
  if (
    normalized === 'FAILED_DELIVERY' ||
    normalized === 'UNDELIVERED' ||
    normalized === 'DELIVERY_FAILED' ||
    normalized === 'LOST' ||
    normalized === 'DAMAGED' ||
    normalized === 'DESTROYED' ||
    normalized === 'DISPOSED_OFF'
  ) return SHIPMENT_STATUS.FAILED_DELIVERY;
  if (
    normalized === 'RTO_INITIATED' ||
    normalized === 'RTO-INITIATED' ||
    normalized === 'RETURN_INITIATED' ||
    normalized === 'RTO_IN_TRANSIT' ||
    normalized === 'RTO_NDR' ||
    normalized === 'RTO_OFD' ||
    normalized === 'RTO_OUT_FOR_DELIVERY'
  ) return SHIPMENT_STATUS.RTO_INITIATED;
  if (
    normalized === 'RTO_DELIVERED' ||
    normalized === 'RTO-DELIVERED' ||
    normalized === 'RETURN_DELIVERED' ||
    normalized === 'RTO_ACKNOWLEDGED'
  ) return SHIPMENT_STATUS.RTO_DELIVERED;
  if (
    normalized === 'CANCELLED' ||
    normalized === 'CANCELED' ||
    normalized === 'CANCELLATION_REQUESTED' ||
    normalized === 'AWB_CANCELLATION_REQUESTED' ||
    normalized === 'SHIPMENT_CANCELLED' ||
    normalized === 'SHIPMENT_CANCELED' ||
    normalized === 'CANCELLED_BEFORE_DISPATCHED' ||
    normalized === 'CANCEL' ||
    normalized === 'PICKUP_CANCELLED' ||
    normalized === 'PICKUP_CANCELED' ||
    normalized === 'PICKUP_ERROR'
  ) {
    return SHIPMENT_STATUS.CANCELLED;
  }
  return null;
}

export function mapShipmentStatusToOrderStatus(shipmentStatus: ShipmentStatus): OrderStatus | null {
  if (shipmentStatus === SHIPMENT_STATUS.OUT_FOR_DELIVERY) return ORDER_STATUS.OUT_FOR_DELIVERY;
  if (shipmentStatus === SHIPMENT_STATUS.DELIVERED) return ORDER_STATUS.DELIVERED;
  if (shipmentStatus === SHIPMENT_STATUS.CANCELLED) return 'CANCELLED';
  return null;
}

