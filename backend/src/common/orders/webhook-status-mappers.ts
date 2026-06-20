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
  if (normalized === 'UD') return SHIPMENT_STATUS.FAILED_DELIVERY;  // Undelivered
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
  if (normalized === 'BOOKED' || normalized === 'MANIFESTED' || normalized === 'MANIFEST_GENERATED') {
    return SHIPMENT_STATUS.BOOKED;
  }
  if (normalized === 'SHIPPED' || normalized === 'DISPATCHED' || normalized === 'SHIPMENT_DISPATCHED') return SHIPMENT_STATUS.IN_TRANSIT;
  if (
    normalized === 'PICKED_UP' ||
    normalized === 'PICKUP_SCHEDULED' ||
    normalized === 'PICKUP_GENERATED' ||
    normalized === 'PICKUP_QUEUED' ||
    normalized === 'PICKUP_COMPLETE'
  ) return SHIPMENT_STATUS.PICKED_UP;
  if (normalized === 'IN_TRANSIT' || normalized === 'REACHED_AT_DESTINATION_HUB') return SHIPMENT_STATUS.IN_TRANSIT;
  if (normalized === 'OUT_FOR_DELIVERY') return SHIPMENT_STATUS.OUT_FOR_DELIVERY;
  if (normalized === 'DELIVERED' || normalized === 'SHIPMENT_DELIVERED') return SHIPMENT_STATUS.DELIVERED;
  if (normalized === 'FAILED_DELIVERY' || normalized === 'UNDELIVERED' || normalized === 'DELIVERY_FAILED') return SHIPMENT_STATUS.FAILED_DELIVERY;
  if (normalized === 'RTO_INITIATED' || normalized === 'RTO-INITIATED' || normalized === 'RETURN_INITIATED' || normalized === 'RTO_IN_TRANSIT') return SHIPMENT_STATUS.RTO_INITIATED;
  if (normalized === 'RTO_DELIVERED' || normalized === 'RTO-DELIVERED' || normalized === 'RETURN_DELIVERED') return SHIPMENT_STATUS.RTO_DELIVERED;
  if (
    normalized === 'CANCELLED' ||
    normalized === 'CANCELED' ||
    normalized === 'CANCELLATION_REQUESTED' ||
    normalized === 'AWB_CANCELLATION_REQUESTED' ||
    normalized === 'SHIPMENT_CANCELLED' ||
    normalized === 'SHIPMENT_CANCELED' ||
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

