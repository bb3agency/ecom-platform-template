/**
 * Scheduling + gating for the Razorpay capture reconciliation (reconciliation queue,
 * job `razorpay-capture-reconcile`). Shared by the API process, which registers the
 * job scheduler, and the workers process, which runs the job. See
 * backend/docs/REFUND_LIFECYCLE.md §9.
 */
export const RAZORPAY_CAPTURE_RECONCILE_JOB = 'razorpay-capture-reconcile';
export const RAZORPAY_CAPTURE_RECONCILE_SCHEDULER_ID = 'reconciliation:razorpay-capture-reconcile';
export const RAZORPAY_CAPTURE_RECONCILE_INTERVAL_MS = 30 * 60 * 1000;

/**
 * `RAZORPAY_RECONCILE_ENABLED` defaults to on, but only ever applies when Razorpay is
 * the configured provider: COD / noop / unconfigured deployments have no provider
 * ledger to reconcile against. Set it to `false` (or `0`) to switch the job off.
 */
export function isRazorpayCaptureReconcileEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.PAYMENT_PROVIDER ?? '').trim().toLowerCase() !== 'razorpay') {
    return false;
  }
  const raw = (env.RAZORPAY_RECONCILE_ENABLED ?? '').trim().toLowerCase();
  if (raw === '') {
    return true;
  }
  return raw === 'true' || raw === '1';
}
