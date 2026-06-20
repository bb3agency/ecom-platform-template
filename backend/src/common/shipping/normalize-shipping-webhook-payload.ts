export type NormalizedShippingWebhookPayload = {
  awb: string;
  status: string;
  description: string;
  location?: string;
  occurredAt?: string;
  /** Shiprocket shipment id — used when AWB lookup alone fails. */
  shiprocketShipmentId?: string;
};

function readString(value: unknown): string | null {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readFirstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = readString(source[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function parseShiprocketLocalDateMs(raw: string): number {
  const isoLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})$/);
  if (isoLike) {
    const [, year, month, day, hour, minute, second] = isoLike;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`).getTime();
  }
  const shiprocketStyle = raw.match(/^(\d{2})\s(\d{2})\s(\d{4})\s(\d{2}):(\d{2}):(\d{2})$/);
  if (shiprocketStyle) {
    const [, day, month, year, hour, minute, second] = shiprocketStyle;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`).getTime();
  }
  return Date.parse(raw);
}

function readLatestScan(body: Record<string, unknown>): Record<string, unknown> | null {
  const scans = body.scans;
  if (!Array.isArray(scans) || scans.length === 0) {
    return null;
  }

  let latest: Record<string, unknown> | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const entry of scans) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const scan = entry as Record<string, unknown>;
    const dateRaw = readString(scan.date);
    const parsedMs = dateRaw ? parseShiprocketLocalDateMs(dateRaw) : Number.NaN;
    if (Number.isFinite(parsedMs) && parsedMs >= latestMs) {
      latestMs = parsedMs;
      latest = scan;
      continue;
    }
    if (!latest) {
      latest = scan;
    }
  }

  return latest;
}

function normalizeOccurredAt(raw: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }
  // Check IST-specific formats FIRST. new Date("YYYY-MM-DD HH:MM:SS") parses as UTC in
  // Node.js, making timestamps 5h30m too early for Delhivery/Shiprocket IST dates.
  const isoLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})$/);
  if (isoLike) {
    const [, year, month, day, hour, minute, second] = isoLike;
    const isoCandidate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`);
    if (!Number.isNaN(isoCandidate.getTime())) {
      return isoCandidate.toISOString();
    }
  }
  const shiprocketStyle = raw.match(/^(\d{2})\s(\d{2})\s(\d{4})\s(\d{2}):(\d{2}):(\d{2})$/);
  if (shiprocketStyle) {
    const [, day, month, year, hour, minute, second] = shiprocketStyle;
    const isoCandidate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`);
    if (!Number.isNaN(isoCandidate.getTime())) {
      return isoCandidate.toISOString();
    }
  }
  // Only fall back to raw Date parsing for true ISO 8601 strings that carry TZ info.
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return undefined;
}

function unwrapWebhookBody(raw: unknown): Record<string, unknown> | null {
  // Delhivery may send an array in some configurations — unwrap first element and recurse
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const first = raw[0];
    if (!first || typeof first !== 'object' || Array.isArray(first)) return null;
    return unwrapWebhookBody(first);
  }
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const body = raw as Record<string, unknown>;

  // Delhivery Push API format: { "Shipment": { "AWB": "...", "Status": { ... }, "ReferenceNo": "..." } }
  // Flatten into a single-level record so downstream key lookups work without path awareness.
  const shipmentObj = body.Shipment;
  if (shipmentObj && typeof shipmentObj === 'object' && !Array.isArray(shipmentObj)) {
    const shipment = shipmentObj as Record<string, unknown>;
    const statusObj = shipment.Status;
    const status =
      statusObj && typeof statusObj === 'object' && !Array.isArray(statusObj)
        ? (statusObj as Record<string, unknown>)
        : {};
    return {
      // AWB / waybill
      AWB: shipment.AWB,
      Waybill: shipment.AWB,
      // Status fields — flattened from nested Status object
      Status: status.Status,
      StatusType: status.StatusType,
      StatusLocation: status.StatusLocation,
      StatusDateTime: status.StatusDateTime,
      Instructions: status.Instructions,
      description: status.Instructions,
      // Delhivery order reference (maps back to our order number)
      ReferenceNo: shipment.ReferenceNo,
      // Preserve originals for any downstream consumers
      _rawShipment: shipment
    };
  }

  // Shiprocket and other providers nest under `data`
  const nested = body.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return body;
}

/** Delhivery contract fields — when present, must parse to a valid ISO timestamp. */
export function readStrictDelhiveryOccurredAt(raw: unknown): string | null {
  const body = unwrapWebhookBody(raw);
  if (!body) {
    return null;
  }
  // StatusDateTime is Delhivery Push API's primary timestamp field; the others are legacy aliases
  return readFirstString(body, ['StatusDateTime', 'occurredAt', 'occurred_at']);
}

/** Maps Delhivery-style and native Shiprocket webhook bodies to the internal worker contract. */
export function normalizeShippingWebhookPayload(raw: unknown): NormalizedShippingWebhookPayload | null {
  const body = unwrapWebhookBody(raw);
  if (!body) {
    return null;
  }

  const latestScan = readLatestScan(body);
  // 'Waybill' (capital W) and 'AWB' (uppercase) are used by Delhivery Push API
  const awbRaw = readFirstString(body, ['awb', 'awb_code', 'AWB', 'Waybill', 'waybill', 'tracking_number']);
  // 'StatusType' (short code e.g. "DL", "OFD") is preferred over human-readable 'Status' for Delhivery
  const status = readFirstString(body, [
    'status',
    'StatusType',
    'Status',
    'current_status',
    'shipment_status',
    'currentStatus',
    'shipmentStatus'
  ]) ?? (latestScan ? readFirstString(latestScan, ['sr-status-label', 'status']) : null);

  if (!status) {
    return null;
  }

  const shiprocketShipmentId =
    readFirstString(body, ['shipment_id', 'sr_shipment_id', 'shipmentId']) ?? undefined;

  if (!awbRaw && !shiprocketShipmentId) {
    return null;
  }

  const awb = awbRaw?.trim() ?? '';

  const description =
    readFirstString(body, ['description', 'activity']) ??
    (latestScan ? readFirstString(latestScan, ['activity', 'sr-status-label', 'status']) : null) ??
    status;

  // 'StatusLocation' is the Delhivery Push API location field
  const location =
    readFirstString(body, ['location', 'StatusLocation']) ??
    (latestScan ? readFirstString(latestScan, ['location']) : null) ??
    undefined;

  // 'StatusDateTime' is the Delhivery Push API timestamp field
  const occurredAt = normalizeOccurredAt(
    readFirstString(body, ['occurredAt', 'occurred_at', 'StatusDateTime', 'current_timestamp', 'currentTimestamp']) ??
      (latestScan ? readFirstString(latestScan, ['date']) : null)
  );

  return {
    awb,
    status,
    description,
    ...(location ? { location } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    ...(shiprocketShipmentId ? { shiprocketShipmentId } : {})
  };
}
