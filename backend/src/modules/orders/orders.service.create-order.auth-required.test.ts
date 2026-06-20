import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OrdersService } from './orders.service';

const checkPincodeServiceabilityMock = vi.fn();
const getDeliveryRatesMock = vi.fn();

vi.mock('@modules/cart/cart.service', () => ({
  CartService: class CartService {
    checkPincodeServiceability = checkPincodeServiceabilityMock;
    getDeliveryRates = getDeliveryRatesMock;
  }
}));

describe('OrdersService createOrder auth requirement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated checkout attempts', async () => {
    const fastify = {
      prisma: {
        storeSettings: {
          findUnique: vi.fn()
        },
        $transaction: vi.fn()
      },
      log: {
        error: vi.fn()
      },
      queues: {
        analytics: { add: vi.fn() },
        shipping: { add: vi.fn() },
        orderProcessing: { add: vi.fn() },
        refunds: { add: vi.fn() },
        notifications: { add: vi.fn() }
      },
      redis: {
        set: vi.fn()
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    await expect(
      service.createOrder(undefined, {
        shippingAddress: {
          fullName: 'Guest User',
          phone: '9000000000',
          line1: 'Line 1',
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500001'
        }
      })
    ).rejects.toMatchObject({
      code: 'UNAUTHORISED',
      statusCode: 401
    });

    expect(checkPincodeServiceabilityMock).not.toHaveBeenCalled();
    expect(getDeliveryRatesMock).not.toHaveBeenCalled();
  });
});
