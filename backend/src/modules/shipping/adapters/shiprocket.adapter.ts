import {
  type CreateShipmentInput,
  type CreateShipmentResult,
  type DeliveryRateInput,
  type DeliveryRateResult,
  type GenerateLabelResult,
  type SchedulePickupResult,
  type ServiceabilityResult,
  type ShippingProviderAdapter,
  type TrackShipmentResult
} from '@common/interfaces/shipping-provider.interface';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  normalizeShippingHsn,
  resolveDefaultShippingHsn,
  resolveShippingHsnCode
} from '@common/shipping/resolve-shipping-hsn';
import {
  normalizeIndianShippingPhone,
  resolveShiprocketCustomerEmail
} from '@common/shipping/shiprocket-payload';
import { isExistingPickupMessage, payloadIndicatesExistingPickup } from '@common/shipping/pickup-detection';

const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';
const DEFAULT_PICKUP_LOCATION = 'Primary';
const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000; // 9 days (buffer before 10d expiry)
const REQUEST_TIMEOUT_MS = 10_000; // 10s abort timeout on every fetch

type ShiprocketAdapterOptions = {
  email: string;
  password: string;
  baseUrl?: string;
  /** Must match the pickup location nickname in Shiprocket dashboard (Settings → Pickup Addresses). */
  pickupLocation?: string;
};

type ShiprocketCourierCompany = {
  courier_company_id: number;
  courier_name: string;
  rate: number;
  etd?: string;
  // Shiprocket returns this as a string ("2" or "2-3") despite the API docs showing number
  estimated_delivery_days?: number | string;
};

type ShiprocketServiceabilityResponse = {
  data?: {
    available_courier_companies?: ShiprocketCourierCompany[];
  };
  status?: number;
};

type ShiprocketCreateOrderResponse = {
  order_id?: number | string;
  shipment_id?: number | string;
  status?: string;
  status_code?: number;
  awb_code?: string;
  courier_name?: string;
  label_url?: string;
};

type ShiprocketAssignAwbResponse = {
  awb_assign_status?: number;
  status_code?: number;
  message?: string;
  response?: {
    data?: {
      awb_code?: string;
      courier_name?: string;
      label_url?: string;
      awb_assign_error?: string;
      courier_id?: number | string;
    };
  };
};

type ShiprocketTrackActivity = {
  date?: string;
  status?: string;
  activity?: string;
  location?: string;
};

type ShiprocketTrackResponse = {
  tracking_data?: {
    shipment_status?: number;
    // Top-level human-readable status string (e.g. "Cancelled", "Delivered")
    current_status?: string;
    // shipment_track[0].current_status is an alternative location for the same field
    shipment_track?: Array<{ current_status?: string; [key: string]: unknown }>;
    shipment_track_activities?: ShiprocketTrackActivity[];
  };
};

// Shiprocket's /courier/generate/pickup nests the useful fields under `response`
// and reports success as top-level `pickup_status` (1 = scheduled), e.g.:
//   { "pickup_status": 1,
//     "response": { "pickup_scheduled_date": "2026-05-06 11:59:17",
//                   "pickup_token_number": "Reafdc4536063", "status": 1 } }
// Older/edge responses expose the same fields at the top level, so we read both.
type ShiprocketPickupResponse = {
  pickup_status?: number;
  pickup_scheduled_date?: string;
  pickup_token_number?: string | number;
  status?: number;
  response?: {
    pickup_scheduled_date?: string;
    pickup_token_number?: string | number;
    status?: number;
    data?: unknown;
  };
};

type ShiprocketLabelResponse = {
  label_url?: string;
  status?: number;
};

export default class ShiprocketAdapter implements ShippingProviderAdapter {
  private readonly email: string;
  private readonly password: string;
  private readonly baseUrl: string;
  private readonly pickupLocation: string;
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(options: ShiprocketAdapterOptions) {
    this.email = options.email;
    this.password = options.password;
    this.baseUrl = options.baseUrl ?? SHIPROCKET_BASE_URL;
    const configuredLocation = options.pickupLocation?.trim();
    this.pickupLocation =
      configuredLocation && configuredLocation.length > 0 ? configuredLocation : DEFAULT_PICKUP_LOCATION;
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.email, password: this.password }),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : 'Network error';
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, `Shiprocket auth failed: ${message}`, 422);
    }
    clearTimeout(timer);

    if (!res.ok) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, `Shiprocket auth HTTP ${res.status}`, 422);
    }

    const data = await this.parseJson(res);
    const token = typeof data.token === 'string' ? data.token : null;
    if (!token) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Shiprocket auth did not return a token', 422);
    }

    this.token = token;
    this.tokenExpiry = Date.now() + TOKEN_TTL_MS;
    return this.token;
  }

  private forceTokenRefresh(): void {
    this.token = null;
    this.tokenExpiry = 0;
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    retryOnUnauthorized = true
  ): Promise<T> {
    const token = await this.getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {})
        },
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : 'Network error';
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, `Shiprocket API request failed: ${message}`, 422);
    }
    clearTimeout(timer);

    if (res.status === 401 && retryOnUnauthorized) {
      this.forceTokenRefresh();
      return this.request<T>(path, init, false);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      // Surface only Shiprocket's human-readable `message` (e.g. "Order is already canceled") —
      // never the raw response payload. The full body stays available in server logs via the
      // technical-failure alert paths that log `error.message` alongside the request context.
      let providerMessage = '';
      try {
        const parsed = JSON.parse(errBody) as { message?: unknown };
        if (typeof parsed.message === 'string') {
          providerMessage = parsed.message.slice(0, 160);
        }
      } catch {
        // Non-JSON body — omit it from the client-facing message entirely.
      }
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        providerMessage
          ? `Shiprocket rejected the request (HTTP ${res.status}): ${providerMessage}`
          : `Shiprocket request failed (HTTP ${res.status})`,
        422
      );
    }

    return this.parseJson(res) as Promise<T>;
  }

  private async parseJson(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Shiprocket returned invalid JSON', 422);
    }
  }

  async checkServiceability(pincode: string, originPincode?: string): Promise<ServiceabilityResult> {
    const pickupPincode = originPincode?.trim() || process.env.SHIPROCKET_PICKUP_PINCODE?.trim() || '';
    if (!pickupPincode) {
      throw new AppError(
        ERROR_CODES.CONFIG_NOT_READY,
        'Shiprocket pickup pincode is not configured — set SHIPROCKET_PICKUP_PINCODE or pass originPincode',
        503
      );
    }
    const query = new URLSearchParams({
      pickup_postcode: pickupPincode,
      delivery_postcode: pincode,
      weight: '0.5',
      cod: '0'
    });

    const payload = await this.request<ShiprocketServiceabilityResponse>(
      `/courier/serviceability/?${query.toString()}`
    );

    const couriers = payload.data?.available_courier_companies ?? [];
    return {
      pincode,
      serviceable: couriers.length > 0,
      providerPayload: payload as Record<string, unknown>
    };
  }

  async calculateDeliveryRate(input: DeliveryRateInput): Promise<DeliveryRateResult> {
    if (!input.originPincode?.trim()) {
      throw new AppError(
        ERROR_CODES.CONFIG_NOT_READY,
        'Shiprocket delivery rate requires originPincode — set SHIPROCKET_PICKUP_PINCODE or configure pickup pincode in store settings',
        503
      );
    }
    const weightKg = Math.max(0.001, input.totalWeightGrams / 1000);
    const isCod = input.paymentMode === 'COD';
    const query = new URLSearchParams({
      pickup_postcode: input.originPincode,
      delivery_postcode: input.destinationPincode,
      weight: weightKg.toFixed(3),
      cod: isCod ? '1' : '0'
    });

    const payload = await this.request<ShiprocketServiceabilityResponse>(
      `/courier/serviceability/?${query.toString()}`
    );

    const allCouriers: ShiprocketCourierCompany[] = payload.data?.available_courier_companies ?? [];

    // Filter out couriers with null/undefined/zero rates — these are typically COD-only
    // couriers that appear in prepaid responses with rate=0 or rate=null. Including them
    // causes the cheapest sort to pick a 0-rate courier, resulting in free shipping silently.
    const couriers = allCouriers.filter((c) => typeof c.rate === 'number' && c.rate > 0);

    if (couriers.length === 0) {
      throw new AppError(ERROR_CODES.PINCODE_NOT_SERVICEABLE, 'No couriers available for this pincode', 422);
    }

    const sorted = [...couriers].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0));
    const cheapest = sorted[0];
    if (!cheapest) {
      throw new AppError(ERROR_CODES.PINCODE_NOT_SERVICEABLE, 'No couriers available for this pincode', 422);
    }

    const availableCouriers = sorted.map((c) => ({
      courierCompanyId: c.courier_company_id,
      courierName: c.courier_name,
      shippingChargePaise: Math.round((c.rate ?? 0) * 100),
      estimatedDays: this.normalizeEstimatedDays(this.parseEstimatedDays(c.estimated_delivery_days)),
      ...(c.etd != null ? { estimatedDeliveryDate: c.etd } : {})
    }));

    return {
      shippingChargePaise: Math.round((cheapest.rate ?? 0) * 100),
      estimatedDays: this.normalizeEstimatedDays(this.parseEstimatedDays(cheapest.estimated_delivery_days)),
      courierName: cheapest.courier_name,
      courierCompanyId: cheapest.courier_company_id,
      ...(cheapest.etd != null ? { estimatedDeliveryDate: cheapest.etd } : {}),
      availableCouriers,
      providerPayload: payload as Record<string, unknown>
    };
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const billingPhone = normalizeIndianShippingPhone(input.customer.phone);
    if (!billingPhone) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Shiprocket requires a valid 10-digit Indian billing phone number',
        422
      );
    }

    const orderDate = new Date().toISOString().split('T')[0] ?? new Date().toISOString().substring(0, 10);
    const defaultHsn = resolveDefaultShippingHsn();
    const resolvePayloadHsn = (raw?: string) => {
      const normalized = normalizeShippingHsn(raw ?? '');
      if (normalized) {
        return normalized;
      }
      return resolveShippingHsnCode({ defaultHsn });
    };

    const orderItems = (input.items ?? []).map((item) => ({
      name: item.name,
      sku: item.sku,
      units: item.quantity,
      selling_price: item.unitPriceRupees.toFixed(2),
      discount: '',
      tax: '',
      hsn: resolvePayloadHsn(item.hsnCode)
    }));

    if (orderItems.length === 0) {
      orderItems.push({
        name: 'Order',
        sku: input.orderNumber,
        units: 1,
        selling_price: input.amountRupees.toFixed(2),
        discount: '',
        tax: '',
        hsn: resolvePayloadHsn(input.hsnCode)
      });
    }

    const weightKg = Math.max(0.001, input.totalWeightGrams / 1000);
    // Last-resort fallback only. The AWB worker always passes cartonized dimensions
    // (see common/shipping/cartonize.ts) — this guards any caller that doesn't.
    const dimensions = input.dimensions ?? { lengthCm: 15, breadthCm: 15, heightCm: 10 };
    const subTotalRupees = input.subtotalRupees ?? input.amountRupees;
    const shippingChargeRupees = input.shippingChargeRupees ?? 0;
    const discountRupees = input.discountRupees ?? 0;
    const isCod = input.paymentMode === 'COD';
    const lineSubtotalRupees = orderItems.reduce(
      (sum, item) => sum + Number.parseFloat(item.selling_price) * item.units,
      0
    );
    const resolvedSubTotalRupees =
      Number.isFinite(lineSubtotalRupees) && lineSubtotalRupees > 0 ? lineSubtotalRupees : subTotalRupees;

    const createPayload: Record<string, unknown> = {
      order_id: input.orderNumber,
      order_date: orderDate,
      pickup_location: this.pickupLocation,
      billing_customer_name: input.customer.fullName,
      billing_last_name: '',
      billing_address: input.customer.line1,
      billing_address_2: input.customer.line2 ?? '',
      billing_city: input.customer.city,
      billing_pincode: input.destinationPincode,
      billing_state: input.customer.state,
      billing_country: 'India',
      billing_email: resolveShiprocketCustomerEmail(input.customer.email, input.storeContactEmail),
      billing_phone: billingPhone,
      shipping_is_billing: true,
      order_items: orderItems,
      payment_method: input.paymentMode === 'COD' ? 'COD' : 'Prepaid',
      shipping_charges: shippingChargeRupees.toFixed(2),
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: discountRupees.toFixed(2),
      sub_total: resolvedSubTotalRupees.toFixed(2),
      length: dimensions.lengthCm,
      breadth: dimensions.breadthCm,
      height: dimensions.heightCm,
      weight: weightKg
    };
    if (isCod) {
      createPayload.cod_amount = input.amountRupees.toFixed(2);
    }

    const createData = await this.request<ShiprocketCreateOrderResponse>(
      '/orders/create/adhoc',
      {
        method: 'POST',
        body: JSON.stringify(createPayload)
      }
    );

    const shiprocketOrderId = createData.order_id != null ? String(createData.order_id) : null;
    const shiprocketShipmentId = createData.shipment_id != null ? String(createData.shipment_id) : null;

    if (!shiprocketShipmentId) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        'Shiprocket order created but no shipment_id returned',
        422
      );
    }

    const awbData = await this.request<ShiprocketAssignAwbResponse>(
      '/courier/assign/awb',
      {
        method: 'POST',
        body: JSON.stringify({
          shipment_id: [this.resolveShipmentIdPayload(shiprocketShipmentId)],
          ...(input.courierCompanyId != null ? { courier_id: input.courierCompanyId } : {})
        })
      }
    );

    // Extract AWB from success response or from "already assigned" idempotent error
    let awbNumber = awbData.response?.data?.awb_code ?? '';
    if (awbData.awb_assign_status !== 1) {
      const assignError = awbData.response?.data?.awb_assign_error ?? '';
      // Idempotency: Shiprocket returns status=0 if AWB was already assigned in a prior attempt.
      // The exact wording varies — match multiple patterns.
      const awbIdempotencyPatterns = [
        /AWB is already assigned with awb\s*[-:]\s*(\S+)/i,
        /already assigned.*?awb[:\s-]+(\S+)/i,
        /awb[:\s-]+(\S+)\s+(?:is\s+)?already assigned/i,
        /duplicate.*?awb[:\s-]+(\S+)/i
      ];
      let extractedAwb: string | null = null;
      for (const pattern of awbIdempotencyPatterns) {
        const m = assignError.match(pattern);
        if (m?.[1]) { extractedAwb = m[1]; break; }
      }
      if (extractedAwb) {
        awbNumber = extractedAwb;
      } else {
        const reason = assignError || awbData.message || JSON.stringify(awbData);
        throw new AppError(
          ERROR_CODES.INTERNAL_ERROR,
          `Shiprocket AWB assignment failed: ${reason}`,
          422
        );
      }
    }

    if (!awbNumber) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Shiprocket AWB code missing from assign response', 422);
    }

    // Fetch estimated delivery days by checking serviceability for the assigned route.
    // This is a lightweight read-only call and the result is stored on the Shipment record.
    let estimatedDays: number | undefined;
    try {
      const rateResult = await this.calculateDeliveryRate({
        originPincode: input.originPincode,
        destinationPincode: input.destinationPincode,
        totalWeightGrams: input.totalWeightGrams,
        paymentMode: input.paymentMode === 'COD' ? 'COD' : 'PREPAID'
      });
      estimatedDays = rateResult.estimatedDays;
    } catch {
      // Non-critical — proceed without estimated days
    }

    return {
      awbNumber,
      trackingUrl: `https://shiprocket.co/tracking/${awbNumber}`,
      ...(estimatedDays != null ? { estimatedDays } : {}),
      ...(shiprocketOrderId != null ? { shiprocketOrderId } : {}),
      shiprocketShipmentId,
      ...(awbData.response?.data?.courier_name != null ? { courierName: awbData.response.data.courier_name } : {}),
      ...(awbData.response?.data?.label_url != null ? { labelUrl: awbData.response.data.label_url } : {}),
      providerPayload: {
        createOrder: createData as Record<string, unknown>,
        assignAwb: awbData as Record<string, unknown>
      }
    };
  }

  async trackShipment(awbNumber: string): Promise<TrackShipmentResult> {
    let payload: ShiprocketTrackResponse;
    try {
      payload = await this.request<ShiprocketTrackResponse>(
        `/courier/track/awb/${encodeURIComponent(awbNumber)}`
      );
    } catch (error) {
      // Shiprocket does NOT return a trackable status for a cancelled AWB — the
      // track endpoint fails with HTTP 500 "Ohh! This AWB has been cancelled."
      // That error IS the status signal: translate it into a CANCELLED result so
      // the poll/sync/webhook pipeline propagates the cancellation (order flip,
      // customer notification, refund) instead of swallowing it as a provider
      // outage forever. Matches "cancel"/"canceled"/"cancelled" case-insensitively.
      const message = error instanceof Error ? error.message : '';
      if (/cancel/i.test(message)) {
        return {
          status: 'CANCELLED',
          events: [
            {
              status: 'CANCELLED',
              description: 'Shipment cancelled at courier (reported by Shiprocket track API)'
            }
          ],
          providerPayload: { trackErrorMessage: message.slice(0, 200) }
        };
      }
      throw error;
    }

    const trackingData = payload.tracking_data;
    const activities = trackingData?.shipment_track_activities ?? [];
    // Prefer header-level current_status (human-readable: "Shipped", "Delivered",
    // "Cancelled") because activity-level statuses carry raw courier codes
    // (e.g. "DTUP-210") that cannot be mapped to internal statuses.
    // Fall back to activity status only if the header fields are absent.
    const latestStatus =
      trackingData?.current_status ||
      trackingData?.shipment_track?.[0]?.current_status ||
      activities[0]?.status ||
      'UNKNOWN';

    const events = activities.map((a) => {
      const occurredAt = a.date ? this.normalizeShiprocketDate(a.date) : undefined;
      return {
        status: a.status ?? 'UNKNOWN',
        ...(a.location != null ? { location: a.location } : {}),
        description: a.activity ?? a.status ?? '',
        ...(occurredAt != null ? { occurredAt } : {})
      };
    });

    return {
      status: latestStatus,
      events,
      providerPayload: payload as Record<string, unknown>
    };
  }

  // NOTE: `orderId` must be the Shiprocket ORDER id (the order_id returned at
  // creation), NOT the shipment id or AWB. Shiprocket's /orders/cancel keys off
  // the order id; passing anything else silently cancels nothing in the dashboard.
  async cancelShipment(orderId: string): Promise<{ cancelled: boolean; providerPayload: Record<string, unknown> }> {
    // Shiprocket order ids are numeric — send a number when possible so the
    // cancel reliably matches the order in their system.
    const cancelId = this.resolveShipmentIdPayload(orderId);
    let payload: Record<string, unknown>;
    try {
      payload = await this.request<Record<string, unknown>>(
        '/orders/cancel',
        {
          method: 'POST',
          body: JSON.stringify({ ids: [cancelId] })
        }
      );
    } catch (error) {
      // Idempotent cancel: Shiprocket rejects a cancel for an already-cancelled
      // order/AWB with an HTTP error ("Ohh! This AWB has been cancelled." /
      // "Order is already canceled"). The desired end-state is already true —
      // treat it as success so compensating cancels and retries don't dead-letter.
      const message = error instanceof Error ? error.message : '';
      if (/cancel/i.test(message)) {
        return { cancelled: true, providerPayload: { alreadyCancelled: true, message: message.slice(0, 200) } };
      }
      throw error;
    }
    const message = typeof payload.message === 'string' ? payload.message.toLowerCase() : '';
    const cancelled = message.includes('cancel') || message.includes('success');
    if (!cancelled) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Shiprocket did not confirm cancellation for order ${orderId}: ${message || JSON.stringify(payload).slice(0, 200)}`,
        422
      );
    }
    return { cancelled: true, providerPayload: payload };
  }

  async schedulePickup(shiprocketShipmentId: string): Promise<SchedulePickupResult> {
    const shipmentId = this.resolveShipmentIdPayload(shiprocketShipmentId);

    let payload: ShiprocketPickupResponse;
    try {
      payload = await this.request<ShiprocketPickupResponse>(
        '/courier/generate/pickup',
        {
          method: 'POST',
          body: JSON.stringify({ shipment_id: [shipmentId] })
        }
      );
    } catch (err) {
      // Shiprocket returns HTTP 400 "Already in Pickup Queue" when a pickup for
      // this shipment/warehouse is already arranged. The shipment is covered, so
      // treat it as a successful (already-scheduled) pickup rather than an error.
      if (err instanceof AppError && isExistingPickupMessage(err.message)) {
        return {
          scheduled: true,
          alreadyScheduled: true,
          providerPayload: { note: 'already_in_pickup_queue', detail: err.message }
        };
      }
      throw err;
    }

    // Fields live under `response` in the current API; fall back to the top level
    // for older/edge shapes so we never lose the scheduled date or token.
    const rawScheduledDate = payload.response?.pickup_scheduled_date ?? payload.pickup_scheduled_date;
    const scheduledDate = rawScheduledDate ? this.normalizeShiprocketDate(rawScheduledDate) : undefined;
    const tokenNumber = payload.response?.pickup_token_number ?? payload.pickup_token_number;
    // Success is signalled by top-level `pickup_status`, nested `response.status`,
    // or simply the presence of a returned pickup slot/token.
    const scheduled =
      (payload.pickup_status ?? payload.response?.status ?? payload.status ?? 0) === 1 ||
      scheduledDate != null ||
      tokenNumber != null;

    // Shiprocket can also report an existing pickup as HTTP 200 with a message.
    if (payloadIndicatesExistingPickup(payload as Record<string, unknown>)) {
      return {
        scheduled: true,
        alreadyScheduled: true,
        ...(scheduledDate != null ? { pickupScheduledDate: scheduledDate } : {}),
        ...(tokenNumber != null ? { pickupTokenNumber: String(tokenNumber) } : {}),
        providerPayload: payload as Record<string, unknown>
      };
    }

    return {
      scheduled,
      ...(scheduledDate != null ? { pickupScheduledDate: scheduledDate } : {}),
      ...(tokenNumber != null ? { pickupTokenNumber: String(tokenNumber) } : {}),
      providerPayload: payload as Record<string, unknown>
    };
  }

  async generateLabel(shiprocketShipmentId: string): Promise<GenerateLabelResult> {
    const shipmentId = this.resolveShipmentIdPayload(shiprocketShipmentId);
    const payload = await this.request<ShiprocketLabelResponse>(
      '/courier/generate/label',
      {
        method: 'POST',
        body: JSON.stringify({ shipment_id: [shipmentId] })
      }
    );

    const labelUrl = payload.label_url ?? '';
    if (!labelUrl) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Shiprocket label generation did not return a URL', 422);
    }

    return {
      labelUrl,
      providerPayload: payload as Record<string, unknown>
    };
  }

  // Shiprocket activity dates are in IST: "2024-06-14 15:30:00" (space-separated, no TZ marker).
  // new Date("2024-06-14 15:30:00") parses as UTC, producing timestamps 5h30m too early.
  private normalizeShiprocketDate(raw: string): string {
    const isoLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})$/);
    if (isoLike) {
      const [, year, month, day, hour, minute, second] = isoLike;
      const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? raw : fallback.toISOString();
  }

  private normalizeEstimatedDays(value: number): number {
    const days = Math.floor(value);
    if (days < 1) return 1;
    if (days > 30) return 30;
    return days;
  }

  // Shiprocket returns estimated_delivery_days as a string ("2" or "2-3") in practice.
  // Parse the first integer from the value; fall back to 4 if absent or unparseable.
  private parseEstimatedDays(value: number | string | undefined): number {
    if (value == null) return 4;
    const first = parseInt(String(value), 10);
    return Number.isFinite(first) && first > 0 ? first : 4;
  }

  private resolveShipmentIdPayload(shiprocketShipmentId: string): number | string {
    const parsed = Number.parseInt(shiprocketShipmentId, 10);
    return Number.isFinite(parsed) ? parsed : shiprocketShipmentId;
  }
}
