import { createHash } from 'crypto';
import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const reliabilityModeGauge = new client.Gauge({
  name: 'app_reliability_mode',
  help: 'Current reliability mode for load shedding',
  labelNames: ['mode'],
  registers: [register]
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 1, 2, 5],
  registers: [register]
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const webhookProcessingDurationSeconds = new client.Histogram({
  name: 'webhook_processing_duration_seconds',
  help: 'Webhook processing duration in seconds',
  labelNames: ['provider', 'event', 'result'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2],
  registers: [register]
});

const webhookEventsTotal = new client.Counter({
  name: 'webhook_events_total',
  help: 'Total webhook events handled',
  labelNames: ['provider', 'event', 'result'],
  registers: [register]
});

const idempotencyHitsTotal = new client.Counter({
  name: 'idempotency_hits_total',
  help: 'Total idempotency cache hits',
  labelNames: ['route', 'result'],
  registers: [register]
});

const queueJobDurationSeconds = new client.Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Queue job execution duration in seconds',
  labelNames: ['queue', 'job_name', 'result'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15, 30, 60],
  registers: [register]
});

const queueJobsTotal = new client.Counter({
  name: 'queue_jobs_total',
  help: 'Total queue jobs by result',
  labelNames: ['queue', 'job_name', 'result'],
  registers: [register]
});

const queueWaitingDepth = new client.Gauge({
  name: 'queue_waiting_depth',
  help: 'Current waiting job depth per queue',
  labelNames: ['queue'],
  registers: [register]
});

const queueOldestWaitingAgeSeconds = new client.Gauge({
  name: 'queue_oldest_waiting_age_seconds',
  help: 'Age of the oldest waiting job per queue in seconds',
  labelNames: ['queue'],
  registers: [register]
});

const queueActiveJobs = new client.Gauge({
  name: 'queue_active_jobs',
  help: 'Current active job count per queue',
  labelNames: ['queue'],
  registers: [register]
});

const queueRetryableFailuresTotal = new client.Counter({
  name: 'queue_retryable_failures_total',
  help: 'Queue job failures that still have retries remaining',
  labelNames: ['queue', 'job_name'],
  registers: [register]
});

const queueTerminalFailuresTotal = new client.Counter({
  name: 'queue_terminal_failures_total',
  help: 'Queue job failures with no retries remaining',
  labelNames: ['queue', 'job_name'],
  registers: [register]
});

const queueDeadLetterGrowthTotal = new client.Counter({
  name: 'queue_dlq_growth_total',
  help: 'Growth in queue dead-letter jobs',
  labelNames: ['queue', 'job_name'],
  registers: [register]
});

const queueWorkerStalledTotal = new client.Counter({
  name: 'queue_worker_stalled_total',
  help: 'Count of queue worker stall detections',
  labelNames: ['queue'],
  registers: [register]
});

const checkoutRequestsTotal = new client.Counter({
  name: 'checkout_requests_total',
  help: 'Checkout and payment critical-path requests',
  labelNames: ['step', 'result'],
  registers: [register]
});

const outboxLagSeconds = new client.Gauge({
  name: 'outbox_oldest_pending_lag_seconds',
  help: 'Age in seconds of oldest pending outbox message',
  registers: [register]
});

const outboxDeadLetterDepth = new client.Gauge({
  name: 'outbox_dead_letter_depth',
  help: 'Count of failed outbox messages waiting replay',
  registers: [register]
});

const authChallengeTotal = new client.Counter({
  name: 'auth_challenge_total',
  help: 'Auth challenge validation outcomes',
  labelNames: ['action', 'result'],
  registers: [register]
});

const authAbuseEscalationTotal = new client.Counter({
  name: 'auth_abuse_escalation_total',
  help: 'Auth abuse escalation outcomes from challenge to temporary block',
  labelNames: ['action', 'stage', 'result'],
  registers: [register]
});

const authRiskSignalTotal = new client.Counter({
  name: 'auth_risk_signal_total',
  help: 'Auth risk signal observations for adaptive abuse defense',
  labelNames: ['action', 'signal', 'result'],
  registers: [register]
});

const flashSaleAdmissionTotal = new client.Counter({
  name: 'flash_sale_admission_total',
  help: 'Flash-sale admission and fairness outcomes',
  labelNames: ['variant_bucket', 'result', 'reason'],
  registers: [register]
});

const flashSaleShardContention = new client.Histogram({
  name: 'flash_sale_shard_contention_ratio',
  help: 'Per-shard budget utilization ratio (used / budget). Values near 1.0 indicate contention — consider increasing HOT_SKU_SHARD_COUNT.',
  labelNames: ['shard'],
  buckets: [0.1, 0.25, 0.5, 0.7, 0.85, 0.95, 1.0],
  registers: [register]
});

const knownWebhookEvents = new Set([
  'payment.captured',
  'payment.failed',
  'refund.processed',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'failed_delivery',
  'rto_initiated',
  'rto_delivered',
  'unknown'
]);

const knownQueueNames = new Set([
  'analytics',
  'cart-cleanup',
  'dead-letter',
  'inventory-alerts',
  'notifications',
  'order-processing',
  'outbox-dispatch',
  'reconciliation',
  'refunds',
  'shipping'
]);

const knownQueueJobs = new Set([
  'confirm-order',
  'create-shipment',
  'create-delhivery-shipment',
  'deduct-inventory',
  'generate-credit-note',
  'generate-invoice',
  'initiate-razorpay-refund',
  'payment-webhook',
  'process-order-update',
  'publish-pending',
  'record-event',
  'replay-dead-letter',
  'send-email',
  'send-primary',
  'send-sms',
  'send-whatsapp',
  'shiprocket-token-refresh',
  'update-shipment-status'
]);

const knownAuthActions = new Set(['login', 'register', 'forgot-password', 'send-otp']);

function normalizeRoute(route: string): string {
  return route.startsWith('/api/v1') ? route : 'unknown';
}

function normalizeBoundedLabel(value: string, allowed: Set<string>): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  return allowed.has(normalized) ? normalized : 'other';
}

export function recordReliabilityMode(mode: string): void {
  reliabilityModeGauge.reset();
  reliabilityModeGauge.labels(mode).set(1);
}

export function recordHttpRequest(args: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}): void {
  const route = normalizeRoute(args.route);
  const statusCode = String(args.statusCode);
  const labels = {
    method: args.method,
    route,
    status_code: statusCode
  };
  httpRequestsTotal.inc(labels);
  httpRequestDurationSeconds.observe(labels, args.durationMs / 1000);
}

export function recordWebhookEvent(args: {
  provider: 'razorpay' | 'delhivery' | 'shiprocket' | 'shipping';
  event: string;
  result: 'accepted' | 'duplicate' | 'rejected' | 'enqueue_failed';
  durationMs: number;
}): void {
  const labels = {
    provider: args.provider,
    event: normalizeBoundedLabel(args.event, knownWebhookEvents),
    result: args.result
  };
  webhookEventsTotal.inc(labels);
  webhookProcessingDurationSeconds.observe(labels, args.durationMs / 1000);
}

export function recordIdempotencyHit(route: string, result: 'replayed' | 'inflight' | 'mismatch'): void {
  idempotencyHitsTotal.inc({
    route: normalizeRoute(route),
    result
  });
}

export function recordQueueJob(
  queue: string,
  jobName: string,
  result: 'active' | 'success' | 'failure',
  durationMs?: number
): void {
  queueJobsTotal.inc({
    queue: normalizeBoundedLabel(queue, knownQueueNames),
    job_name: normalizeBoundedLabel(jobName, knownQueueJobs),
    result
  });
  if (durationMs !== undefined && result !== 'active') {
    queueJobDurationSeconds.observe(
      {
        queue: normalizeBoundedLabel(queue, knownQueueNames),
        job_name: normalizeBoundedLabel(jobName, knownQueueJobs),
        result
      },
      durationMs / 1000
    );
  }
}

export function recordQueueHealthSnapshot(args: {
  queue: string;
  waiting: number;
  active: number;
  oldestWaitingAgeSeconds: number;
}): void {
  const queue = normalizeBoundedLabel(args.queue, knownQueueNames);
  queueWaitingDepth.labels(queue).set(Math.max(0, args.waiting));
  queueActiveJobs.labels(queue).set(Math.max(0, args.active));
  queueOldestWaitingAgeSeconds.labels(queue).set(Math.max(0, args.oldestWaitingAgeSeconds));
}

export function recordQueueFailure(args: {
  queue: string;
  jobName: string;
  terminal: boolean;
}): void {
  const labels = {
    queue: normalizeBoundedLabel(args.queue, knownQueueNames),
    job_name: normalizeBoundedLabel(args.jobName, knownQueueJobs)
  };
  if (args.terminal) {
    queueTerminalFailuresTotal.inc(labels);
    queueDeadLetterGrowthTotal.inc(labels);
    return;
  }
  queueRetryableFailuresTotal.inc(labels);
}

export function recordQueueDeadLetterGrowth(queue: string, jobName: string): void {
  queueDeadLetterGrowthTotal.inc({
    queue: normalizeBoundedLabel(queue, knownQueueNames),
    job_name: normalizeBoundedLabel(jobName, knownQueueJobs)
  });
}

export function recordQueueWorkerStall(queue: string): void {
  queueWorkerStalledTotal.inc({
    queue: normalizeBoundedLabel(queue, knownQueueNames)
  });
}

export function recordCheckoutPath(step: string, result: 'success' | 'failure' | 'accepted'): void {
  const normalizedStep = step.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id');
  checkoutRequestsTotal.inc({ step: normalizedStep, result });
}

export function recordOutboxLag(lagSeconds: number): void {
  outboxLagSeconds.set(Math.max(0, lagSeconds));
}

export function recordOutboxDeadLetterDepth(total: number): void {
  outboxDeadLetterDepth.set(Math.max(0, total));
}

export function recordAuthChallenge(action: string, result: 'passed' | 'failed' | 'skipped' | 'error'): void {
  authChallengeTotal.inc({
    action: normalizeBoundedLabel(action, knownAuthActions),
    result
  });
}

export function recordAuthAbuseEscalation(
  action: string,
  stage: 'challenge' | 'temporary_block',
  result: 'observed' | 'blocked' | 'cleared'
): void {
  authAbuseEscalationTotal.inc({
    action: normalizeBoundedLabel(action, knownAuthActions),
    stage,
    result
  });
}

export function recordAuthRiskSignal(
  action: string,
  signal: 'session' | 'device' | 'tls_fingerprint' | 'user_agent' | 'burst_anomaly',
  result: 'observed' | 'suspicious' | 'missing'
): void {
  authRiskSignalTotal.inc({
    action: normalizeBoundedLabel(action, knownAuthActions),
    signal,
    result
  });
}

export function recordFlashSaleAdmission(
  variant: string,
  result: 'admitted' | 'rejected',
  reason: 'budget' | 'cooldown' | 'user_cap' | 'not_hot'
): void {
  const bucket = createHash('sha256').update(variant).digest('hex').slice(0, 8);
  flashSaleAdmissionTotal.inc({
    variant_bucket: bucket,
    result,
    reason
  });
}

const processCrashTotal = new client.Counter({
  name: 'process_crash_total',
  help: 'Count of process-level crash events before shutdown',
  labelNames: ['reason'],
  registers: [register]
});

export function recordProcessCrash(reason: 'unhandled_rejection' | 'uncaught_exception'): void {
  processCrashTotal.inc({ reason });
}

export function recordFlashSaleShardContention(shard: number, used: number, budget: number): void {
  const ratio = budget > 0 ? Math.min(used / budget, 1.0) : 0;
  flashSaleShardContention.observe({ shard: String(shard) }, ratio);
}

export async function getMetricsSnapshot(): Promise<string> {
  return register.metrics();
}

export function getMetricsContentType(): string {
  return register.contentType;
}
