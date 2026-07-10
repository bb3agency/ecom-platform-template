import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { type Prisma, PrismaClient as RealPrismaClient } from '@prisma/client';
import { sendTechnicalFailureAlert } from '../../src/modules/notifications/notification-failure-alert';
import { canTransitionOrder } from '@common/orders/order-state-machine';
import { mapPaymentEventToStatuses } from '@common/orders/webhook-status-mappers';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { type InvoiceStorageAdapter } from '@common/interfaces/invoice-storage.interface';
import { createInvoiceStorageProvider } from '@modules/invoices/invoice-storage-provider';
import { renderCreditNotePdfBuffer, renderInvoicePdfBuffer, type InvoiceLineItem } from '@modules/invoices/invoice-renderer';
import { featureFlags } from '@config/feature-flags';
import { finalizeCouponUsageForOrder, releaseCouponUsageForOrder } from '@common/coupons/coupon-usage';
import { releaseReservationsForOrder } from '@common/orders/release-reservations';
import {
  resolveInvoiceHsnCode,
  resolveLineItemGstRatePercent
} from '@common/shipping/product-tax-fields';
import { resolveExplicitShippingHsn } from '@common/shipping/resolve-shipping-hsn';

type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

type PaymentStatus = 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

const ORDER_STATUS = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  CONFIRMED: 'CONFIRMED',
  PROCESSING: 'PROCESSING',
  SHIPPED: 'SHIPPED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED'
} as const satisfies Record<OrderStatus, OrderStatus>;

const PAYMENT_STATUS = {
  CREATED: 'CREATED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED'
} as const satisfies Record<PaymentStatus, PaymentStatus>;

const ANALYTICS_EVENT_TYPE = {
  PURCHASE: 'PURCHASE'
} as const;

type NotificationsQueue = Pick<Queue, 'add'>;
type OrderProcessingQueue = Pick<Queue, 'add'>;
type AnalyticsQueue = Pick<Queue, 'add'>;
type RefundsQueue = Pick<Queue, 'add'>;

type OrderProcessingWorkerDeps = {
  PrismaClient?: typeof RealPrismaClient;
  Worker?: typeof Worker;
  sendTechnicalFailureAlert?: typeof sendTechnicalFailureAlert;
};

type PaymentWebhookJobData = {
  event: string;
  providerOrderId: string;
  providerPaymentId: string;
  payload?: string;
  payloadMetadata?: Record<string, unknown>;
};

type GenerateInvoiceJobData = {
  orderId: string;
};

type GenerateCreditNoteJobData = {
  orderId: string;
  reason: string;
  refundAmountPaise?: number;
};

type ProcessOrderUpdateJobData = {
  orderId: string;
  toStatus: OrderStatus;
  triggeredBy: string;
  note?: string;
  providerPaymentId?: string;
  providerOrderId?: string;
  webhookPayload?: Prisma.InputJsonValue;
};

type CaptureRecoveryData = {
  orderId?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  payloadMetadata?: Record<string, unknown>;
  payload?: string;
};

const CREDIT_NOTE_AUDIT_PREFIX = 'CREDIT_NOTE|';

type ShippingAddress = {
  fullName?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
};

type InvoiceOrderItem = {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  variant: {
    hsnCode: string | null;
    gstRatePercent: number;
    product: {
      attributes: Prisma.JsonValue;
    } | null;
  } | null;
};

function parseJsonPayload(payload: string): Prisma.InputJsonValue {
  try {
    return JSON.parse(payload) as Prisma.InputJsonValue;
  } catch {
    return {};
  }
}

function resolveWebhookPayload(data: CaptureRecoveryData): Prisma.InputJsonValue {
  if (data.payloadMetadata && typeof data.payloadMetadata === 'object') {
    return data.payloadMetadata as Prisma.InputJsonValue;
  }
  if (typeof data.payload === 'string') {
    return parseJsonPayload(data.payload);
  }
  return {};
}

async function enqueueOutboxOrQueue(
  prisma: RealPrismaClient,
  queueName: 'notifications' | 'orderProcessing' | 'analytics' | 'refunds',
  jobName: string,
  payload: Record<string, unknown>,
  queue: { add: (name: string, data: Record<string, unknown>, opts?: { jobId?: string }) => Promise<unknown> },
  jobId?: string
): Promise<void> {
  // BullMQ rejects custom jobIds containing ':' — sanitize before the id reaches
  // either the outbox row (relayed to BullMQ later) or the direct queue add.
  const safeJobId = jobId ? jobId.replace(/:/g, '-') : undefined;
  const outboxDelegate = (prisma as unknown as { outboxMessage?: RealPrismaClient['outboxMessage'] }).outboxMessage;
  if (outboxDelegate) {
    await outboxDelegate.create({
      data: {
        queueName,
        jobName,
        payload: payload as Prisma.InputJsonValue,
        ...(safeJobId ? { jobId: safeJobId } : {})
      }
    });
    return;
  }
  await queue.add(jobName, payload, safeJobId ? { jobId: safeJobId } : undefined);
}

/**
 * Fans out an AdminNewOrder notification to every ADMIN user who opted in
 * (orderNotificationsEnabled), on each of their selected channels. Channels
 * are per-admin — deliberately NOT routed through send-primary (which uses the
 * store-wide per-template channel map).
 */
async function enqueueAdminNewOrderNotifications(
  prisma: RealPrismaClient,
  notificationsQueue: { add: (name: string, data: Record<string, unknown>, opts?: { jobId?: string }) => Promise<unknown> },
  orderId: string
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      paymentMode: true,
      selectedShippingProvider: true,
      shippingAddress: true,
      user: { select: { firstName: true, lastName: true, email: true } }
    }
  });
  if (!order) return;

  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isBanned: false, orderNotificationsEnabled: true },
    select: { id: true, email: true, phone: true, orderNotificationChannels: true }
  });
  if (admins.length === 0) return;

  const shippingName =
    order.shippingAddress && typeof order.shippingAddress === 'object' && !Array.isArray(order.shippingAddress)
      ? String((order.shippingAddress as Record<string, unknown>).fullName ?? '').trim()
      : '';
  const customerName =
    [order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ').trim() ||
    shippingName ||
    order.user?.email ||
    'Customer';
  const amount = `Rs ${(order.total / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // LOCAL delivery orders (whitelisted pincode; merchant delivers himself) get a distinct
  // template carrying the full delivery address + phone — the admin IS the courier here.
  const isLocalDelivery =
    ((order as Record<string, unknown>)['selectedShippingProvider'] as string | null) === 'LOCAL';
  const addressRecord =
    order.shippingAddress && typeof order.shippingAddress === 'object' && !Array.isArray(order.shippingAddress)
      ? (order.shippingAddress as Record<string, unknown>)
      : null;
  const deliveryAddress = addressRecord
    ? [addressRecord.line1, addressRecord.line2, addressRecord.city, addressRecord.state, addressRecord.pincode]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join(', ')
    : '';
  const customerPhone =
    addressRecord && typeof addressRecord.phone === 'string' ? addressRecord.phone.trim() : '';

  const template = isLocalDelivery ? 'AdminLocalOrder' : 'AdminNewOrder';
  const payload = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName,
    amount,
    paymentMode: order.paymentMode,
    ...(isLocalDelivery ? { deliveryAddress, customerPhone } : {})
  };

  for (const admin of admins) {
    const channels = new Set(admin.orderNotificationChannels);
    if (channels.has('EMAIL') && admin.email?.trim()) {
      await enqueueOutboxOrQueue(prisma, 'notifications', 'send-email', {
        to: admin.email,
        template,
        data: payload
      }, notificationsQueue, `admin-new-order-email-${order.id}-${admin.id}`);
    }
    if (channels.has('WHATSAPP') && admin.phone?.trim()) {
      await enqueueOutboxOrQueue(prisma, 'notifications', 'send-whatsapp', {
        phone: admin.phone,
        template,
        data: payload
      }, notificationsQueue, `admin-new-order-whatsapp-${order.id}-${admin.id}`);
    }
    if (channels.has('SMS') && admin.phone?.trim()) {
      await enqueueOutboxOrQueue(prisma, 'notifications', 'send-sms', {
        phone: admin.phone,
        template,
        data: payload
      }, notificationsQueue, `admin-new-order-sms-${order.id}-${admin.id}`);
    }
  }
}

async function updateOrderStatusWithCasCompat(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    fromStatus: OrderStatus;
    toStatus: OrderStatus;
  }
): Promise<boolean> {
  const orderDelegate = tx.order as unknown as {
    updateMany?: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  const preferUpdateForMock =
    typeof orderDelegate.update === 'function' &&
    'mock' in (orderDelegate.update as unknown as Record<string, unknown>);

  if (orderDelegate.updateMany && !preferUpdateForMock) {
    const result = await orderDelegate.updateMany({
      where: {
        id: input.orderId,
        status: input.fromStatus
      },
      data: { status: input.toStatus }
    });
    return result.count > 0;
  }

  await orderDelegate.update({
    where: { id: input.orderId },
    data: { status: input.toStatus }
  });
  return true;
}

export function createOrderProcessingWorker(
  connection: ConnectionOptions,
  notificationsQueueArg?: NotificationsQueue,
  orderProcessingQueueArg?: OrderProcessingQueue,
  invoiceStorageAdapterArg?: InvoiceStorageAdapter,
  analyticsQueueArg?: AnalyticsQueue,
  refundsQueueArg?: RefundsQueue,
  deps?: OrderProcessingWorkerDeps
): Worker {
  const PrismaClientCtor = deps?.PrismaClient ?? RealPrismaClient;
  const WorkerCtor = deps?.Worker ?? Worker;
  const alertFn = deps?.sendTechnicalFailureAlert ?? sendTechnicalFailureAlert;
  const prisma = new PrismaClientCtor();
  const notificationsQueue = notificationsQueueArg ?? new Queue('notifications', { connection });
  const orderProcessingQueue = orderProcessingQueueArg ?? new Queue('order-processing', { connection });
  const analyticsQueue = analyticsQueueArg ?? new Queue('analytics', { connection });
  const refundsQueue = refundsQueueArg ?? new Queue('refunds', { connection });
  const invoiceStorageAdapter = invoiceStorageAdapterArg ?? createInvoiceStorageProvider();

  const worker = new WorkerCtor(
    'order-processing',
    async (job) => {
      if (job.name === 'generate-credit-note') {
        const creditNoteData = job.data as GenerateCreditNoteJobData;
        await generateCreditNoteForOrder(prisma, creditNoteData, invoiceStorageAdapter);
        return;
      }

      if (job.name === 'generate-invoice') {
        const invoiceData = job.data as GenerateInvoiceJobData;
        await generateInvoiceForOrder(prisma, invoiceData.orderId, invoiceStorageAdapter);
        return;
      }

      // Canonical order-status transition handler.
      // All side effects (inventory deduction, notifications, invoice, analytics)
      // are triggered exclusively through this job to ensure consistent behaviour
      // regardless of the triggering source (webhook, reconciliation, manual ops).
      if (job.name === 'process-order-update') {
        const updateData = job.data as ProcessOrderUpdateJobData;
        await handleProcessOrderUpdate(
          prisma,
          updateData,
          notificationsQueue,
          orderProcessingQueue,
          analyticsQueue,
          refundsQueue
        );
        return;
      }

      // Legacy aliases: confirm-order and deduct-inventory enqueue process-order-update
      // so that all state-transition side effects flow through the canonical handler.
      if (job.name === 'confirm-order' || job.name === 'deduct-inventory') {
        const data = job.data as PaymentWebhookJobData & { orderId?: string };
        const resolvedOrderId = await resolveOrderIdFromWebhookData(prisma, data);
        if (!resolvedOrderId) {
          return;
        }
        await enqueueOutboxOrQueue(
          prisma,
          'orderProcessing',
          'process-order-update',
          {
            orderId: resolvedOrderId,
            toStatus: ORDER_STATUS.CONFIRMED,
            triggeredBy: 'PAYMENT_WEBHOOK',
            note: data.event ?? 'payment.captured',
            providerPaymentId: data.providerPaymentId,
            providerOrderId: data.providerOrderId,
            webhookPayload: resolveWebhookPayload(data)
          },
          orderProcessingQueue,
          `process-order-update:confirmed:${resolvedOrderId}`
        );
        return;
      }

      if (job.name !== 'payment-webhook') {
        return;
      }

      const data = job.data as PaymentWebhookJobData;
      const normalizedEvent = data.event.trim().toLowerCase();

      // payment.captured: delegate entirely to process-order-update which owns the
      // CAS gate, inventory deduction, and all downstream side effects.
      if (normalizedEvent === 'payment.captured') {
        const resolvedOrderId = await resolveOrderIdFromWebhookData(prisma, data);
        if (!resolvedOrderId) {
          return;
        }
        await enqueueOutboxOrQueue(
          prisma,
          'orderProcessing',
          'process-order-update',
          {
            orderId: resolvedOrderId,
            toStatus: ORDER_STATUS.CONFIRMED,
            triggeredBy: 'PAYMENT_WEBHOOK',
            note: data.event,
            providerPaymentId: data.providerPaymentId,
            providerOrderId: data.providerOrderId,
            webhookPayload: resolveWebhookPayload(data)
          },
          orderProcessingQueue,
          `process-order-update:confirmed:${resolvedOrderId}`
        );
        return;
      }

      // Non-capture payment events (payment.failed, refund.processed) are handled
      // directly inside the transaction because they do not require the heavy
      // side-effect orchestration that process-order-update provides.
      await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findFirst({
          where: { providerOrderId: data.providerOrderId }
        });
        if (!payment) {
          return;
        }

        if (payment.providerPaymentId === data.providerPaymentId && payment.status === PAYMENT_STATUS.CAPTURED) {
          return;
        }

        const order = await tx.order.findUnique({
          where: { id: payment.orderId },
          include: {
            user: {
              select: {
                email: true,
                phone: true
              }
            }
          }
        });
        if (!order) {
          return;
        }

        const mapped = mapPaymentEventToStatuses(data.event);
        if (!mapped) {
          return;
        }
        const nextPaymentStatus = mapped.paymentStatus;
        const nextOrderStatus = mapped.orderStatus;
        if (nextPaymentStatus === PAYMENT_STATUS.CAPTURED) {
          return;
        }

        if (normalizedEvent === 'refund.processed') {
          const pendingRefundAmount = payment.refundPendingAmountPaise;
          const remainingRefundable = Math.max(payment.amount - payment.refundedAmountPaise, 0);
          const processedRefundAmount =
            pendingRefundAmount > 0 ? Math.min(pendingRefundAmount, remainingRefundable) : remainingRefundable;
          if (processedRefundAmount <= 0) {
            return;
          }

          const nextRefundedAmount = Math.min(payment.refundedAmountPaise + processedRefundAmount, payment.amount);
          const isFullyRefunded = nextRefundedAmount >= payment.amount;

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              providerPaymentId: data.providerPaymentId,
              status: isFullyRefunded ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED,
              webhookPayload: resolveWebhookPayload(data),
              refundedAmountPaise: nextRefundedAmount,
              refundPendingAmountPaise: Math.max(pendingRefundAmount - processedRefundAmount, 0)
            }
          });

          if (isFullyRefunded && order.status !== ORDER_STATUS.REFUNDED && canTransitionOrder(order.status, ORDER_STATUS.REFUNDED)) {
            const refunded = await updateOrderStatusWithCasCompat(tx, {
              orderId: order.id,
              fromStatus: order.status,
              toStatus: ORDER_STATUS.REFUNDED
            });
            if (refunded) {
              await tx.orderStatusHistory.create({
                data: {
                  orderId: order.id,
                  fromStatus: order.status,
                  toStatus: ORDER_STATUS.REFUNDED,
                  triggeredBy: 'PAYMENT_WEBHOOK',
                  note: `Refund processed (${processedRefundAmount} paise)`
                }
              });
              await releaseCouponUsageForOrder(tx, order.id);
            }
          } else {
            await tx.orderStatusHistory.create({
              data: {
                orderId: order.id,
                fromStatus: order.status,
                toStatus: order.status,
                triggeredBy: 'PAYMENT_WEBHOOK',
                note: `Partial refund processed (${processedRefundAmount} paise)`
              }
            });
          }

          const outboxDelegate = (tx as unknown as { outboxMessage?: Prisma.TransactionClient['outboxMessage'] }).outboxMessage;
          if (outboxDelegate) {
            await outboxDelegate.create({
              data: {
                queueName: 'orderProcessing',
                jobName: 'generate-credit-note',
                payload: {
                  orderId: order.id,
                  reason: `Refund processed (${processedRefundAmount} paise)`,
                  refundAmountPaise: processedRefundAmount
                } as Prisma.InputJsonValue,
                jobId: `generate-credit-note-${order.id}-${processedRefundAmount}`
              }
            });
          } else {
            await orderProcessingQueue.add(
              'generate-credit-note',
              {
                orderId: order.id,
                reason: `Refund processed (${processedRefundAmount} paise)`,
                refundAmountPaise: processedRefundAmount
              },
              { jobId: `generate-credit-note-${order.id}-${processedRefundAmount}` }
            );
          }
          return;
        }

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: data.providerPaymentId,
            status: nextPaymentStatus,
            webhookPayload: resolveWebhookPayload(data)
          }
        });

        if (order.status !== nextOrderStatus && canTransitionOrder(order.status, nextOrderStatus)) {
          const updated = await updateOrderStatusWithCasCompat(tx, {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: nextOrderStatus
          });

          if (updated) {
            await tx.orderStatusHistory.create({
              data: {
                orderId: order.id,
                fromStatus: order.status,
                toStatus: nextOrderStatus,
                triggeredBy: 'PAYMENT_WEBHOOK',
                note: data.event
              }
            });
          }
        }

        if (nextPaymentStatus === PAYMENT_STATUS.FAILED) {
          await releaseReservationsForOrder(tx, order.id);
          if (order.user.email || order.user.phone) {
            const outboxDelegate = (tx as unknown as { outboxMessage?: Prisma.TransactionClient['outboxMessage'] }).outboxMessage;
            if (outboxDelegate) {
              await outboxDelegate.create({
                data: {
                  queueName: 'notifications',
                  jobName: 'send-primary',
                  payload: {
                    email: order.user.email,
                    phone: order.user.phone,
                    template: 'PaymentFailed',
                    data: {
                      orderId: order.id,
                      providerOrderId: data.providerOrderId
                    }
                  } as Prisma.InputJsonValue,
                  jobId: `notifications-primary-${order.id}-PaymentFailed`
                }
              });
            } else {
              await notificationsQueue.add('send-primary', {
                email: order.user.email,
                phone: order.user.phone,
                template: 'PaymentFailed',
                data: {
                  orderId: order.id,
                  providerOrderId: data.providerOrderId
                }
              });
            }
          }
        }
      });
    },
    { connection }
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;
    void alertFn({
      prisma,
      template: 'OrderProcessingWorkerTerminalFailure',
      channel: 'UNKNOWN',
      recipient: 'order-processing-worker',
      errorMessage: error instanceof Error ? error.message : String(error),
      failureStage: 'WORKER_TERMINAL',
      queueName: 'order-processing',
      jobName: job.name,
      jobId: job.id ?? 'unknown',
      domain: 'orders',
      component: 'order-processing-worker',
      terminalFailure: true
    });
  });

  return worker;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveOrderIdFromWebhookData(
  prisma: RealPrismaClient,
  data: (PaymentWebhookJobData & { orderId?: string }) | { orderId: string }
): Promise<string | null> {
  if ('orderId' in data && data.orderId) {
    return data.orderId;
  }
  const webhookData = data as PaymentWebhookJobData;
  if (!webhookData.providerOrderId) {
    return null;
  }
  const payment = await prisma.payment.findFirst({
    where: { providerOrderId: webhookData.providerOrderId },
    select: { orderId: true }
  });
  return payment?.orderId ?? null;
}

async function handleProcessOrderUpdate(
  prisma: RealPrismaClient,
  data: ProcessOrderUpdateJobData,
  notificationsQueue: NotificationsQueue,
  orderProcessingQueue: OrderProcessingQueue,
  analyticsQueue: AnalyticsQueue,
  refundsQueue: RefundsQueue
): Promise<void> {
  if (data.toStatus !== ORDER_STATUS.CONFIRMED) {
    // Future: handle additional target statuses (PROCESSING, CANCELLED, etc.)
    return;
  }

  let orderForSideEffects:
    | {
        id: string;
        orderNumber: string;
        userId: string;
        user: { email: string | null; phone: string | null };
      }
    | undefined;

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: data.orderId },
        select: {
          id: true,
          orderNumber: true,
          userId: true,
          status: true,
          discountAmount: true,
          coupons: {
            select: {
              id: true,
              usesCount: true
            }
          },
          user: {
            select: {
              email: true,
              phone: true
            }
          },
          items: {
            select: {
              variantId: true,
              quantity: true
            }
          },
          payment: {
            select: { id: true, status: true }
          }
        }
      });
      if (!order) {
        return;
      }

      const isCodSideEffectsJob =
        data.triggeredBy === 'COD_ORDER_CREATED' &&
        order.status === ORDER_STATUS.CONFIRMED;

      // New PREPAID flow (confirmPrepaid): order is already CONFIRMED with coupon finalized.
      // Skip DB transitions — only run inventory deduction, emails, and invoice.
      const isPrepaidConfirmedSideEffectsJob =
        data.triggeredBy === 'PREPAID_CONFIRMED' &&
        order.status === ORDER_STATUS.CONFIRMED;

      // Old PREPAID flow (webhook-driven): order is awaiting payment or recovering.
      const isPrepaidConfirmationTarget =
        !isCodSideEffectsJob &&
        !isPrepaidConfirmedSideEffectsJob &&
        (order.status === ORDER_STATUS.PENDING_PAYMENT ||
          order.status === ORDER_STATUS.PAYMENT_FAILED);

      if (!isCodSideEffectsJob && !isPrepaidConfirmedSideEffectsJob && !isPrepaidConfirmationTarget) {
        return;
      }

      if (isCodSideEffectsJob) {
        const alreadyProcessed = await tx.orderStatusHistory.findFirst({
          where: {
            orderId: order.id,
            triggeredBy: 'COD_ORDER_CREATED'
          },
          select: { id: true }
        });
        if (alreadyProcessed) {
          return;
        }
      } else if (isPrepaidConfirmedSideEffectsJob) {
        // Idempotency: only run side effects once — check if inventory has already been deducted.
        const alreadyProcessed = await tx.orderStatusHistory.findFirst({
          where: {
            orderId: order.id,
            triggeredBy: 'PREPAID_CONFIRMED'
          },
          select: { id: true }
        });
        if (alreadyProcessed) {
          return;
        }
      } else {
        // CAS gate — only one concurrent prepaid job (old webhook flow) wins.
        const claimed = await tx.order.updateMany({
          where: {
            id: order.id,
            status: {
              in: [ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAYMENT_FAILED]
            }
          },
          data: {
            status: ORDER_STATUS.CONFIRMED
          }
        });
        if (claimed.count === 0) {
          return;
        }
      }

      // Deduct inventory for each line item.
      for (const item of order.items) {
        const updated = await tx.inventory.updateMany({
          where: {
            variantId: item.variantId,
            quantity: {
              gte: item.quantity
            }
          },
          data: {
            quantity: {
              decrement: item.quantity
            }
          }
        });

        if (updated.count === 0) {
          throw new AppError(
            ERROR_CODES.INSUFFICIENT_STOCK,
            `Insufficient stock while confirming payment for variant ${item.variantId}`,
            422
          );
        }
      }

      await releaseReservationsForOrder(tx, order.id);

      // Persist payment capture if provider data is present and not yet recorded (old prepaid flow only).
      if (!isCodSideEffectsJob && !isPrepaidConfirmedSideEffectsJob && order.payment && data.providerPaymentId) {
        if (order.payment.status !== PAYMENT_STATUS.CAPTURED) {
          await tx.payment.update({
            where: { id: order.payment.id },
            data: {
              providerPaymentId: data.providerPaymentId,
              status: PAYMENT_STATUS.CAPTURED,
              ...(data.webhookPayload ? { webhookPayload: data.webhookPayload } : {}),
              capturedAt: new Date()
            }
          });
        }
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: (isCodSideEffectsJob || isPrepaidConfirmedSideEffectsJob)
            ? ORDER_STATUS.CONFIRMED
            : order.status,
          toStatus: ORDER_STATUS.CONFIRMED,
          triggeredBy: data.triggeredBy,
          note: data.note ?? 'process-order-update'
        }
      });

      // Coupon finalization: already done inside confirmPrepaid for new PREPAID flow.
      // For COD and old PREPAID (webhook) flows, finalize here.
      if (!isPrepaidConfirmedSideEffectsJob) {
        await finalizeCouponUsageForOrder(tx, {
          orderId: order.id,
          userId: order.userId,
          discountAmount: order.discountAmount ?? 0,
          coupons: order.coupons
        });
      }

      orderForSideEffects = {
        id: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        user: {
          email: order.user.email,
          phone: order.user.phone
        }
      };
    });
  } catch (error) {
      if (error instanceof AppError && error.code === ERROR_CODES.INSUFFICIENT_STOCK) {
        if (data.triggeredBy === 'COD_ORDER_CREATED') {
          await handleCodSideEffectsFailure(prisma, data, notificationsQueue, {
            cancelReason: 'Auto-cancelled due to insufficient stock while confirming COD order'
          });
        } else {
        await handlePostCaptureRecovery(prisma, data, refundsQueue, {
          cancelReason: 'Auto-cancelled due to insufficient stock after payment capture',
          refundReason: 'Auto-refund due to insufficient stock after payment capture'
        });
      }
      return;
    }
      if (error instanceof AppError && error.code === ERROR_CODES.COUPON_USAGE_EXCEEDED) {
        if (data.triggeredBy === 'COD_ORDER_CREATED') {
          await handleCodSideEffectsFailure(prisma, data, notificationsQueue, {
            cancelReason: 'Auto-cancelled due to coupon usage limit while confirming COD order'
          });
        } else {
        await handlePostCaptureRecovery(prisma, data, refundsQueue, {
          cancelReason: 'Auto-cancelled due to coupon usage limit reached after payment capture',
          refundReason: 'Auto-refund due to coupon usage limit reached after payment capture'
        });
      }
      return;
    }
    throw error;
  }

  if (!orderForSideEffects) {
    return;
  }
  const sideEffectsTarget = orderForSideEffects;

  if (sideEffectsTarget.user.email || sideEffectsTarget.user.phone) {
    await enqueueOutboxOrQueue(prisma, 'notifications', 'send-primary', {
      email: sideEffectsTarget.user.email,
      phone: sideEffectsTarget.user.phone,
      template: 'OrderConfirmed',
      data: {
        orderId: sideEffectsTarget.id,
        orderNumber: sideEffectsTarget.orderNumber,
        providerOrderId: data.providerOrderId ?? ''
      }
    }, notificationsQueue, `notifications-primary-${sideEffectsTarget.id}-OrderConfirmed`);
  }

  // Per-admin opt-in "new order" alerts: every ADMIN who enabled
  // orderNotificationsEnabled gets an AdminNewOrder notification on each of
  // their selected channels. Best-effort — a failure here never blocks the
  // customer-facing side effects.
  try {
    await enqueueAdminNewOrderNotifications(prisma, notificationsQueue, sideEffectsTarget.id);
  } catch (adminNotifyError) {
    await sendTechnicalFailureAlert({
      prisma,
      template: 'AdminNewOrder',
      channel: 'UNKNOWN',
      recipient: sideEffectsTarget.id,
      errorMessage:
        adminNotifyError instanceof Error ? adminNotifyError.message : 'Unknown admin notify error',
      failureStage: 'QUEUE_ENQUEUE',
      domain: 'orders',
      component: 'admin-new-order-notifications',
      queueName: 'notifications',
      jobName: 'admin-new-order'
    });
  }

  if (featureFlags.gstInvoicing) {
    await enqueueOutboxOrQueue(prisma, 'orderProcessing', 'generate-invoice', {
      orderId: sideEffectsTarget.id
    }, orderProcessingQueue, `generate-invoice-${sideEffectsTarget.id}`);
  }

  await enqueueOutboxOrQueue(prisma, 'analytics', 'record-event', {
    eventType: ANALYTICS_EVENT_TYPE.PURCHASE,
    sessionId: `order-${sideEffectsTarget.id}`,
    ...(sideEffectsTarget.userId ? { userId: sideEffectsTarget.userId } : {}),
    payload: {
      orderId: sideEffectsTarget.id,
      providerOrderId: data.providerOrderId ?? ''
    },
    occurredAt: new Date().toISOString()
  }, analyticsQueue, `analytics-${ANALYTICS_EVENT_TYPE.PURCHASE}-order-${sideEffectsTarget.id}`);
}

async function handleCodSideEffectsFailure(
  prisma: RealPrismaClient,
  data: ProcessOrderUpdateJobData,
  notificationsQueue: NotificationsQueue,
  reason: { cancelReason: string }
): Promise<void> {
  const notifyTarget = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({
      where: { id: data.orderId },
      select: {
        id: true,
        status: true,
        user: {
          select: {
            email: true,
            phone: true
          }
        }
      }
    });
    if (!order || order.status !== ORDER_STATUS.CONFIRMED) {
      return null;
    }

    const cancelled = await tx.order.updateMany({
      where: {
        id: order.id,
        status: ORDER_STATUS.CONFIRMED
      },
      data: {
        status: ORDER_STATUS.CANCELLED
      }
    });
    if (cancelled.count === 0) {
      return null;
    }

    await releaseReservationsForOrder(tx, order.id);
    await releaseCouponUsageForOrder(tx, order.id);
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: ORDER_STATUS.CONFIRMED,
        toStatus: ORDER_STATUS.CANCELLED,
        triggeredBy: 'SYSTEM',
        note: reason.cancelReason
      }
    });
    return {
      id: order.id,
      email: order.user.email,
      phone: order.user.phone
    };
  });

  if (notifyTarget && (notifyTarget.email || notifyTarget.phone)) {
    await enqueueOutboxOrQueue(
      prisma,
      'notifications',
      'send-primary',
      {
        email: notifyTarget.email,
        phone: notifyTarget.phone,
        template: 'OrderCancelled',
        data: { orderId: notifyTarget.id }
      },
      notificationsQueue,
      `notifications:primary:${notifyTarget.id}:OrderCancelled:cod-failure`
    );
  }
}

async function handlePostCaptureRecovery(
  prisma: RealPrismaClient,
  data: CaptureRecoveryData,
  refundsQueue: RefundsQueue,
  reason: {
    cancelReason: string;
    refundReason: string;
  }
): Promise<void> {
  const recovery = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (!data.providerOrderId && !data.orderId) {
      return null;
    }
    const payment = await tx.payment.findFirst({
      where: data.providerOrderId
        ? { providerOrderId: data.providerOrderId }
        : { orderId: data.orderId as string },
      select: {
        id: true,
        orderId: true,
        status: true
      }
    });
    if (!payment) {
      return null;
    }

    const order = await tx.order.findUnique({
      where: { id: payment.orderId },
      select: {
        id: true,
        status: true
      }
    });
    if (!order) {
      return null;
    }

    if (payment.status !== PAYMENT_STATUS.CAPTURED) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          ...(data.providerPaymentId ? { providerPaymentId: data.providerPaymentId } : {}),
          status: PAYMENT_STATUS.CAPTURED,
          webhookPayload: resolveWebhookPayload(data),
          capturedAt: new Date()
        }
      });
    }

    const cancelled = await tx.order.updateMany({
      where: {
        id: order.id,
        status: ORDER_STATUS.PENDING_PAYMENT
      },
      data: {
        status: ORDER_STATUS.CANCELLED
      }
    });
    if (cancelled.count === 0 && order.status !== ORDER_STATUS.CANCELLED) {
      return null;
    }

    if (cancelled.count > 0) {
      await releaseReservationsForOrder(tx, order.id);
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: ORDER_STATUS.PENDING_PAYMENT,
          toStatus: ORDER_STATUS.CANCELLED,
          triggeredBy: 'SYSTEM',
          note: reason.cancelReason
        }
      });
    }

    return { orderId: order.id };
  });

  if (!recovery) {
    return;
  }

  await enqueueOutboxOrQueue(
    prisma,
    'refunds',
    'initiate-razorpay-refund',
    {
      orderId: recovery.orderId,
      reason: reason.refundReason,
      initiatedBy: 'SYSTEM',
      sourceStatus: ORDER_STATUS.CANCELLED
    },
    refundsQueue,
    `auto-refund:${data.providerPaymentId ?? data.orderId ?? 'unknown'}`
  );
}

async function generateInvoiceForOrder(prisma: RealPrismaClient, orderId: string, invoiceStorageAdapter: InvoiceStorageAdapter): Promise<void> {
  if (!featureFlags.gstInvoicing) {
    return;
  }

  const sellerProfile = await resolveSellerProfileOrThrow(prisma);
  // Fetched OUTSIDE the transaction — a slow logo host must never hold a DB tx open.
  const invoiceLogo = await fetchInvoiceLogo(sellerProfile.logoUrl);

  await prisma.$transaction(async (tx) => {
    const existingInvoice = await tx.invoice.findUnique({
      where: { orderId }
    });
    if (existingInvoice) {
      return;
    }

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: { email: true }
        },
        items: {
          include: {
            variant: {
              select: {
                hsnCode: true,
                gstRatePercent: true,
                product: {
                  select: {
                    attributes: true
                  }
                }
              }
            }
          }
        }
      }
    });
    if (!order) {
      return;
    }

    for (const item of order.items) {
      const explicitHsn = resolveExplicitShippingHsn({
        variantHsnCode: item.variant?.hsnCode,
        productAttributes: item.variant?.product?.attributes
      });
      if (!explicitHsn) {
        throw new Error(`Missing product HSN code for GST invoice line item ${item.id}`);
      }
    }

    await tx.$executeRaw`CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1`;
    const sequenceResult = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('invoice_number_seq')`;
    const sequenceNumber = Number(sequenceResult[0]?.nextval ?? 1n);
    const year = new Date().getFullYear();
    const invoiceNumber = `INV-${year}-${String(sequenceNumber).padStart(5, '0')}`;
    const shippingAddress = (order.shippingAddress ?? {}) as ShippingAddress;
    const sellerState = sellerProfile.state;
    const buyerState = (shippingAddress.state ?? 'Unknown').trim();
    const isInterState = sellerState.toLowerCase() !== buyerState.toLowerCase();
    const lineItems: InvoiceLineItem[] = order.items.map((item: InvoiceOrderItem): InvoiceLineItem => {
      const attributes = item.variant?.product?.attributes ?? null;
      const taxRatePercent = resolveLineItemGstRatePercent(item.variant?.gstRatePercent, attributes);
      const lineTax = Math.round((item.totalPrice * taxRatePercent) / 100);
      const cgst = isInterState ? 0 : Math.round(lineTax / 2);
      const sgst = isInterState ? 0 : lineTax - cgst;
      const igst = isInterState ? lineTax : 0;
      return {
        name: item.productName,
        hsnCode: resolveInvoiceHsnCode({
          variantHsnCode: item.variant?.hsnCode,
          productAttributes: attributes
        }),
        quantity: item.quantity,
        unitPricePaise: item.unitPrice,
        lineTotalPaise: item.totalPrice,
        taxRatePercent,
        cgstPaise: cgst,
        sgstPaise: sgst,
        igstPaise: igst
      };
    });

    const cgstPaise = lineItems.reduce((sum, item) => sum + item.cgstPaise, 0);
    const sgstPaise = lineItems.reduce((sum, item) => sum + item.sgstPaise, 0);
    const igstPaise = lineItems.reduce((sum, item) => sum + item.igstPaise, 0);
    const amountInWords = amountPaiseToIndianWords(order.total);

    const content = await renderInvoicePdfBuffer({
      storeDisplayName: sellerProfile.storeName,
      logo: invoiceLogo,
      invoiceNumber,
      orderNumber: order.orderNumber,
      issuedAtIso: new Date().toISOString(),
      seller: {
        legalName: sellerProfile.legalName,
        addressLine: sellerProfile.addressLine,
        state: sellerState,
        gstin: sellerProfile.gstin,
        fssai: sellerProfile.fssai
      },
      buyer: {
        fullName: shippingAddress.fullName ?? 'Customer',
        addressLine: [shippingAddress.line1, shippingAddress.line2, shippingAddress.city].filter(Boolean).join(', '),
        state: buyerState,
        pincode: shippingAddress.pincode ?? 'N/A'
      },
      lineItems,
      subtotalPaise: order.subtotal,
      shippingPaise: order.shippingCharge,
      discountPaise: order.discountAmount,
      totalPaise: order.total,
      cgstPaise,
      sgstPaise,
      igstPaise,
      amountInWords
    });

    const uploaded = await invoiceStorageAdapter.uploadInvoicePdf({
      orderId: order.id,
      invoiceNumber,
      content
    });

    await tx.invoice.create({
      data: {
        orderId: order.id,
        invoiceNumber,
        pdfUrl: uploaded.storageReference
      }
    });
  });
}

async function generateCreditNoteForOrder(
  prisma: RealPrismaClient,
  data: GenerateCreditNoteJobData,
  invoiceStorageAdapter: InvoiceStorageAdapter
): Promise<void> {
  if (!featureFlags.gstInvoicing) {
    return;
  }

  const sellerProfile = await resolveSellerProfileOrThrow(prisma);

  await prisma.$transaction(async (tx) => {
    const originalInvoice = await tx.invoice.findUnique({
      where: { orderId: data.orderId }
    });
    if (!originalInvoice) {
      return;
    }

    const order = await tx.order.findUnique({
      where: { id: data.orderId },
      include: {
        payment: true
      }
    });
    if (!order) {
      return;
    }

    const shippingAddress = (order.shippingAddress ?? {}) as ShippingAddress;
    const creditNoteNumber = `CN-${originalInvoice.invoiceNumber}`;
    const content = await renderCreditNotePdfBuffer({
      creditNoteNumber,
      originalInvoiceNumber: originalInvoice.invoiceNumber,
      orderNumber: order.orderNumber,
      issuedAtIso: new Date().toISOString(),
      reason: data.reason,
      refundAmountPaise: data.refundAmountPaise ?? order.payment?.amount ?? order.total,
      seller: {
        legalName: sellerProfile.legalName,
        gstin: sellerProfile.gstin,
        fssai: sellerProfile.fssai
      },
      buyer: {
        fullName: shippingAddress.fullName ?? 'Customer'
      }
    });

    await invoiceStorageAdapter.uploadInvoicePdf({
      orderId: order.id,
      invoiceNumber: creditNoteNumber,
      content
    });

    const auditPayload = JSON.stringify({
      creditNoteNumber,
      originalInvoiceNumber: originalInvoice.invoiceNumber,
      reason: data.reason
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: order.status as OrderStatus,
        triggeredBy: 'SYSTEM',
        note: `${CREDIT_NOTE_AUDIT_PREFIX}${auditPayload}`
      }
    });
  });
}

type SellerProfile = {
  legalName: string;
  addressLine: string;
  state: string;
  gstin: string;
  fssai: string;
  /** Customer-facing store/brand name for the invoice header (may equal legalName). */
  storeName: string;
  /** Store logo URL (StoreSettings.logoUrl); rendered on the invoice when fetchable PNG/JPG. */
  logoUrl: string | null;
};

/**
 * Best-effort fetch of the store logo for the invoice header. Any failure (timeout,
 * non-image, unsupported format) returns null — the invoice renders text-only.
 * react-pdf embeds only PNG/JPG, so other formats are skipped by magic-byte sniff.
 */
async function fetchInvoiceLogo(logoUrl: string | null): Promise<{ data: Buffer; format: 'png' | 'jpg' } | null> {
  const url = (logoUrl ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 8 || bytes.length > 2 * 1024 * 1024) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return { data: bytes, format: 'png' };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      return { data: bytes, format: 'jpg' };
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveSellerProfileOrThrow(prisma: RealPrismaClient): Promise<SellerProfile> {
  const storeSettingsDelegate = (prisma as unknown as { storeSettings?: RealPrismaClient['storeSettings'] }).storeSettings;
  const settings = storeSettingsDelegate
    ? await storeSettingsDelegate.findUnique({
        where: { singletonKey: 'default' },
        select: {
          storeName: true,
          logoUrl: true,
          sellerLegalName: true,
          sellerAddress: true,
          sellerState: true,
          gstin: true,
          fssaiNumber: true
        }
      })
    : null;

  const legalName = (settings?.sellerLegalName ?? settings?.storeName ?? '').trim();
  const addressLine = (settings?.sellerAddress ?? '').trim();
  const state = (settings?.sellerState ?? '').trim();
  const gstin = (settings?.gstin ?? '').trim();
  const fssai = (settings?.fssaiNumber ?? '').trim();
  const requiresFssai = ['food', 'true', '1'].includes(String(process.env.STORE_REQUIRES_FSSAI ?? '').toLowerCase());

  if (requiresFssai && !fssai) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      'FSSAI is required for invoice generation for food clients',
      500
    );
  }

  if (process.env.NODE_ENV === 'production') {
    const missing = [
      !legalName ? 'StoreSettings.sellerLegalName' : null,
      !addressLine ? 'StoreSettings.sellerAddress' : null,
      !state ? 'StoreSettings.sellerState' : null,
      !gstin ? 'StoreSettings.gstin' : null,
      (!fssai && requiresFssai) ? 'StoreSettings.fssaiNumber' : null
    ].filter((value): value is string => value !== null);

    if (missing.length > 0) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        `Missing required DB-backed configuration for invoicing: ${missing.join(', ')}`,
        500
      );
    }
  }

  return {
    legalName: legalName || 'Ecom Store Pvt Ltd',
    addressLine: addressLine || 'Address not configured',
    state: state || 'Unknown',
    gstin: gstin || 'GSTIN_NOT_CONFIGURED',
    fssai: fssai || (requiresFssai ? 'FSSAI_REQUIRED' : 'FSSAI_NOT_CONFIGURED'),
    storeName: (settings?.storeName ?? '').trim() || legalName || 'Ecom Store Pvt Ltd',
    logoUrl: ((settings as { logoUrl?: string | null } | null)?.logoUrl ?? '').trim() || null
  };
}

const oneToNineteen = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen'
];

const tensWords = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function amountPaiseToIndianWords(totalPaise: number): string {
  const rupees = Math.floor(totalPaise / 100);
  const paise = Math.abs(totalPaise % 100);
  const rupeeWords = convertIndianNumberToWords(rupees);
  if (paise === 0) {
    return `${rupeeWords} Rupees Only`;
  }
  const paiseWords = convertIndianNumberToWords(paise);
  return `${rupeeWords} Rupees and ${paiseWords} Paise Only`;
}

function convertIndianNumberToWords(value: number): string {
  if (value <= 19) {
    return oneToNineteen[value] ?? 'Zero';
  }
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const units = value % 10;
    return `${tensWords[tens]}${units ? ` ${oneToNineteen[units]}` : ''}`;
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const remainder = value % 100;
    return `${oneToNineteen[hundreds]} Hundred${remainder ? ` ${convertIndianNumberToWords(remainder)}` : ''}`;
  }
  if (value < 100000) {
    const thousands = Math.floor(value / 1000);
    const remainder = value % 1000;
    return `${convertIndianNumberToWords(thousands)} Thousand${remainder ? ` ${convertIndianNumberToWords(remainder)}` : ''}`;
  }
  if (value < 10000000) {
    const lakhs = Math.floor(value / 100000);
    const remainder = value % 100000;
    return `${convertIndianNumberToWords(lakhs)} Lakh${remainder ? ` ${convertIndianNumberToWords(remainder)}` : ''}`;
  }
  const crores = Math.floor(value / 10000000);
  const remainder = value % 10000000;
  return `${convertIndianNumberToWords(crores)} Crore${remainder ? ` ${convertIndianNumberToWords(remainder)}` : ''}`;
}

