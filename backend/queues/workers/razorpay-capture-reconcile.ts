import { PaymentStatus, Prisma, type PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import type {
  PaymentProviderAdapter,
  ProviderCapturedPayment
} from '@common/interfaces/payment-provider.interface';
import type { sendTechnicalFailureAlert } from '../../src/modules/notifications/notification-failure-alert';

/**
 * Scheduled Razorpay capture reconciliation.
 *
 * The `payment.captured` webhook is the only thing that tells the platform about a
 * capture the checkout did not record itself. If Razorpay never delivers it (webhook
 * disabled, endpoint down past Razorpay's retry window, subscription missing), a
 * captured payment sits unnoticed. This job pages Razorpay's own ledger instead and,
 * for each payment still captured in the scan window:
 *
 *   local Payment row is CAPTURED / PARTIALLY_REFUNDED / REFUNDED → nothing to do
 *     (a DIFFERENT captured payment on the same Razorpay order → duplicate-capture issue)
 *   local Payment row is CREATED / FAILED → re-drive the `payment-webhook` job with a
 *     synthetic `payment.captured` event, exactly what the missing webhook would do
 *   no local Payment row, older than the orphan grace → `refund-orphan-capture`
 *     (the refunds worker re-checks and only refunds Razorpay orders our checkout created)
 *
 * Every finding is also written as a ReconciliationIssue, like the order lifecycle check.
 */

/** Scan window. Runs every 30 min, so consecutive windows overlap heavily. */
export const RAZORPAY_CAPTURE_RECONCILE_WINDOW_MS = 48 * 60 * 60 * 1000;
export const RAZORPAY_CAPTURE_RECONCILE_PAGE_SIZE = 100;
/** Hard bound on provider calls per run (100 × 20 = 2,000 payments per 48 h). */
export const RAZORPAY_CAPTURE_RECONCILE_MAX_PAGES = 20;
/**
 * Mirrors ORPHAN_CAPTURE_CHECK_DELAY_MS in order-processing.worker.ts: a capture must
 * outlive the 30-minute checkout session before it can be called orphaned, so a
 * late-but-legitimate confirm-prepaid always wins over the automatic refund.
 */
export const RAZORPAY_ORPHAN_CAPTURE_MIN_AGE_MS = 45 * 60 * 1000;
/** Mirrors REFUND_ORPHAN_CAPTURE_JOB in order-processing.worker.ts / refunds.worker.ts. */
const REFUND_ORPHAN_CAPTURE_JOB = 'refund-orphan-capture';
const HEAL_JOB_BUCKET_MS = 60 * 60 * 1000;
const ISSUE_RESOLVE_PAGE_SIZE = 500;

export const RAZORPAY_RECONCILE_ISSUE = {
  webhookMissing: 'RAZORPAY_CAPTURE_WEBHOOK_MISSING',
  orphanCapture: 'RAZORPAY_ORPHAN_CAPTURE',
  duplicateCapture: 'RAZORPAY_DUPLICATE_CAPTURE'
} as const;

type RazorpayReconcileIssueType = (typeof RAZORPAY_RECONCILE_ISSUE)[keyof typeof RAZORPAY_RECONCILE_ISSUE];

const MONEY_CAPTURED_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  PaymentStatus.CAPTURED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED
]);

const AWAITING_PAYMENT_ORDER_STATUSES: ReadonlySet<string> = new Set(['PENDING_PAYMENT', 'PAYMENT_FAILED']);

export type RazorpayCaptureReconcileDeps = {
  /** Full client: the alert helper reads ops config + recipients through it. */
  prisma: PrismaClient;
  provider: Pick<PaymentProviderAdapter, 'listCapturedPayments'>;
  orderProcessingQueue: Pick<Queue, 'add'>;
  refundsQueue: Pick<Queue, 'add'>;
  /** RECONCILIATION_AUTO_HEAL_ISSUES set; gates the heal and the orphan refund. */
  autoHealIssues: ReadonlySet<string>;
  alert: typeof sendTechnicalFailureAlert;
  now?: () => number;
};

export type RazorpayCaptureReconcileSummary = {
  pages: number;
  scanned: number;
  /** True when the page bound stopped the walk before the provider ran out of pages. */
  truncated: boolean;
  alreadyRecorded: number;
  healEnqueued: number;
  orphanRefundEnqueued: number;
  orphanTooRecent: number;
  duplicateCaptures: number;
};

type LocalPaymentRow = {
  providerOrderId: string;
  providerPaymentId: string | null;
  status: PaymentStatus;
  order: { status: string } | null;
};

export function buildCaptureHealJobId(providerPaymentId: string, nowMs: number): string {
  // Bucketed per hour (like the lifecycle heal) so a heal job that FAILED and is
  // retained by removeOnFail does not swallow every later re-enqueue.
  return `rzp-reconcile-captured-${providerPaymentId}-${Math.floor(nowMs / HEAL_JOB_BUCKET_MS)}`;
}

function issueRef(providerPaymentId: string, issueType: RazorpayReconcileIssueType): string {
  return `${providerPaymentId}:${issueType}`;
}

function paymentIdFromIssueRef(aggregateRef: string, issueType: string): string | null {
  const suffix = `:${issueType}`;
  return aggregateRef.endsWith(suffix) ? aggregateRef.slice(0, -suffix.length) : null;
}

export async function runRazorpayCaptureReconcile(
  deps: RazorpayCaptureReconcileDeps
): Promise<RazorpayCaptureReconcileSummary> {
  const { prisma, provider, orderProcessingQueue, refundsQueue, autoHealIssues, alert } = deps;
  const nowMs = (deps.now ?? Date.now)();
  const summary: RazorpayCaptureReconcileSummary = {
    pages: 0,
    scanned: 0,
    truncated: false,
    alreadyRecorded: 0,
    healEnqueued: 0,
    orphanRefundEnqueued: 0,
    orphanTooRecent: 0,
    duplicateCaptures: 0
  };
  // Bound to the adapter: a bare method reference would lose `this` on RazorpayAdapter.
  const listCapturedPayments = provider.listCapturedPayments?.bind(provider);
  if (!listCapturedPayments) {
    return summary;
  }

  // Payments flagged this run, per issue type — anything open but not re-flagged by a
  // COMPLETE scan is no longer a problem (refunded, or recorded after all).
  const flagged: Record<RazorpayReconcileIssueType, Set<string>> = {
    [RAZORPAY_RECONCILE_ISSUE.webhookMissing]: new Set(),
    [RAZORPAY_RECONCILE_ISSUE.orphanCapture]: new Set(),
    [RAZORPAY_RECONCILE_ISSUE.duplicateCapture]: new Set()
  };

  /** Returns true when a NEW open issue was created (false when one is already open). */
  const recordIssue = async (
    issueType: RazorpayReconcileIssueType,
    providerPaymentId: string,
    details: Record<string, unknown>
  ): Promise<boolean> => {
    flagged[issueType].add(providerPaymentId);
    const aggregateRef = issueRef(providerPaymentId, issueType);
    const existing = await prisma.reconciliationIssue.findFirst({
      where: { aggregateRef, issueType, isResolved: false },
      select: { id: true }
    });
    if (existing) {
      return false;
    }
    await prisma.reconciliationIssue.create({
      data: { aggregateRef, issueType, details: details as Prisma.InputJsonValue }
    });
    return true;
  };

  const handleCapture = async (
    payment: ProviderCapturedPayment,
    local: LocalPaymentRow | undefined
  ): Promise<void> => {
    const providerDetails = {
      providerPaymentId: payment.providerPaymentId,
      providerOrderId: payment.providerOrderId,
      amountPaise: payment.amount,
      currency: payment.currency,
      providerCreatedAt: payment.createdAt.toISOString()
    };

    if (local && MONEY_CAPTURED_STATUSES.has(local.status)) {
      summary.alreadyRecorded += 1;
      // Matched through the Razorpay order but recorded against ANOTHER payment id:
      // the customer was charged twice on one order. Never auto-refunded — a person
      // confirms in the Razorpay Dashboard which capture to keep.
      if (local.providerPaymentId && local.providerPaymentId !== payment.providerPaymentId) {
        summary.duplicateCaptures += 1;
        const created = await recordIssue(RAZORPAY_RECONCILE_ISSUE.duplicateCapture, payment.providerPaymentId, {
          ...providerDetails,
          recordedProviderPaymentId: local.providerPaymentId,
          severity: 'critical',
          healPolicy: 'manual_review'
        });
        if (created) {
          void alert({
            prisma,
            template: 'RazorpayDuplicateCapture',
            channel: 'UNKNOWN',
            recipient: payment.providerPaymentId,
            errorMessage: `Razorpay payment ${payment.providerPaymentId} was captured on order ${payment.providerOrderId ?? 'unknown'}, which is already paid by ${local.providerPaymentId}. The customer appears to have been charged twice — check the Razorpay Dashboard and refund the extra capture.`,
            failureStage: 'CORE_LOGIC',
            domain: 'payments',
            component: 'razorpay-capture-reconcile',
            queueName: 'reconciliation',
            terminalFailure: false
          });
        }
      }
      return;
    }

    if (local) {
      // CREATED / FAILED: the capture never reached the order. Re-drive it through the
      // same job the webhook would have queued; process-order-update's CAS gate makes a
      // duplicate (a late real webhook, the lifecycle heal) a no-op.
      const orderStatus = local.order?.status ?? null;
      const awaitingPayment = orderStatus !== null && AWAITING_PAYMENT_ORDER_STATUSES.has(orderStatus);
      const healAllowed = autoHealIssues.has(RAZORPAY_RECONCILE_ISSUE.webhookMissing);
      await recordIssue(RAZORPAY_RECONCILE_ISSUE.webhookMissing, payment.providerPaymentId, {
        ...providerDetails,
        localPaymentStatus: local.status,
        orderStatus,
        severity: 'critical',
        // An order that is no longer awaiting payment (e.g. cancelled as abandoned)
        // will not be confirmed by the heal: the captured money needs a person.
        healPolicy: awaitingPayment && healAllowed ? 'auto_heal_safe' : 'manual_review'
      });
      if (healAllowed) {
        await orderProcessingQueue.add(
          'payment-webhook',
          {
            event: 'payment.captured',
            providerOrderId: local.providerOrderId,
            providerPaymentId: payment.providerPaymentId,
            payloadMetadata: {
              source: 'razorpay-capture-reconcile',
              amountPaise: payment.amount,
              currency: payment.currency,
              providerCreatedAt: payment.createdAt.toISOString()
            }
          },
          { jobId: buildCaptureHealJobId(payment.providerPaymentId, nowMs) }
        );
        summary.healEnqueued += 1;
      }
      return;
    }

    // No local record. A payment outside any Razorpay order cannot have come from our
    // checkout (the refunds worker would refuse it anyway), so leave it alone.
    if (!payment.providerOrderId) {
      return;
    }
    if (nowMs - payment.createdAt.getTime() < RAZORPAY_ORPHAN_CAPTURE_MIN_AGE_MS) {
      summary.orphanTooRecent += 1;
      return;
    }
    const refundAllowed = autoHealIssues.has(RAZORPAY_RECONCILE_ISSUE.orphanCapture);
    await recordIssue(RAZORPAY_RECONCILE_ISSUE.orphanCapture, payment.providerPaymentId, {
      ...providerDetails,
      severity: 'critical',
      // The refunds worker refunds only Razorpay orders our checkout created; captures
      // from payment links / POS stay listed here until they leave the scan window.
      healPolicy: refundAllowed ? 'auto_refund_if_platform_order' : 'manual_review'
    });
    if (refundAllowed) {
      // Same jobId as the webhook-driven orphan path, so the two never double-queue.
      await refundsQueue.add(
        REFUND_ORPHAN_CAPTURE_JOB,
        {
          providerPaymentId: payment.providerPaymentId,
          providerOrderId: payment.providerOrderId,
          reason: 'Automatic refund: payment captured but no order was created (found by scheduled reconciliation)'
        },
        { jobId: `refund-orphan-capture-${payment.providerPaymentId}` }
      );
      summary.orphanRefundEnqueued += 1;
    }
  };

  // `to` is fixed for the whole walk: payments created after it cannot shift the
  // offset pages under us, so every payment in the window is seen at least once.
  const from = new Date(nowMs - RAZORPAY_CAPTURE_RECONCILE_WINDOW_MS);
  const to = new Date(nowMs);
  let complete = false;
  for (let page = 0; page < RAZORPAY_CAPTURE_RECONCILE_MAX_PAGES; page += 1) {
    const { items, hasMore } = await listCapturedPayments({
      from,
      to,
      count: RAZORPAY_CAPTURE_RECONCILE_PAGE_SIZE,
      skip: page * RAZORPAY_CAPTURE_RECONCILE_PAGE_SIZE
    });
    summary.pages += 1;
    summary.scanned += items.length;

    if (items.length > 0) {
      const paymentIds = items.map(({ providerPaymentId }) => providerPaymentId);
      const orderIds = [
        ...new Set(items.flatMap(({ providerOrderId }) => (providerOrderId ? [providerOrderId] : [])))
      ];
      const localRows: LocalPaymentRow[] = await prisma.payment.findMany({
        where: {
          OR: [
            { providerPaymentId: { in: paymentIds } },
            ...(orderIds.length > 0 ? [{ providerOrderId: { in: orderIds } }] : [])
          ]
        },
        select: {
          providerOrderId: true,
          providerPaymentId: true,
          status: true,
          order: { select: { status: true } }
        }
      });
      const byPaymentId = new Map(
        localRows.flatMap((row) => (row.providerPaymentId ? [[row.providerPaymentId, row] as const] : []))
      );
      const byOrderId = new Map(localRows.map((row) => [row.providerOrderId, row] as const));

      for (const payment of items) {
        const local =
          byPaymentId.get(payment.providerPaymentId) ??
          (payment.providerOrderId ? byOrderId.get(payment.providerOrderId) : undefined);
        await handleCapture(payment, local);
      }
    }

    if (!hasMore) {
      complete = true;
      break;
    }
  }
  summary.truncated = !complete;

  if (summary.truncated) {
    void alert({
      prisma,
      template: 'RazorpayCaptureReconcileTruncated',
      channel: 'UNKNOWN',
      recipient: 'razorpay-capture-reconcile',
      errorMessage: `Razorpay capture reconciliation stopped after ${RAZORPAY_CAPTURE_RECONCILE_MAX_PAGES} pages (${summary.scanned} captured payments) without reaching the end of the 48-hour window. Older captures in the window were not checked this run.`,
      failureStage: 'CORE_LOGIC',
      domain: 'payments',
      component: 'razorpay-capture-reconcile',
      queueName: 'reconciliation',
      terminalFailure: false
    });
  }

  await resolveClearedIssues(prisma, flagged, complete);
  return summary;
}

/**
 * - webhook-missing issues resolve on positive evidence only: the local Payment row now
 *   carries that capture. Leaving the window is NOT enough (an order cancelled while its
 *   money was captured must stay visible).
 * - orphan / duplicate issues resolve when a COMPLETE scan no longer sees them: the
 *   capture was refunded, recorded after all, or is older than the window.
 */
async function resolveClearedIssues(
  prisma: RazorpayCaptureReconcileDeps['prisma'],
  flagged: Record<RazorpayReconcileIssueType, Set<string>>,
  scanComplete: boolean
): Promise<void> {
  const resolveRefs = async (issueType: RazorpayReconcileIssueType, paymentIds: string[]): Promise<void> => {
    if (paymentIds.length === 0) return;
    await prisma.reconciliationIssue.updateMany({
      where: {
        issueType,
        isResolved: false,
        aggregateRef: { in: paymentIds.map((id) => issueRef(id, issueType)) }
      },
      data: { isResolved: true, resolvedAt: new Date() }
    });
  };

  const openIds = async (issueType: RazorpayReconcileIssueType): Promise<string[]> => {
    const open = await prisma.reconciliationIssue.findMany({
      where: { issueType, isResolved: false },
      select: { aggregateRef: true },
      orderBy: { detectedAt: 'asc' },
      take: ISSUE_RESOLVE_PAGE_SIZE
    });
    return open.flatMap(({ aggregateRef }) => {
      const id = paymentIdFromIssueRef(aggregateRef, issueType);
      return id ? [id] : [];
    });
  };

  const webhookMissingIds = await openIds(RAZORPAY_RECONCILE_ISSUE.webhookMissing);
  if (webhookMissingIds.length > 0) {
    const settled = await prisma.payment.findMany({
      where: { providerPaymentId: { in: webhookMissingIds }, status: { in: [...MONEY_CAPTURED_STATUSES] } },
      select: { providerPaymentId: true }
    });
    await resolveRefs(
      RAZORPAY_RECONCILE_ISSUE.webhookMissing,
      settled.flatMap(({ providerPaymentId }) => (providerPaymentId ? [providerPaymentId] : []))
    );
  }

  if (!scanComplete) {
    return;
  }
  for (const issueType of [RAZORPAY_RECONCILE_ISSUE.orphanCapture, RAZORPAY_RECONCILE_ISSUE.duplicateCapture]) {
    const stillFlagged = flagged[issueType];
    const cleared = (await openIds(issueType)).filter((id) => !stillFlagged.has(id));
    await resolveRefs(issueType, cleared);
  }
}
