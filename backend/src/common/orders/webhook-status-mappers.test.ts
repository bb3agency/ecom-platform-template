import { describe, expect, it } from 'vitest';
import {
  mapPaymentEventToStatuses,
  mapShipmentStatusToOrderStatus,
  mapShipmentWebhookStatus
} from './webhook-status-mappers';

describe('webhook status mappers', () => {
  it('maps payment.failed event to failed statuses', () => {
    const result = mapPaymentEventToStatuses('payment.failed');
    expect(result).not.toBeNull();
    expect(result?.paymentStatus).toBe('FAILED');
    expect(result?.orderStatus).toBe('PAYMENT_FAILED');
  });

  it('maps payment.captured event to captured and confirmed', () => {
    const result = mapPaymentEventToStatuses('payment.captured');
    expect(result?.paymentStatus).toBe('CAPTURED');
    expect(result?.orderStatus).toBe('CONFIRMED');
  });

  it('maps refund.processed event to refunded statuses', () => {
    const result = mapPaymentEventToStatuses('refund.processed');
    expect(result?.paymentStatus).toBe('REFUNDED');
    expect(result?.orderStatus).toBe('REFUNDED');
  });

  it('returns null for unknown payment events', () => {
    const result = mapPaymentEventToStatuses('payment.authorized');
    expect(result).toBeNull();
  });

  it('normalizes shipment status strings and rejects unknown statuses', () => {
    expect(mapShipmentWebhookStatus(' delivered ')).toBe('DELIVERED');
    expect(mapShipmentWebhookStatus('OUT_FOR_DELIVERY')).toBe('OUT_FOR_DELIVERY');
    expect(mapShipmentWebhookStatus('Out For Delivery')).toBe('OUT_FOR_DELIVERY');
    expect(mapShipmentWebhookStatus('Manifested')).toBe('BOOKED');
    expect(mapShipmentWebhookStatus('MANIFEST GENERATED')).toBe('BOOKED');
    expect(mapShipmentWebhookStatus('SHIPPED')).toBe('IN_TRANSIT');
    expect(mapShipmentWebhookStatus('unknown_vendor_state')).toBeNull();
  });

  it('maps Shiprocket cancellation status variants to CANCELLED', () => {
    expect(mapShipmentWebhookStatus('CANCELLED')).toBe('CANCELLED');
    expect(mapShipmentWebhookStatus('Cancelled')).toBe('CANCELLED');
    expect(mapShipmentWebhookStatus('CANCELED')).toBe('CANCELLED');
    expect(mapShipmentWebhookStatus('Cancellation Requested')).toBe('CANCELLED');
    expect(mapShipmentWebhookStatus('AWB Cancellation Requested')).toBe('CANCELLED');
    expect(mapShipmentWebhookStatus('Pickup Cancelled')).toBe('CANCELLED');
    expect(mapShipmentWebhookStatus('Pickup Error')).toBe('CANCELLED');
  });

  it('maps Delhivery StatusType short codes', () => {
    expect(mapShipmentWebhookStatus('BO')).toBe('BOOKED');
    expect(mapShipmentWebhookStatus('PU')).toBe('PICKED_UP');
    expect(mapShipmentWebhookStatus('IT')).toBe('IN_TRANSIT');
    expect(mapShipmentWebhookStatus('OFD')).toBe('OUT_FOR_DELIVERY');
    expect(mapShipmentWebhookStatus('DL')).toBe('DELIVERED');
    expect(mapShipmentWebhookStatus('NDR')).toBe('FAILED_DELIVERY');
    expect(mapShipmentWebhookStatus('RTO')).toBe('RTO_INITIATED');
    expect(mapShipmentWebhookStatus('RTD')).toBe('RTO_DELIVERED');
    expect(mapShipmentWebhookStatus('EXP')).toBe('CANCELLED');
    expect(mapShipmentWebhookStatus('REV')).toBe('IN_TRANSIT');
  });

  it('maps shipment status to order status only for meaningful milestones', () => {
    expect(mapShipmentStatusToOrderStatus('OUT_FOR_DELIVERY')).toBe('OUT_FOR_DELIVERY');
    expect(mapShipmentStatusToOrderStatus('DELIVERED')).toBe('DELIVERED');
    expect(mapShipmentStatusToOrderStatus('CANCELLED')).toBe('CANCELLED');
    expect(mapShipmentStatusToOrderStatus('RTO_INITIATED')).toBeNull();
    expect(mapShipmentStatusToOrderStatus('BOOKED')).toBeNull();
  });
});

