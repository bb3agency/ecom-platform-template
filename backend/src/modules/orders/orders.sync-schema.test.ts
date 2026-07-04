import { describe, it, expect } from 'vitest';
import fastJson from 'fast-json-stringify';
import { adminSyncShipmentStatusSchema } from './orders.schemas';

describe('adminSyncShipmentStatusSchema response contract', () => {
  // Regression: the schema once declared { id, status, updatedAt } — fields the
  // service never returned — so fast-json-stringify failed its required check
  // and EVERY /admin/shipments/:id/sync call 500'd after the sync committed.
  it('serializes the exact shape adminSyncShipmentStatus returns', () => {
    const stringify = fastJson(
      adminSyncShipmentStatusSchema.response[200] as unknown as Parameters<typeof fastJson>[0]
    );

    const synced = JSON.parse(
      stringify({
        synced: true,
        message: 'Synced: BOOKED → IN_TRANSIT',
        shipmentStatus: 'IN_TRANSIT',
        orderStatus: 'SHIPPED'
      })
    );
    expect(synced).toEqual({
      synced: true,
      message: 'Synced: BOOKED → IN_TRANSIT',
      shipmentStatus: 'IN_TRANSIT',
      orderStatus: 'SHIPPED'
    });

    const notSynced = JSON.parse(
      stringify({
        synced: false,
        message: 'Status already up to date: BOOKED',
        shipmentStatus: 'BOOKED',
        orderStatus: 'CANCELLED'
      })
    );
    expect(notSynced.synced).toBe(false);
    expect(notSynced.message).toContain('BOOKED');
  });
});
