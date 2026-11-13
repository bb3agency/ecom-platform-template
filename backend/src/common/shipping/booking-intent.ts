/**
 * In-flight courier booking recovery (be-rel-02 follow-up).
 *
 * Before the shipping worker calls the courier it records a BOOKING INTENT: the
 * order's Shipment row in status PENDING with no AWB. The order number is the
 * stable client reference sent to the courier (Shiprocket `order_id`, Delhivery
 * `order`), so a crash or stall while the courier call is in flight can be
 * recovered by looking the booking up at the courier by that reference and
 * adopting it, instead of booking a second time.
 *
 * No schema change: the intent reuses `Shipment.status = PENDING` +
 * `awbNumber = null`, `Shipment.updatedAt` as the heartbeat (bumped on every
 * attempt) and `Shipment.webhookPayload.bookingIntent` for its metadata. The
 * successful booking write overwrites `webhookPayload` with the provider payload.
 */

/** An intent untouched this long is stale: no job attempt is still working on it. */
export const BOOKING_INTENT_STALE_MS = 15 * 60 * 1000;

/** Sweep re-enqueues of `create-shipment` for one intent before it gives up. */
export const BOOKING_INTENT_MAX_SWEEP_REQUEUES = 3;

/** Stale intents examined per sweep run. */
export const BOOKING_INTENT_SWEEP_BATCH = 25;

export type BookingIntentMeta = {
  clientReference: string;
  startedAt: string;
  sweepRequeues: number;
};

type ShipmentLike = {
  status?: string | null;
  awbNumber?: string | null;
};

/** True for a Shipment row that is a booking intent (courier call may be in flight). */
export function isBookingIntent(shipment: ShipmentLike | null | undefined): boolean {
  return Boolean(shipment) && shipment?.status === 'PENDING' && !shipment.awbNumber;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Reads intent metadata from `Shipment.webhookPayload`; null when absent or malformed. */
export function readBookingIntentMeta(webhookPayload: unknown): BookingIntentMeta | null {
  if (!isRecord(webhookPayload)) {
    return null;
  }
  const raw = webhookPayload.bookingIntent;
  if (!isRecord(raw) || typeof raw.clientReference !== 'string' || raw.clientReference.length === 0) {
    return null;
  }
  return {
    clientReference: raw.clientReference,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : new Date(0).toISOString(),
    sweepRequeues:
      typeof raw.sweepRequeues === 'number' && Number.isFinite(raw.sweepRequeues) ? raw.sweepRequeues : 0
  };
}

/**
 * Builds the `webhookPayload` for an intent write. Keeps `startedAt` and the
 * sweep counter of an earlier intent for the same reference so retries do not
 * reset the sweep's give-up budget.
 */
export function buildBookingIntentPayload(
  clientReference: string,
  previous: BookingIntentMeta | null,
  now: Date = new Date()
): { bookingIntent: BookingIntentMeta } {
  const carried = previous?.clientReference === clientReference ? previous : null;
  return {
    bookingIntent: {
      clientReference,
      startedAt: carried?.startedAt ?? now.toISOString(),
      sweepRequeues: carried?.sweepRequeues ?? 0
    }
  };
}
