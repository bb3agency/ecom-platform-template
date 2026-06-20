/**
 * Detects whether a shipping provider's response indicates that a pickup is
 * ALREADY arranged for the warehouse/shipment, rather than a genuine failure.
 *
 * Pickup is a warehouse-level event: a single open pickup request collects every
 * ready AWB at that warehouse. When a merchant books many orders in a day and
 * clicks "Schedule pickup" on each, only the first creates a request — the rest
 * are already covered by that courier visit. Providers signal this by rejecting
 * the duplicate (Delhivery: "pickup ... already exists"; Shiprocket: "Already in
 * Pickup Queue"). We treat these as success so the operator is never blocked
 * from "scheduling" pickup on later orders.
 */
const EXISTING_PICKUP_PATTERNS: RegExp[] = [
  /already.*pickup/,
  /pickup.*already/,
  /already.*scheduled/,
  /already.*queue/,
  /in pickup queue/,
  /pickup.*exist/,
  /open pickup/,
  /pending pickup/,
  /pr_exist/,
  /duplicate pickup/
];

export function isExistingPickupMessage(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return false;
  }
  const text = raw.toLowerCase();
  return EXISTING_PICKUP_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Scans a provider JSON payload for an "already scheduled" signal by checking
 * common message/error fields and, as a backstop, the whole serialized body.
 */
export function payloadIndicatesExistingPickup(payload: Record<string, unknown>): boolean {
  const candidateFields = ['message', 'error', 'rmk', 'remarks', 'detail', 'reason'];
  for (const field of candidateFields) {
    const value = payload[field];
    if (typeof value === 'string' && isExistingPickupMessage(value)) {
      return true;
    }
    if (Array.isArray(value) && value.some((item) => isExistingPickupMessage(item))) {
      return true;
    }
  }
  try {
    return isExistingPickupMessage(JSON.stringify(payload));
  } catch {
    return false;
  }
}
