import { describe, expect, it } from 'vitest';
import { normalizeShippingWebhookPayload, readStrictDelhiveryOccurredAt } from './normalize-shipping-webhook-payload';

describe('normalize-shipping-webhook-payload', () => {
  it('passes through Delhivery-style payloads', () => {
    expect(
      normalizeShippingWebhookPayload({
        awb: 'AWB123',
        status: 'IN_TRANSIT',
        description: 'At hub',
        location: 'Hyderabad',
        occurredAt: '2026-05-01T10:00:00.000Z'
      })
    ).toEqual({
      awb: 'AWB123',
      status: 'IN_TRANSIT',
      description: 'At hub',
      location: 'Hyderabad',
      occurredAt: '2026-05-01T10:00:00.000Z'
    });
  });

  it('normalizes native Shiprocket webhook payloads', () => {
    const normalized = normalizeShippingWebhookPayload({
      awb: '19041424751540',
      current_status: 'IN TRANSIT',
      shipment_status: 'IN TRANSIT',
      current_timestamp: '23 05 2023 11:43:52',
      scans: [
        {
          date: '2023-05-20 10:27:56',
          activity: 'In Transit - Bag Added To Trip',
          location: 'Jaipur Hub',
          'sr-status-label': 'IN TRANSIT'
        }
      ]
    });

    expect(normalized).toMatchObject({
      awb: '19041424751540',
      status: 'IN TRANSIT',
      description: 'In Transit - Bag Added To Trip',
      location: 'Jaipur Hub'
    });
    expect(normalized?.occurredAt).toBeDefined();
  });

  it('returns null when AWB or status is missing', () => {
    expect(normalizeShippingWebhookPayload({ current_status: 'DELIVERED' })).toBeNull();
    expect(normalizeShippingWebhookPayload({ awb: '123' })).toBeNull();
  });

  it('unwraps nested data payloads', () => {
    expect(
      normalizeShippingWebhookPayload({
        data: {
          awb: 'AWB-NESTED',
          current_status: 'DELIVERED',
          activity: 'Delivered to customer'
        }
      })
    ).toMatchObject({
      awb: 'AWB-NESTED',
      status: 'DELIVERED',
      description: 'Delivered to customer'
    });
  });

  it('accepts shipment_id when awb is absent', () => {
    expect(
      normalizeShippingWebhookPayload({
        shipment_id: '67890',
        current_status: 'IN TRANSIT'
      })
    ).toEqual({
      awb: '',
      status: 'IN TRANSIT',
      description: 'IN TRANSIT',
      shiprocketShipmentId: '67890'
    });
  });

  it('coerces numeric AWB values', () => {
    expect(normalizeShippingWebhookPayload({ awb: 19041424751540, status: 'DELIVERED', description: 'Done' })).toEqual({
      awb: '19041424751540',
      status: 'DELIVERED',
      description: 'Done'
    });
  });

  it('prefers the newest scan entry by date', () => {
    const normalized = normalizeShippingWebhookPayload({
      awb: 'AWB1',
      current_status: 'IN TRANSIT',
      scans: [
        {
          date: '2023-05-19 11:59:16',
          activity: 'Manifest uploaded',
          location: 'Hub A'
        },
        {
          date: '2023-05-23 11:43:46',
          activity: 'In Transit - latest event',
          location: 'Hub B'
        }
      ]
    });

    expect(normalized).toMatchObject({
      description: 'In Transit - latest event',
      location: 'Hub B'
    });
  });

  it('handles Delhivery Push API array payload', () => {
    const result = normalizeShippingWebhookPayload([
      {
        Waybill: '1234567890123',
        AWB: '1234567890123',
        Status: 'Delivered',
        StatusType: 'DL',
        StatusLocation: 'Bangalore',
        StatusDateTime: '2026-06-12T14:30:00',
        ReferenceNo: 'ORDER-123'
      }
    ]);
    expect(result).toMatchObject({
      awb: '1234567890123',
      status: 'DL',
      location: 'Bangalore'
    });
    expect(result?.occurredAt).toBeDefined();
  });

  it('handles Delhivery array with StatusType short code as fallback when Status absent', () => {
    const result = normalizeShippingWebhookPayload([
      {
        Waybill: '9999999',
        StatusType: 'OFD',
        StatusLocation: 'Mumbai',
        StatusDateTime: '2026-06-12T09:00:00'
      }
    ]);
    expect(result).toMatchObject({ awb: '9999999', status: 'OFD' });
  });

  it('returns null for empty Delhivery array', () => {
    expect(normalizeShippingWebhookPayload([])).toBeNull();
  });

  it('reads Waybill (capital W) as AWB', () => {
    const result = normalizeShippingWebhookPayload({
      Waybill: 'AWBCAP',
      Status: 'IN_TRANSIT'
    });
    expect(result?.awb).toBe('AWBCAP');
  });

  it('readStrictDelhiveryOccurredAt reads only Delhivery occurredAt fields', () => {
    expect(readStrictDelhiveryOccurredAt({ occurredAt: '2026-05-01T10:00:00.000Z' })).toBe(
      '2026-05-01T10:00:00.000Z'
    );
    expect(readStrictDelhiveryOccurredAt({ current_timestamp: '23 05 2023 11:43:52' })).toBeNull();
  });
});
