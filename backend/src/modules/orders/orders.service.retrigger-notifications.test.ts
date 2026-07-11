import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

describe('OrdersService admin retrigger notification', () => {
  it('queues default EMAIL+SMS channels when channels omitted', async () => {
    const addNotification = vi.fn().mockResolvedValue(undefined);
    const fastify = {
      prisma: {
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'order_1',
            user: {
              email: 'customer@example.com',
              phone: '9999999999'
            }
          })
        }
      },
      queues: {
        notifications: {
          add: addNotification
        }
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);
    const result = await service.adminRetriggerNotification('order_1', {
      template: 'OrderConfirmed'
    });

    expect(addNotification).toHaveBeenCalledTimes(2);
    expect(addNotification).toHaveBeenNthCalledWith(
      1,
      'send-email',
      expect.objectContaining({
        to: 'customer@example.com',
        template: 'OrderConfirmed',
        data: { orderId: 'order_1' }
      }),
      // Resend appends a per-invocation token so it always delivers (never deduped
      // against an earlier automatic send of the same status template).
      expect.objectContaining({
        jobId: expect.stringMatching(/^notifications-email-order_1-OrderConfirmed-resend-/)
      })
    );
    expect(addNotification).toHaveBeenNthCalledWith(
      2,
      'send-sms',
      expect.objectContaining({
        phone: '9999999999',
        template: 'OrderConfirmed',
        data: { orderId: 'order_1' }
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^notifications-sms-order_1-OrderConfirmed-resend-/)
      })
    );
    expect(result).toEqual({
      orderId: 'order_1',
      template: 'OrderConfirmed',
      channels: ['EMAIL', 'SMS'],
      queuedJobs: 2
    });
  });

  it('rejects EMAIL channel when customer email is missing', async () => {
    const addNotification = vi.fn().mockResolvedValue(undefined);
    const fastify = {
      prisma: {
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'order_2',
            user: {
              email: null,
              phone: '9999999999'
            }
          })
        }
      },
      queues: {
        notifications: {
          add: addNotification
        }
      }
    } as unknown as FastifyInstance;

    const service = new OrdersService(fastify);

    await expect(
      service.adminRetriggerNotification('order_2', {
        template: 'OrderConfirmed',
        channels: ['EMAIL']
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(addNotification).not.toHaveBeenCalled();
  });
});
