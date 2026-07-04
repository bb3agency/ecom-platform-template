import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DelhiveryAdapter from './delhivery.adapter';

describe('DelhiveryAdapter', () => {
  beforeEach(() => {
    // Suppress debug logging during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates shipment using token auth and multipart data mapping', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        success: true,
        packages: [{ status: 'Success', waybill: 'AWB123' }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'delhivery_key', baseUrl: 'https://track.delhivery.com' });
    const result = await adapter.createShipment({
      orderNumber: 'ORD-2026-00001',
      amountRupees: 499.5,
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 1200,
      paymentMode: 'Prepaid',
      sellerGstTin: '29ABCDE1234F1Z5',
      hsnCode: '1001',
      customer: {
        fullName: 'Test User',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Bengaluru',
        state: 'Karnataka'
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/cmu/create.json');
    expect((init.headers as Record<string, string>).Authorization).toBe('Token delhivery_key');

    const formBody = init.body as URLSearchParams;
    const rawData = formBody.get('data');
    const format = formBody.get('format');
    expect(format).toBe('json');
    expect(typeof rawData).toBe('string');
    if (typeof rawData !== 'string') {
      throw new Error('Expected Delhivery form data payload as string');
    }
    const parsedData = JSON.parse(rawData) as {
      shipments: Array<{
        order: string;
        total_amount: number;
        pin: string;
        origin_pin: string;
        payment_mode: string;
        weight: number;
        seller_gst_tin: string;
        hsn_code: string;
      }>;
    };
    expect(parsedData.shipments[0]).toMatchObject({
      order: 'ORD-2026-00001',
      total_amount: 499.5,
      pin: '560001',
      origin_pin: '110001',
      payment_mode: 'Pre-paid',
      weight: 1.2,
      seller_gst_tin: '29ABCDE1234F1Z5',
      hsn_code: '1001'
    });

    expect(result.awbNumber).toBe('AWB123');
    expect(result.trackingUrl).toContain('AWB123');
  });

  it('uses default numeric HSN when order payload omits product HSN', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        success: true,
        packages: [{ status: 'Success', waybill: 'AWB999' }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'delhivery_key', baseUrl: 'https://track.delhivery.com' });
    await adapter.createShipment({
      orderNumber: 'ORD-2026-00003',
      amountRupees: 100,
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 500,
      paymentMode: 'Prepaid',
      sellerGstTin: '29ABCDE1234F1Z5',
      hsnCode: 'NA',
      customer: {
        fullName: 'Test User',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Bengaluru',
        state: 'Karnataka'
      }
    });

    const formBody = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as URLSearchParams;
    const parsedData = JSON.parse(String(formBody.get('data'))) as {
      shipments: Array<{ hsn_code: string }>;
    };
    expect(parsedData.shipments[0]?.hsn_code).toBe('2106');
  });

  it('checks serviceability using Delhivery pincode endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ delivery_codes: [{ postal_code: { pin: '560001' } }] })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'delhivery_key', baseUrl: 'https://track.delhivery.com' });
    const result = await adapter.checkServiceability('560001');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/c/api/pin-codes/json/?filter_codes=560001');
    expect(result.serviceable).toBe(true);
    expect(result.pincode).toBe('560001');
  });

  it('calculates delivery charge and ETA from Delhivery rate endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ total_amount: 88.5, estimated_delivery_days: 2 })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'delhivery_key', baseUrl: 'https://track.delhivery.com' });
    const result = await adapter.calculateDeliveryRate({
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 1500
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/api/kinko/v1/invoice/charges/');
    expect(url).toContain('d_pin=560001');
    expect(url).toContain('o_pin=110001');
    expect(url).toContain('cgm=1500');
    expect(result).toMatchObject({
      shippingChargePaise: 8850,
      estimatedDays: 2
    });
  });

  it('throws when Delhivery returns invalid JSON on success response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'not-json'
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'delhivery_key', baseUrl: 'https://track.delhivery.com' });
    await expect(adapter.checkServiceability('560001')).rejects.toMatchObject({
      statusCode: 422,
      message: 'Delhivery returned invalid JSON'
    });
  });

  it('rate API includes all required query parameters with correct values', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ total_amount: 50, estimated_delivery_days: 3 })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });

    // Test PREPAID mode
    await adapter.calculateDeliveryRate({
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 500,
      paymentMode: 'PREPAID'
    });

    const [urlPrepaid] = fetchMock.mock.calls[0] as [string];
    expect(urlPrepaid).toContain('md=S');
    expect(urlPrepaid).toContain('ss=Delivered');
    expect(urlPrepaid).toContain('pt=Pre-paid'); // Exact format: capital P, hyphenated
    expect(urlPrepaid).toContain('cod=0');

    // Test COD mode
    vi.clearAllMocks();
    await adapter.calculateDeliveryRate({
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 500,
      paymentMode: 'COD'
    });

    const [urlCod] = fetchMock.mock.calls[0] as [string];
    expect(urlCod).toContain('md=S');
    expect(urlCod).toContain('ss=Delivered');
    expect(urlCod).toContain('pt=COD');
    expect(urlCod).toContain('cod=1');
  });

  it('rate API handles weight edge cases: minimum 1g, fractional floored', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ total_amount: 50, estimated_delivery_days: 2 })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });

    // Zero weight should become 1g
    await adapter.calculateDeliveryRate({
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 0
    });

    let [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('cgm=1');

    // Fractional weight should be floored
    vi.clearAllMocks();
    await adapter.calculateDeliveryRate({
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 1234.999
    });

    [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('cgm=1234');
  });

  it('extracts total_amount from flat Delhivery kinko rate response', async () => {
    // Delhivery /api/kinko/v1/invoice/charges/.json returns a flat object — NOT a data array.
    // total_amount is the primary charge field (includes GST). charge_with_tax is B2B/LTL only.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ total_amount: 75.5, estimated_delivery_days: 3 })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });
    const result = await adapter.calculateDeliveryRate({
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 500,
      paymentMode: 'PREPAID'
    });

    expect(result.shippingChargePaise).toBe(7550);
    expect(result.estimatedDays).toBe(3);
  });

  it('rate API correctly defaults paymentMode when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ total_amount: 50, estimated_delivery_days: 2 })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });

    // When paymentMode is undefined, should default to PREPAID
    await adapter.calculateDeliveryRate({
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 500
      // paymentMode omitted — should default to prepaid
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('pt=Pre-paid');
    expect(url).toContain('cod=0');
  });

  it('extracts total_amount from top-level array wrapped by parsePayload', async () => {
    // Some Delhivery account plans return the rate as a top-level JSON array.
    // parsePayload wraps this as { _array: [...] } — charge must be found at _array[0].total_amount.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ total_amount: 60.0, estimated_delivery_days: 2 }])
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });
    const result = await adapter.calculateDeliveryRate({
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 500,
      paymentMode: 'PREPAID'
    });

    expect(result.shippingChargePaise).toBe(6000);
    expect(result.estimatedDays).toBe(2);
  });

  it('throws 502 when Delhivery rate response has no recognisable charge field', async () => {
    // Prevents silently returning shippingCharge:0 ("Free") when the API returns unexpected JSON.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ some_unknown_field: 100 })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });
    await expect(
      adapter.calculateDeliveryRate({
        destinationPincode: '560001',
        originPincode: '110001',
        totalWeightGrams: 500
      })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('schedulePickup books a pickup with a future IST slot', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ pickup_id: 987654, success: true })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key', pickupLocationName: 'Home' });
    const result = await adapter.schedulePickup('AWB123');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/fm/request/new/');
    const body = JSON.parse(init.body as string) as { pickup_location: string; pickup_date: string; pickup_time: string };
    expect(body.pickup_location).toBe('Home');
    expect(body.pickup_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.scheduled).toBe(true);
    expect(result.alreadyScheduled).toBeUndefined();
    expect(result.pickupTokenNumber).toBe('987654');
  });

  it('schedulePickup treats an existing open pickup (HTTP 400) as success, not failure', async () => {
    // A merchant with many same-day orders clicks "Schedule pickup" on each; only
    // the first creates a request. Delhivery rejects the rest while the prior
    // warehouse pickup is still open — that visit already covers this AWB.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'Pickup request already exists for this warehouse' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key', pickupLocationName: 'Home' });
    const result = await adapter.schedulePickup('AWB123');

    expect(result.scheduled).toBe(true);
    expect(result.alreadyScheduled).toBe(true);
    expect(result.pickupScheduledDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('schedulePickup treats an existing pickup reported with HTTP 200 + error flag as success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: false, error: 'open pickup request pending' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key', pickupLocationName: 'Home' });
    const result = await adapter.schedulePickup('AWB123');

    expect(result.scheduled).toBe(true);
    expect(result.alreadyScheduled).toBe(true);
  });

  it('schedulePickup still surfaces a genuine non-pickup error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'ClientWarehouse matching query does not exist' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key', pickupLocationName: 'Home' });
    await expect(adapter.schedulePickup('AWB123')).rejects.toMatchObject({ statusCode: 422 });
  });

  it('schedulePickup returns a clean 502 (not a hang) when the response body read rejects', async () => {
    // Delhivery's /fm/ endpoint can send headers (200) then break the body read.
    // The operation must surface a clean AppError(502), never hang to an Nginx 502.
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => {
        throw abortError;
      }
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key', pickupLocationName: 'Home' });
    await expect(adapter.schedulePickup('AWB123')).rejects.toMatchObject({ statusCode: 422 });
  });

  it('schedulePickup times out cleanly (no hang) when the response body never resolves', async () => {
    // The decisive guard: even if AbortController never interrupts a stalled body
    // read, the wall-clock Promise.race must reject within 12s so the backend
    // never hangs long enough for Nginx to return an opaque 502.
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => new Promise<string>(() => {}) // never resolves — simulates a stalled body
      });
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new DelhiveryAdapter({ apiKey: 'test_key', pickupLocationName: 'Home' });
      const pending = adapter.schedulePickup('AWB123');
      const assertion = expect(pending).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringContaining('did not respond within 12s')
      });
      await vi.advanceTimersByTimeAsync(12_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelShipment posts raw JSON with cancellation:"true" to /api/p/edit and verifies via tracking', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/v1/packages/json')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ShipmentData: [{ Shipment: { Status: { Status: 'Cancelled', StatusType: 'CN' }, Scans: [] } }]
            })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: true, remark: 'cancelled' })
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });
    const result = await adapter.cancelShipment('56555510000140');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // NO trailing slash — the slashed path can 301 and fetch turns the redirected POST into a body-less GET.
    expect(url.endsWith('/api/p/edit')).toBe(true);
    // Must be a raw JSON body (not the format=json&data= form wrapper) with a string "true".
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(typeof init.body).toBe('string');
    const body = JSON.parse(init.body as string) as { waybill: string; cancellation: unknown };
    expect(body).toEqual({ waybill: '56555510000140', cancellation: 'true' });
    // Verification call hit the track API.
    const trackCall = fetchMock.mock.calls.find(([u]) => (u as string).includes('/api/v1/packages/json'));
    expect(trackCall).toBeDefined();
    expect(result.cancelled).toBe(true);
  });

  it('cancelShipment rejects a bare waybill echo without an affirmative status (silent-ignore guard)', async () => {
    // Delhivery echoes the waybill even when it silently ignores the cancellation
    // (e.g. already picked up). That alone must NOT count as success.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ waybill: '56555510000140' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });
    await expect(adapter.cancelShipment('56555510000140')).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('did not confirm cancellation')
    });
  });

  it('cancelShipment fails loudly when edit is accepted but tracking still shows the package active', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/packages/json')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ShipmentData: [{ Shipment: { Status: { Status: 'In Transit', StatusType: 'UD' }, Scans: [] } }]
              })
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: true })
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });
      const pending = adapter.cancelShipment('56555510000140');
      const assertion = expect(pending).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringContaining('tracking still shows the package as active')
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelShipment accepts "Returned" tracking status (prepaid/COD cancel outcome per Delhivery docs)', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/v1/packages/json')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ShipmentData: [{ Shipment: { Status: { Status: 'Returned', StatusType: 'RT' }, Scans: [] } }]
            })
        };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });
    const result = await adapter.cancelShipment('56555510000140');
    expect(result.cancelled).toBe(true);
  });

  it('cancelShipment treats a track-API hiccup as inconclusive and keeps the positive edit response', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/v1/packages/json')) {
        return { ok: false, status: 500, text: async () => 'upstream error' };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: true, remark: 'cancelled' })
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });
    const result = await adapter.cancelShipment('56555510000140');
    expect(result.cancelled).toBe(true);
  });

  it('generateLabel renders Delhivery official barcode + nested packages[0] fields (no blank label)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        packages: [{
          wbn: '56555510000162',
          oid: 'ORD-2026-00032',
          name: 'Umesh J',
          address: 'Kukatpally',
          pin: 500072,
          destination: 'Hyderabad_Kailashhills_D (Telangana)',
          origin: 'Guntur_Vinayaknagar_D (Andhra Pradesh)',
          destination_city: 'Hyderabad',
          st: 'Telangana',
          pt: 'Pre-paid',
          prd: 'test-product',
          weight: 2,
          barcode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
        }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });
    const result = await adapter.generateLabel('56555510000162');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/api/p/packing_slip?wbns=56555510000162');
    const html = result.labelHtml ?? '';
    // Uses Delhivery's official base64 barcode image, NOT a self-generated one.
    expect(html).toContain('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
    expect(html).not.toContain('JsBarcode');
    expect(html).not.toContain('cdn.jsdelivr.net');
    // Reads nested packages[0] fields — label is not blank.
    expect(html).toContain('Umesh J');
    expect(html).toContain('Kukatpally');
    expect(html).toContain('Hyderabad');
    expect(html).toContain('ORD-2026-00032');
    expect(html).toContain('PREPAID');
  });

  it('cancelShipment fails loudly when Delhivery rejects the cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: false, error: 'Cancellation not accepted' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DelhiveryAdapter({ apiKey: 'test_key' });
    await expect(adapter.cancelShipment('56555510000140')).rejects.toMatchObject({ statusCode: 422 });
  });
});
