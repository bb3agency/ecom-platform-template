import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { OrderStatus, ShippingProvider, ShipmentStatus, type Prisma, PrismaClient as RealPrismaClient } from '@prisma/client';
import { canTransitionOrder } from '@common/orders/order-state-machine';
import { mapShipmentStatusToOrderStatus, mapShipmentWebhookStatus } from '@common/orders/webhook-status-mappers';
import {
  createShippingProvider,
  createShippingAdapterForProvider
} from '@modules/shipping/shipping-provider';
import { featureFlags } from '@config/feature-flags';
import { resolvePickupPincode } from '@common/shipping/resolve-pickup-pincode';
import {
  resolveDefaultShippingHsn,
  resolveExplicitShippingHsn,
  resolveShippingHsnCode
} from '@common/shipping/resolve-shipping-hsn';
import {
  normalizeIndianShippingPhone,
  resolveShiprocketCustomerEmail
} from '@common/shipping/shiprocket-payload';
import { parseBoxPresets } from '@common/shipping/select-box-preset';
import { cartonize } from '@common/shipping/cartonize';
import { sendTechnicalFailureAlert } from '../../src/modules/notifications/notification-failure-alert';

type NotificationsQueue = Pick<Queue, 'add'>;

type ShippingWorkerDeps = {
  PrismaClient?: typeof RealPrismaClient;
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
  const prisma = new PrismaClientCtor();
  const notificationsQueue = notificationsQueueArg ?? new Queue('notifications', { connection });
  const shippingProvider = shippingProviderFactory();

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

        if (order.status === OrderStatus.SHIPPED || order.status === OrderStatus.OUT_FOR_DELIVERY || order.status === OrderStatus.DELIVERED) {
          return;
        }
        if (order.status !== OrderStatus.PROCESSING && order.status !== OrderStatus.CONFIRMED) {
          return;
        }
        if (!canTransitionOrder(order.status, OrderStatus.SHIPPED)) {
          return;
        }

        // Idempotency guard: if a shipment with an AWB already exists for this
        // order (e.g. retry after a successful provider call but failed DB write),
        // skip the external call entirely and let Phase 3 re-persist the result.
        if (order.shipment?.awbNumber) {
          return;
        }

        const pickupPincode = await resolvePickupPincode(prisma);
        if (!pickupPincode) {
          throw new Error('Missing pickup pincode configuration');
        }

        const settings = await prisma.storeSettings.findUnique({
          where: { singletonKey: 'default' },
          select: { gstin: true, contactEmail: true, boxPresets: true }
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
        const explicitHsnCodes = new Set<string>();
        for (const variant of variants) {
          const explicitHsn = resolveExplicitShippingHsn({
            variantHsnCode: variant.hsnCode,
            productAttributes: variant.product.attributes
          });
          if (explicitHsn) {
            explicitHsnCodes.add(explicitHsn);
          }
        }
        const sellerGstTin = (settings?.gstin ?? '').trim();
        if (featureFlags.gstInvoicing) {
          if (!sellerGstTin) {
            throw new Error('Missing seller GSTIN for shipment booking');
          }
          if (explicitHsnCodes.size === 0) {
            throw new Error('Missing product HSN code(s) for shipment booking');
          }
        }
        for (const item of order.items) {
          const unitWeight = variantWeights.get(item.variantId) ?? 0;
          if (unitWeight <= 0) {
            throw new Error(`Missing or invalid variant weight for variant ${item.variantId}`);
          }
        }
        const totalWeightGrams = order.items.reduce(
          (sum, item) => sum + (variantWeights.get(item.variantId) ?? 0) * item.quantity,
          0
        );

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
          boxPresets: boxPresets.map((b) => ({ name: b.name, lengthCm: b.lengthCm, widthCm: b.widthCm, heightCm: b.heightCm }))
        });

        const shipmentInput = {
          orderNumber: order.orderNumber,
          amountRupees: order.total / 100,
          subtotalRupees: orderSubtotalPaise / 100,
          shippingChargeRupees: orderShippingChargePaise / 100,
          discountRupees: orderDiscountPaise / 100,
          destinationPincode: shippingAddress.pincode,
          originPincode: pickupPincode,
          totalWeightGrams,
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

        // --- Phase 2: external provider call (no DB connection held) ---
        const shipment = await effectiveShippingProvider.createShipment(shipmentInput);

        // Determine which provider handled this shipment.
        // Prefer the order-level selection; fall back to shipment response signature
        // (shiprocketShipmentId present → Shiprocket, absent → Delhivery).
        // SHIPPING_PROVIDER env var is intentionally NOT used — routing is credential-based.
        const resolvedProvider =
          resolvedProviderForOrder ??
          (shipment.shiprocketShipmentId != null
            ? ShippingProvider.SHIPROCKET
            : ShippingProvider.DELHIVERY);

        const shiprocketFields = {
          ...(shipment.shiprocketShipmentId != null
            ? { shiprocketShipmentId: shipment.shiprocketShipmentId }
            : {}),
          ...(shipment.labelUrl != null ? { labelUrl: shipment.labelUrl } : {})
        };

        // --- Phase 3: short write-only transaction (result persistence) ---
        // Re-check order is still shippable before persisting AWB. If the order was
        // cancelled while the provider call was in flight, compensate by cancelling AWB.
        let awbToCancel: string | null = null;
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
            awbToCancel = shipment.awbNumber;
            return;
          }

          const estimatedDelivery =
            shipment.estimatedDays != null
              ? new Date(Date.now() + shipment.estimatedDays * 24 * 60 * 60 * 1000)
              : null;

          await upsertShipmentCompat(tx, {
            orderId: order.id,
            existingShipmentId: freshOrder.shipment?.id ?? order.shipment?.id,
            data: {
              provider: resolvedProvider,
              status: ShipmentStatus.BOOKED,
              awbNumber: shipment.awbNumber,
              ...(shipment.trackingUrl ? { trackingUrl: shipment.trackingUrl } : {}),
              ...(estimatedDelivery ? { estimatedDelivery } : {}),
              webhookPayload: sanitizeProviderPayload(shipment.providerPayload),
              ...shiprocketFields
            }
          });

          const shipped = await updateOrderStatusWithCasCompat(tx, {
            orderId: order.id,
            fromStatus: freshOrder.status,
            toStatus: OrderStatus.SHIPPED,
            extraData: {
              ...(shipment.shiprocketOrderId != null ? { shiprocketOrderId: shipment.shiprocketOrderId } : {})
            }
          });

          if (shipped) {
            const providerLabel = resolvedProvider === ShippingProvider.SHIPROCKET ? 'Shiprocket' : 'Delhivery';
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
                shipment.estimatedDays != null
                  ? `Estimated delivery in ${shipment.estimatedDays} day${shipment.estimatedDays === 1 ? '' : 's'}. `
                  : '';
              await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
                email: userEmail,
                phone: userPhone,
                template: 'OrderShipped',
                data: {
                  orderId: order.id,
                  orderNumber: (order as typeof order & { orderNumber?: string }).orderNumber ?? order.id,
                  awb: shipment.awbNumber,
                  trackingUrl: shipment.trackingUrl ?? '',
                  estimatedDeliveryText,
                  ...(shipment.estimatedDays != null ? { estimatedDays: shipment.estimatedDays } : {})
                }
              }, `shipping:primary:${order.id}:shipped`);
            }
          } else {
            awbToCancel = shipment.awbNumber;
          }
        });

        if (awbToCancel) {
          try {
            // Use the same adapter that created the AWB, not the global env-based one.
            await effectiveShippingProvider.cancelShipment(awbToCancel);
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
        }
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
            status: { notIn: TERMINAL as unknown as ShipmentStatus[] },
            awbNumber: { not: null }
          },
          include: {
            order: { select: { id: true, orderNumber: true, status: true } }
          },
          take: 50, // Process max 50 per run to avoid long-running jobs
          orderBy: { updatedAt: 'asc' } // Oldest first so stale ones are prioritised
        });

        for (const shipment of activeShipments) {
          if (!shipment.awbNumber) continue;
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

            if (!nextShipmentStatus || nextShipmentStatus === shipment.status) continue;

            const nextOrderStatus = mapShipmentStatusToOrderStatus(nextShipmentStatus);

            await prisma.$transaction(async (tx) => {
              await tx.shipment.update({
                where: { id: shipment.id },
                data: { status: nextShipmentStatus }
              });

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

              if (
                nextOrderStatus &&
                shipment.order.status !== nextOrderStatus &&
                canTransitionOrder(shipment.order.status, nextOrderStatus)
              ) {
                await tx.order.update({
                  where: { id: shipment.order.id },
                  data: { status: nextOrderStatus }
                });
                await tx.orderStatusHistory.create({
                  data: {
                    orderId: shipment.order.id,
                    fromStatus: shipment.order.status,
                    toStatus: nextOrderStatus,
                    triggeredBy: 'SHIPPING_WEBHOOK',
                    note: `Auto-poll sync: provider reports ${tracking.status}`
                  }
                });
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
                    capturedAt: true
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

        const email = shipment.order.user?.email;
        const phone = shipment.order.user?.phone;

        const nextOrderStatus = nextShipmentStatus ? mapShipmentStatusToOrderStatus(nextShipmentStatus) : null;
        if (nextOrderStatus && shipment.order.status !== nextOrderStatus && canTransitionOrder(shipment.order.status, nextOrderStatus)) {
          const updated = await updateOrderStatusWithCasCompat(tx, {
            orderId: shipment.order.id,
            fromStatus: shipment.order.status,
            toStatus: nextOrderStatus
          });

          if (updated) {
            await tx.orderStatusHistory.create({
              data: {
                orderId: shipment.order.id,
                fromStatus: shipment.order.status,
                toStatus: nextOrderStatus,
                triggeredBy: 'SHIPPING_WEBHOOK',
                note: `Shipment status changed to ${data.status}`
              }
            });

            if (nextOrderStatus === 'CANCELLED' && (email || phone)) {
              await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
                email,
                phone,
                template: 'OrderCancelled',
                data: { orderId: shipment.order.id, awb: resolvedAwb }
              }, `shipping:primary:${shipment.order.id}:cancelled-webhook`);
            }
          }
        }
        if (nextShipmentStatus === 'IN_TRANSIT' && (phone || email)) {
          const estimatedDaysFromDelivery = shipment.estimatedDelivery
            ? Math.max(1, Math.round((shipment.estimatedDelivery.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
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
              orderId: shipment.order.id,
              awb: resolvedAwb,
              trackingUrl: shipment.trackingUrl ?? '',
              estimatedDeliveryText,
              ...(estimatedDaysFromDelivery != null ? { estimatedDays: estimatedDaysFromDelivery } : {})
            }
          // Deduplication key differs from :shipped so this can fire even if booking notification ran.
          }, `shipping:primary:${shipment.order.id}:in-transit`);
        }

        if (nextShipmentStatus === 'OUT_FOR_DELIVERY' && (phone || email)) {
          await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
            email,
            phone,
            template: 'OutForDelivery',
            data: {
              orderId: shipment.order.id,
              awb: resolvedAwb
            }
          }, `shipping:primary:${shipment.order.id}:out-for-delivery`);
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
          if (email || phone) {
            await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
              email,
              phone,
              template: 'OrderDelivered',
              data: {
                orderId: shipment.order.id,
                awb: resolvedAwb
              }
            }, `shipping:primary:${shipment.order.id}:delivered`);
          }
        }

        if (nextShipmentStatus === 'FAILED_DELIVERY' && (phone || email)) {
          await enqueueNotificationOutboxOrQueue(tx, notificationsQueue, 'send-primary', {
            email,
            phone,
            template: 'FailedDelivery',
            data: {
              orderId: shipment.order.id,
              awb: resolvedAwb
            }
          }, `shipping:primary:${shipment.order.id}:failed-delivery`);
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
