import { PrismaClient, Role } from '@prisma/client';
import { decryptOpsConfigValue } from '@common/security/ops-config-crypto';
import { ResendAdapter } from './adapters/resend.adapter';

export type TechnicalFailureStage =
  | 'WORKER_DELIVERY'
  | 'WORKER_TERMINAL'
  | 'WORKER_STALL'
  | 'QUEUE_ENQUEUE'
  | 'OUTBOX_DISPATCH'
  | 'ROUTE_HANDLER'
  | 'WEBHOOK_PROCESSING'
  | 'PROVIDER_RUNTIME'
  | 'CORE_LOGIC'
  | 'PROCESS_RESTART';

export type TechnicalFailureChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'UNKNOWN';

export type TechnicalFailureAlertInput = {
  prisma: PrismaClient;
  template: string;
  channel: TechnicalFailureChannel;
  recipient: string;
  errorMessage: string;
  failureStage: TechnicalFailureStage;
  domain?: string;
  component?: string;
  queueName?: string;
  jobName?: string;
  jobId?: string;
  outboxMessageId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  terminalFailure?: boolean;
};

export type NotificationFailureStage = TechnicalFailureStage;
export type NotificationFailureChannel = TechnicalFailureChannel;
export type NotificationFailureAlertInput = TechnicalFailureAlertInput;

const OPS_RUNTIME_NOTIFICATION_KEYS = [
  'RESEND_API_KEY',
  'RESEND_FROM'
] as const;

/**
 * Severity tiers for technical failure alerts.
 * - critical: email always sent (bypasses dedup for terminalFailure=true)
 * - high: email sent, subject to 15-min dedup cooldown
 * - suppressed: no email — failure is already captured by structured logger
 *
 * Note: CORE_LOGIC covers both critical infrastructure errors (process crash,
 * Redis down — marked with terminalFailure:true, bypass dedup) and low-priority
 * side-effect failures (cache miss, analytics enqueue — suppressed by tier).
 * The terminalFailure bypass in shouldSuppressAlert handles this distinction.
 */
const ALERT_SEVERITY_MAP: Record<TechnicalFailureStage, 'critical' | 'high' | 'suppressed'> = {
  PROCESS_RESTART:    'critical',
  WORKER_TERMINAL:    'critical',
  WEBHOOK_PROCESSING: 'critical',
  PROVIDER_RUNTIME:   'critical',
  WORKER_STALL:       'high',    // stalled jobs are operationally significant
  ROUTE_HANDLER:      'high',
  QUEUE_ENQUEUE:      'high',
  OUTBOX_DISPATCH:    'high',
  WORKER_DELIVERY:    'suppressed', // individual notification delivery failures — logged in NotificationLog
  CORE_LOGIC:         'high',       // promoted: infrastructure failures (Redis, BullMQ, audit chain) need visibility
};

/** 15-minute cooldown between identical alerts (same stage:domain:component). */
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * In-process dedup cache: maps a dedup key → timestamp of last sent alert.
 * Resets on process restart (intentional — fresh process = fresh alerting).
 * Stale entries (> 2× cooldown) are evicted on each cache write to prevent unbounded growth.
 */
const alertCooldownCache = new Map<string, number>();

/** Evicts cache entries older than 2× the cooldown window. */
function evictStaleCacheEntries(now: number): void {
  const staleThreshold = now - ALERT_COOLDOWN_MS * 2;
  for (const [key, lastSentAt] of alertCooldownCache) {
    if (lastSentAt < staleThreshold) {
      alertCooldownCache.delete(key);
    }
  }
}

/**
 * Returns the dedup key if this alert should go through the cooldown check,
 * or null if the alert bypasses dedup (terminal / process-level events).
 * Returns false if the alert is suppressed entirely (low severity tier).
 */
function resolveDedupDecision(input: TechnicalFailureAlertInput): string | null | false {
  const severity = ALERT_SEVERITY_MAP[input.failureStage];
  if (severity === 'suppressed') {
    return false;
  }

  // Terminal events (process restart, job exhausted) always fire — never deduplicated.
  if (input.failureStage === 'PROCESS_RESTART' || input.terminalFailure === true) {
    return null;
  }

  return `${input.failureStage}:${input.domain ?? 'system'}:${input.component ?? 'unknown'}`;
}

/**
 * Returns true if this alert should be suppressed (either low severity or within cooldown window).
 * Must be called BEFORE the send attempt. Use recordAlertSent() after a successful send.
 */
function shouldSuppressAlert(input: TechnicalFailureAlertInput): boolean {
  const decision = resolveDedupDecision(input);
  if (decision === false) {
    return true; // severity-suppressed
  }
  if (decision === null) {
    return false; // always-fire (terminal)
  }

  const lastSentAt = alertCooldownCache.get(decision);
  const now = Date.now();
  return lastSentAt !== undefined && now - lastSentAt < ALERT_COOLDOWN_MS;
}

/**
 * Records that an alert was successfully dispatched, starting the cooldown window.
 * Called AFTER a successful send to avoid suppressing retries when transport fails.
 */
function recordAlertSent(input: TechnicalFailureAlertInput): void {
  const decision = resolveDedupDecision(input);
  if (decision === null || decision === false) {
    return; // terminal events and suppressed events don't use the cache
  }
  const now = Date.now();
  evictStaleCacheEntries(now);
  alertCooldownCache.set(decision, now);
}

async function resolveRuntimeConfig(prisma: PrismaClient): Promise<NodeJS.ProcessEnv> {
  const runtimeConfig: NodeJS.ProcessEnv = {};
  const rows = await prisma.opsConfigSecret.findMany({
    where: {
      isActive: true,
      secretKey: {
        in: [...OPS_RUNTIME_NOTIFICATION_KEYS]
      }
    },
    select: {
      secretKey: true,
      encryptedValue: true
    }
  });

  for (const row of rows) {
    runtimeConfig[row.secretKey] = decryptOpsConfigValue(row.encryptedValue);
  }

  return runtimeConfig;
}

async function resolveFailureAlertRecipients(prisma: PrismaClient): Promise<string[]> {
  const [opsUsers, adminUsers] = await Promise.all([
    prisma.opsUser.findMany({
      where: { isActive: true },
      select: { email: true }
    }),
    prisma.user.findMany({
      where: {
        role: Role.ADMIN,
        isBanned: false,
        email: { not: null }
      },
      select: { email: true }
    })
  ]);

  const recipients = new Set<string>();
  for (const user of opsUsers) {
    const email = user.email?.trim().toLowerCase();
    if (email) {
      recipients.add(email);
    }
  }
  for (const user of adminUsers) {
    const email = user.email?.trim().toLowerCase();
    if (email) {
      recipients.add(email);
    }
  }

  return [...recipients];
}

async function resolveClientMetadata(prisma: PrismaClient): Promise<{ clientName: string; websiteUrl: string }> {
  const settings = await prisma.storeSettings.findUnique({
    where: { singletonKey: 'default' },
    select: {
      storeName: true,
      websiteUrl: true
    }
  });

  const clientName = (settings?.storeName ?? '').trim();
  const websiteUrl = (settings?.websiteUrl ?? '').trim();

  // No fallback: if missing, return explicit markers so alerts surface configuration gaps.
  return {
    clientName: clientName.length > 0 ? clientName : '[MISSING_CONFIG:StoreSettings.storeName]',
    websiteUrl: websiteUrl.length > 0 ? websiteUrl : '[MISSING_CONFIG:StoreSettings.websiteUrl]'
  };
}

/**
 * Sends a technical failure alert email to active ops identities and verified admin users.
 * This helper is best-effort and intentionally swallows alert transport errors.
 */
export async function sendTechnicalFailureAlert(input: TechnicalFailureAlertInput): Promise<void> {
  if (input.template === 'NotificationDeliveryFailure') {
    return;
  }

  if (shouldSuppressAlert(input)) {
    return;
  }

  try {
    const runtimeConfig = await resolveRuntimeConfig(input.prisma);
    const resendApiKey = (runtimeConfig.RESEND_API_KEY ?? '').trim();
    if (!resendApiKey) {
      return;
    }

    const recipients = await resolveFailureAlertRecipients(input.prisma);
    if (recipients.length === 0) {
      return;
    }
    const clientMetadata = await resolveClientMetadata(input.prisma);

    const adapter = new ResendAdapter({
      apiKey: resendApiKey,
      fromEmail: runtimeConfig.RESEND_FROM ?? 'noreply@example.com'
    });

    await Promise.allSettled(
      recipients.map((to) =>
        adapter.sendEmail({
          to,
          template: 'NotificationDeliveryFailure',
          data: {
            template: input.template,
            channel: input.channel,
            recipient: input.recipient,
            errorMessage: input.errorMessage,
            failureStage: input.failureStage,
            queueName: input.queueName ?? 'unknown',
            jobName: input.jobName ?? 'unknown',
            jobId: input.jobId ?? 'unknown',
            outboxMessageId: input.outboxMessageId ?? 'n/a',
            domain: input.domain ?? 'system',
            component: input.component ?? 'unknown-component',
            route: input.route ?? 'n/a',
            method: input.method ?? 'n/a',
            statusCode: input.statusCode ?? 500,
            terminalFailure: input.terminalFailure ?? false,
            clientName: clientMetadata.clientName,
            websiteUrl: clientMetadata.websiteUrl
          }
        })
      )
    );

    // Record cooldown AFTER successful dispatch — not before — so transport
    // failures don't suppress the next legitimate alert occurrence.
    recordAlertSent(input);
  } catch {
    return;
  }
}

export type ProcessRestartAlertInput = {
  prisma: PrismaClient;
  requestedBy: string;
  scheduledFor: string;
  jobId: string;
};

/**
 * Fires a pre-exit alert email to all active ops users and verified admin users
 * immediately before process.exit(0) triggers a scheduled restart.
 * Best-effort — never throws so it cannot block the exit.
 */
export async function sendProcessRestartAlert(input: ProcessRestartAlertInput): Promise<void> {
  try {
    const runtimeConfig = await resolveRuntimeConfig(input.prisma);
    const resendApiKey = (runtimeConfig.RESEND_API_KEY ?? '').trim();
    if (!resendApiKey) {
      return;
    }

    const recipients = await resolveFailureAlertRecipients(input.prisma);
    if (recipients.length === 0) {
      return;
    }

    const clientMetadata = await resolveClientMetadata(input.prisma);

    const adapter = new ResendAdapter({
      apiKey: resendApiKey,
      fromEmail: runtimeConfig.RESEND_FROM ?? 'noreply@example.com'
    });

    await Promise.allSettled(
      recipients.map((to) =>
        adapter.sendEmail({
          to,
          template: 'ProcessRestartAlert',
          data: {
            requestedBy: input.requestedBy,
            scheduledFor: input.scheduledFor,
            jobId: input.jobId,
            clientName: clientMetadata.clientName,
            websiteUrl: clientMetadata.websiteUrl
          }
        })
      )
    );
  } catch {
    return;
  }
}

/**
 * Backward-compatible wrapper for existing notification failure alert call sites.
 */
export async function sendNotificationFailureAlert(input: NotificationFailureAlertInput): Promise<void> {
  await sendTechnicalFailureAlert(input);
}
