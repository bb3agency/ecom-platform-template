import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type {
  ListCapturedPaymentsInput,
  ListCapturedPaymentsResult,
  ProviderCapturedPayment
} from '@common/interfaces/payment-provider.interface';
import {
  RAZORPAY_CAPTURE_RECONCILE_MAX_PAGES,
  RAZORPAY_CAPTURE_RECONCILE_PAGE_SIZE,
  RAZORPAY_CAPTURE_RECONCILE_WINDOW_MS,
  RAZORPAY_RECONCILE_ISSUE,
  buildCaptureHealJobId,
  runRazorpayCaptureReconcile,
  type RazorpayCaptureReconcileDeps
} from './razorpay-capture-reconcile';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const HOUR = 60 * 60 * 1000;

type LocalPayment = {
  providerOrderId: string;
  providerPaymentId: string | null;
  status: 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  orderStatus: string;
};

type Issue = { id: string; issueType: string; aggregateRef: string; details: unknown; isResolved: boolean };

type InFilter = { in: string[] };

function capture(id: string, orderId: string | null, ageMs: number): ProviderCapturedPayment {
  return {
    providerPaymentId: id,
    providerOrderId: orderId,
    amount: 5000,
    currency: 'INR',
    createdAt: new Date(NOW - ageMs)
  };
}

function setup(options: {
  pages: ProviderCapturedPayment[][];
  /** Force hasMore on every page (pagination-bound test). */
  alwaysMore?: boolean;
  payments?: LocalPayment[];
  issues?: Issue[];
  autoHeal?: string[];
}) {
  const payments = options.payments ?? [];
  const issues: Issue[] = [...(options.issues ?? [])];

  const listCapturedPayments = vi.fn(async (input: ListCapturedPaymentsInput): Promise<ListCapturedPaymentsResult> => {
    const pageIndex = input.skip / input.count;
    const items = options.pages[pageIndex] ?? [];
    return { items, hasMore: options.alwaysMore === true || pageIndex < options.pages.length - 1 };
  });

  const paymentFindMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
    const where = args.where;
    if (Array.isArray(where['OR'])) {
      const clauses = where['OR'] as Array<{ providerPaymentId?: InFilter; providerOrderId?: InFilter }>;
      return payments
        .filter((p) =>
          clauses.some(
            (c) =>
              (c.providerPaymentId && p.providerPaymentId !== null && c.providerPaymentId.in.includes(p.providerPaymentId)) ||
              (c.providerOrderId && c.providerOrderId.in.includes(p.providerOrderId))
          )
        )
        .map((p) => ({
          providerOrderId: p.providerOrderId,
          providerPaymentId: p.providerPaymentId,
          status: p.status,
          order: { status: p.orderStatus }
        }));
    }
    const ids = (where['providerPaymentId'] as InFilter).in;
    const statuses = (where['status'] as InFilter).in;
    return payments
      .filter((p) => p.providerPaymentId !== null && ids.includes(p.providerPaymentId) && statuses.includes(p.status))
      .map((p) => ({ providerPaymentId: p.providerPaymentId }));
  });

  const prisma = {
    payment: { findMany: paymentFindMany },
    reconciliationIssue: {
      findFirst: vi.fn(async (args: { where: { aggregateRef: string; issueType: string } }) =>
        issues.find(
          (i) => !i.isResolved && i.aggregateRef === args.where.aggregateRef && i.issueType === args.where.issueType
        ) ?? null
      ),
      create: vi.fn(async (args: { data: { aggregateRef: string; issueType: string; details: unknown } }) => {
        const issue = { id: `issue_${issues.length + 1}`, isResolved: false, ...args.data };
        issues.push(issue);
        return issue;
      }),
      findMany: vi.fn(async (args: { where: { issueType: string } }) =>
        issues
          .filter((i) => !i.isResolved && i.issueType === args.where.issueType)
          .map(({ aggregateRef }) => ({ aggregateRef }))
      ),
      updateMany: vi.fn(async (args: { where: { issueType: string; aggregateRef: InFilter } }) => {
        let count = 0;
        for (const issue of issues) {
          if (!issue.isResolved && issue.issueType === args.where.issueType && args.where.aggregateRef.in.includes(issue.aggregateRef)) {
            issue.isResolved = true;
            count += 1;
          }
        }
        return { count };
      })
    }
  };

  const orderProcessingAdd = vi.fn(async () => undefined);
  const refundsAdd = vi.fn(async () => undefined);
  const alert = vi.fn(async () => undefined);

  const deps: RazorpayCaptureReconcileDeps = {
    prisma: prisma as unknown as PrismaClient,
    provider: { listCapturedPayments },
    orderProcessingQueue: { add: orderProcessingAdd } as unknown as RazorpayCaptureReconcileDeps['orderProcessingQueue'],
    refundsQueue: { add: refundsAdd } as unknown as RazorpayCaptureReconcileDeps['refundsQueue'],
    autoHealIssues: new Set(
      options.autoHeal ?? [RAZORPAY_RECONCILE_ISSUE.webhookMissing, RAZORPAY_RECONCILE_ISSUE.orphanCapture]
    ),
    alert: alert as unknown as RazorpayCaptureReconcileDeps['alert'],
    now: () => NOW
  };

  return { deps, issues, listCapturedPayments, paymentFindMany, orderProcessingAdd, refundsAdd, alert };
}

describe('runRazorpayCaptureReconcile', () => {
  it('asks Razorpay for the trailing 48-hour window in pages of 100', async () => {
    const { deps, listCapturedPayments } = setup({ pages: [[]] });

    await runRazorpayCaptureReconcile(deps);

    expect(listCapturedPayments).toHaveBeenCalledWith({
      from: new Date(NOW - RAZORPAY_CAPTURE_RECONCILE_WINDOW_MS),
      to: new Date(NOW),
      count: RAZORPAY_CAPTURE_RECONCILE_PAGE_SIZE,
      skip: 0
    });
  });

  it('skips captures already recorded locally (by payment id or by Razorpay order)', async () => {
    const { deps, orderProcessingAdd, refundsAdd, issues } = setup({
      pages: [[capture('pay_a', 'order_a', 2 * HOUR), capture('pay_b', 'order_b', 2 * HOUR), capture('pay_c', 'order_c', 2 * HOUR)]],
      payments: [
        { providerOrderId: 'order_a', providerPaymentId: 'pay_a', status: 'CAPTURED', orderStatus: 'CONFIRMED' },
        { providerOrderId: 'order_b', providerPaymentId: null, status: 'REFUNDED', orderStatus: 'REFUNDED' },
        { providerOrderId: 'order_c', providerPaymentId: 'pay_c', status: 'PARTIALLY_REFUNDED', orderStatus: 'CANCELLED' }
      ]
    });

    const summary = await runRazorpayCaptureReconcile(deps);

    expect(summary.alreadyRecorded).toBe(3);
    expect(orderProcessingAdd).not.toHaveBeenCalled();
    expect(refundsAdd).not.toHaveBeenCalled();
    expect(issues).toHaveLength(0);
  });

  it('re-drives payment.captured through the payment-webhook job when the local payment is still CREATED/FAILED', async () => {
    const { deps, orderProcessingAdd, refundsAdd, issues } = setup({
      pages: [[capture('pay_new', 'order_x', 2 * HOUR), capture('pay_retry', 'order_y', 2 * HOUR)]],
      payments: [
        { providerOrderId: 'order_x', providerPaymentId: null, status: 'CREATED', orderStatus: 'PENDING_PAYMENT' },
        // Customer failed with pay_old, then succeeded with pay_retry on the same order.
        { providerOrderId: 'order_y', providerPaymentId: 'pay_old', status: 'FAILED', orderStatus: 'PAYMENT_FAILED' }
      ]
    });

    const summary = await runRazorpayCaptureReconcile(deps);

    expect(summary.healEnqueued).toBe(2);
    expect(refundsAdd).not.toHaveBeenCalled();
    expect(orderProcessingAdd).toHaveBeenCalledWith(
      'payment-webhook',
      expect.objectContaining({
        event: 'payment.captured',
        providerOrderId: 'order_x',
        providerPaymentId: 'pay_new',
        payloadMetadata: expect.objectContaining({ source: 'razorpay-capture-reconcile' })
      }),
      { jobId: buildCaptureHealJobId('pay_new', NOW) }
    );
    expect(orderProcessingAdd).toHaveBeenCalledWith(
      'payment-webhook',
      expect.objectContaining({ providerOrderId: 'order_y', providerPaymentId: 'pay_retry' }),
      { jobId: buildCaptureHealJobId('pay_retry', NOW) }
    );
    expect(issues.map((i) => [i.issueType, i.aggregateRef])).toEqual([
      [RAZORPAY_RECONCILE_ISSUE.webhookMissing, `pay_new:${RAZORPAY_RECONCILE_ISSUE.webhookMissing}`],
      [RAZORPAY_RECONCILE_ISSUE.webhookMissing, `pay_retry:${RAZORPAY_RECONCILE_ISSUE.webhookMissing}`]
    ]);
    expect(issues[0]?.details).toMatchObject({ healPolicy: 'auto_heal_safe', localPaymentStatus: 'CREATED' });
  });

  it('flags a capture on an order no longer awaiting payment for manual review (heal is still harmless)', async () => {
    const { deps, issues, orderProcessingAdd } = setup({
      pages: [[capture('pay_late', 'order_z', 3 * HOUR)]],
      payments: [{ providerOrderId: 'order_z', providerPaymentId: null, status: 'CREATED', orderStatus: 'CANCELLED' }]
    });

    await runRazorpayCaptureReconcile(deps);

    expect(orderProcessingAdd).toHaveBeenCalledTimes(1);
    expect(issues[0]?.details).toMatchObject({ healPolicy: 'manual_review', orderStatus: 'CANCELLED' });
  });

  it('builds hour-bucketed heal job ids without colons', () => {
    expect(buildCaptureHealJobId('pay_1', NOW)).toBe(`rzp-reconcile-captured-pay_1-${Math.floor(NOW / HOUR)}`);
    expect(buildCaptureHealJobId('pay_1', NOW)).not.toContain(':');
    expect(buildCaptureHealJobId('pay_1', NOW + HOUR)).not.toBe(buildCaptureHealJobId('pay_1', NOW));
  });

  it('enqueues refund-orphan-capture for an unrecorded capture older than 45 minutes', async () => {
    const { deps, refundsAdd, orderProcessingAdd, issues } = setup({
      pages: [[capture('pay_orphan', 'order_o', 46 * 60 * 1000)]]
    });

    const summary = await runRazorpayCaptureReconcile(deps);

    expect(summary.orphanRefundEnqueued).toBe(1);
    expect(orderProcessingAdd).not.toHaveBeenCalled();
    expect(refundsAdd).toHaveBeenCalledWith(
      'refund-orphan-capture',
      expect.objectContaining({ providerPaymentId: 'pay_orphan', providerOrderId: 'order_o' }),
      // Same jobId as the webhook-driven orphan path, so the two never double-queue.
      { jobId: 'refund-orphan-capture-pay_orphan' }
    );
    expect(issues[0]).toMatchObject({
      issueType: RAZORPAY_RECONCILE_ISSUE.orphanCapture,
      aggregateRef: `pay_orphan:${RAZORPAY_RECONCILE_ISSUE.orphanCapture}`
    });
  });

  it('leaves young orphans (checkout may still confirm) and order-less payments alone', async () => {
    const { deps, refundsAdd, issues } = setup({
      pages: [[capture('pay_young', 'order_y', 10 * 60 * 1000), capture('pay_link', null, 5 * HOUR)]]
    });

    const summary = await runRazorpayCaptureReconcile(deps);

    expect(summary.orphanTooRecent).toBe(1);
    expect(refundsAdd).not.toHaveBeenCalled();
    expect(issues).toHaveLength(0);
  });

  it('records but does not act when the heal / orphan refund are not in the auto-heal set', async () => {
    const { deps, refundsAdd, orderProcessingAdd, issues } = setup({
      pages: [[capture('pay_new', 'order_x', 2 * HOUR), capture('pay_orphan', 'order_o', 2 * HOUR)]],
      payments: [{ providerOrderId: 'order_x', providerPaymentId: null, status: 'CREATED', orderStatus: 'PENDING_PAYMENT' }],
      autoHeal: []
    });

    await runRazorpayCaptureReconcile(deps);

    expect(orderProcessingAdd).not.toHaveBeenCalled();
    expect(refundsAdd).not.toHaveBeenCalled();
    expect(issues.map((i) => (i.details as { healPolicy: string }).healPolicy)).toEqual(['manual_review', 'manual_review']);
  });

  it('flags (never refunds) a second capture on an already-paid Razorpay order and alerts once', async () => {
    const { deps, issues, alert, refundsAdd } = setup({
      pages: [[capture('pay_second', 'order_d', 2 * HOUR)]],
      payments: [{ providerOrderId: 'order_d', providerPaymentId: 'pay_first', status: 'CAPTURED', orderStatus: 'CONFIRMED' }]
    });

    const summary = await runRazorpayCaptureReconcile(deps);
    await runRazorpayCaptureReconcile(deps);

    expect(summary.duplicateCaptures).toBe(1);
    expect(refundsAdd).not.toHaveBeenCalled();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ issueType: RAZORPAY_RECONCILE_ISSUE.duplicateCapture });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ template: 'RazorpayDuplicateCapture' }));
  });

  it('does not duplicate an issue that is already open', async () => {
    const { deps, issues } = setup({ pages: [[capture('pay_orphan', 'order_o', 2 * HOUR)]] });

    await runRazorpayCaptureReconcile(deps);
    await runRazorpayCaptureReconcile(deps);

    expect(issues).toHaveLength(1);
  });

  it('walks every page until Razorpay reports no more', async () => {
    const { deps, listCapturedPayments, refundsAdd } = setup({
      pages: [[capture('pay_1', 'order_1', 2 * HOUR)], [capture('pay_2', 'order_2', 2 * HOUR)], []]
    });

    const summary = await runRazorpayCaptureReconcile(deps);

    expect(listCapturedPayments.mock.calls.map(([input]) => input.skip)).toEqual([0, 100, 200]);
    expect(summary).toMatchObject({ pages: 3, scanned: 2, truncated: false });
    expect(refundsAdd).toHaveBeenCalledTimes(2);
  });

  it('stops at the page bound, reports truncation and alerts', async () => {
    const { deps, listCapturedPayments, alert } = setup({ pages: [[]], alwaysMore: true });

    const summary = await runRazorpayCaptureReconcile(deps);

    expect(listCapturedPayments).toHaveBeenCalledTimes(RAZORPAY_CAPTURE_RECONCILE_MAX_PAGES);
    expect(summary.truncated).toBe(true);
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ template: 'RazorpayCaptureReconcileTruncated' }));
  });

  it('propagates a provider failure so BullMQ retries the run', async () => {
    const { deps } = setup({ pages: [[]] });
    deps.provider = { listCapturedPayments: vi.fn().mockRejectedValue(new Error('Razorpay 502')) };

    await expect(runRazorpayCaptureReconcile(deps)).rejects.toThrow('Razorpay 502');
  });

  it('does nothing when the provider cannot list payments', async () => {
    const { deps, paymentFindMany } = setup({ pages: [[]] });
    deps.provider = {};

    const summary = await runRazorpayCaptureReconcile(deps);

    expect(summary.pages).toBe(0);
    expect(paymentFindMany).not.toHaveBeenCalled();
  });

  describe('issue resolution', () => {
    const openIssue = (paymentId: string, issueType: string): Issue => ({
      id: `${paymentId}-${issueType}`,
      issueType,
      aggregateRef: `${paymentId}:${issueType}`,
      details: {},
      isResolved: false
    });

    it('resolves a webhook-missing issue once the local payment carries the capture', async () => {
      const { deps, issues } = setup({
        pages: [[]],
        payments: [{ providerOrderId: 'order_x', providerPaymentId: 'pay_healed', status: 'CAPTURED', orderStatus: 'CONFIRMED' }],
        issues: [
          openIssue('pay_healed', RAZORPAY_RECONCILE_ISSUE.webhookMissing),
          openIssue('pay_stuck', RAZORPAY_RECONCILE_ISSUE.webhookMissing)
        ]
      });

      await runRazorpayCaptureReconcile(deps);

      expect(issues.find((i) => i.aggregateRef.startsWith('pay_healed'))?.isResolved).toBe(true);
      // Out of the window is NOT evidence of a fix — stays open.
      expect(issues.find((i) => i.aggregateRef.startsWith('pay_stuck'))?.isResolved).toBe(false);
    });

    it('resolves orphan / duplicate issues a complete scan no longer sees, and keeps re-flagged ones', async () => {
      const { deps, issues } = setup({
        pages: [[capture('pay_still', 'order_s', 2 * HOUR)]],
        issues: [
          openIssue('pay_gone', RAZORPAY_RECONCILE_ISSUE.orphanCapture),
          openIssue('pay_still', RAZORPAY_RECONCILE_ISSUE.orphanCapture),
          openIssue('pay_dup_gone', RAZORPAY_RECONCILE_ISSUE.duplicateCapture)
        ]
      });

      await runRazorpayCaptureReconcile(deps);

      expect(issues.find((i) => i.aggregateRef.startsWith('pay_gone'))?.isResolved).toBe(true);
      expect(issues.find((i) => i.aggregateRef.startsWith('pay_dup_gone'))?.isResolved).toBe(true);
      expect(issues.find((i) => i.aggregateRef.startsWith('pay_still'))?.isResolved).toBe(false);
    });

    it('never resolves orphan issues from a truncated scan', async () => {
      const { deps, issues } = setup({
        pages: [[]],
        alwaysMore: true,
        issues: [openIssue('pay_gone', RAZORPAY_RECONCILE_ISSUE.orphanCapture)]
      });

      await runRazorpayCaptureReconcile(deps);

      expect(issues[0]?.isResolved).toBe(false);
    });
  });
});
