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
import { resolveShippingHsnCode } from '@common/shipping/resolve-shipping-hsn';
import { isExistingPickupMessage, payloadIndicatesExistingPickup } from '@common/shipping/pickup-detection';

type DelhiveryAdapterOptions = {
  apiKey: string;
  /**
   * Base URL without trailing slash. Defaults to production.
   * Use https://staging-express.delhivery.com for staging.
   */
  baseUrl?: string;
  /**
   * Registered warehouse/pickup name in Delhivery dashboard.
   * Must exactly match the pickup location name set up in your Delhivery account.
   * Required for createShipment to succeed.
   */
  pickupLocationName?: string;
  /** Origin pincode — used as return_pin fallback. Normally from input.originPincode. */
  pickupPincode?: string;
  /** Seller/return address city */
  sellerCity?: string;
  /** Seller/return address state */
  sellerState?: string;
  /** Seller name (used for seller_name and return_name) */
  sellerName?: string;
  /** Seller address line (used for seller_add and return_add) */
  sellerAddress?: string;
  /** Seller phone (used for return_phone) */
  sellerPhone?: string;
};

export default class DelhiveryAdapter implements ShippingProviderAdapter {
  private readonly apiKey: string;

  private readonly baseUrl: string;

  private readonly pickupLocationName: string;

  private readonly pickupPincode: string;

  private readonly sellerCity: string;

  private readonly sellerState: string;

  private readonly sellerName: string;

  private readonly sellerAddress: string;

  private readonly sellerPhone: string;

  constructor(options: DelhiveryAdapterOptions) {
    this.apiKey = options.apiKey;
    // Base URL must NOT include /api suffix — all paths include /api/ where needed
    this.baseUrl = (options.baseUrl ?? 'https://track.delhivery.com').replace(/\/$/, '');
    this.pickupLocationName = options.pickupLocationName ?? 'Primary';
    this.pickupPincode = options.pickupPincode ?? '';
    this.sellerCity = options.sellerCity ?? '';
    this.sellerState = options.sellerState ?? '';
    this.sellerName = options.sellerName ?? 'Store';
    this.sellerAddress = options.sellerAddress ?? '';
    this.sellerPhone = options.sellerPhone ?? '';
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const weightKg = Number((input.totalWeightGrams / 1000).toFixed(3));
    const isCod = input.paymentMode === 'COD';
    const returnPin = this.pickupPincode || input.originPincode;
    if (!returnPin) {
      throw new AppError(
        ERROR_CODES.CONFIG_NOT_READY,
        'Delhivery createShipment requires a return pincode — set DELHIVERY_PICKUP_PINCODE or pass originPincode',
        503
      );
    }
    const productsDesc =
      input.items && input.items.length > 0
        ? input.items.map((i) => i.name).join(', ').slice(0, 255)
        : 'Product';
    const totalQty =
      input.items && input.items.length > 0 ? input.items.reduce((s, i) => s + i.quantity, 0) : 1;
    const orderDate = new Date().toISOString().slice(0, 10);

    // Delhivery payment_mode values: 'COD' or 'Pre-paid' (hyphenated — 'Prepaid' is rejected)
    const delhiveryPaymentMode = input.paymentMode === 'COD' ? 'COD' : 'Pre-paid';

    // Seller address: prefer configured address; fall back to city+state (never a pincode string)
    const sellerAddFallback = [this.sellerCity, this.sellerState].filter(Boolean).join(', ') || 'India';
    const sellerAdd = this.sellerAddress || sellerAddFallback;

    const shipmentEntry: Record<string, unknown> = {
      name: input.customer.fullName,
      phone: input.customer.phone,
      add: input.customer.line2
        ? `${input.customer.line1}, ${input.customer.line2}`
        : input.customer.line1,
      city: input.customer.city,
      state: input.customer.state,
      country: 'India',
      pin: input.destinationPincode,
      order: input.orderNumber,
      waybill: '', // leave empty for auto-assignment
      payment_mode: delhiveryPaymentMode,
      total_amount: Number(input.amountRupees.toFixed(2)),
      products_desc: productsDesc,
      hsn_code: resolveShippingHsnCode({ variantHsnCode: input.hsnCode }),
      order_date: orderDate,
      quantity: String(totalQty),
      weight: weightKg,
      origin_pin: input.originPincode,
      seller_gst_tin: input.sellerGstTin,
      seller_name: this.sellerName,
      seller_add: sellerAdd,
      seller_phone: this.sellerPhone,
      return_name: this.sellerName,
      return_add: sellerAdd,
      return_pin: returnPin,
      return_city: this.sellerCity,
      return_state: this.sellerState,
      return_country: 'India',
      return_phone: this.sellerPhone
    };

    if (isCod) {
      shipmentEntry.cod_amount = Number(input.amountRupees.toFixed(2));
    }

    if (input.dimensions) {
      shipmentEntry.shipment_length = input.dimensions.lengthCm;
      shipmentEntry.shipment_breadth = input.dimensions.breadthCm;
      shipmentEntry.shipment_height = input.dimensions.heightCm;
    }

    const data = JSON.stringify({
      pickup_location: { name: this.pickupLocationName },
      shipments: [shipmentEntry]
    });

    const body = new URLSearchParams({ format: 'json', data });

    const payload = await this.request('/api/cmu/create.json', { method: 'POST', body });

    // Per Delhivery API docs, successful response must have:
    // 1. success === true at root level
    // 2. packages[0].status === "Success"
    // 3. packages[0].waybill containing the AWB
    const success = payload.success === true;
    const firstPackage = this.pickUnknown(payload, ['packages', 0]);
    const packageStatus =
      firstPackage && typeof firstPackage === 'object' && !Array.isArray(firstPackage)
        ? (firstPackage as Record<string, unknown>).status
        : undefined;
    const isSuccess = packageStatus === 'Success';

    if (!success || !isSuccess) {
      const remarks = this.pickString(payload, [['packages', 0, 'remarks'], ['rmk']]);
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Delhivery shipment creation failed${remarks ? `: ${remarks}` : ''}`,
        422
      );
    }

    const packageWaybill = this.pickString(payload, [
      ['packages', 0, 'waybill'],
      ['shipment', 'waybill'],
      ['waybill']
    ]);

    if (!packageWaybill) {
      const remarks = this.pickString(payload, [['packages', 0, 'remarks'], ['rmk']]);
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Unable to extract AWB from Delhivery response${remarks ? `: ${remarks}` : ''}`,
        422
      );
    }

    return {
      awbNumber: packageWaybill,
      trackingUrl: `https://www.delhivery.com/track/package/${packageWaybill}`,
      providerPayload: payload
    };
  }

  async trackShipment(awbNumber: string): Promise<TrackShipmentResult> {
    const payload = await this.request(
      `/api/v1/packages/json/?waybill=${encodeURIComponent(awbNumber)}&verbose=2`
    );

    const shipmentData = this.pickUnknown(payload, ['ShipmentData', 0, 'Shipment']);
    // Prefer StatusType (authoritative short code e.g. "DL", "OFD") over Status (human-readable)
    const status =
      this.pickString(payload, [
        ['ShipmentData', 0, 'Shipment', 'Status', 'StatusType'],
        ['ShipmentData', 0, 'Shipment', 'Status', 'Status']
      ]) ?? 'UNKNOWN';

    const events: TrackShipmentResult['events'] = [];

    if (shipmentData && typeof shipmentData === 'object' && !Array.isArray(shipmentData)) {
      const scans = (shipmentData as Record<string, unknown>).Scans;
      if (Array.isArray(scans)) {
        for (const entry of scans) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
          const detail = (entry as Record<string, unknown>).ScanDetail;
          if (!detail || typeof detail !== 'object' || Array.isArray(detail)) continue;
          const d = detail as Record<string, unknown>;

          const evtStatus =
            typeof d.StatusCode === 'string' ? d.StatusCode :
            typeof d.ScanType === 'string' ? d.ScanType : 'UNKNOWN';
          const evtDescription =
            typeof d.Scan === 'string' ? d.Scan :
            typeof d.Instructions === 'string' && d.Instructions ? d.Instructions : evtStatus;
          const evtLocation = typeof d.ScannedLocation === 'string' ? d.ScannedLocation : undefined;
          const evtOccurredRaw =
            typeof d.StatusDateTime === 'string' ? d.StatusDateTime :
            typeof d.ScanDateTime === 'string' ? d.ScanDateTime : '';
          const evtOccurredAt = evtOccurredRaw ? this.normalizeEventDateTime(evtOccurredRaw) : undefined;

          events.push({
            status: evtStatus,
            description: evtDescription,
            ...(evtLocation ? { location: evtLocation } : {}),
            ...(evtOccurredAt != null ? { occurredAt: evtOccurredAt } : {})
          });
        }
      }
    }

    return { status, events, providerPayload: payload };
  }

  async cancelShipment(awbNumber: string): Promise<{ cancelled: boolean; providerPayload: Record<string, unknown> }> {
    // Delhivery's Cancel/Edit API (POST /api/p/edit) expects a RAW JSON body with
    // `cancellation` as the STRING "true" — NOT the `format=json&data=` form
    // wrapper used by create.json, and NOT a boolean. Sending the wrong shape is
    // silently ignored by Delhivery, so the order never cancels in their dashboard.
    const payload = await this.request('/api/p/edit/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waybill: awbNumber, cancellation: 'true' })
    });

    // Success shape is `{ "status": true, ... }`. Treat an explicit boolean
    // status/success, or a clear "cancelled / cancellation accepted" text, as
    // success. An `error`/`false` (e.g. "Cancellation not accepted") must fail
    // loudly so the operator/worker knows Delhivery did not cancel it.
    const statusText = (
      this.pickString(payload, [['status'], ['remark'], ['message'], ['error']]) ?? ''
    ).toLowerCase();
    // Explicit failure first — these must override any positive signal so a
    // rejected cancellation never reports success.
    const explicitFailure =
      payload.status === false ||
      payload.success === false ||
      /not\s+(cancell?ed|accepted|allowed)/.test(statusText) ||
      /\berror\b/.test(statusText);
    // NOTE: a bare waybill echo is NOT a positive signal. Delhivery's edit API
    // echoes the waybill back even when it silently ignores the cancellation
    // (e.g. package already picked up / in transit), which previously made us
    // report "cancelled" while the shipment stayed active in their dashboard.
    const positiveSignal =
      payload.status === true ||
      payload.success === true ||
      /\bcancell?ed\b/.test(statusText) ||
      /cancell?ation\s+accepted/.test(statusText) ||
      /\bsuccess(ful)?\b/.test(statusText);

    const cancelled = positiveSignal && !explicitFailure;

    if (!cancelled) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Delhivery did not confirm cancellation for AWB ${awbNumber}${statusText ? `: ${statusText}` : ''}`,
        422
      );
    }

    // Delhivery can return status:true ("request accepted") without actually
    // cancelling the package (silently ignored once the package is picked up
    // or in transit). Verify against the track API that the package really
    // moved to Cancelled; retry once after a short delay because the edit can
    // take a moment to reflect. A track-API hiccup is treated as inconclusive
    // (we keep the positive edit response) — but a definitive non-cancelled
    // tracking status fails loudly so the outbox job retries and the operator
    // is alerted instead of the order silently staying live at Delhivery.
    const verification = await this.verifyCancellationViaTracking(awbNumber);
    if (verification === 'not-cancelled') {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Delhivery accepted the cancellation request for AWB ${awbNumber} but tracking still shows the package as active. ` +
          `If the package was already picked up, cancel it from the Delhivery dashboard or via Delhivery support.`,
        422
      );
    }

    return { cancelled: true, providerPayload: payload };
  }

  /**
   * Confirms via the track API that a package is actually cancelled after an
   * edit/cancellation request. Returns:
   *  - 'cancelled'      → tracking shows Cancelled (definitive success)
   *  - 'not-cancelled'  → tracking definitively shows a live, non-cancelled package
   *  - 'inconclusive'   → track API failed or returned no status (do not block)
   */
  private async verifyCancellationViaTracking(
    awbNumber: string
  ): Promise<'cancelled' | 'not-cancelled' | 'inconclusive'> {
    // Per Delhivery's Cancel Order API docs, a successful cancellation moves a
    // pickup package to "Cancelled" but a forward Prepaid/COD package to
    // "Returned" (RT/RTO) — both are terminal cancel outcomes and must count.
    const isCancelledStatus = (status: string): boolean => {
      const upper = status.trim().toUpperCase();
      return (
        /cancel/i.test(status) ||
        /return/i.test(status) ||
        upper === 'CN' ||
        upper === 'RT' ||
        upper.startsWith('RTO')
      );
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      try {
        const tracked = await this.trackShipment(awbNumber);
        if (!tracked.status || tracked.status === 'UNKNOWN') {
          return 'inconclusive';
        }
        if (isCancelledStatus(tracked.status)) {
          return 'cancelled';
        }
        // Live status — retry once in case the cancellation hasn't reflected yet.
      } catch {
        return 'inconclusive';
      }
    }
    return 'not-cancelled';
  }

  async checkServiceability(pincode: string, _originPincode?: string): Promise<ServiceabilityResult> {
    // Pincode endpoint is at /c/api/pin-codes (NOT under /api)
    const payload = await this.request(
      `/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`
    );

    // A pincode entry exists AND postal_code.reachable must be "Y".
    // Delhivery returns string "Y"/"N" flags (not booleans) for reachable, pre_paid, cash_on_delivery.
    // A pincode record with reachable="N" is a known-but-non-serviceable area (ODA, NSZ).
    const deliveryCodes = this.pickUnknown(payload, ['delivery_codes']);
    let serviceable = false;
    if (Array.isArray(deliveryCodes) && deliveryCodes.length > 0) {
      const first = deliveryCodes[0];
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        const postalCode = (first as Record<string, unknown>).postal_code;
        if (postalCode && typeof postalCode === 'object' && !Array.isArray(postalCode)) {
          const pc = postalCode as Record<string, unknown>;
          const reachable = pc.reachable;
          // Absent reachable field means serviceable (older API versions / full pincode list endpoint)
          serviceable = reachable === 'Y' || reachable === true || reachable === undefined;
        }
      }
    }

    return { pincode, serviceable, providerPayload: payload };
  }

  async calculateDeliveryRate(input: DeliveryRateInput): Promise<DeliveryRateResult> {
    const isCod = input.paymentMode === 'COD';
    const query = new URLSearchParams({
      md: 'S',
      ss: 'Delivered',
      d_pin: input.destinationPincode,
      o_pin: input.originPincode,
      cgm: String(Math.max(1, Math.floor(input.totalWeightGrams))),
      pt: isCod ? 'COD' : 'Pre-paid',
      cod: isCod ? '1' : '0'
    });

    // Note: Delhivery's rate endpoint uses /api/kinko (not under /api prefix that would double)
    const payload = await this.request(`/api/kinko/v1/invoice/charges/.json?${query.toString()}`);

    // Delhivery /api/kinko/v1/invoice/charges/.json response shapes observed in the wild:
    //   1. Flat object:               { total_amount: 88.5, ... }
    //   2. Top-level array (wrapped): payload becomes { _array: [{ total_amount: 88.5 }] }
    //      because parsePayload wraps top-level arrays as { _array: [...] }
    //   3. Nested under data key:     { data: { total_amount: 88.5 } }
    //   4. Nested data array:         { data: [{ total_amount: 88.5 }] }
    // charge_with_tax is a B2B/LTL API field — absent from express rate responses.
    const chargeRupees = this.pickNumber(payload, [
      // Shape 1: flat object (most common per official docs)
      ['total_amount'],
      ['freight_charge'],
      ['gross_amount'],
      ['totalAmount'],
      // Shape 2: top-level array wrapped by parsePayload
      ['_array', 0, 'total_amount'],
      ['_array', 0, 'freight_charge'],
      ['_array', 0, 'gross_amount'],
      // Shape 3: nested under data key
      ['data', 'total_amount'],
      ['data', 'freight_charge'],
      // Shape 4: nested data array
      ['data', 0, 'total_amount'],
      ['data', 0, 'freight_charge']
    ]);

    // If no charge field matched, throw — never silently return 0 (would show "Free" to user).
    if (chargeRupees === null) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Delhivery rate response missing charge field. Keys received: ${Object.keys(payload).join(', ')}`,
        422
      );
    }

    // estimated_delivery_days is not guaranteed in the kinko rate response; default to 4.
    const estimatedDaysRaw = this.pickNumber(payload, [
      ['estimated_delivery_days'],
      ['tat_days'],
      ['delivery_days'],
      ['estimatedDays'],
      ['_array', 0, 'estimated_delivery_days'],
      ['_array', 0, 'tat_days'],
      ['data', 'estimated_delivery_days'],
      ['data', 0, 'estimated_delivery_days']
    ]);

    const shippingChargePaise = Math.max(0, Math.round(chargeRupees * 100));
    const estimatedDays = estimatedDaysRaw !== null ? this.normalizeEstimatedDays(estimatedDaysRaw) : 4;

    return { shippingChargePaise, estimatedDays, providerPayload: payload };
  }

  // Delhivery pickup is location-based (one request per warehouse slot), not per-waybill.
  // The _awbNumber param is accepted for interface compatibility but is not sent to Delhivery.
  async schedulePickup(_awbNumber: string): Promise<SchedulePickupResult> {
    if (!this.pickupLocationName) {
      throw new AppError(
        ERROR_CODES.CONFIG_NOT_READY,
        'Delhivery schedulePickup requires a pickupLocationName — configure it in Ops config',
        503
      );
    }

    // Delhivery rejects a pickup whose date+time is already in the past, so the
    // requested slot must always be in the future. We shift "now" into IST and
    // pick a slot within Delhivery's pickup window (~10:00–18:00 IST):
    //   - early enough in the day → schedule today, at least 2h out (min 11:00)
    //   - too late today → schedule tomorrow morning at 11:00
    // Delhivery requires date as YYYY-MM-DD (IST calendar day).
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + IST_OFFSET_MS);
    const istHour = istNow.getUTCHours(); // istNow is already shifted, so UTC getters give IST wall-clock

    let pickupDateObj = istNow;
    let pickupHour: number;
    if (istHour < 15) {
      // Enough lead time today: schedule ~2h out, never before 11:00.
      pickupHour = Math.max(istHour + 2, 11);
    } else {
      // Past the same-day cutoff — schedule tomorrow morning.
      pickupDateObj = new Date(istNow.getTime() + 24 * 60 * 60 * 1000);
      pickupHour = 11;
    }
    const pickupDate = pickupDateObj.toISOString().slice(0, 10);
    const pickupTime = `${String(pickupHour).padStart(2, '0')}:00:00`;

    const pickupRequestBody = {
      pickup_location: this.pickupLocationName,
      pickup_time: pickupTime,
      pickup_date: pickupDate,
      expected_package_count: 1
    };

    let payload: Record<string, unknown>;
    try {
      payload = await this.request('/fm/request/new/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pickupRequestBody)
      });
    } catch (err) {
      // Delhivery rejects a second pickup request for the warehouse while an
      // earlier one is still open/uncollected. That courier visit already
      // covers this AWB, so treat it as a successful (already-arranged) pickup
      // instead of blocking the operator from "scheduling" later orders.
      if (err instanceof AppError && isExistingPickupMessage(err.message)) {
        const existingId = this.extractPickupId(err.message);
        return {
          scheduled: true,
          alreadyScheduled: true,
          pickupScheduledDate: `${pickupDate}T${pickupTime}+05:30`,
          ...(existingId ? { pickupTokenNumber: existingId } : {}),
          providerPayload: { note: 'existing_open_pickup_request', detail: err.message }
        };
      }
      throw err;
    }

    // Delhivery commonly returns HTTP 200 with `pr_exist: true`, a real
    // `pickup_id`, and a message like "...Already Exist for 16 Jun in slot
    // 18:00 - 21:00" when a warehouse pickup is already scheduled. That pickup
    // covers this AWB too (pickup is warehouse-level), so surface its real id.
    if (payloadIndicatesExistingPickup(payload)) {
      const existingId =
        payload.pickup_id != null
          ? String(payload.pickup_id)
          : this.extractPickupId(JSON.stringify(payload));
      return {
        scheduled: true,
        alreadyScheduled: true,
        pickupScheduledDate: `${pickupDate}T${pickupTime}+05:30`,
        ...(existingId ? { pickupTokenNumber: existingId } : {}),
        providerPayload: payload
      };
    }

    const pickupId =
      payload.pickup_id != null ? String(payload.pickup_id) : null;

    return {
      scheduled: pickupId !== null || payload.success === true,
      pickupScheduledDate: `${pickupDate}T${pickupTime}+05:30`,
      ...(pickupId ? { pickupTokenNumber: pickupId } : {}),
      providerPayload: payload
    };
  }

  /** Pulls the numeric Delhivery pickup id out of a "Pickup Request <id> ..." message. */
  private extractPickupId(text: string): string | null {
    const match = text.match(/pickup request\s+(\d+)/i);
    return match?.[1] ?? null;
  }

  // Delhivery packing slip returns JSON for client rendering, not a PDF URL.
  // This method fetches the raw JSON; the service layer renders it to HTML.
  async generateLabel(awbNumber: string): Promise<GenerateLabelResult> {
    if (!awbNumber) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'AWB number is required for Delhivery label generation', 422);
    }

    const payload = await this.request(
      `/api/p/packing_slip?wbns=${encodeURIComponent(awbNumber)}`
    );

    // Render a self-contained HTML shipping label from the Delhivery packing slip JSON.
    // The JSON structure varies; we pull known fields and fall back gracefully.
    const labelHtml = this.renderPackingSlipHtml(awbNumber, payload);

    return { labelHtml, providerPayload: payload };
  }

  private renderPackingSlipHtml(awbNumber: string, data: Record<string, unknown>): string {
    // Delhivery's /api/p/packing_slip nests the shipment under `packages[0]`.
    // It also returns its OWN routing barcode as a base64 PNG (`barcode`) and the
    // sort routing (`origin` → `destination` facility codes) — couriers and the
    // sortation hubs read those, so we must render Delhivery's official barcode
    // (NOT a self-generated one) and the routing, all inline (no external script,
    // which is why the old label rendered blank in the popup).
    const pkgs = data.packages;
    const pkg: Record<string, unknown> =
      Array.isArray(pkgs) && pkgs.length > 0 && typeof pkgs[0] === 'object' && pkgs[0] !== null
        ? (pkgs[0] as Record<string, unknown>)
        : data;

    const esc = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };
    const get = (keys: string[]): string => {
      for (const k of keys) {
        const v = pkg[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (typeof v === 'number' && Number.isFinite(v)) return String(v);
      }
      return '';
    };

    const awb = get(['wbn', 'waybill']) || awbNumber;
    const consigneeName = get(['name', 'cname', 'customer_name']);
    const consigneeAddress = get(['address', 'cadd', 'add']);
    const consigneePin = get(['pin', 'cpin', 'pincode']);
    const consigneeCity = get(['destination_city', 'customer_city']);
    const consigneeState = get(['st', 'customer_state']);
    const consigneePhone = get(['contact', 'cnph', 'cphone', 'phone']);
    const originFacility = get(['origin']);
    const destinationFacility = get(['destination']);
    const sellerName = get(['snm', 'cl']);
    const returnAddress = get(['radd', 'sadd']);
    const returnCity = get(['rcty']);
    const returnPin = get(['rpin']);
    const returnState = get(['rst']);
    const orderRef = get(['oid', 'order', 'order_id']);
    const product = get(['prd', 'products_desc']);
    const qty = get(['qty', 'quantity']);
    const weight = get(['weight', 'wt']);
    const hsn = get(['hsn_code']);
    const sellerGst = get(['seller_gst_tin', 'client_gst_tin']);
    const paymentMode = get(['pt', 'pm', 'payment_mode']);
    const codValue = get(['cod', 'cod_amount']);
    const isCod = paymentMode.toUpperCase().includes('COD') || (codValue !== '' && Number(codValue) > 0);
    const logo = get(['delhivery_logo']);
    // Delhivery's official routing barcode (base64 data URI). Render it as an
    // image — it encodes the AWB + sort routing the hubs scan.
    const barcodeRaw = pkg.barcode;
    const barcode = typeof barcodeRaw === 'string' && barcodeRaw.startsWith('data:image') ? barcodeRaw : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Delhivery Label — ${esc(awb)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;background:#f3f4f6;color:#000;padding:8px}
  .toolbar{display:flex;gap:8px;max-width:100mm;margin:0 auto 10px;position:sticky;top:8px}
  .toolbar button{flex:1;min-height:44px;font-size:14px;font-weight:bold;border:none;border-radius:8px;cursor:pointer;padding:0 10px}
  .toolbar .print{background:#111827;color:#fff}
  .toolbar .dl{background:#fff;color:#111827;border:2px solid #111827}
  .label{width:100mm;max-width:100%;margin:0 auto;background:#fff;border:2px solid #000;padding:8px;page-break-inside:avoid}
  .header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #000;padding-bottom:6px;margin-bottom:6px}
  .header img{height:22px}
  .header .brand{font-size:16px;font-weight:bold;letter-spacing:1px}
  .pay{font-size:13px;font-weight:bold;border:1px solid #000;padding:2px 8px}
  .pay.cod{background:#000;color:#fff}
  .routing{display:flex;justify-content:space-between;font-size:10px;font-weight:bold;margin:4px 0}
  .dest{font-size:15px;font-weight:bold;text-align:center;border:1px solid #000;padding:4px;margin:4px 0}
  .barcode-wrap{text-align:center;margin:6px 0}
  .barcode-wrap img{max-width:100%;height:64px}
  .awb{font-size:14px;font-weight:bold;letter-spacing:2px;text-align:center;margin-top:2px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  td{padding:2px 3px;vertical-align:top;border-top:1px solid #ddd}
  .k{font-weight:bold;width:34%;white-space:nowrap}
  .ship-to{font-size:12px;font-weight:bold;margin-top:6px}
  @media print{body{padding:0;background:#fff}.toolbar{display:none}.label{border-width:2px}}
</style>
</head>
<body>
<div class="toolbar">
  <button class="print" type="button" onclick="window.print()">&#128424; Print / Save as PDF</button>
  <button class="dl" type="button" id="dlBtn">&#11015; Download</button>
</div>
<div class="label">
  <div class="header">
    ${logo ? `<img src="${esc(logo)}" alt="Delhivery">` : '<span class="brand">DELHIVERY</span>'}
    <span class="pay ${isCod ? 'cod' : ''}">${isCod ? `COD ₹${esc(codValue)}` : 'PREPAID'}</span>
  </div>

  ${destinationFacility || originFacility ? `<div class="routing"><span>${esc(originFacility)}</span><span>&#8594; ${esc(destinationFacility)}</span></div>` : ''}
  ${consigneeCity || consigneeState ? `<div class="dest">${esc(consigneeCity)}${consigneeState ? `, ${esc(consigneeState)}` : ''} ${esc(consigneePin)}</div>` : ''}

  ${barcode
    ? `<div class="barcode-wrap"><img src="${barcode}" alt="AWB ${esc(awb)}"></div>`
    : ''}
  <div class="awb">${esc(awb)}</div>

  <div class="ship-to">Ship to:</div>
  <table>
    <tr><td class="k">Name</td><td>${esc(consigneeName)}</td></tr>
    <tr><td class="k">Address</td><td>${esc(consigneeAddress)}${consigneeCity ? `, ${esc(consigneeCity)}` : ''}${consigneePin ? ` - ${esc(consigneePin)}` : ''}</td></tr>
    ${consigneePhone ? `<tr><td class="k">Phone</td><td>${esc(consigneePhone)}</td></tr>` : ''}
    ${orderRef ? `<tr><td class="k">Order</td><td>${esc(orderRef)}</td></tr>` : ''}
    ${product ? `<tr><td class="k">Product</td><td>${esc(product)}${qty ? ` (Qty ${esc(qty)})` : ''}</td></tr>` : ''}
    ${weight ? `<tr><td class="k">Weight</td><td>${esc(weight)} kg</td></tr>` : ''}
    ${hsn ? `<tr><td class="k">HSN</td><td>${esc(hsn)}</td></tr>` : ''}
    ${sellerGst ? `<tr><td class="k">Seller GST</td><td>${esc(sellerGst)}</td></tr>` : ''}
    ${sellerName || returnAddress ? `<tr><td class="k">Return</td><td>${esc(sellerName)}${returnAddress ? `, ${esc(returnAddress)}` : ''}${returnCity ? `, ${esc(returnCity)}` : ''}${returnState ? `, ${esc(returnState)}` : ''}${returnPin ? ` - ${esc(returnPin)}` : ''}</td></tr>` : ''}
  </table>
</div>
<script>
  // Download a self-contained copy of this label (works offline; can be reprinted).
  document.getElementById('dlBtn').addEventListener('click', function () {
    var html = '<!DOCTYPE html>' + document.documentElement.outerHTML;
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'delhivery-label-${esc(awb)}.html';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  });
</script>
</body>
</html>`;
  }

  private async request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    // Bulletproof timeout: we do NOT rely on AbortController/undici actually
    // interrupting a stalled body read (in some Node/undici versions a response
    // whose headers arrived but whose body stalls is never aborted by the signal,
    // so response.text() hangs forever and Nginx returns an opaque 502). Instead
    // we race the whole fetch+read against a hard wall-clock timer, guaranteeing
    // this method always settles within DELHIVERY_TIMEOUT_MS and the backend
    // always returns clean JSON — never an Nginx 502 — for this provider path.
    const DELHIVERY_TIMEOUT_MS = 12_000;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(); // best-effort cancel of the underlying socket
        reject(
          new AppError(
            ERROR_CODES.INTERNAL_ERROR,
            `Delhivery did not respond within ${DELHIVERY_TIMEOUT_MS / 1000}s for ${path} — the provider endpoint stalled (Shiprocket is unaffected). Retry shortly; if it persists, the account's pickup/manifest API may not be enabled or the VPS cannot reach track.delhivery.com.`,
            422
          )
        );
      }, DELHIVERY_TIMEOUT_MS);
    });

    const operation = (async (): Promise<Record<string, unknown>> => {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Token ${this.apiKey}`,
          ...(init?.headers ?? {})
        },
        signal: controller.signal
      });

      const responseText = await response.text();
      const parsed = this.parsePayload(responseText);
      if (!response.ok) {
        // Include Delhivery's error detail (often in 'message', 'error', or 'rmk') for diagnostics
        const detail =
          typeof parsed.message === 'string' ? parsed.message :
          typeof parsed.error === 'string' ? parsed.error :
          typeof parsed.rmk === 'string' ? parsed.rmk :
          responseText.slice(0, 200);
        throw new AppError(
          ERROR_CODES.INTERNAL_ERROR,
          `Delhivery API error ${response.status}: ${detail}`,
          422
        );
      }
      return parsed;
    })();

    // If the timeout wins the race, `operation` keeps running and may reject
    // later with no awaiter — an unhandled rejection that can crash the Node
    // process (itself a source of Nginx 502s). Attach a no-op handler so any
    // late settlement is always considered handled.
    operation.catch(() => undefined);

    try {
      return await Promise.race([operation, timeoutPromise]);
    } catch (err) {
      // Re-throw our own AppErrors (timeout / non-OK response / invalid JSON) unchanged.
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Delhivery request to ${path} failed: ${err instanceof Error ? err.message : 'network error'}`,
        422
      );
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private parsePayload(text: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(text);
      // Delhivery sometimes returns an array at top level — wrap it
      if (Array.isArray(parsed)) {
        return { _array: parsed };
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Delhivery returned invalid JSON', 422);
    }
  }

  private pickString(payload: Record<string, unknown>, paths: Array<Array<string | number>>): string | null {
    for (const path of paths) {
      let cursor: unknown = payload;
      for (const key of path) {
        if (typeof key === 'number') {
          if (!Array.isArray(cursor) || key >= cursor.length) {
            cursor = undefined;
            break;
          }
          cursor = cursor[key];
          continue;
        }
        if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
          cursor = undefined;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[key];
      }
      if (typeof cursor === 'string' && cursor.length > 0) {
        return cursor;
      }
    }
    return null;
  }

  private pickNumber(payload: Record<string, unknown>, paths: Array<Array<string | number>>): number | null {
    for (const path of paths) {
      const value = this.pickUnknown(payload, path);
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  }

  private pickUnknown(payload: Record<string, unknown>, path: Array<string | number>): unknown {
    let cursor: unknown = payload;
    for (const key of path) {
      if (typeof key === 'number') {
        if (!Array.isArray(cursor) || key >= cursor.length) {
          return undefined;
        }
        cursor = cursor[key];
        continue;
      }
      if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
        return undefined;
      }
      cursor = (cursor as Record<string, unknown>)[key];
    }
    return cursor;
  }

  private normalizeEstimatedDays(value: number): number {
    const integerDays = Math.floor(value);
    if (integerDays < 1) return 1;
    if (integerDays > 30) return 30;
    return integerDays;
  }

  // Delhivery scan timestamps are in IST: "2024-06-14 15:30:00" (space-separated, no TZ marker).
  // new Date("2024-06-14 15:30:00") parses as UTC in Node.js, producing timestamps 5h30m too early.
  private normalizeEventDateTime(raw: string): string {
    const isoLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})$/);
    if (isoLike) {
      const [, year, month, day, hour, minute, second] = isoLike;
      const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? raw : fallback.toISOString();
  }
}
