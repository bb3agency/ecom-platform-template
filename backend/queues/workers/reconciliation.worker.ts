import { OrderStatus, PaymentStatus, Prisma, PrismaClient as RealPrismaClient } from '@prisma/client';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { releaseCouponUsageForOrder, clearUnfinalizedCouponLinks } from '@common/coupons/coupon-usage';
import { releaseReservationsForOrder } from '@common/orders/release-reservations';
import { restoreOrderInventoryOnCancel } from '@common/orders/restore-inventory-on-cancel';
import { sendTechnicalFailureAlert } from '../../src/modules/notifications/notification-failure-alert';

const STALE_PENDING_PAYMENT_MS = 30 * 60 * 1000;

// Runtime-configurable auto-heal set.
// Set RECONCILIATION_AUTO_HEAL_ISSUES to a comma-separated list of issue types
// to enable. Omitting or setting to an empty string disables all auto-heals
// without a code deploy — useful during fraud investigations or incident triage.
// Default: all four safe types are enabled.
const DEFAULT_AUTO_HEAL_ISSUES = [
  'PAYMENT_CAPTURED_ORDER_NOT_CONFIRMED',
  'REFUNDED_STATUS_MISMATCH',
  'STALE_PENDING_PAYMENT'
];
function resolveAutoHealSet(): ReadonlySet<string> {
  const raw = process.env.RECONCILIATION_AUTO_HEAL_ISSUES;
  if (raw === undefined) {
    return new Set(DEFAULT_AUTO_HEAL_ISSUES);
  }
  if (raw.trim() === '') {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

function issueKey(orderId: string, issueType: string): string {
  return `${orderId}:${issueType}`;
}

type ReconciliationWorkerDeps = {
  PrismaClient?: typeof RealPrismaClient;
  Worker?: typeof Worker;
  Queue?: typeof Queue;
  sendTechnicalFailureAlert?: typeof sendTechnicalFailureAlert;
};

export function createReconciliationWorker(
  connection: ConnectionOptions,
  deps?: ReconciliationWorkerDeps
): Worker {
  const PrismaClientCtor = deps?.PrismaClient ?? RealPrismaClient;
  const WorkerCtor = deps?.Worker ?? Worker;
  const QueueCtor = deps?.Queue ?? Queue;
  const alertFn = deps?.sendTechnicalFailureAlert ?? sendTechnicalFailureAlert;
  const prisma = new PrismaClientCtor();

  const worker = new WorkerCtor(
    'reconciliation',
    async (job) => {
      if (job.name !== 'run-order-lifecycle-check') {
        return;
      }

      const SAFE_AUTO_HEAL_ISSUES = resolveAutoHealSet();

      const pageSize = 200;
      let cursor: string | undefined;
      // deterministic page walk to avoid partial scans under growth.
      while (true) {
        const orders = await prisma.order.findMany({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            }
          },
          include: {
            payment: true,
            shipment: true
          },
          take: pageSize,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          orderBy: { id: 'asc' }
        });

        for (const order of orders) {
          const issues: Array<{ issueType: string; details: Record<string, unknown> }> = [];
          const paymentStatus = order.payment?.status ?? null;
          if (order.status === OrderStatus.CONFIRMED && paymentStatus !== PaymentStatus.CAPTURED) {
            issues.push({
              issueType: 'ORDER_CONFIRMED_WITHOUT_CAPTURED_PAYMENT',
              details: {
                orderStatus: order.status,
                paymentStatus,
                severity: 'critical',
                healPolicy: 'manual_review'
              }
            });
          }

          if (
            (order.status === OrderStatus.PENDING_PAYMENT || order.status === OrderStatus.PAYMENT_FAILED) &&
            paymentStatus === PaymentStatus.CAPTURED
          ) {
            issues.push({
              issueType: 'PAYMENT_CAPTURED_ORDER_NOT_CONFIRMED',
              details: {
                orderStatus: order.status,
                paymentStatus,
                severity: 'critical',
                healPolicy: 'auto_heal_safe'
              }
            });
          }

          if (order.status === OrderStatus.SHIPPED && !order.shipment) {
            issues.push({
              issueType: 'ORDER_SHIPPED_WITHOUT_SHIPMENT',
              details: {
                orderStatus: order.status,
                severity: 'high',
                healPolicy: 'manual_review'
              }
            });
          }

          if (
            order.payment &&
            order.payment.status === PaymentStatus.REFUNDED &&
            order.status !== OrderStatus.REFUNDED
          ) {
            issues.push({
              issueType: 'REFUNDED_STATUS_MISMATCH',
              details: {
                orderStatus: order.status,
                paymentStatus: order.payment.status,
                severity: 'high',
                healPolicy: 'manual_review'
              }
            });
          }

          if (
            (order.status === OrderStatus.PENDING_PAYMENT ||
              order.status === OrderStatus.PAYMENT_FAILED) &&
            Date.now() - order.createdAt.getTime() > STALE_PENDING_PAYMENT_MS
          ) {
            issues.push({
              issueType:
                order.status === OrderStatus.PAYMENT_FAILED
                  ? 'STALE_PAYMENT_FAILED'
                  : 'STALE_PENDING_PAYMENT',
              details: {
                orderStatus: order.status,
                ageSeconds: Math.floor((Date.now() - order.createdAt.getTime()) / 1000),
                severity: 'medium',
                healPolicy: 'auto_heal_safe'
              }
            });
          }

          if (
            (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.REFUNDED || order.status === OrderStatus.CANCELLED) &&
            order.shipment &&
            order.shipment.status !== 'DELIVERED' &&
            order.shipment.status !== 'CANCELLED' &&
            order.shipment.status !== 'RTO_DELIVERED'
          ) {
            issues.push({
              issueType: 'SHIPMENT_TERMINAL_STATE_MISMATCH',
              details: {
                orderStatus: order.status,
                shipmentStatus: order.shipment.status,
                severity: 'medium',
                healPolicy: 'manual_review'
              }
            });
          }

          for (const issue of issues) {
            const aggregateRef = issueKey(order.id, issue.issueType);
            const existing = await prisma.reconciliationIssue.findFirst({
              where: {
                aggregateRef,
                issueType: issue.issueType,
                isResolved: false
              }
            });
            if (!existing) {
              await prisma.reconciliationIssue.create({
                data: {
                  aggregateRef,
                  issueType: issue.issueType,
                  details: issue.details as Prisma.InputJsonValue
                }
              });
            }
          }

          if (
            (order.status === OrderStatus.PENDING_PAYMENT ||
              order.status === OrderStatus.PAYMENT_FAILED) &&
            order.payment?.status === PaymentStatus.CAPTURED &&
            SAFE_AUTO_HEAL_ISSUES.has('PAYMENT_CAPTURED_ORDER_NOT_CONFIRMED')
          ) {
            // Re-enqueue a process-order-update job so that inventory deduction,
            // coupon usesCount increment, cart reservation release, notifications,
            // and analytics all fire through the canonical order-processing path.
            // A raw prisma.order.update() here would bypass all of that logic.
            const orderProcessingQueue = new QueueCtor('order-processing', { connection });
            try {
              await orderProcessingQueue.add(
                'process-order-update',
                {
                  orderId: order.id,
                  toStatus: OrderStatus.CONFIRMED,
                  triggeredBy: 'RECONCILIATION',
                  note: 'Auto-heal: payment captured but order not confirmed'
                },
                { jobId: `reconcile-process-order-update-${order.id}` }
              );
            } finally {
              await orderProcessingQueue.close();
            }
            await prisma.reconciliationIssue.updateMany({
              where: {
                aggregateRef: issueKey(order.id, 'PAYMENT_CAPTURED_ORDER_NOT_CONFIRMED'),
                issueType: 'PAYMENT_CAPTURED_ORDER_NOT_CONFIRMED',
                isResolved: false
              },
              data: {
                isResolved: true,
                resolvedAt: new Date()
              }
            });
          }

          if (
            order.payment &&
            order.payment.status === PaymentStatus.REFUNDED &&
            order.status !== OrderStatus.REFUNDED &&
            SAFE_AUTO_HEAL_ISSUES.has('REFUNDED_STATUS_MISMATCH')
          ) {
            await prisma.$transaction(async (tx) => {
              const orderDelegate = tx.order as unknown as {
                findUnique?: (args: {
                  where: { id: string };
                  include: {
                    items: { select: { variantId: true; quantity: true } };
                    statusHistory: { select: { triggeredBy: true } };
                  };
                }) => Promise<{
                  id: string;
                  status: OrderStatus;
                  paymentMode: string | null;
                  items: Array<{ variantId: string; quantity: number }>;
                  statusHistory: Array<{ triggeredBy: string | null }>;
                } | null>;
                updateMany?: (args: {
                  where: Record<string, unknown>;
                  data: Record<string, unknown>;
                }) => Promise<{ count: number }>;
                update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
              };
              const snapshot = orderDelegate.findUnique
                ? await orderDelegate.findUnique({
                    where: { id: order.id },
                    include: {
                      items: { select: { variantId: true, quantity: true } },
                      statusHistory: { select: { triggeredBy: true } }
                    }
                  })
                : null;
              const priorStatus = snapshot?.status ?? order.status;
              let healed = false;
              if (typeof orderDelegate.updateMany === 'function') {
                const result = await orderDelegate.updateMany({
                  where: { id: order.id, status: { not: OrderStatus.REFUNDED } },
                  data: { status: OrderStatus.REFUNDED }
                });
                healed = result.count > 0;
              } else {
                await orderDelegate.update({
                  where: { id: order.id },
                  data: { status: OrderStatus.REFUNDED }
                });
                healed = true;
              }
              if (healed) {
                if (
                  snapshot &&
                  (priorStatus === OrderStatus.CONFIRMED || priorStatus === OrderStatus.PROCESSING)
                ) {
                  await restoreOrderInventoryOnCancel(tx, {
                    id: order.id,
                    paymentMode: snapshot.paymentMode,
                    items: snapshot.items,
                    statusHistory: snapshot.statusHistory
                  });
                }
                await releaseCouponUsageForOrder(tx, order.id);
                await clearUnfinalizedCouponLinks(tx, order.id);
              }
            });
            await prisma.reconciliationIssue.updateMany({
              where: {
                aggregateRef: issueKey(order.id, 'REFUNDED_STATUS_MISMATCH'),
                issueType: 'REFUNDED_STATUS_MISMATCH',
                isResolved: false
              },
              data: {
                isResolved: true,
                resolvedAt: new Date()
              }
            });
          }

          const paymentBlocksStaleCancel =
            paymentStatus === PaymentStatus.CAPTURED ||
            paymentStatus === PaymentStatus.PARTIALLY_REFUNDED;

          if (
            (order.status === OrderStatus.PENDING_PAYMENT ||
              order.status === OrderStatus.PAYMENT_FAILED) &&
            Date.now() - order.createdAt.getTime() > STALE_PENDING_PAYMENT_MS &&
            !paymentBlocksStaleCancel &&
            SAFE_AUTO_HEAL_ISSUES.has('STALE_PENDING_PAYMENT')
          ) {
            const staleFromStatus = order.status;
            await prisma.$transaction(async (tx) => {
              const orderDelegate = tx.order as unknown as {
                updateMany?: (args: {
                  where: Record<string, unknown>;
                  data: Record<string, unknown>;
                }) => Promise<{ count: number }>;
                update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
              };
              let cancelled = false;
              if (typeof orderDelegate.updateMany === 'function') {
                const result = await orderDelegate.updateMany({
                  where: { id: order.id, status: staleFromStatus },
                  data: { status: OrderStatus.CANCELLED }
                });
                cancelled = result.count > 0;
              } else {
                await orderDelegate.update({
                  where: { id: order.id },
                  data: { status: OrderStatus.CANCELLED }
                });
                cancelled = true;
              }
              if (cancelled) {
                if (staleFromStatus === OrderStatus.PENDING_PAYMENT) {
                  await releaseReservationsForOrder(tx, order.id);
                }
                await clearUnfinalizedCouponLinks(tx, order.id);
                await tx.orderStatusHistory.create({
                  data: {
                    orderId: order.id,
                    fromStatus: staleFromStatus,
                    toStatus: OrderStatus.CANCELLED,
                    triggeredBy: 'RECONCILIATION',
                    note:
                      staleFromStatus === OrderStatus.PAYMENT_FAILED
                        ? 'Auto-heal: stale payment failed checkout abandoned'
                        : 'Auto-heal: stale pending payment checkout abandoned'
                  }
                });
              }
            });
            await prisma.reconciliationIssue.updateMany({
              where: {
                aggregateRef: issueKey(
                  order.id,
                  staleFromStatus === OrderStatus.PAYMENT_FAILED
                    ? 'STALE_PAYMENT_FAILED'
                    : 'STALE_PENDING_PAYMENT'
                ),
                issueType:
                  staleFromStatus === OrderStatus.PAYMENT_FAILED
                    ? 'STALE_PAYMENT_FAILED'
                    : 'STALE_PENDING_PAYMENT',
                isResolved: false
              },
              data: {
                isResolved: true,
                resolvedAt: new Date()
              }
            });
          }
        }
        if (orders.length < pageSize) break;
        cursor = orders[orders.length - 1]?.id;
      }

      await prisma.reconciliationIssue.updateMany({
        where: {
          issueType: 'ORDER_SHIPPED_WITHOUT_SHIPMENT',
          isResolved: false,
          aggregateRef: {
            in: (
              await prisma.order.findMany({
                where: { shipment: { isNot: null } },
                select: { id: true }
              })
            ).map((order) => issueKey(order.id, 'ORDER_SHIPPED_WITHOUT_SHIPMENT'))
          }
        },
        data: {
          isResolved: true,
          resolvedAt: new Date()
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
      template: 'ReconciliationWorkerTerminalFailure',
      channel: 'UNKNOWN',
      recipient: 'reconciliation-worker',
      errorMessage: error instanceof Error ? error.message : String(error),
      failureStage: 'WORKER_TERMINAL',
      queueName: 'reconciliation',
      jobName: job.name,
      jobId: job.id ?? 'unknown',
      domain: 'orders',
      component: 'reconciliation-worker',
      terminalFailure: true
    });
  });

  return worker;
}
