import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let failedHandler: ((job: unknown, error: Error) => void) | undefined;

const state = {
  processor: undefined as undefined | ((job: { name: string; data: unknown }) => Promise<void>),
  notificationsAdd: vi.fn(),
  createShipment: vi.fn(),
  cancelShipmentDelhivery: vi.fn(),
  cancelShipmentShiprocket: vi.fn(),
  trackShipmentDelhivery: vi.fn(),
  trackShipmentShiprocket: vi.fn(),
  // Top-level prisma shipment (used outside $transaction, e.g. cancel-shipment job)
  shipment: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn()
  },
  tx: {
    shipment: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn()
    },
    shipmentEvent: {
      create: vi.fn()
    },
    productVariant: {
      findMany: vi.fn()
    },
    storeSettings: {
      findUnique: vi.fn()
    },
    order: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    orderStatusHistory: {
      create: vi.fn()
    },
    payment: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
};

function MockWorker(_name: string, processor: (job: { name: string; data: unknown }) => Promise<void>) {
  state.processor = processor;
  return { on: (event: string, handler: (job: unknown, error: Error) => void) => { if (event === 'failed') failedHandler = handler; } };
}

function MockPrismaClient() {
  return {
    order: {
      findUnique: state.tx.order.findUnique
    },
    storeSettings: {
      findUnique: state.tx.storeSettings.findUnique
    },
    productVariant: {
      findMany: state.tx.productVariant.findMany
    },
    // Top-level shipment methods used outside $transaction (cancel-shipment, poll jobs)
    shipment: {
      findFirst: state.shipment.findFirst,
      findMany: state.shipment.findMany,
      updateMany: state.shipment.updateMany
    },
    $transaction<T>(fn: (tx: typeof state.tx) => Promise<T>) {
      return fn(state.tx);
    }
  };
}

function mockCreateShippingProvider() {
  return {
    createShipment: state.createShipment,
    trackShipment: vi.fn(),
    cancelShipment: vi.fn(),
    checkServiceability: vi.fn(),
    calculateDeliveryRate: vi.fn()
  };
}

// Per-provider adapter factory — returns distinct mocks keyed by provider name so
// tests can assert that the correct provider's methods were called.
function mockCreateShippingAdapterForProvider(providerKey: 'delhivery' | 'shiprocket') {
  if (providerKey === 'delhivery') {
    return {
      createShipment: state.createShipment,
      trackShipment: state.trackShipmentDelhivery,
      cancelShipment: state.cancelShipmentDelhivery,
      checkServiceability: vi.fn(),
      calculateDeliveryRate: vi.fn()
    };
  }
  return {
    createShipment: state.createShipment,
    trackShipment: state.trackShipmentShiprocket,
    cancelShipment: state.cancelShipmentShiprocket,
    checkServiceability: vi.fn(),
    calculateDeliveryRate: vi.fn()
  };
}

import { createShippingWorker } from './shipping.worker';
import { DEFAULT_SHIPPING_HSN_FALLBACK } from '@common/shipping/resolve-shipping-hsn';
import { featureFlags } from '../../src/config/feature-flags';

describe('shipping worker error and retry behavior', () => {
  let originalGstInvoicingFlag: boolean;
  const mockConnection = {} as Parameters<typeof createShippingWorker>[0];
  type NotificationsQueueArg = Parameters<typeof createShippingWorker>[1];
  type ShippingDeps = NonNullable<Parameters<typeof createShippingWorker>[2]>;
  type ShippingWorkerType = NonNullable<ShippingDeps['Worker']>;
  type ShippingPrismaType = NonNullable<ShippingDeps['PrismaClient']>;
  const mockNotificationsQueue = { add: state.notificationsAdd } as unknown as NotificationsQueueArg;
  const sendTechnicalFailureAlert = vi.fn().mockResolvedValue(undefined);

  const shippingDeps = {
    Worker: MockWorker as unknown as ShippingWorkerType,
    PrismaClient: MockPrismaClient as unknown as ShippingPrismaType,
    createShippingProvider: mockCreateShippingProvider,
    createShippingAdapterForProvider: mockCreateShippingAdapterForProvider,
    sendTechnicalFailureAlert
  };
  const boot = () =>
    createShippingWorker(mockConnection, mockNotificationsQueue, shippingDeps);

  beforeEach(() => {
    originalGstInvoicingFlag = featureFlags.gstInvoicing;
    featureFlags.gstInvoicing = true;
    failedHandler = undefined;
    sendTechnicalFailureAlert.mockReset();
    process.env.DELHIVERY_PICKUP_PINCODE = '500001';
    state.processor = undefined;
    state.createShipment.mockReset();
    state.cancelShipmentDelhivery.mockReset();
    state.cancelShipmentShiprocket.mockReset();
    state.trackShipmentDelhivery.mockReset();
    state.trackShipmentShiprocket.mockReset();
    state.shipment.findFirst.mockReset();
    state.shipment.findMany.mockReset();
    state.shipment.updateMany.mockReset();
    state.tx.shipment.findFirst.mockReset();
    state.tx.shipment.update.mockReset();
    state.tx.shipment.create.mockReset();
    state.tx.shipmentEvent.create.mockReset();
    state.tx.productVariant.findMany.mockReset();
    state.tx.storeSettings.findUnique.mockReset();
    state.tx.order.findUnique.mockReset();
    state.tx.order.update.mockReset();
    state.tx.orderStatusHistory.create.mockReset();
    state.tx.payment.findUnique.mockReset();
    state.tx.payment.update.mockReset();
    state.notificationsAdd.mockReset();
    state.tx.storeSettings.findUnique.mockResolvedValue({
      pickupPincode: '500001',
      contactEmail: 'admin@example.com',
      gstin: '29ABCDE1234F1Z5'
    });
  });

  afterEach(() => {
    featureFlags.gstInvoicing = originalGstInvoicingFlag;
  });

  it('creates shipment and marks order shipped for create-shipment job', async () => {
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      orderNumber: 'ORD-2026-00001',
      total: 1000,
      status: 'PROCESSING',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      payment: { status: 'CAPTURED' },
      shipment: null,
      items: [{ variantId: 'variant_1', quantity: 2, productName: 'Test Product', sku: 'SKU-1', unitPrice: 500 }]
    });
    state.tx.productVariant.findMany.mockResolvedValue([
      { id: 'variant_1', weight: 300, product: { attributes: { hsnCode: '1001' } } }
    ]);
    state.createShipment.mockResolvedValue({
      awbNumber: 'AWB123',
      trackingUrl: 'https://track.example/AWB123',
      providerPayload: { ok: true }
    });
    state.tx.shipment.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'create-shipment',
      data: { orderId: 'order_1' }
    });

    expect(state.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: 'ORD-2026-00001',
        paymentMode: 'Prepaid',
        sellerGstTin: '29ABCDE1234F1Z5',
        hsnCode: '1001',
        items: [
          expect.objectContaining({
            name: 'Test Product',
            sku: 'SKU-1',
            hsnCode: '1001'
          })
        ]
      })
    );
    expect(state.tx.shipment.create).toHaveBeenCalledTimes(1);
    expect(state.tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: { status: 'SHIPPED' }
    });
    // The booked weight must be the FULL sealed-parcel weight: items (2×300g) PLUS
    // the packaging (carton/tape/void-fill) weight. Booking items-only weight (600g
    // exactly) under-declares and gets re-billed a higher slab at the courier hub.
    const bookedInput = state.createShipment.mock.calls[0]?.[0] as { totalWeightGrams: number };
    expect(bookedInput.totalWeightGrams).toBeGreaterThan(600);
  });

  it('uses default shipping HSN when product attributes omit hsnCode and GST invoicing is disabled', async () => {
    featureFlags.gstInvoicing = false;
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_no_hsn',
      orderNumber: 'ORD-2026-00003',
      total: 1000,
      status: 'PROCESSING',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      payment: { status: 'CAPTURED' },
      shipment: null,
      items: [{ variantId: 'variant_1', quantity: 1, productName: 'test-product', sku: 'TEST-SKU', unitPrice: 1000 }]
    });
    state.tx.productVariant.findMany.mockResolvedValue([
      { id: 'variant_1', weight: 300, hsnCode: null, product: { attributes: {} } }
    ]);
    state.createShipment.mockResolvedValue({
      awbNumber: 'AWB456',
      trackingUrl: 'https://track.example/AWB456',
      providerPayload: { ok: true }
    });
    state.tx.shipment.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'create-shipment',
      data: { orderId: 'order_no_hsn' }
    });

    expect(state.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        hsnCode: DEFAULT_SHIPPING_HSN_FALLBACK,
        items: [
          expect.objectContaining({
            name: 'test-product',
            hsnCode: DEFAULT_SHIPPING_HSN_FALLBACK
          })
        ]
      })
    );
  });

  it('throws when shipping phone is not a valid 10-digit Indian number', async () => {
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_bad_phone',
      orderNumber: 'ORD-2026-00006',
      total: 1000,
      status: 'PROCESSING',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '12345',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      payment: { status: 'CAPTURED' },
      shipment: null,
      items: [{ variantId: 'variant_1', quantity: 1, productName: 'test-product', sku: 'TEST-SKU', unitPrice: 1000, totalPrice: 1000 }]
    });
    state.tx.productVariant.findMany.mockResolvedValue([
      { id: 'variant_1', weight: 300, hsnCode: '1001', product: { attributes: {} } }
    ]);

    await expect(
      state.processor?.({
        name: 'create-shipment',
        data: { orderId: 'order_bad_phone' }
      })
    ).rejects.toThrow('Invalid shipping phone for shipment booking');
    expect(state.createShipment).not.toHaveBeenCalled();
  });

  it('throws when GST invoicing is enabled and products omit explicit HSN codes', async () => {
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_no_hsn_gst',
      orderNumber: 'ORD-2026-00005',
      total: 1000,
      status: 'PROCESSING',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      payment: { status: 'CAPTURED' },
      shipment: null,
      items: [{ variantId: 'variant_1', quantity: 1, productName: 'test-product', sku: 'TEST-SKU', unitPrice: 1000 }]
    });
    state.tx.productVariant.findMany.mockResolvedValue([
      { id: 'variant_1', weight: 300, hsnCode: null, product: { attributes: {} } }
    ]);

    await expect(
      state.processor?.({
        name: 'create-shipment',
        data: { orderId: 'order_no_hsn_gst' }
      })
    ).rejects.toThrow('Missing product HSN code(s) for shipment booking');
    expect(state.createShipment).not.toHaveBeenCalled();
  });

  it('prefers variant hsnCode over product attributes when building shipment items', async () => {
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_variant_hsn',
      orderNumber: 'ORD-2026-00004',
      total: 1000,
      status: 'PROCESSING',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      payment: { status: 'CAPTURED' },
      shipment: null,
      items: [{ variantId: 'variant_1', quantity: 1, productName: 'Spice Mix', sku: 'SPICE-1', unitPrice: 1000 }]
    });
    state.tx.productVariant.findMany.mockResolvedValue([
      {
        id: 'variant_1',
        weight: 300,
        hsnCode: '3304',
        product: { attributes: { hsnCode: '1001' } }
      }
    ]);
    state.createShipment.mockResolvedValue({
      awbNumber: 'AWB3304',
      trackingUrl: 'https://track.example/AWB3304',
      providerPayload: { ok: true }
    });
    state.tx.shipment.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'create-shipment',
      data: { orderId: 'order_variant_hsn' }
    });

    expect(state.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        hsnCode: '3304',
        items: [expect.objectContaining({ hsnCode: '3304' })]
      })
    );
  });

  it('throws when creating shipment before payment capture', async () => {
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_2',
      orderNumber: 'ORD-2026-00002',
      total: 1000,
      status: 'PROCESSING',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      payment: { status: 'CREATED' },
      shipment: null,
      items: [{ variantId: 'variant_1', quantity: 1, productName: 'Test Product', sku: 'SKU-1', unitPrice: 500 }]
    });
    state.tx.productVariant.findMany.mockResolvedValue([
      { id: 'variant_1', weight: 300, product: { attributes: { hsnCode: '1001' } } }
    ]);

    await expect(
      state.processor?.({
        name: 'create-shipment',
        data: { orderId: 'order_2' }
      })
    ).rejects.toThrow('Shipment booking requires captured payment for prepaid orders');
    expect(state.createShipment).not.toHaveBeenCalled();
  });

  it('creates COD shipment without requiring CAPTURED payment', async () => {
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_cod',
      orderNumber: 'ORD-2026-00099',
      total: 50000,
      status: 'PROCESSING',
      paymentMode: 'COD',
      shippingAddress: {
        fullName: 'COD Buyer',
        phone: '8888888888',
        line1: 'COD Street',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600001'
      },
      payment: { status: 'CREATED' },
      shipment: null,
      items: [{ variantId: 'variant_1', quantity: 1, productName: 'Test Product', sku: 'SKU-1', unitPrice: 500 }]
    });
    state.tx.productVariant.findMany.mockResolvedValue([
      { id: 'variant_1', weight: 400, product: { attributes: { hsnCode: '6109' } } }
    ]);
    state.createShipment.mockResolvedValue({
      awbNumber: 'AWB-COD-123',
      trackingUrl: 'https://track.example/AWB-COD-123',
      providerPayload: { ok: true }
    });
    state.tx.shipment.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'create-shipment',
      data: { orderId: 'order_cod' }
    });

    expect(state.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMode: 'COD'
      })
    );
    expect(state.tx.shipment.create).toHaveBeenCalledTimes(1);
  });

  it('ignores create-shipment when order is missing', async () => {
    boot();
    state.tx.order.findUnique.mockResolvedValue(null);

    await state.processor?.({
      name: 'create-shipment',
      data: { orderId: 'missing-order' }
    });

    expect(state.createShipment).not.toHaveBeenCalled();
    expect(state.tx.shipment.create).not.toHaveBeenCalled();
    expect(state.tx.order.update).not.toHaveBeenCalled();
  });

  it('returns without changes when shipment is missing', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue(null);

    await state.processor?.({
      name: 'update-shipment-status',
      data: {
        awb: 'awb_1',
        status: 'In Transit',
        description: 'moving',
        location: 'Hub',
        occurredAt: new Date().toISOString(),
        payload: '{}'
      }
    });

    expect(state.tx.shipment.update).not.toHaveBeenCalled();
    expect(state.tx.shipmentEvent.create).not.toHaveBeenCalled();
  });

  it('resolves shipment by shiprocketShipmentId when awb is absent', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment_sr',
      awbNumber: 'AWB-SR-001',
      trackingUrl: 'https://track.example/AWB-SR-001',
      order: {
        id: 'order_sr',
        status: 'SHIPPED',
        user: {
          email: 'customer@example.com',
          phone: '9999999999'
        }
      }
    });
    state.tx.shipment.update.mockResolvedValue(undefined);
    state.tx.shipmentEvent.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'update-shipment-status',
      data: {
        awb: '',
        shiprocketShipmentId: '67890',
        status: 'IN TRANSIT',
        description: 'Moving',
        location: 'Hub',
        occurredAt: new Date().toISOString(),
        payload: '{}'
      }
    });

    expect(state.tx.shipment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ shiprocketShipmentId: '67890' }]
        }
      })
    );
    expect(state.tx.shipmentEvent.create).toHaveBeenCalled();
  });

  it('throws when shipment update fails so BullMQ can retry', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment_1',
      order: {
        id: 'order_1',
        status: 'SHIPPED',
        user: {
          email: 'test@example.com',
          phone: '9999999999'
        }
      }
    });
    state.tx.shipment.update.mockRejectedValue(new Error('temporary shipping db error'));

    await expect(
      state.processor?.({
        name: 'update-shipment-status',
        data: {
          awb: 'awb_1',
          status: 'In Transit',
          description: 'moving',
          location: 'Hub',
          occurredAt: new Date().toISOString(),
          payload: '{}'
        }
      })
    ).rejects.toThrow('temporary shipping db error');
  });

  it('updates shipment and order timeline for out-for-delivery webhook', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment_1',
      order: {
        id: 'order_1',
        status: 'SHIPPED',
        user: {
          email: 'customer@example.com',
          phone: '9999999999'
        }
      }
    });
    state.tx.shipment.update.mockResolvedValue(undefined);
    state.tx.shipmentEvent.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'update-shipment-status',
      data: {
        awb: 'awb_1',
        status: 'Out For Delivery',
        description: 'on route',
        location: 'Last mile hub',
        occurredAt: '2026-04-26T13:00:00.000Z',
        payload: '{"awb":"awb_1"}'
      }
    });

    expect(state.tx.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'OUT_FOR_DELIVERY'
        })
      })
    );
    expect(state.tx.shipmentEvent.create).toHaveBeenCalledTimes(1);
    expect(state.tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: { status: 'OUT_FOR_DELIVERY' }
    });
    expect(state.tx.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order_1',
          fromStatus: 'SHIPPED',
          toStatus: 'OUT_FOR_DELIVERY'
        })
      })
    );
    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'send-primary',
      expect.objectContaining({
        email: 'customer@example.com',
        phone: '9999999999',
        template: 'OutForDelivery'
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('shipping-primary-order_1-out-for-delivery')
      })
    );
  });

  it('accepts legacy shipment-webhook job name for backward compatibility', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment_1',
      order: {
        id: 'order_1',
        status: 'SHIPPED',
        user: {
          email: 'customer@example.com',
          phone: '9999999999'
        }
      }
    });
    state.tx.shipment.update.mockResolvedValue(undefined);
    state.tx.shipmentEvent.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'shipment-webhook',
      data: {
        awb: 'awb_legacy',
        status: 'In Transit',
        description: 'legacy payload',
        location: 'Hub',
        occurredAt: '2026-04-26T13:00:00.000Z',
        payload: '{"awb":"awb_legacy"}'
      }
    });

    expect(state.tx.shipment.update).toHaveBeenCalledTimes(1);
    expect(state.tx.shipmentEvent.create).toHaveBeenCalledTimes(1);
  });

  it('does not coerce unknown shipment statuses to in_transit', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment_1',
      order: {
        id: 'order_1',
        status: 'SHIPPED',
        user: {
          email: 'customer@example.com',
          phone: '9999999999'
        }
      }
    });
    state.tx.shipment.update.mockResolvedValue(undefined);
    state.tx.shipmentEvent.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'update-shipment-status',
      data: {
        awb: 'awb_legacy',
        status: 'UNKNOWN_VENDOR_STATE',
        description: 'legacy payload',
        location: 'Hub',
        occurredAt: '2026-04-26T13:00:00.000Z',
        payload: '{"awb":"awb_legacy"}'
      }
    });

    expect(state.tx.shipment.update).toHaveBeenCalledWith({
      where: { id: 'shipment_1' },
      data: {
        webhookPayload: expect.objectContaining({
          awb: 'awb_legacy',
          status: 'UNKNOWN_VENDOR_STATE',
          occurredAt: '2026-04-26T13:00:00.000Z'
        })
      }
    });
    expect(state.tx.order.update).not.toHaveBeenCalled();
    expect(state.notificationsAdd).not.toHaveBeenCalled();
  });

  it('enqueues delivered primary notification', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment_1',
      order: {
        id: 'order_1',
        status: 'OUT_FOR_DELIVERY',
        user: {
          email: 'customer@example.com',
          phone: '9999999999'
        }
      }
    });
    state.tx.shipment.update.mockResolvedValue(undefined);
    state.tx.shipmentEvent.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'update-shipment-status',
      data: {
        awb: 'awb_1',
        status: 'Delivered',
        description: 'delivered',
        location: 'Customer doorstep',
        occurredAt: '2026-04-26T13:00:00.000Z',
        payload: '{"awb":"awb_1"}'
      }
    });

    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'send-primary',
      expect.objectContaining({
        email: 'customer@example.com',
        phone: '9999999999',
        template: 'OrderDelivered'
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('shipping-primary-order_1-delivered')
      })
    );
  });

  it('enqueues failed-delivery primary notification', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment_1',
      order: {
        id: 'order_1',
        status: 'OUT_FOR_DELIVERY',
        user: {
          email: 'customer@example.com',
          phone: '9999999999'
        }
      }
    });
    state.tx.shipment.update.mockResolvedValue(undefined);
    state.tx.shipmentEvent.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'update-shipment-status',
      data: {
        awb: 'awb_1',
        status: 'FAILED_DELIVERY',
        description: 'delivery attempt failed',
        location: 'Customer address',
        occurredAt: '2026-04-26T13:00:00.000Z',
        payload: '{"awb":"awb_1"}'
      }
    });

    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'send-primary',
      expect.objectContaining({
        email: 'customer@example.com',
        phone: '9999999999',
        template: 'FailedDelivery'
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('shipping-primary-order_1-failed-delivery')
      })
    );
  });

  it('auto-captures COD payment when DELIVERED webhook fires', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment_1',
      order: {
        id: 'order_1',
        status: 'OUT_FOR_DELIVERY',
        paymentMode: 'COD',
        payment: { status: 'CREATED', capturedAt: null },
        user: {
          email: 'cod-customer@example.com',
          phone: '7777777777'
        }
      }
    });
    state.tx.shipment.update.mockResolvedValue(undefined);
    state.tx.shipmentEvent.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);
    state.tx.payment.update.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'update-shipment-status',
      data: {
        awb: 'awb_cod_1',
        status: 'Delivered',
        description: 'Delivered to customer',
        location: 'Customer doorstep',
        occurredAt: '2026-04-26T15:00:00.000Z',
        payload: '{"awb":"awb_cod_1"}'
      }
    });

    expect(state.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'order_1' },
        data: expect.objectContaining({ status: 'CAPTURED' })
      })
    );
    expect(state.tx.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggeredBy: 'SHIPPING_WEBHOOK',
          note: expect.stringContaining('COD payment marked as collected')
        })
      })
    );
  });

  it('skips COD auto-capture if payment already CAPTURED', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment_1',
      order: {
        id: 'order_1',
        status: 'OUT_FOR_DELIVERY',
        paymentMode: 'COD',
        payment: { status: 'CAPTURED', capturedAt: new Date() },
        user: { email: null, phone: null }
      }
    });
    state.tx.shipment.update.mockResolvedValue(undefined);
    state.tx.shipmentEvent.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'update-shipment-status',
      data: {
        awb: 'awb_cod_2',
        status: 'Delivered',
        description: 'Already captured',
        location: null,
        occurredAt: '2026-04-26T16:00:00.000Z',
        payload: '{"awb":"awb_cod_2"}'
      }
    });

    expect(state.tx.payment.update).not.toHaveBeenCalled();
  });

  it('does not auto-capture payment for PREPAID DELIVERED orders', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment_1',
      order: {
        id: 'order_1',
        status: 'OUT_FOR_DELIVERY',
        paymentMode: 'PREPAID',
        payment: { status: 'CAPTURED', capturedAt: new Date() },
        user: { email: null, phone: null }
      }
    });
    state.tx.shipment.update.mockResolvedValue(undefined);
    state.tx.shipmentEvent.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'update-shipment-status',
      data: {
        awb: 'awb_prepaid_1',
        status: 'Delivered',
        description: 'Delivered',
        location: null,
        occurredAt: '2026-04-26T17:00:00.000Z',
        payload: '{"awb":"awb_prepaid_1"}'
      }
    });

    expect(state.tx.payment.update).not.toHaveBeenCalled();
  });

  it('enqueues admin email notification for RTO initiated', async () => {
    boot();
    state.tx.shipment.findFirst.mockResolvedValue({
      id: 'shipment_1',
      order: {
        id: 'order_1',
        status: 'OUT_FOR_DELIVERY',
        user: {
          email: 'customer@example.com',
          phone: '9999999999'
        }
      }
    });
    state.tx.shipment.update.mockResolvedValue(undefined);
    state.tx.shipmentEvent.create.mockResolvedValue(undefined);
    state.tx.order.update.mockResolvedValue(undefined);
    state.tx.orderStatusHistory.create.mockResolvedValue(undefined);
    state.tx.storeSettings.findUnique.mockResolvedValue({
      contactEmail: 'admin@example.com'
    });

    await state.processor?.({
      name: 'update-shipment-status',
      data: {
        awb: 'awb_1',
        status: 'RTO_INITIATED',
        description: 'return to origin started',
        location: 'Hub',
        occurredAt: '2026-04-26T13:00:00.000Z',
        payload: '{"awb":"awb_1"}'
      }
    });

    expect(state.notificationsAdd).toHaveBeenCalledWith(
      'send-primary',
      expect.objectContaining({
        email: 'admin@example.com',
        template: 'OrderCancelled'
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('shipping-primary-order_1-rto-initiated')
      })
    );
  });

  it('sends terminal failure alert when shipping job exhausts all attempts', () => {
    boot();

    const terminalJob = { name: 'create-shipment', id: 'job_s1', opts: { attempts: 3 }, attemptsMade: 3 };
    failedHandler?.(terminalJob, new Error('provider unreachable'));

    expect(sendTechnicalFailureAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: 'shipping',
        jobName: 'create-shipment',
        jobId: 'job_s1',
        terminalFailure: true,
        errorMessage: 'provider unreachable'
      })
    );
  });

  it('does NOT send alert when shipping job still has remaining attempts', () => {
    boot();

    const retryJob = { name: 'create-shipment', id: 'job_s2', opts: { attempts: 3 }, attemptsMade: 1 };
    failedHandler?.(retryJob, new Error('transient error'));

    expect(sendTechnicalFailureAlert).not.toHaveBeenCalled();
  });

  // ── Dual-shipping provider routing ──────────────────────────────────────────

  it('cancel-shipment routes to Delhivery adapter when shipment.provider is DELHIVERY', async () => {
    boot();
    state.shipment.findFirst.mockResolvedValue({ provider: 'DELHIVERY' });
    state.shipment.updateMany.mockResolvedValue({ count: 1 });
    state.cancelShipmentDelhivery.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'cancel-shipment',
      data: { orderId: 'order_del', awbNumber: 'DEL-AWB-001' }
    });

    expect(state.cancelShipmentDelhivery).toHaveBeenCalledWith('DEL-AWB-001');
    expect(state.cancelShipmentShiprocket).not.toHaveBeenCalled();
    expect(state.shipment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderId: 'order_del', awbNumber: 'DEL-AWB-001' }),
        data: { status: 'CANCELLED' }
      })
    );
  });

  it('cancel-shipment routes to Shiprocket adapter and cancels by Shiprocket ORDER id', async () => {
    // Shiprocket /orders/cancel keys off the order id (stored on the Order), not
    // the AWB or shipment id — otherwise the cancel never reflects in their dashboard.
    boot();
    state.shipment.findFirst.mockResolvedValue({
      provider: 'SHIPROCKET',
      shiprocketShipmentId: '67890',
      awbNumber: 'SR-AWB-002',
      order: { shiprocketOrderId: '123456' }
    });
    state.shipment.updateMany.mockResolvedValue({ count: 1 });
    state.cancelShipmentShiprocket.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'cancel-shipment',
      data: { orderId: 'order_sr', awbNumber: 'SR-AWB-002' }
    });

    expect(state.cancelShipmentShiprocket).toHaveBeenCalledWith('123456');
    expect(state.cancelShipmentDelhivery).not.toHaveBeenCalled();
  });

  it('cancel-shipment falls back to shipment id / AWB when no Shiprocket order id is stored', async () => {
    boot();
    state.shipment.findFirst.mockResolvedValue({
      provider: 'SHIPROCKET',
      shiprocketShipmentId: '67890',
      awbNumber: 'SR-AWB-002',
      order: { shiprocketOrderId: null }
    });
    state.shipment.updateMany.mockResolvedValue({ count: 1 });
    state.cancelShipmentShiprocket.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'cancel-shipment',
      data: { orderId: 'order_sr', awbNumber: 'SR-AWB-002' }
    });

    expect(state.cancelShipmentShiprocket).toHaveBeenCalledWith('67890');
  });

  it('create-shipment compensating cancel uses the same adapter that created the AWB', async () => {
    // Simulate: order gets cancelled mid-flight after AWB was created by Delhivery.
    // The compensating cancel must use the Delhivery adapter, not the global one.
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_comp',
      orderNumber: 'ORD-COMP-001',
      total: 1000,
      status: 'PROCESSING',
      selectedShippingProvider: 'DELHIVERY',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      payment: { status: 'CAPTURED' },
      shipment: null,
      items: [{ variantId: 'v1', quantity: 1, productName: 'Spice', sku: 'S1', unitPrice: 1000 }]
    });
    state.tx.productVariant.findMany.mockResolvedValue([
      { id: 'v1', weight: 300, hsnCode: '1001', product: { attributes: { hsnCode: '1001' } } }
    ]);
    state.createShipment.mockResolvedValue({
      awbNumber: 'DEL-COMP-AWB',
      trackingUrl: 'https://track.del/DEL-COMP-AWB',
      providerPayload: {}
    });
    // Simulate order already cancelled when Phase 3 transaction runs
    state.tx.shipment.findFirst.mockResolvedValue({
      id: null,
      awbNumber: null
    });
    const freshOrderDelegate = state.tx.order as unknown as { findUnique: ReturnType<typeof vi.fn> };
    freshOrderDelegate.findUnique
      .mockResolvedValueOnce({
        id: 'order_comp',
        orderNumber: 'ORD-COMP-001',
        total: 1000,
        status: 'PROCESSING',
        selectedShippingProvider: 'DELHIVERY',
        shippingAddress: {
          fullName: 'Test Customer',
          phone: '9999999999',
          line1: 'Street 1',
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500001'
        },
        payment: { status: 'CAPTURED' },
        shipment: null,
        items: [{ variantId: 'v1', quantity: 1, productName: 'Spice', sku: 'S1', unitPrice: 1000 }]
      })
      // Phase 3 re-read returns CANCELLED — triggers compensating cancel path
      .mockResolvedValueOnce({
        id: 'order_comp',
        status: 'CANCELLED',
        shipment: null
      });
    state.cancelShipmentDelhivery.mockResolvedValue(undefined);

    await state.processor?.({
      name: 'create-shipment',
      data: { orderId: 'order_comp' }
    });

    // Compensating cancel must use Delhivery (the provider that created the AWB)
    expect(state.cancelShipmentDelhivery).toHaveBeenCalledWith('DEL-COMP-AWB');
    expect(state.cancelShipmentShiprocket).not.toHaveBeenCalled();
    // Order must not be marked SHIPPED
    expect(state.tx.order.update).not.toHaveBeenCalled();
  });

  it('throws when order is locked to DELHIVERY but Delhivery adapter is unavailable', async () => {
    // Rate-lock enforcement: if Delhivery was selected at checkout but adapter is not configured,
    // the worker must throw — never silently fall back to a different provider.
    const adapterFactoryReturningNull = (_key: 'delhivery' | 'shiprocket') => null;
    const depsWithNullDelhivery = {
      ...shippingDeps,
      createShippingAdapterForProvider: adapterFactoryReturningNull
    };
    createShippingWorker(mockConnection, mockNotificationsQueue, depsWithNullDelhivery);

    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_locked_del',
      orderNumber: 'ORD-LOCK-DEL-001',
      total: 13000,
      status: 'PROCESSING',
      selectedShippingProvider: 'DELHIVERY',
      paymentMode: 'PREPAID',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      payment: { status: 'CAPTURED' },
      shipment: null,
      items: [{ variantId: 'v1', quantity: 1, productName: 'Spice', sku: 'S1', unitPrice: 13000 }]
    });
    state.tx.productVariant.findMany.mockResolvedValue([
      { id: 'v1', weight: 300, hsnCode: '0910', product: { attributes: {} } }
    ]);

    await expect(
      state.processor?.({ name: 'create-shipment', data: { orderId: 'order_locked_del' } })
    ).rejects.toThrow(/DELHIVERY.*not configured/);

    // Must never create a shipment via any provider
    expect(state.createShipment).not.toHaveBeenCalled();
  });

  it('throws when order is locked to SHIPROCKET but Shiprocket adapter is unavailable', async () => {
    // Rate-lock enforcement: if Shiprocket was selected at checkout but adapter is not configured,
    // the worker must throw — never silently fall back to a different provider.
    const adapterFactoryReturningNull = (_key: 'delhivery' | 'shiprocket') => null;
    const depsWithNullShiprocket = {
      ...shippingDeps,
      createShippingAdapterForProvider: adapterFactoryReturningNull
    };
    createShippingWorker(mockConnection, mockNotificationsQueue, depsWithNullShiprocket);

    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_locked_spr',
      orderNumber: 'ORD-LOCK-SPR-001',
      total: 48000,
      status: 'PROCESSING',
      selectedShippingProvider: 'SHIPROCKET',
      paymentMode: 'PREPAID',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9999999999',
        line1: 'Street 1',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      payment: { status: 'CAPTURED' },
      shipment: null,
      items: [{ variantId: 'v1', quantity: 1, productName: 'Oil', sku: 'O1', unitPrice: 48000 }]
    });
    state.tx.productVariant.findMany.mockResolvedValue([
      { id: 'v1', weight: 1000, hsnCode: '1515', product: { attributes: {} } }
    ]);

    await expect(
      state.processor?.({ name: 'create-shipment', data: { orderId: 'order_locked_spr' } })
    ).rejects.toThrow(/SHIPROCKET.*not configured/);

    // Must never create a shipment via any provider
    expect(state.createShipment).not.toHaveBeenCalled();
  });

  it('uses legacy global provider for orders with no selectedShippingProvider', async () => {
    // Backward compat: orders created before rate-lock was implemented have null
    // selectedShippingProvider and must continue to use the global env-var provider.
    boot();
    state.tx.order.findUnique.mockResolvedValue({
      id: 'order_legacy',
      orderNumber: 'ORD-LEGACY-001',
      total: 5000,
      status: 'PROCESSING',
      selectedShippingProvider: null,
      paymentMode: 'PREPAID',
      shippingAddress: {
        fullName: 'Legacy Customer',
        phone: '8888888888',
        line1: 'Old Street',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001'
      },
      payment: { status: 'CAPTURED' },
      shipment: null,
      items: [{ variantId: 'v1', quantity: 1, productName: 'Legacy Product', sku: 'LP1', unitPrice: 5000 }]
    });
    state.tx.productVariant.findMany.mockResolvedValue([
      { id: 'v1', weight: 200, hsnCode: '0910', product: { attributes: {} } }
    ]);
    state.createShipment.mockResolvedValue({
      awbNumber: 'LEGACY-AWB',
      trackingUrl: 'https://track/LEGACY-AWB',
      providerPayload: {}
    });
    state.tx.shipment.findFirst.mockResolvedValue(null);
    state.tx.shipment.create.mockResolvedValue({ id: 'ship_legacy', awbNumber: 'LEGACY-AWB' });
    state.tx.order.findUnique
      .mockResolvedValueOnce({
        id: 'order_legacy',
        orderNumber: 'ORD-LEGACY-001',
        total: 5000,
        status: 'PROCESSING',
        selectedShippingProvider: null,
        paymentMode: 'PREPAID',
        shippingAddress: {
          fullName: 'Legacy Customer',
          phone: '8888888888',
          line1: 'Old Street',
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500001'
        },
        payment: { status: 'CAPTURED' },
        shipment: null,
        items: [{ variantId: 'v1', quantity: 1, productName: 'Legacy Product', sku: 'LP1', unitPrice: 5000 }]
      })
      .mockResolvedValueOnce({ id: 'order_legacy', status: 'PROCESSING', shipment: null });

    await state.processor?.({ name: 'create-shipment', data: { orderId: 'order_legacy' } });

    // Global provider's createShipment was called (backward compat path)
    expect(state.createShipment).toHaveBeenCalledTimes(1);
  });
});

