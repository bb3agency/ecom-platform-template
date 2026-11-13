import { describe, expect, it } from 'vitest';
import { buildBookingIntentPayload, isBookingIntent, readBookingIntentMeta } from './booking-intent';

describe('booking intent helpers', () => {
  it('treats only a PENDING shipment without an AWB as a booking intent', () => {
    expect(isBookingIntent({ status: 'PENDING', awbNumber: null })).toBe(true);
    expect(isBookingIntent({ status: 'PENDING', awbNumber: 'AWB1' })).toBe(false);
    expect(isBookingIntent({ status: 'BOOKED', awbNumber: null })).toBe(false);
    expect(isBookingIntent(null)).toBe(false);
  });

  it('reads intent metadata and rejects malformed payloads', () => {
    expect(
      readBookingIntentMeta({
        bookingIntent: { clientReference: 'ORD-1', startedAt: '2026-11-01T00:00:00.000Z', sweepRequeues: 2 }
      })
    ).toEqual({ clientReference: 'ORD-1', startedAt: '2026-11-01T00:00:00.000Z', sweepRequeues: 2 });
    expect(readBookingIntentMeta({ status: 'Success' })).toBeNull();
    expect(readBookingIntentMeta({ bookingIntent: { clientReference: '' } })).toBeNull();
    expect(readBookingIntentMeta(null)).toBeNull();
    expect(readBookingIntentMeta({ bookingIntent: { clientReference: 'ORD-1' } })?.sweepRequeues).toBe(0);
  });

  it('carries startedAt and the sweep counter across retries for the same reference only', () => {
    const now = new Date('2026-11-13T10:00:00.000Z');
    const previous = { clientReference: 'ORD-1', startedAt: '2026-11-01T00:00:00.000Z', sweepRequeues: 2 };

    expect(buildBookingIntentPayload('ORD-1', previous, now)).toEqual({ bookingIntent: previous });
    expect(buildBookingIntentPayload('ORD-2', previous, now)).toEqual({
      bookingIntent: { clientReference: 'ORD-2', startedAt: now.toISOString(), sweepRequeues: 0 }
    });
    expect(buildBookingIntentPayload('ORD-1', null, now).bookingIntent.sweepRequeues).toBe(0);
  });
});
