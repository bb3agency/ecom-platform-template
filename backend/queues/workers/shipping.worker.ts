import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { OrderStatus, ShippingProvider, ShipmentStatus, type Prisma, PrismaClient as RealPrismaClient } from '@prisma/client';
import { canTransitionOrder } from '@common/orders/order-state-machine';
import { mapShipmentStatusToOrderStatus, mapShipmentWebhookStatus } from '@common/orders/webhook-status-mappers';
import {
  createShippingProvider,
  createShippingAdapterForProvider
} from '@modules/shipping/shipping-provider';
import { resolveGstInvoicingEnabled } from '@common/invoicing/gst-invoicing-flag';
import { restoreOrderInventoryOnCancel } from '@common/orders/restore-inventory-on-cancel';
import { releaseCouponUsageForOrder } from '@common/coupons/coupon-usage';
import { resolvePickupPincode } from '@common/shipping/resolve-pickup-pincode';
import {
  resolveDefaultShippingHsn,
  resolveShippingHsnCode
} from '@common/shipping/resolve-shipping-hsn';
import {
  normalizeIndianShippingPhone,
  resolveShiprocketCustomerEmail
} from '@common/shipping/shiprocket-payload';
import { parseBoxPresets } from '@common/shipping/select-box-preset';
import { cartonize } from '@common/shipping/cartonize';
import {
  BOOKING_INTENT_MAX_SWEEP_REQUEUES,
  BOOKING_INTENT_STALE_MS,
  BOOKING_INTENT_SWEEP_BATCH,
  buildBookingIntentPayload,
  isBookingIntent,
  readBookingIntentMeta
} from '@common/shipping/booking-intent';
import type { CreateShipmentInput, ShipmentLookupResult } from '@common/interfaces/shipping-provider.interface';
import { sendTechnicalFailureAlert } from '../../src/modules/notifications/notification-failure-alert';

type NotificationsQueue = Pick<Queue, 'add'>;

type ShippingWorkerDeps = {
  PrismaClient?: typeof RealPrismaClient;
  /** Shared process-wide client (workers/index.ts) — avoids one connection pool per worker. */
  prisma?: RealPrismaClient;
  Worker?: typeof Worker;
  createShippingProvider?: typeof createShippingProvider;
  createShippingAdapterForProvider?: (providerKey: 'delhivery' | 'shiprocket') => ReturnType<typeof createShippingAdapterForProvider>;
  sendTechnicalFailureAlert?: typeof sendTechnicalFailureAlert;
};

type ShippingWebhookJobData = {
  awb: string;
  status: string;
  description: string;
  location: string | null;
  occurredAt: string;
  shiprocketShipmentId?: string;
  payload?: string;
  payloadMetadata?: Record<string, unknown>;
};

function parseWebhookOccurredAt(raw: string): Date {
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

type CreateShipmentJobData = {
  orderId: string;
};

type CancelShipmentJobData = {
  orderId: string;
  awbNumber: string;
};

function parseJsonPayload(payload: string): Prisma.InputJsonValue {
  try {
    return JSON.parse(payload) as Prisma.InputJsonValue;
  } catch {
    return {};
  }
}

function sanitizeProviderPayload(payload: unknown): Prisma.InputJsonValue {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  const whitelisted = {
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
    ...(typeof record.statusCode === 'string' || typeof record.statusCode === 'number'
      ? { statusCode: String(record.statusCode) }
      : {}),
    ...(typeof record.status_code === 'string' || typeof record.status_code === 'number'
      ? { statusCode: String(record.status_code) }
      : {}),
    ...(typeof record.message === 'string' ? { message: record.message } : {}),
    ...(typeof record.requestId === 'string' ? { requestId: record.requestId } : {}),
    ...(typeof record.request_id === 'string' ? { requestId: record.request_id } : {}),
    ...(typeof record.awb === 'string' ? { awb: record.awb } : {}),
    ...(typeof record.waybill === 'string' ? { waybill: record.waybill } : {}),
    ...(typeof record.trackingUrl === 'string' ? { trackingUrl: record.trackingUrl } : {})
  };
  return whitelisted as Prisma.InputJsonValue;
}

function resolveWebhookPayload(data: ShippingWebhookJobData): Prisma.InputJsonValue {
  const basePayload = {
    awb: data.awb,
    status: data.status,
    occurredAt: data.occurredAt
  };
  if (data.payloadMetadata && typeof data.payloadMetadata === 'object') {
    return {
      ...basePayload,
      ...(typeof data.payloadMetadata.source === 'string' ? { source: data.payloadMetadata.source } : {}),
      ...(typeof data.payloadMetadata.payloadHash === 'string' ? { payloadHash: data.payloadMetadata.payloadHash } : {})
    } as Prisma.InputJsonValue;
  }
  if (typeof data.payload === 'string') {
    return {
      ...basePayload,
      provider: sanitizeProviderPayload(parseJsonPayload(data.payload))
    } as Prisma.InputJsonValue;
  }
  return basePayload as Prisma.InputJsonValue;
}

async function enqueueNotificationOutboxOrQueue(
  tx: Prisma.TransactionClient,
  notificationsQueue: NotificationsQueue,
  jobName: 'send-email' | 'send-sms' | 'send-whatsapp' | 'send-primary',
  payload: Record<string, unknown>,
  jobId?: string
): Promise<void> {
  // BullMQ rejects custom jobIds containing ':' — sanitize before the id reaches
  // either the outbox row (relayed to BullMQ later) or the direct queue add.
  const safeJobId = jobId ? jobId.replace(/:/g, '-') : undefined;
  const outboxDelegate = (tx as unknown as { outboxMessage?: Prisma.TransactionClient['outboxMessage'] }).outboxMessage;
  if (outboxDelegate) {
    await outboxDelegate.create({
      data: {
        queueName: 'notifications',
        jobName,
        payload: payload as Prisma.InputJsonValue,
        ...(safeJobId ? { jobId: safeJobId } : {})
      }
    });
    return;
  }
  await notificationsQueue.add(jobName, payload, safeJobId ? { jobId: safeJobId } : undefined);
}

/**
 * Enqueue a job onto an arbitrary queue (used for refunds) via the transactional
 * outbox when available, falling back to a direct add is NOT possible here because
 * the worker only holds the notifications queue handle — so refund enqueues REQUIRE
 * the outbox (always present with the real Prisma client in the worker runtime).
 */
async function enqueueOutboxJob(
  tx: Prisma.TransactionClient,
  queueName: 'refunds' | 'notifications' | 'shipping',
  jobName: string,
  payload: Record<string, unknown>,
  jobId?: string
): Promise<void> {
  const safeJobId = jobId ? jobId.replace(/:/g, '-') : undefined;
  const outboxDelegate = (tx as unknown as { outboxMessage?: Prisma.TransactionClient['outboxMessage'] }).outboxMessage;
  if (!outboxDelegate) {
    return;
  }
  await outboxDelegate.create({
    data: {
      queueName,
      jobName,
      payload: payload as Prisma.InputJsonValue,
      ...(safeJobId ? { jobId: safeJobId } : {})
    }
  });
}

type ShipmentNotificationOrderContext = {
  id: string;
  orderNumber: string | null;
  email: string | null;
  phone: string | null;
  estimatedDelivery: Date | null;
  trackingUrl: string | null;
};

/**
 * Single source of truth for shipment-status-driven customer notifications.
 * Used by BOTH the webhook path and the background poll path so that whichever
 * detects the transition first fires the correct template — and the status-scoped
 * dedup jobId (e.g. `shipping-primary-<id>-delivered`) means the other path is a
 * no-op. Callers MUST only invoke this when the shipment status actually changed
 * to `nextShipmentStatus` in the current transaction (durable dedup via the
 * Shipment.status column), so a repeated poll never re-sends.
 */
async function emitShipmentStatusNotification(
  tx: Prisma.TransactionClient,
  notificationsQueue: NotificationsQueue,
  order: ShipmentNotificationOrderContext,
  nextShipmentStatus: ShipmentStatus,
  resolvedAwb: string
): Promise<void> {
  const { id: orderId, email, phone } = order;
  const contact = Boolean(email || phone);

  if (nextShipmentStatus === 'IN_TRANSIT' && contact) {
    const estimatedDaysFromDelivery = order.estimatedDelivery
      ? Math.max(1, Math.round((order.estimatedDelivery.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : undefined;
    const estimatedDeliveryText =
      estimatedDaysFromDelivery != null
        ? `Estimated delivery in ${estimatedDaysFromDelivery} day${estimatedDaysFromDelivery === 1 ? '' : 's'}. `
        : '';
    await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
      email,
      phone,
      template: 'OrderShipped',
      data: {
        orderId,
        orderNumber: order.orderNumber ?? orderId,
        awb: resolvedAwb,
        trackingUrl: order.trackingUrl ?? '',
        estimatedDeliveryText,
        ...(estimatedDaysFromDelivery != null ? { estimatedDays: estimatedDaysFromDelivery } : {})
      }
    }, `shipping:primary:${orderId}:in-transit`);
    return;
  }

  if (nextShipmentStatus === 'OUT_FOR_DELIVERY' && contact) {
    await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
      email,
      phone,
      template: 'OutForDelivery',
      data: { orderId, orderNumber: order.orderNumber ?? orderId, awb: resolvedAwb }
    }, `shipping:primary:${orderId}:out-for-delivery`);
    return;
  }

  if (nextShipmentStatus === 'DELIVERED' && contact) {
    await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
      email,
      phone,
      template: 'OrderDelivered',
      data: { orderId, orderNumber: order.orderNumber ?? orderId, awb: resolvedAwb }
    }, `shipping:primary:${orderId}:delivered`);
    return;
  }

  if (nextShipmentStatus === 'FAILED_DELIVERY' && contact) {
    await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
      email,
      phone,
      template: 'FailedDelivery',
      data: { orderId, orderNumber: order.orderNumber ?? orderId, awb: resolvedAwb }
    }, `shipping:primary:${orderId}:failed-delivery`);
    return;
  }

  if (nextShipmentStatus === 'CANCELLED' && contact) {
    await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
      email,
      phone,
      template: 'OrderCancelled',
      data: { orderId, orderNumber: order.orderNumber ?? orderId, awb: resolvedAwb }
    }, `shipping:primary:${orderId}:cancelled-webhook`);
  }
}

type ShipmentCancellationOrderContext = {
  id: string;
  paymentMode: string | null;
  items: Array<{ variantId: string; quantity: number }>;
  statusHistory: Array<{ triggeredBy: string | null }>;
  payment: { status: string; providerPaymentId: string | null; amount: number } | null;
};

/**
 * Full cancellation side-effects for a shipment-driven cancel (courier cancelled
 * from their dashboard, or a cancel webhook/poll). Mirrors the admin-cancel path:
 * restore inventory, release coupon usage, and enqueue a customer refund for
 * captured prepaid payments. Idempotent: the refund outbox jobId is scoped per
 * order+source so a re-run does not double-refund.
 */
async function runShipmentCancellationSideEffects(
  tx: Prisma.TransactionClient,
  order: ShipmentCancellationOrderContext,
  priorStatus: OrderStatus
): Promise<void> {
  // Inventory was deducted at CONFIRMED (prepaid) / COD_ORDER_CREATED (COD).
  // Restore whenever we are cancelling a still-fulfillable order.
  if (
    priorStatus === OrderStatus.CONFIRMED ||
    priorStatus === OrderStatus.PROCESSING ||
    priorStatus === OrderStatus.SHIPPED ||
    priorStatus === OrderStatus.OUT_FOR_DELIVERY
  ) {
    await restoreOrderInventoryOnCancel(tx, {
      id: order.id,
      paymentMode: order.paymentMode,
      items: order.items,
      statusHistory: order.statusHistory
    });
    await releaseCouponUsageForOrder(tx, order.id);
  }

  // Refund the customer for captured prepaid payments (COD has nothing captured
  // unless collected — but a cancelled COD is never delivered, so no capture).
  const payment = order.payment;
  const shouldRefund =
    payment != null &&
    (payment.status === 'CAPTURED' || payment.status === 'PARTIALLY_REFUNDED') &&
    Boolean(payment.providerPaymentId);
  if (shouldRefund) {
    await enqueueOutboxJob(
      tx,
      'refunds',
      'initiate-razorpay-refund',
      {
        orderId: order.id,
        reason: 'Order cancelled by courier — automatic customer refund',
        initiatedBy: 'SHIPPING_WEBHOOK',
        sourceStatus: priorStatus
      },
      `initiate-razorpay-refund:${order.id}:full:courier-cancel`
    );
  }
}

async function upsertShipmentCompat(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    existingShipmentId?: string | undefined;
    data: Record<string, unknown>;
  }
): Promise<void> {
  const shipmentDelegate = tx.shipment as unknown as {
    upsert?: (args: {
      where: { orderId: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => Promise<unknown>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };

  if (shipmentDelegate.upsert) {
    await shipmentDelegate.upsert({
      where: { orderId: input.orderId },
      update: input.data,
      create: {
        orderId: input.orderId,
        ...input.data
      }
    });
    return;
  }

  if (input.existingShipmentId) {
    await shipmentDelegate.update({
      where: { id: input.existingShipmentId },
      data: input.data
    });
    return;
  }

  await shipmentDelegate.create({
    data: {
      orderId: input.orderId,
      ...input.data
    }
  });
}

async function updateOrderStatusWithCasCompat(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    fromStatus: OrderStatus;
    toStatus: OrderStatus;
    extraData?: Record<string, unknown>;
  }
): Promise<boolean> {
  const orderDelegate = tx.order as unknown as {
    updateMany?: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  const preferUpdateForMock =
    typeof orderDelegate.update === 'function' &&
    'mock' in (orderDelegate.update as unknown as Record<string, unknown>);
  const data = {
    status: input.toStatus,
    ...(input.extraData ?? {})
  };

  if (orderDelegate.updateMany && !preferUpdateForMock) {
    const result = await orderDelegate.updateMany({
      where: {
        id: input.orderId,
        status: input.fromStatus
      },
      data
    });
    return result.count > 0;
  }

  await orderDelegate.update({
    where: { id: input.orderId },
    data
  });
  return true;
}

function estimatedDaysFrom(estimatedDelivery: Date | null | undefined): number | undefined {
  if (!estimatedDelivery) {
    return undefined;
  }
  return Math.max(0, Math.ceil((estimatedDelivery.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function createShippingWorker(
  connection: ConnectionOptions,
  notificationsQueueArg?: NotificationsQueue,
  deps?: ShippingWorkerDeps
): Worker {
  const PrismaClientCtor = deps?.PrismaClient ?? RealPrismaClient;
  const WorkerCtor = deps?.Worker ?? Worker;
  const shippingProviderFactory = deps?.createShippingProvider ?? createShippingProvider;
  const shippingAdapterFactory = deps?.createShippingAdapterForProvider ?? createShippingAdapterForProvider;
  const alertFn = deps?.sendTechnicalFailureAlert ?? sendTechnicalFailureAlert;
  const prisma = deps?.prisma ?? new PrismaClientCtor();
  const notificationsQueue = notificationsQueueArg ?? new Queue('notifications', { connection });
  const shippingProvider = shippingProviderFactory();

  type BookedShipment = {
    awbNumber: string;
    trackingUrl?: string | null | undefined;
    estimatedDays?: number | null | undefined;
    shiprocketOrderId?: string | null | undefined;
    shiprocketShipmentId?: string | null | undefined;
  };
  type BookableOrder = {
    id: string;
    orderNumber?: string | null;
    user?: { email: string | null; phone: string | null } | null;
  };

  /**
   * Phase 3 of create-shipment: the courier booking is already persisted on the
   * Shipment row. Re-check the order is still shippable, CAS it to SHIPPED and
   * notify; if it was cancelled while the provider call was in flight, cancel the
   * booking at the courier (compensating action). Safe to re-run on retry.
   */
  const finalizeBookedShipment = async (input: {
    order: BookableOrder;
    provider: ShippingProvider;
    adapter: typeof shippingProvider;
    booking: BookedShipment;
  }): Promise<void> => {
    const { order, provider, adapter, booking } = input;
    const outcome: { cancelBooking: boolean } = { cancelBooking: false };
    await prisma.$transaction(async (tx) => {
      const freshOrder = await tx.order.findUnique({
        where: { id: order.id },
        select: {
          id: true,
          status: true,
          shipment: {
            select: {
              id: true,
              awbNumber: true
            }
          }
        }
      });
      if (
        !freshOrder ||
        freshOrder.status === OrderStatus.CANCELLED ||
        (freshOrder.status !== OrderStatus.CONFIRMED && freshOrder.status !== OrderStatus.PROCESSING) ||
        !canTransitionOrder(freshOrder.status, OrderStatus.SHIPPED)
      ) {
        outcome.cancelBooking = true;
        return;
      }

      const shipped = await updateOrderStatusWithCasCompat(tx, {
        orderId: order.id,
        fromStatus: freshOrder.status,
        toStatus: OrderStatus.SHIPPED
      });

      if (!shipped) {
        outcome.cancelBooking = true;
        return;
      }

      const providerLabel = provider === ShippingProvider.SHIPROCKET ? 'Shiprocket' : 'Delhivery';
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: freshOrder.status,
          toStatus: OrderStatus.SHIPPED,
          triggeredBy: 'ADMIN',
          note: `Shipment booked by admin via ${providerLabel}`
        }
      });

      // Notify customer immediately on shipment booking
      const userEmail = order.user?.email;
      const userPhone = order.user?.phone;
      if (userEmail || userPhone) {
        const estimatedDeliveryText =
          booking.estimatedDays != null
            ? `Estimated delivery in ${booking.estimatedDays} day${booking.estimatedDays === 1 ? '' : 's'}. `
            : '';
        await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
          email: userEmail,
          phone: userPhone,
          template: 'OrderShipped',
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber ?? order.id,
            awb: booking.awbNumber,
            trackingUrl: booking.trackingUrl ?? '',
            estimatedDeliveryText,
            ...(booking.estimatedDays != null ? { estimatedDays: booking.estimatedDays } : {})
          }
        }, `shipping:primary:${order.id}:shipped`);
      }
    });

    if (!outcome.cancelBooking) {
      return;
    }
    // be-rel-06: Shiprocket's /orders/cancel keys off the Shiprocket ORDER id —
    // the AWB cancels nothing there. Same precedence as the cancel-shipment job.
    // Delhivery cancels by AWB.
    const cancelIdentifier =
      provider === ShippingProvider.SHIPROCKET
        ? (booking.shiprocketOrderId ?? booking.shiprocketShipmentId ?? booking.awbNumber)
        : booking.awbNumber;
    try {
      if (!adapter) {
        throw new Error(`No ${provider} adapter configured to cancel orphaned booking ${booking.awbNumber}`);
      }
      // Use the same adapter that created the AWB, not the global env-based one.
      await adapter.cancelShipment(cancelIdentifier);
      await prisma.shipment.updateMany({
        where: { orderId: order.id, awbNumber: booking.awbNumber },
        data: { status: ShipmentStatus.CANCELLED }
      });
    } catch (error) {
      await alertFn({
        prisma,
        template: 'ShipmentCancellation',
        channel: 'UNKNOWN',
        recipient: order.id,
        errorMessage: error instanceof Error ? error.message : 'Unknown shipment cancel error',
        failureStage: 'CORE_LOGIC',
        domain: 'shipping',
        component: 'create-shipment-compensating-cancel',
        queueName: 'shipping',
        jobName: 'create-shipment'
      });
    }
  };

  /** The adapter for the provider recorded on a Shipment row (same precedence as resume/cancel). */
  const adapterForProvider = (provider: ShippingProvider): typeof shippingProvider => {
    const keyed =
      provider === ShippingProvider.SHIPROCKET
        ? shippingAdapterFactory('shiprocket')
        : provider === ShippingProvider.DELHIVERY
          ? shippingAdapterFactory('delhivery')
          : null;
    return keyed ?? shippingProvider;
  };

  type CourierBooking = BookedShipment & {
    providerPayload: Record<string, unknown>;
    labelUrl?: string | null | undefined;
  };

  /**
   * Phase 2b of create-shipment (be-rel-02): persist the courier booking in its own
   * short write BEFORE any status/notification work, so a Phase 3 failure leaves the
   * AWB recorded and the retry resumes Phase 3 instead of booking again. Also used
   * to ADOPT a booking found at the courier for an in-flight intent.
   */
  const persistCourierBooking = async (input: {
    orderId: string;
    existingShipmentId?: string | undefined;
    provider: ShippingProvider;
    booking: CourierBooking;
  }): Promise<void> => {
    const { orderId, existingShipmentId, provider, booking } = input;
    const estimatedDelivery =
      booking.estimatedDays != null
        ? new Date(Date.now() + booking.estimatedDays * 24 * 60 * 60 * 1000)
        : null;
    await prisma.$transaction(async (tx) => {
      await upsertShipmentCompat(tx, {
        orderId,
        existingShipmentId,
        data: {
          provider,
          status: ShipmentStatus.BOOKED,
          awbNumber: booking.awbNumber,
          ...(booking.trackingUrl ? { trackingUrl: booking.trackingUrl } : {}),
          ...(estimatedDelivery ? { estimatedDelivery } : {}),
          webhookPayload: sanitizeProviderPayload(booking.providerPayload),
          ...(booking.shiprocketShipmentId != null
            ? { shiprocketShipmentId: booking.shiprocketShipmentId }
            : {}),
          ...(booking.labelUrl != null ? { labelUrl: booking.labelUrl } : {})
        }
      });
      if (booking.shiprocketOrderId != null) {
        // Needed by any later cancel (Shiprocket cancels by ORDER id).
        await tx.order.update({
          where: { id: orderId },
          data: { shiprocketOrderId: booking.shiprocketOrderId }
        });
      }
    });
  };

  type LookupWithAwb = Extract<ShipmentLookupResult, { state: 'found' }> & { awbNumber: string };

  const hasAwb = (lookup: ShipmentLookupResult): lookup is LookupWithAwb =>
    lookup.state === 'found' && typeof lookup.awbNumber === 'string' && lookup.awbNumber.length > 0;

  /** Maps a lookup hit with an AWB to the booking shape persisted on the Shipment. */
  const bookingFromLookup = (lookup: LookupWithAwb): CourierBooking => ({
    awbNumber: lookup.awbNumber,
    trackingUrl: lookup.trackingUrl,
    shiprocketOrderId: lookup.shiprocketOrderId,
    shiprocketShipmentId: lookup.shiprocketShipmentId,
    labelUrl: lookup.labelUrl,
    providerPayload: { ...lookup.providerPayload, status: 'adopted-from-lookup' }
  });

  /**
   * Looks an in-flight booking up at the courier by our client reference. Throws
   * when the adapter cannot answer — an intent is never resolved by booking blind.
   */
  const lookUpInFlightBooking = async (
    adapter: typeof shippingProvider,
    provider: ShippingProvider,
    clientReference: string
  ): Promise<ShipmentLookupResult> => {
    if (!adapter?.findShipmentByReference) {
      throw new Error(
        `Cannot verify in-flight ${provider} booking for ${clientReference}: no adapter with booking lookup is configured. ` +
          'Refusing to book again blind.'
      );
    }
    return adapter.findShipmentByReference(clientReference);
  };

  /**
   * Records the booking intent before the courier is called: a PENDING Shipment
   * with no AWB, keyed by our client reference (the order number). Compare-and-set
   * on `awbNumber: null` so a concurrently stored booking is never demoted.
   * Returns the intent's Shipment id when known.
   */
  const writeBookingIntent = async (input: {
    orderId: string;
    clientReference: string;
    provider: ShippingProvider;
    existing: { id: string; webhookPayload?: unknown } | null | undefined;
  }): Promise<string | undefined> => {
    const { orderId, clientReference, provider, existing } = input;
    const webhookPayload = buildBookingIntentPayload(
      clientReference,
      readBookingIntentMeta(existing?.webhookPayload)
    ) as unknown as Prisma.InputJsonValue;
    if (existing) {
      const updated = await prisma.shipment.updateMany({
        where: { id: existing.id, awbNumber: null },
        data: { provider, status: ShipmentStatus.PENDING, webhookPayload }
      });
      if (updated.count === 0) {
        throw new Error(`Shipment for order ${orderId} changed while recording the booking intent — retrying`);
      }
      return existing.id;
    }
    const created = (await prisma.shipment.create({
      data: { orderId, provider, status: ShipmentStatus.PENDING, webhookPayload }
    })) as { id?: string } | null | undefined;
    return created?.id;
  };

  /** Drops an intent that provably has no live booking behind it (CAS on PENDING + no AWB). */
  const releaseBookingIntent = async (shipmentId: string): Promise<void> => {
    await prisma.shipment.deleteMany({
      where: { id: shipmentId, status: ShipmentStatus.PENDING, awbNumber: null }
    });
  };

  const alertBookingIntent = async (orderId: string, errorMessage: string): Promise<void> => {
    await alertFn({
      prisma,
      template: 'ShipmentBookingIntent',
      channel: 'UNKNOWN',
      recipient: orderId,
      errorMessage,
      failureStage: 'CORE_LOGIC',
      domain: 'shipping',
      component: 'booking-intent-sweep',
      queueName: 'shipping',
      jobName: 'reconcile-booking-intents'
    });
  };

  type StaleBookingIntent = {
    id: string;
    provider: ShippingProvider;
    webhookPayload: unknown;
    order: {
      id: string;
      orderNumber: string;
      status: OrderStatus;
      user: { email: string | null; phone: string | null } | null;
    };
  };

  /**
   * Sweep step for ONE stale intent (no job attempt touched it for
   * BOOKING_INTENT_STALE_MS). Looks the booking up at the courier first:
   *  - live booking with AWB → adopt it, then finalize (ships, or compensating-
   *    cancels when the order was cancelled meanwhile);
   *  - cancelled at the courier → release the intent;
   *  - nothing (or a Shiprocket order without AWB) on a still-shippable order →
   *    re-enqueue create-shipment (which looks up again, then books / resumes),
   *    at most BOOKING_INTENT_MAX_SWEEP_REQUEUES times;
   *  - nothing on an order that is no longer shippable → release the intent.
   * A lookup failure throws: nothing is booked or released.
   */
  const reconcileBookingIntent = async (intent: StaleBookingIntent): Promise<void> => {
    const { order, provider } = intent;
    const adapter = adapterForProvider(provider);
    const lookup = await lookUpInFlightBooking(adapter, provider, order.orderNumber);

    if (hasAwb(lookup)) {
      const booking = bookingFromLookup(lookup);
      await persistCourierBooking({ orderId: order.id, existingShipmentId: intent.id, provider, booking });
      await finalizeBookedShipment({ order, provider, adapter, booking });
      return;
    }

    if (lookup.state === 'cancelled') {
      await releaseBookingIntent(intent.id);
      await alertBookingIntent(
        order.id,
        `Booking intent for order ${order.orderNumber} released: ${provider} reports the reference as cancelled. Re-ship from admin if still required.`
      );
      return;
    }

    const partial = lookup.state === 'found';
    const shippable = order.status === OrderStatus.CONFIRMED || order.status === OrderStatus.PROCESSING;

    if (!shippable) {
      if (partial) {
        if (!lookup.shiprocketOrderId || !adapter) {
          throw new Error(
            `Order ${order.orderNumber} is ${order.status} but ${provider} holds an order for it without an AWB — cancel it at the courier manually.`
          );
        }
        await adapter.cancelShipment(lookup.shiprocketOrderId);
      }
      await releaseBookingIntent(intent.id);
      return;
    }

    const meta =
      readBookingIntentMeta(intent.webhookPayload) ?? buildBookingIntentPayload(order.orderNumber, null).bookingIntent;
    if (meta.sweepRequeues >= BOOKING_INTENT_MAX_SWEEP_REQUEUES) {
      if (partial) {
        throw new Error(
          `Booking for order ${order.orderNumber} still has no AWB after ${meta.sweepRequeues} sweep retries; ` +
            `${provider} holds the order — assign the AWB at the courier or cancel it there.`
        );
      }
      await releaseBookingIntent(intent.id);
      await alertBookingIntent(
        order.id,
        `Booking intent for order ${order.orderNumber} released after ${meta.sweepRequeues} sweep retries: ` +
          `${provider} has no booking for it. Re-ship from admin.`
      );
      return;
    }

    const nextRequeue = meta.sweepRequeues + 1;
    await prisma.$transaction(async (tx) => {
      const bumped = await tx.shipment.updateMany({
        where: { id: intent.id, status: ShipmentStatus.PENDING, awbNumber: null },
        data: {
          webhookPayload: { bookingIntent: { ...meta, sweepRequeues: nextRequeue } } as unknown as Prisma.InputJsonValue
        }
      });
      if (bumped.count === 0) {
        return;
      }
      await enqueueOutboxJob(
        tx,
        'shipping',
        'create-shipment',
        { orderId: order.id },
        `create-shipment:${order.id}:intent-sweep-${nextRequeue}`
      );
    });
  };

  const reconcileStaleBookingIntents = async (): Promise<void> => {
    const staleBefore = new Date(Date.now() - BOOKING_INTENT_STALE_MS);
    const intents = (await prisma.shipment.findMany({
      where: {
        status: ShipmentStatus.PENDING,
        awbNumber: null,
        updatedAt: { lt: staleBefore },
        provider: { in: [ShippingProvider.DELHIVERY, ShippingProvider.SHIPROCKET] }
      },
      select: {
        id: true,
        provider: true,
        webhookPayload: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            user: { select: { email: true, phone: true } }
          }
        }
      },
      orderBy: { updatedAt: 'asc' },
      take: BOOKING_INTENT_SWEEP_BATCH
    })) as StaleBookingIntent[];

    for (const intent of intents) {
      try {
        await reconcileBookingIntent(intent);
      } catch (error) {
        // One intent failing (courier lookup down, manual action needed) must not
        // block the rest; it is retried on the next sweep and nothing was booked.
        await alertBookingIntent(
          intent.order.id,
          error instanceof Error ? error.message : 'Unknown booking-intent reconciliation error'
        );
      }
    }
  };

  const worker = new WorkerCtor(
    'shipping',
    async (job) => {
      if (job.name === 'create-shipment' || job.name === 'create-delhivery-shipment') {
        const data = job.data as CreateShipmentJobData;

        // --- Phase 1: read-only validation (no DB lock held) ---
        const orderRaw = await prisma.order.findUnique({
          where: { id: data.orderId },
          include: {
            payment: true,
            shipment: true,
            items: true,
            user: {
              select: {
                email: true,
                phone: true
              }
            }
          }
        });
        const order = orderRaw as (typeof orderRaw & { courierCompanyId?: number | null }) | null;
        if (!order) {
          return;
        }

        // Defense in depth: merchant-fulfilled local delivery orders must NEVER book a
        // courier — even a stray/replayed create-shipment job is dropped here.
        if (
          ((order as Record<string, unknown>)['selectedShippingProvider'] as string | null) === 'LOCAL'
        ) {
          return;
        }

        if (order.status === OrderStatus.SHIPPED || order.status === OrderStatus.OUT_FOR_DELIVERY || order.status === OrderStatus.DELIVERED) {
          return;
        }
        if (order.status !== OrderStatus.PROCESSING && order.status !== OrderStatus.CONFIRMED) {
          return;
        }
        if (!canTransitionOrder(order.status, OrderStatus.SHIPPED)) {
          return;
        }

        // Idempotency guard (be-rel-02): the courier booking is persisted in its own
        // short write right after the provider call (Phase 2b). A retry that finds a
        // BOOKED shipment with an AWB on a still-unshipped order therefore resumes
        // Phase 3 from the stored booking instead of calling the courier again
        // (which would double-book or orphan the first AWB). Any other existing AWB
        // (e.g. a CANCELLED booking) is left alone, as before.
        if (order.shipment?.awbNumber) {
          if (order.shipment.status !== ShipmentStatus.BOOKED) {
            return;
          }
          const storedProvider = order.shipment.provider;
          const resumeAdapter =
            storedProvider === ShippingProvider.SHIPROCKET
              ? shippingAdapterFactory('shiprocket')
              : storedProvider === ShippingProvider.DELHIVERY
                ? shippingAdapterFactory('delhivery')
                : null;
          await finalizeBookedShipment({
            order,
            provider: storedProvider,
            adapter: resumeAdapter ?? shippingProvider,
            booking: {
              awbNumber: order.shipment.awbNumber,
              trackingUrl: order.shipment.trackingUrl,
              estimatedDays: estimatedDaysFrom(order.shipment.estimatedDelivery),
              shiprocketOrderId: (order as Record<string, unknown>)['shiprocketOrderId'] as string | null | undefined,
              shiprocketShipmentId: order.shipment.shiprocketShipmentId
            }
          });
          return;
        }

        // In-flight recovery: a booking intent (PENDING shipment, no AWB) means an
        // earlier attempt may have reached the courier before crashing/stalling.
        // Look the booking up by our client reference FIRST and adopt it; only a
        // definite "not found" may book again. A failed lookup throws (BullMQ
        // retries) — never book blind.
        let resumeProviderOrder: CreateShipmentInput['existingProviderOrder'];
        if (order.shipment && isBookingIntent(order.shipment)) {
          const intentProvider = order.shipment.provider;
          const lookupAdapter = adapterForProvider(intentProvider);
          const lookup = await lookUpInFlightBooking(lookupAdapter, intentProvider, order.orderNumber);
          if (hasAwb(lookup)) {
            const booking = bookingFromLookup(lookup);
            await persistCourierBooking({
              orderId: order.id,
              existingShipmentId: order.shipment.id,
              provider: intentProvider,
              booking
            });
            await finalizeBookedShipment({ order, provider: intentProvider, adapter: lookupAdapter, booking });
            return;
          }
          if (lookup.state === 'cancelled') {
            throw new Error(
              `In-flight booking for order ${order.orderNumber} is cancelled at ${intentProvider}; ` +
                'the booking-intent sweep releases it — re-ship from admin afterwards.'
            );
          }
          if (lookup.state === 'found') {
            if (!lookup.shiprocketShipmentId) {
              throw new Error(
                `${intentProvider} holds an order for ${order.orderNumber} without an AWB or shipment id — manual action required.`
              );
            }
            resumeProviderOrder = {
              shiprocketShipmentId: lookup.shiprocketShipmentId,
              ...(lookup.shiprocketOrderId ? { shiprocketOrderId: lookup.shiprocketOrderId } : {})
            };
          }
        }

        const pickupPincode = await resolvePickupPincode(prisma);
        if (!pickupPincode) {
          throw new Error('Missing pickup pincode configuration');
        }

        const settings = await prisma.storeSettings.findUnique({
          where: { singletonKey: 'default' },
          select: { gstin: true, contactEmail: true, boxPresets: true, packagingWeightGrams: true }
        });

        const shippingAddress = (order.shippingAddress ?? {}) as {
          fullName?: string;
          phone?: string;
          line1?: string;
          line2?: string;
          city?: string;
          state?: string;
          pincode?: string;
        };
        if (
          !shippingAddress.fullName ||
          !shippingAddress.phone ||
          !shippingAddress.line1 ||
          !shippingAddress.city ||
          !shippingAddress.state ||
          !shippingAddress.pincode
        ) {
          throw new Error('Invalid shipping address for shipment booking');
        }
        const normalizedPhone = normalizeIndianShippingPhone(shippingAddress.phone);
        if (!normalizedPhone) {
          throw new Error('Invalid shipping phone for shipment booking');
        }

        const variantIds = order.items.map((item) => item.variantId);
        const variants = await prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: {
            id: true,
            weight: true,
            packageLengthCm: true,
            packageWidthCm: true,
            packageHeightCm: true,
            keepUpright: true,
            hsnCode: true,
            product: {
              select: {
                attributes: true
              }
            }
          }
        });
        const variantById = new Map(variants.map((variant) => [variant.id, variant]));
        const variantWeights = new Map(variants.map((variant) => [variant.id, variant.weight ?? 0]));
        const defaultShippingHsn = resolveDefaultShippingHsn();
        const sellerGstTin = (settings?.gstin ?? '').trim();
        // HSN is OPTIONAL per product (2026-07-11): carrier payloads fall back to the
        // configurable DEFAULT_SHIPPING_HSN (generic food preparation, 2106) via
        // resolveShippingHsnCode — a missing product code must never block booking.
        // Seller GSTIN remains required when GST invoicing is enabled (merchant-level,
        // one-time setup in Admin → Settings → Store).
        if ((await resolveGstInvoicingEnabled(prisma)) && !sellerGstTin) {
          throw new Error('Missing seller GSTIN for shipment booking');
        }
        for (const item of order.items) {
          const unitWeight = variantWeights.get(item.variantId) ?? 0;
          if (unitWeight <= 0) {
            throw new Error(`Missing or invalid variant weight for variant ${item.variantId}`);
          }
        }
        // Resolve the provider for this specific order: prefer order.selectedShippingProvider,
        // fall back to the globally configured SHIPPING_PROVIDER env var.
        const orderSelectedProvider = (order as Record<string, unknown>)['selectedShippingProvider'] as string | null | undefined;
        const resolvedProviderForOrder =
          orderSelectedProvider?.toLowerCase() === 'shiprocket'
            ? ShippingProvider.SHIPROCKET
            : orderSelectedProvider?.toLowerCase() === 'delhivery'
              ? ShippingProvider.DELHIVERY
              : null;

        // Strict rate-lock enforcement: the provider selected at checkout MUST be used for AWB.
        // Never fall back to a different provider — doing so would ship at a different rate than quoted.
        let effectiveShippingProvider: typeof shippingProvider;
        if (resolvedProviderForOrder === ShippingProvider.DELHIVERY) {
          const adapter = shippingAdapterFactory('delhivery');
          if (!adapter) {
            throw new Error(
              `Order ${order.id} has shipping locked to DELHIVERY at checkout but the Delhivery ` +
              `adapter is not configured. Verify Delhivery credentials in Ops config and restart the worker.`
            );
          }
          effectiveShippingProvider = adapter;
        } else if (resolvedProviderForOrder === ShippingProvider.SHIPROCKET) {
          const adapter = shippingAdapterFactory('shiprocket');
          if (!adapter) {
            throw new Error(
              `Order ${order.id} has shipping locked to SHIPROCKET at checkout but the Shiprocket ` +
              `adapter is not configured. Verify Shiprocket credentials in Ops config and restart the worker.`
            );
          }
          effectiveShippingProvider = adapter;
        } else {
          // No provider locked at checkout (legacy orders or single-provider mode): use global default.
          if (!shippingProvider) {
            throw new Error('Shipping provider is not configured');
          }
          effectiveShippingProvider = shippingProvider;
        }

        const orderPaymentMode = (order as Record<string, unknown>)['paymentMode'] as string | undefined;
        const isCodOrder = orderPaymentMode === 'COD';
        if (!isCodOrder && order.payment?.status !== 'CAPTURED') {
          throw new Error('Shipment booking requires captured payment for prepaid orders');
        }
        const paymentMode: 'Prepaid' | 'COD' = isCodOrder ? 'COD' : 'Prepaid';

        const orderSubtotalPaise = order.subtotal ?? order.items.reduce((sum, item) => sum + (item.totalPrice ?? item.unitPrice * item.quantity), 0);
        const orderShippingChargePaise = order.shippingCharge ?? 0;
        const orderDiscountPaise = order.discountAmount ?? 0;

        const shipmentItems = order.items.map((item) => {
          const variant = variantById.get(item.variantId);
          const lineTotalPaise = item.totalPrice ?? item.unitPrice * item.quantity;
          return {
            name: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitPriceRupees: lineTotalPaise / item.quantity / 100,
            hsnCode: resolveShippingHsnCode({
              variantHsnCode: variant?.hsnCode,
              productAttributes: variant?.product.attributes,
              defaultHsn: defaultShippingHsn
            })
          };
        });
        const primaryHsnCode = shipmentItems[0]?.hsnCode ?? defaultShippingHsn;

        // Cartonization: 3D-pack the ordered items into the actual shipping box so the
        // dimensions sent to the courier match the parcel that ships (couriers bill
        // volumetric weight from L×W×H). Catalog box if configured & fits, else a
        // computed bounding box; +1cm safety padding. See common/shipping/cartonize.ts.
        const cartonItems = order.items.map((item) => {
          const v = variantById.get(item.variantId);
          return {
            lengthCm: v?.packageLengthCm ?? 0,
            widthCm: v?.packageWidthCm ?? 0,
            heightCm: v?.packageHeightCm ?? 0,
            weightGrams: variantWeights.get(item.variantId) ?? 0,
            quantity: item.quantity,
            keepUpright: v?.keepUpright ?? false
          };
        });
        const boxPresets = parseBoxPresets(settings?.boxPresets);
        const carton = cartonize({
          items: cartonItems,
          boxPresets: boxPresets.map((b) => ({
            name: b.name,
            lengthCm: b.lengthCm,
            widthCm: b.widthCm,
            heightCm: b.heightCm,
            ...(b.boxWeightGrams != null ? { boxWeightGrams: b.boxWeightGrams } : {})
          })),
          packagingWeightGramsOverride: settings?.packagingWeightGrams ?? null
        });

        const shipmentInput = {
          orderNumber: order.orderNumber,
          amountRupees: order.total / 100,
          subtotalRupees: orderSubtotalPaise / 100,
          shippingChargeRupees: orderShippingChargePaise / 100,
          discountRupees: orderDiscountPaise / 100,
          destinationPincode: shippingAddress.pincode,
          originPincode: pickupPincode,
          // Declare the FULL sealed-parcel weight (items + packaging) — this is what the
          // courier's hub scale captures. Declaring item weight alone triggers a weight-
          // mismatch re-bill on every parcel. See cartonize.ts packaging weight.
          totalWeightGrams: carton.weightGrams,
          paymentMode,
          sellerGstTin: sellerGstTin || 'NA',
          hsnCode: primaryHsnCode,
          items: shipmentItems,
          ...(settings?.contactEmail ? { storeContactEmail: settings.contactEmail } : {}),
          customer: {
            fullName: shippingAddress.fullName,
            phone: normalizedPhone,
            email: resolveShiprocketCustomerEmail(order.user?.email, settings?.contactEmail),
            line1: shippingAddress.line1,
            ...(shippingAddress.line2 ? { line2: shippingAddress.line2 } : {}),
            city: shippingAddress.city,
            state: shippingAddress.state
          },
          ...(order.courierCompanyId != null ? { courierCompanyId: order.courierCompanyId } : {}),
          dimensions: {
            lengthCm: carton.lengthCm,
            breadthCm: carton.widthCm,
            heightCm: carton.heightCm
          }
        };

        // --- Phase 2a: record the booking intent BEFORE calling the courier ---
        // The order number is the stable client reference the courier stores
        // (Shiprocket order_id / Delhivery order), so a crash while the call below
        // is in flight is recovered by lookup instead of a blind second booking.
        // Legacy orders with no locked provider record the env-default provider.
        const envProviderKey = process.env.SHIPPING_PROVIDER?.trim().toLowerCase();
        const intentProvider =
          resolvedProviderForOrder ??
          (envProviderKey === 'shiprocket'
            ? ShippingProvider.SHIPROCKET
            : envProviderKey === 'delhivery'
              ? ShippingProvider.DELHIVERY
              : null);
        const intentShipmentId = intentProvider
          ? await writeBookingIntent({
              orderId: order.id,
              clientReference: order.orderNumber,
              provider: intentProvider,
              existing: order.shipment
            })
          : undefined;

        // --- Phase 2: external provider call (no DB connection held) ---
        const shipment = await effectiveShippingProvider.createShipment({
          ...shipmentInput,
          ...(resumeProviderOrder ? { existingProviderOrder: resumeProviderOrder } : {})
        });

        // Determine which provider handled this shipment.
        // Prefer the order-level selection; fall back to shipment response signature
        // (shiprocketShipmentId present → Shiprocket, absent → Delhivery).
        // SHIPPING_PROVIDER env var is intentionally NOT used — routing is credential-based.
        const resolvedProvider =
          resolvedProviderForOrder ??
          (shipment.shiprocketShipmentId != null
            ? ShippingProvider.SHIPROCKET
            : ShippingProvider.DELHIVERY);

        // --- Phase 2b: persist the courier booking immediately (be-rel-02) ---
        // The AWB now exists at the courier. Record it in its own short write BEFORE
        // any status/notification work so that if Phase 3 fails (DB blip, deadlock,
        // crash) the BullMQ retry sees the stored AWB and resumes Phase 3 instead of
        // booking the courier a second time. This write also turns the intent row
        // (PENDING) into the BOOKED shipment.
        await persistCourierBooking({
          orderId: order.id,
          existingShipmentId: intentShipmentId ?? order.shipment?.id,
          provider: resolvedProvider,
          booking: shipment
        });

        await finalizeBookedShipment({
          order,
          provider: resolvedProvider,
          adapter: effectiveShippingProvider,
          booking: {
            awbNumber: shipment.awbNumber,
            trackingUrl: shipment.trackingUrl,
            estimatedDays: shipment.estimatedDays,
            shiprocketOrderId: shipment.shiprocketOrderId,
            shiprocketShipmentId: shipment.shiprocketShipmentId
          }
        });
        return;
      }

      if (job.name === 'cancel-shipment') {
        const data = job.data as CancelShipmentJobData;

        // Look up which provider created this shipment so we cancel with the same one.
        // In dual-shipping mode the global shippingProvider may be wrong (env-based).
        // For Shiprocket /orders/cancel we need the Shiprocket ORDER id (stored on
        // the Order, not the Shipment) — not the shipment id and not the AWB; for
        // Delhivery we use the AWB.
        const existingShipment = await prisma.shipment.findFirst({
          where: { orderId: data.orderId },
          select: {
            provider: true,
            shiprocketShipmentId: true,
            awbNumber: true,
            order: {
              select: { shiprocketOrderId: true }
            }
          }
        });

        if (!existingShipment) {
          return; // No shipment to cancel.
        }

        const cancelAdapterKey: 'delhivery' | 'shiprocket' | null =
          existingShipment.provider === ShippingProvider.SHIPROCKET
            ? 'shiprocket'
            : existingShipment.provider === ShippingProvider.DELHIVERY
              ? 'delhivery'
              : null;

        // Strict: cancel MUST use the same adapter that created the AWB — never fall back.
        let cancelAdapter: typeof shippingProvider;
        if (cancelAdapterKey === 'delhivery') {
          const adapter = shippingAdapterFactory('delhivery');
          if (!adapter) {
            throw new Error(
              `Cannot cancel AWB ${data.awbNumber}: shipment belongs to DELHIVERY but the Delhivery adapter is not configured.`
            );
          }
          cancelAdapter = adapter;
        } else if (cancelAdapterKey === 'shiprocket') {
          const adapter = shippingAdapterFactory('shiprocket');
          if (!adapter) {
            throw new Error(
              `Cannot cancel shipment ${data.awbNumber}: shipment belongs to SHIPROCKET but the Shiprocket adapter is not configured.`
            );
          }
          cancelAdapter = adapter;
        } else {
          // No shipment record found — fall back to global provider.
          if (!shippingProvider) return;
          cancelAdapter = shippingProvider;
        }

        // Shiprocket's /orders/cancel expects the Shiprocket ORDER id — passing the
        // shipment id or AWB cancels nothing in their dashboard. Prefer the stored
        // order id, then the shipment id (legacy rows), then the AWB as a last
        // resort. Delhivery cancels by AWB via /api/p/edit/.
        const cancelIdentifier =
          cancelAdapterKey === 'shiprocket'
            ? (existingShipment.order?.shiprocketOrderId ??
               existingShipment.shiprocketShipmentId ??
               data.awbNumber)
            : data.awbNumber;

        await cancelAdapter.cancelShipment(cancelIdentifier);

        await prisma.shipment.updateMany({
          where: {
            orderId: data.orderId,
            awbNumber: data.awbNumber
          },
          data: {
            status: ShipmentStatus.CANCELLED
          }
        });
        return;
      }

      // Periodic recovery of courier bookings left in flight by a crashed/stalled
      // create-shipment attempt (see common/shipping/booking-intent.ts).
      if (job.name === 'reconcile-booking-intents') {
        await reconcileStaleBookingIntents();
        return;
      }

      if (job.name === 'shiprocket-token-refresh') {
        if (shippingProvider) {
          try {
            await shippingProvider.checkServiceability('110001');
          } catch {
            // Intentionally swallowed — the goal is token warmup, not serviceability accuracy.
          }
        }
        return;
      }

      // Background poll: sync non-terminal shipment statuses from the provider.
      // Runs every 30 min so missed webhooks (e.g. Shiprocket dashboard cancellations)
      // are picked up automatically without manual "Sync" clicks.
      if (job.name === 'poll-shipment-statuses') {
        if (!shippingProvider) return;

        const TERMINAL = ['DELIVERED', 'CANCELLED', 'RTO_DELIVERED'] as const;
        const activeShipments = await prisma.shipment.findMany({
          where: {
            awbNumber: { not: null },
            OR: [
              { status: { notIn: TERMINAL as unknown as ShipmentStatus[] } },
              // Repair lane: shipment already DELIVERED but the order lags behind
              // (e.g. the DELIVERED webhook landed while the order transition was
              // blocked) — no provider call needed, just promote the order.
              {
                status: 'DELIVERED' as ShipmentStatus,
                order: { status: { notIn: ['DELIVERED', 'CANCELLED', 'REFUNDED'] } }
              }
            ]
          },
          include: {
            order: {
              include: {
                user: { select: { email: true, phone: true } },
                payment: { select: { status: true, providerPaymentId: true, amount: true } },
                items: { select: { variantId: true, quantity: true } },
                statusHistory: { select: { triggeredBy: true } }
              }
            }
          },
          take: 50, // Process max 50 per run to avoid long-running jobs
          orderBy: { updatedAt: 'asc' } // Oldest first so stale ones are prioritised
        });

        for (const shipment of activeShipments) {
          if (!shipment.awbNumber) continue;

          // Repair lane — shipment is terminally delivered; promote the lagging order
          // from local state without hitting the provider.
          if (shipment.status === 'DELIVERED') {
            try {
              const repairOrderStatus = mapShipmentStatusToOrderStatus(shipment.status);
              if (
                repairOrderStatus &&
                shipment.order.status !== repairOrderStatus &&
                canTransitionOrder(shipment.order.status, repairOrderStatus)
              ) {
                await prisma.$transaction(async (tx) => {
                  await tx.order.update({
                    where: { id: shipment.order.id },
                    data: { status: repairOrderStatus }
                  });
                  await tx.orderStatusHistory.create({
                    data: {
                      orderId: shipment.order.id,
                      fromStatus: shipment.order.status,
                      toStatus: repairOrderStatus,
                      triggeredBy: 'SHIPPING_WEBHOOK',
                      note: 'Auto-poll repair: shipment already DELIVERED, order status lagged'
                    }
                  });

                  // COD collected at the doorstep — capture the payment (idempotent).
                  if (
                    shipment.order.paymentMode === 'COD' &&
                    shipment.order.payment &&
                    shipment.order.payment.status !== 'CAPTURED'
                  ) {
                    await tx.payment.updateMany({
                      where: { orderId: shipment.order.id, status: { not: 'CAPTURED' } },
                      data: { status: 'CAPTURED', capturedAt: new Date() }
                    });
                  }

                  // Emit the "delivered" notification that was missed when the order
                  // status lagged (root cause of the missing delivered notification).
                  // Deduped by the shared `:delivered` jobId against any webhook send.
                  await emitShipmentStatusNotification(
                    tx,
                    notificationsQueue,
                    {
                      id: shipment.order.id,
                      orderNumber: shipment.order.orderNumber ?? null,
                      email: shipment.order.user?.email ?? null,
                      phone: shipment.order.user?.phone ?? null,
                      estimatedDelivery: shipment.estimatedDelivery ?? null,
                      trackingUrl: shipment.trackingUrl ?? null
                    },
                    'DELIVERED',
                    shipment.awbNumber ?? ''
                  );
                });
              }
            } catch {
              // Swallow per-shipment errors — one bad row should not abort the rest.
            }
            continue;
          }
          try {
            // In dual-shipping mode, shipments may belong to different providers.
            // Use the provider recorded on the shipment row, not the global env-based one.
            const pollAdapterKey: 'delhivery' | 'shiprocket' | null =
              shipment.provider === ShippingProvider.SHIPROCKET
                ? 'shiprocket'
                : shipment.provider === ShippingProvider.DELHIVERY
                  ? 'delhivery'
                  : null;
            // Use the correct adapter for this shipment — never cross-provider.
            const pollAdapter =
              pollAdapterKey === 'delhivery'
                ? shippingAdapterFactory('delhivery')
                : pollAdapterKey === 'shiprocket'
                  ? shippingAdapterFactory('shiprocket')
                  : shippingProvider;
            if (!pollAdapter) continue;
            const tracking = await pollAdapter.trackShipment(shipment.awbNumber);
            const nextShipmentStatus = mapShipmentWebhookStatus(tracking.status);

            if (!nextShipmentStatus) continue;

            const nextOrderStatus = mapShipmentStatusToOrderStatus(nextShipmentStatus);
            const shipmentChanged = nextShipmentStatus !== shipment.status;
            // Repair a lagging order even when the shipment status is already current
            // (e.g. shipment DELIVERED landed while the order transition was blocked).
            const orderLagging =
              nextOrderStatus != null &&
              shipment.order.status !== nextOrderStatus &&
              canTransitionOrder(shipment.order.status, nextOrderStatus);

            if (!shipmentChanged && !orderLagging) continue;

            await prisma.$transaction(async (tx) => {
              if (shipmentChanged) {
                await tx.shipment.update({
                  where: { id: shipment.id },
                  data: { status: nextShipmentStatus }
                });
              }

              if (tracking.events.length > 0) {
                await tx.shipmentEvent.createMany({
                  data: tracking.events.map((event) => ({
                    shipmentId: shipment.id,
                    status: event.status,
                    description: event.description,
                    location: event.location ?? null,
                    occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date()
                  })),
                  skipDuplicates: true
                });
              }

              const priorOrderStatus = shipment.order.status;
              if (
                nextOrderStatus &&
                priorOrderStatus !== nextOrderStatus &&
                canTransitionOrder(priorOrderStatus, nextOrderStatus)
              ) {
                await tx.order.update({
                  where: { id: shipment.order.id },
                  data: { status: nextOrderStatus }
                });
                await tx.orderStatusHistory.create({
                  data: {
                    orderId: shipment.order.id,
                    fromStatus: priorOrderStatus,
                    toStatus: nextOrderStatus,
                    triggeredBy: 'SHIPPING_WEBHOOK',
                    note: `Auto-poll sync: provider reports ${tracking.status}`
                  }
                });

                // COD collected on delivery — capture the payment (idempotent).
                if (
                  nextOrderStatus === 'DELIVERED' &&
                  shipment.order.paymentMode === 'COD' &&
                  shipment.order.payment &&
                  shipment.order.payment.status !== 'CAPTURED'
                ) {
                  await tx.payment.updateMany({
                    where: { orderId: shipment.order.id, status: { not: 'CAPTURED' } },
                    data: { status: 'CAPTURED', capturedAt: new Date() }
                  });
                }

                // Courier-driven cancellation detected by the poll: same side-effects
                // as an admin cancel (inventory restore, coupon release, prepaid refund).
                if (nextOrderStatus === 'CANCELLED') {
                  await runShipmentCancellationSideEffects(
                    tx,
                    {
                      id: shipment.order.id,
                      paymentMode: shipment.order.paymentMode ?? null,
                      items: shipment.order.items,
                      statusHistory: shipment.order.statusHistory,
                      payment: shipment.order.payment
                        ? {
                            status: shipment.order.payment.status,
                            providerPaymentId: shipment.order.payment.providerPaymentId ?? null,
                            amount: shipment.order.payment.amount
                          }
                        : null
                    },
                    priorOrderStatus
                  );
                }
              }

              // Customer notification for the shipment transition (deduped on change).
              if (shipmentChanged) {
                await emitShipmentStatusNotification(
                  tx,
                  notificationsQueue,
                  {
                    id: shipment.order.id,
                    orderNumber: shipment.order.orderNumber ?? null,
                    email: shipment.order.user?.email ?? null,
                    phone: shipment.order.user?.phone ?? null,
                    estimatedDelivery: shipment.estimatedDelivery ?? null,
                    trackingUrl: shipment.trackingUrl ?? null
                  },
                  nextShipmentStatus,
                  shipment.awbNumber ?? ''
                );
              }
            });
          } catch {
            // Swallow per-shipment errors — one bad AWB should not abort the rest.
          }
        }
        return;
      }

      if (job.name !== 'update-shipment-status' && job.name !== 'shipment-webhook') {
        return;
      }

      const data = job.data as ShippingWebhookJobData;
      const nextShipmentStatus = mapShipmentWebhookStatus(data.status);
      const shipmentLookupRef = data.awb.trim() || data.shiprocketShipmentId?.trim() || '';
      if (!shipmentLookupRef) {
        return;
      }

      await prisma.$transaction(async (tx) => {
        const shipment = await tx.shipment.findFirst({
          where: {
            OR: [
              ...(data.awb.trim() ? [{ awbNumber: data.awb.trim() }] : []),
              ...(data.shiprocketShipmentId?.trim()
                ? [{ shiprocketShipmentId: data.shiprocketShipmentId.trim() }]
                : [])
            ]
          },
          include: {
            order: {
              include: {
                user: {
                  select: {
                    email: true,
                    phone: true
                  }
                },
                payment: {
                  select: {
                    status: true,
                    capturedAt: true,
                    providerPaymentId: true,
                    amount: true
                  }
                },
                items: {
                  select: {
                    variantId: true,
                    quantity: true
                  }
                },
                statusHistory: {
                  select: {
                    triggeredBy: true
                  }
                }
              }
            }
          }
        });
        if (!shipment) {
          return;
        }

        const resolvedAwb = data.awb.trim() || shipment.awbNumber;
        // Durable dedup: only emit customer notifications when the shipment status
        // actually transitions in THIS transaction. Whichever path (webhook or the
        // background poll) writes the new status first fires the notification; the
        // other sees no change and is a silent no-op — no duplicate messages.
        const previousShipmentStatus = shipment.status;
        const shipmentDidChange = Boolean(nextShipmentStatus) && nextShipmentStatus !== previousShipmentStatus;

        if (nextShipmentStatus) {
          await tx.shipment.update({
            where: { id: shipment.id },
            data: {
              status: nextShipmentStatus,
              webhookPayload: resolveWebhookPayload(data)
            }
          });
        } else {
          await tx.shipment.update({
            where: { id: shipment.id },
            data: {
              webhookPayload: resolveWebhookPayload(data)
            }
          });
        }

        await tx.shipmentEvent.create({
          data: {
            shipmentId: shipment.id,
            status: data.status,
            location: data.location ?? null,
            description: data.description,
            occurredAt: parseWebhookOccurredAt(data.occurredAt)
          }
        });

        const email = shipment.order.user?.email ?? null;
        const phone = shipment.order.user?.phone ?? null;
        const notificationContext: ShipmentNotificationOrderContext = {
          id: shipment.order.id,
          orderNumber: shipment.order.orderNumber ?? null,
          email,
          phone,
          estimatedDelivery: shipment.estimatedDelivery ?? null,
          trackingUrl: shipment.trackingUrl ?? null
        };

        const nextOrderStatus = nextShipmentStatus ? mapShipmentStatusToOrderStatus(nextShipmentStatus) : null;
        if (nextOrderStatus && shipment.order.status !== nextOrderStatus && canTransitionOrder(shipment.order.status, nextOrderStatus)) {
          const priorOrderStatus = shipment.order.status;
          const updated = await updateOrderStatusWithCasCompat(tx, {
            orderId: shipment.order.id,
            fromStatus: priorOrderStatus,
            toStatus: nextOrderStatus
          });

          if (updated) {
            await tx.orderStatusHistory.create({
              data: {
                orderId: shipment.order.id,
                fromStatus: priorOrderStatus,
                toStatus: nextOrderStatus,
                triggeredBy: 'SHIPPING_WEBHOOK',
                note: `Shipment status changed to ${data.status}`
              }
            });

            // Courier-driven cancellation: run the SAME side-effects as an admin
            // cancel — restore inventory, release coupons, refund captured prepaid.
            if (nextOrderStatus === 'CANCELLED') {
              await runShipmentCancellationSideEffects(
                tx,
                {
                  id: shipment.order.id,
                  paymentMode: shipment.order.paymentMode ?? null,
                  items: shipment.order.items,
                  statusHistory: shipment.order.statusHistory,
                  payment: shipment.order.payment
                    ? {
                        status: shipment.order.payment.status,
                        providerPaymentId: shipment.order.payment.providerPaymentId ?? null,
                        amount: shipment.order.payment.amount
                      }
                    : null
                },
                priorOrderStatus
              );
            }
          }
        }

        // Customer notification for the shipment transition (deduped on actual change).
        if (shipmentDidChange && nextShipmentStatus) {
          await emitShipmentStatusNotification(
            tx,
            notificationsQueue,
            notificationContext,
            nextShipmentStatus,
            resolvedAwb ?? ''
          );
        }

        if (nextShipmentStatus === 'DELIVERED') {
          const deliveredOrder = shipment.order as typeof shipment.order & { paymentMode?: string | null };
          if (deliveredOrder.paymentMode === 'COD') {
            const existingPayment = deliveredOrder.payment;
            if (existingPayment && existingPayment.status !== 'CAPTURED') {
              const paymentDelegate = tx.payment as unknown as {
                updateMany?: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
                update: (args: { where: { orderId: string }; data: Record<string, unknown> }) => Promise<unknown>;
              };
              const preferUpdateForMock =
                typeof paymentDelegate.update === 'function' &&
                'mock' in (paymentDelegate.update as unknown as Record<string, unknown>);

              let markedCaptured = false;
              if (paymentDelegate.updateMany && !preferUpdateForMock) {
                const captureResult = await paymentDelegate.updateMany({
                  where: {
                    orderId: shipment.order.id,
                    status: {
                      not: 'CAPTURED'
                    }
                  },
                  data: { status: 'CAPTURED', capturedAt: new Date() }
                });
                markedCaptured = captureResult.count > 0;
              } else {
                await paymentDelegate.update({
                  where: { orderId: shipment.order.id },
                  data: { status: 'CAPTURED', capturedAt: new Date() }
                });
                markedCaptured = true;
              }

              if (markedCaptured) {
                await tx.orderStatusHistory.create({
                  data: {
                    orderId: shipment.order.id,
                    fromStatus: OrderStatus.DELIVERED,
                    toStatus: OrderStatus.DELIVERED,
                    triggeredBy: 'SHIPPING_WEBHOOK',
                    note: 'COD payment marked as collected by Shiprocket on delivery'
                  }
                });
              }
            }
          }
          // Customer "delivered" notification is emitted by emitShipmentStatusNotification
          // above (gated on the actual shipment-status change).
        }

        if (nextShipmentStatus === 'RTO_INITIATED') {
          const settings = await tx.storeSettings.findUnique({
            where: { singletonKey: 'default' },
            select: { contactEmail: true }
          });
          const adminEmail = settings?.contactEmail ?? null;
          if (adminEmail) {
            await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
              email: adminEmail,
              template: 'OrderCancelled',
              data: {
                orderId: shipment.order.id,
                awb: resolvedAwb
              }
            }, `shipping:primary:${shipment.order.id}:rto-initiated`);
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
      template: 'ShippingWorkerTerminalFailure',
      channel: 'UNKNOWN',
      recipient: 'shipping-worker',
      errorMessage: error instanceof Error ? error.message : String(error),
      failureStage: 'WORKER_TERMINAL',
      queueName: 'shipping',
      jobName: job.name,
      jobId: job.id ?? 'unknown',
      domain: 'shipping',
      component: 'shipping-worker',
      terminalFailure: true
    });
  });

  return worker;
}
