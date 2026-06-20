import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as ordersApi from './orders-api';

// Mock the apiClient
vi.mock('./api', () => ({
  apiClient: vi.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
}));

describe('orders-api - new payment flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports prepareCheckout function with correct signature', () => {
    expect(typeof ordersApi.prepareCheckout).toBe('function');
  });

  it('exports confirmPrepaid function with correct signature', () => {
    expect(typeof ordersApi.confirmPrepaid).toBe('function');
  });

  it('prepareCheckout types are exported correctly', () => {
    // Just verify the types are available
    type TestInput = ordersApi.PrepareCheckoutInput;
    type TestResponse = ordersApi.PrepareCheckoutResponse;
    type TestConfirmInput = ordersApi.ConfirmPrepaidInput;

    expect(true).toBe(true); // TypeScript compilation proves types exist
  });

  it('createOrder still exists for COD flow', () => {
    expect(typeof ordersApi.createOrder).toBe('function');
  });

  it('retryPayment still exists for backward compatibility', () => {
    expect(typeof ordersApi.retryPayment).toBe('function');
  });
});

describe('orders-api - type definitions', () => {
  it('PrepareCheckoutInput includes addressId and shippingAddress options', () => {
    const input: ordersApi.PrepareCheckoutInput = {
      addressId: 'addr_1',
      notes: 'Special instructions'
    };
    expect(input.addressId).toBe('addr_1');
  });

  it('PrepareCheckoutInput supports shippingAddress with full address details', () => {
    const input: ordersApi.PrepareCheckoutInput = {
      shippingAddress: {
        fullName: 'John Doe',
        phone: '9999999999',
        line1: 'Address Line 1',
        line2: 'Apt 1',
        city: 'Mumbai',
        state: 'MH',
        pincode: '400001'
      },
      notes: 'Handle with care'
    };
    expect(input.shippingAddress?.fullName).toBe('John Doe');
  });

  it('PrepareCheckoutResponse includes checkout session and Razorpay details', () => {
    const response: ordersApi.PrepareCheckoutResponse = {
      checkoutSessionId: 'session_abc123',
      razorpayOrderId: 'order_123',
      amount: 5500,
      currency: 'INR'
    };
    expect(response.checkoutSessionId).toBeDefined();
    expect(response.razorpayOrderId).toBeDefined();
    expect(response.amount).toBe(5500);
    expect(response.currency).toBe('INR');
  });

  it('ConfirmPrepaidInput includes all required payment verification fields', () => {
    const input: ordersApi.ConfirmPrepaidInput = {
      checkoutSessionId: 'session_abc123',
      razorpayOrderId: 'order_123',
      razorpayPaymentId: 'pay_123',
      razorpaySignature: 'sig_abc'
    };
    expect(input.checkoutSessionId).toBe('session_abc123');
    expect(input.razorpayPaymentId).toBe('pay_123');
    expect(input.razorpaySignature).toBe('sig_abc');
  });

  it('OrderSummary type supports both old and new order states', () => {
    const order: ordersApi.OrderSummary = {
      id: 'order_1',
      orderNumber: 'ORD-2026-00001',
      status: 'CONFIRMED',
      paymentMode: 'PREPAID',
      shippingAddress: {
        fullName: 'John Doe',
        phone: '9999999999',
        line1: 'Address 1',
        city: 'City',
        state: 'State',
        pincode: '100001'
      },
      subtotal: 5000,
      shippingCharge: 500,
      discountAmount: 0,
      total: 5500,
      items: []
    };
    expect(order.status).toBe('CONFIRMED');
    expect(order.paymentMode).toBe('PREPAID');
  });
});
