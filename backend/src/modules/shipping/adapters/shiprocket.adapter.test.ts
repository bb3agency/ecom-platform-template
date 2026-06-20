import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShiprocketAdapter from './shiprocket.adapter';

describe('ShiprocketAdapter', () => {
  beforeEach(() => {
    // Suppress debug logging during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('authenticates and caches token on first request', async () => {
    vi.stubEnv('SHIPROCKET_PICKUP_PINCODE', '110001');
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: 'sr-token-123' })
    }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: { available_courier_companies: [{ courier_company_id: 1, courier_name: 'Test', rate: 50 }] }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    await adapter.checkServiceability('560001');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [authUrl, authInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(authUrl).toContain('/auth/login');
    expect(authInit.method).toBe('POST');
    expect((authInit.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const [svcUrl, svcInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(svcUrl).toContain('/courier/serviceability/');
    expect((svcInit.headers as Record<string, string>).Authorization).toBe('Bearer sr-token-123');
  });

  it('creates shipment and assigns AWB', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          order_id: 101,
          shipment_id: 202,
          status: 'NEW'
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          awb_assign_status: 1,
          response: {
            data: {
              awb_code: 'AWB123456',
              courier_name: 'TestCourier',
              label_url: 'https://label.example/123'
            }
          }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
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

    expect(result.awbNumber).toBe('AWB123456');
    expect(result.trackingUrl).toContain('AWB123456');
    expect(result.shiprocketOrderId).toBe('101');
    expect(result.shiprocketShipmentId).toBe('202');
    expect(result.courierName).toBe('TestCourier');
    expect(result.labelUrl).toBe('https://label.example/123');
    const createBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(createBody.payment_method).toBe('Prepaid');
    expect(createBody.pickup_location).toBe('Primary');
  });

  it('uses default numeric HSN when order payload omits product HSN', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ order_id: 101, shipment_id: 202, status: 'NEW' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          awb_assign_status: 1, response: { data: { awb_code: 'AWB777', courier_name: 'TestCourier' } }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    await adapter.createShipment({
      orderNumber: 'ORD-2026-00003',
      amountRupees: 100,
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 500,
      paymentMode: 'Prepaid',
      sellerGstTin: '29ABCDE1234F1Z5',
      hsnCode: 'NA',
      items: [
        {
          name: 'test-product',
          sku: 'TEST-SKU',
          quantity: 1,
          unitPriceRupees: 100
        }
      ],
      customer: {
        fullName: 'Test User',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Bengaluru',
        state: 'Karnataka'
      }
    });

    const createBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(createBody.order_items[0].hsn).toBe('2106');
  });

  it('uses configured pickup location nickname in create order payload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ order_id: 101, shipment_id: 202, status: 'NEW' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          awb_assign_status: 1, response: { data: { awb_code: 'AWB999', courier_name: 'TestCourier' } }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({
      email: 'test@example.com',
      password: 'secret',
      pickupLocation: 'Raghava Warehouse'
    });
    await adapter.createShipment({
      orderNumber: 'ORD-2026-00002',
      amountRupees: 100,
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 500,
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

    const createBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(createBody.pickup_location).toBe('Raghava Warehouse');
  });

  it('sends payment_method COD in Shiprocket payload for COD orders', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ order_id: 201, shipment_id: 301, status: 'NEW' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          awb_assign_status: 1,
          response: { data: { awb_code: 'AWB-COD-001', courier_name: 'CODCourier' } }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    await adapter.createShipment({
      orderNumber: 'ORD-2026-00002',
      amountRupees: 799,
      destinationPincode: '400001',
      originPincode: '110001',
      totalWeightGrams: 500,
      paymentMode: 'COD',
      sellerGstTin: '27ABCDE1234F1Z5',
      hsnCode: '6109',
      customer: {
        fullName: 'COD Customer',
        phone: '8888888888',
        line1: 'COD Street',
        city: 'Mumbai',
        state: 'Maharashtra'
      }
    });

    const createBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(createBody.payment_method).toBe('COD');
    expect(createBody.cod_amount).toBe('799.00');
    expect(createBody.sub_total).toBe('799.00');
  });

  it('sends order breakdown fields and normalizes phone/email in create payload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ order_id: 301, shipment_id: 401, status: 'NEW' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          awb_assign_status: 1, response: { data: { awb_code: 'AWB-BREAKDOWN', courier_name: 'TestCourier' } }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    await adapter.createShipment({
      orderNumber: 'ORD-2026-00004',
      amountRupees: 550,
      subtotalRupees: 500,
      shippingChargeRupees: 50,
      discountRupees: 0,
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 500,
      paymentMode: 'Prepaid',
      sellerGstTin: '29ABCDE1234F1Z5',
      hsnCode: '1001',
      items: [
        {
          name: 'Product',
          sku: 'SKU-1',
          quantity: 1,
          unitPriceRupees: 500
        }
      ],
      customer: {
        fullName: 'Test User',
        phone: '+91 9876543210',
        email: 'buyer@example.com',
        line1: 'Street 1',
        city: 'Bengaluru',
        state: 'Karnataka'
      }
    });

    const createBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(createBody.sub_total).toBe('500.00');
    expect(createBody.shipping_charges).toBe('50.00');
    expect(createBody.billing_phone).toBe('9876543210');
    expect(createBody.billing_email).toBe('buyer@example.com');
    expect(createBody.cod_amount).toBeUndefined();
  });

  it('aligns sub_total with discounted line totals', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ order_id: 401, shipment_id: 501, status: 'NEW' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          awb_assign_status: 1, response: { data: { awb_code: 'AWB-DISC', courier_name: 'TestCourier' } }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    await adapter.createShipment({
      orderNumber: 'ORD-2026-00005',
      amountRupees: 450,
      subtotalRupees: 999,
      shippingChargeRupees: 50,
      discountRupees: 100,
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 500,
      paymentMode: 'Prepaid',
      sellerGstTin: '29ABCDE1234F1Z5',
      hsnCode: '1001',
      items: [
        {
          name: 'Discounted item',
          sku: 'SKU-DISC',
          quantity: 2,
          unitPriceRupees: 200
        }
      ],
      customer: {
        fullName: 'Test User',
        phone: '9876543210',
        email: 'buyer@example.com',
        line1: 'Street 1',
        city: 'Bengaluru',
        state: 'Karnataka'
      }
    });

    const createBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(createBody.sub_total).toBe('400.00');
    expect(createBody.order_items[0].selling_price).toBe('200.00');
  });

  it('tracks shipment and maps activities', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          tracking_data: {
            shipment_status: 6,
            shipment_track_activities: [
              { date: '2026-04-25T10:00:00Z', status: 'Delivered', activity: 'Delivered to customer', location: 'Bengaluru' }
            ]
          }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    const result = await adapter.trackShipment('AWB123');

    expect(result.status).toBe('Delivered');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.status).toBe('Delivered');
    expect(result.events[0]?.location).toBe('Bengaluru');
  });

  it('checks serviceability and returns true when couriers exist', async () => {
    vi.stubEnv('SHIPROCKET_PICKUP_PINCODE', '110001');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: { available_courier_companies: [{ courier_company_id: 1, courier_name: 'Test', rate: 50 }] }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    const result = await adapter.checkServiceability('560001');

    expect(result.serviceable).toBe(true);
    expect(result.pincode).toBe('560001');
  });

  it('uses originPincode override instead of env for serviceability', async () => {
    vi.stubEnv('SHIPROCKET_PICKUP_PINCODE', '110001');
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: 'sr-token-123' })
    }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: { available_courier_companies: [{ courier_company_id: 1, courier_name: 'Test', rate: 50 }] }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    await adapter.checkServiceability('560001', '500001');

    const [svcUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(svcUrl).toContain('pickup_postcode=500001');
  });

  it('calculates delivery rate from cheapest courier', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            available_courier_companies: [
              { courier_company_id: 1, courier_name: 'Fast', rate: 100, estimated_delivery_days: 2 },
              { courier_company_id: 2, courier_name: 'Cheap', rate: 50, estimated_delivery_days: 4 }
            ]
          }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    const result = await adapter.calculateDeliveryRate({
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 1500
    });

    expect(result.shippingChargePaise).toBe(5000);
    expect(result.estimatedDays).toBe(4);
    expect(result.courierName).toBe('Cheap');
    expect(result.availableCouriers).toHaveLength(2);
  });

  it('filters out zero and null rate couriers before picking cheapest', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            available_courier_companies: [
              { courier_company_id: 1, courier_name: 'ZeroRate', rate: 0, estimated_delivery_days: 1 },
              { courier_company_id: 2, courier_name: 'NullRate', rate: null, estimated_delivery_days: 1 },
              { courier_company_id: 3, courier_name: 'ValidCourier', rate: 130, estimated_delivery_days: 3 }
            ]
          }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    const result = await adapter.calculateDeliveryRate({
      destinationPincode: '560001',
      originPincode: '110001',
      totalWeightGrams: 500
    });

    // Must pick ValidCourier (₹130), not ZeroRate or NullRate
    expect(result.shippingChargePaise).toBe(13000);
    expect(result.courierName).toBe('ValidCourier');
    expect(result.availableCouriers).toHaveLength(1); // Only valid courier
  });

  it('throws PINCODE_NOT_SERVICEABLE when all couriers have zero/null rates', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            available_courier_companies: [
              { courier_company_id: 1, courier_name: 'ZeroOnly', rate: 0, estimated_delivery_days: 1 },
              { courier_company_id: 2, courier_name: 'NullOnly', rate: null, estimated_delivery_days: 1 }
            ]
          }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    await expect(
      adapter.calculateDeliveryRate({
        destinationPincode: '999999',
        originPincode: '110001',
        totalWeightGrams: 500
      })
    ).rejects.toMatchObject({ code: 'PINCODE_NOT_SERVICEABLE' });
  });

  it('schedules pickup successfully', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 1,
          pickup_scheduled_date: '2026-05-06',
          pickup_token_number: 'PKP123'
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    const result = await adapter.schedulePickup('SHIP202');

    expect(result.scheduled).toBe(true);
    expect(result.pickupScheduledDate).toBe('2026-05-06');
    expect(result.pickupTokenNumber).toBe('PKP123');
    expect(result.alreadyScheduled).toBeUndefined();
  });

  it('treats "Already in Pickup Queue" (HTTP 400) as a successful, already-scheduled pickup', async () => {
    // When a warehouse pickup is already arranged, Shiprocket rejects further
    // pickup requests for the same shipment/warehouse. The shipment is covered,
    // so the operator must not see a failure when scheduling later same-day orders.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'Already in Pickup Queue.' })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    const result = await adapter.schedulePickup('SHIP202');

    expect(result.scheduled).toBe(true);
    expect(result.alreadyScheduled).toBe(true);
  });

  it('treats an existing pickup reported with HTTP 200 + message as already-scheduled', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 0, message: 'Pickup already scheduled' })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    const result = await adapter.schedulePickup('SHIP202');

    expect(result.scheduled).toBe(true);
    expect(result.alreadyScheduled).toBe(true);
  });

  it('still surfaces a genuine pickup failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({ message: 'Invalid shipment id' })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    await expect(adapter.schedulePickup('SHIP202')).rejects.toMatchObject({ statusCode: 422 });
  });

  it('generates label and returns URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'sr-token-123' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          label_url: 'https://label.example/abc.pdf'
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    const result = await adapter.generateLabel('SHIP202');

    expect(result.labelUrl).toBe('https://label.example/abc.pdf');
  });

  it('refreshes token on 401 and retries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'old-token' })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized'
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: 'new-token' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: { available_courier_companies: [{ courier_company_id: 1, courier_name: 'Test', rate: 50 }] }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    vi.stubEnv('SHIPROCKET_PICKUP_PINCODE', '110001');
    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    await adapter.checkServiceability('560001');

    // First call: auth, second: serviceability (401), third: re-auth, fourth: retry serviceability
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('throws when Shiprocket returns invalid JSON on success response', async () => {
    vi.stubEnv('SHIPROCKET_PICKUP_PINCODE', '110001');
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: 'sr-token-123' })
    }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'not-json'
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ShiprocketAdapter({ email: 'test@example.com', password: 'secret' });
    await expect(adapter.checkServiceability('560001')).rejects.toMatchObject({
      statusCode: 422,
      message: 'Shiprocket returned invalid JSON'
    });
  });
});
