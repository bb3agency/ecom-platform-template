import { AnalyticsEventType, NotificationStatus, OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { redactSensitiveData } from '@common/security/redaction';
import { sendTechnicalFailureAlert } from '@modules/notifications/notification-failure-alert';
import {
  AnalyticsCategoryBreakdownQuery,
  AnalyticsFunnelQuery,
  AnalyticsGranularity,
  AnalyticsRevenueQuery,
  AnalyticsShippingProviderQuery
} from './analytics.types';
import { OrdersService } from '@modules/orders/orders.service';
type PrismaClientExt = FastifyInstance['prisma'] & {
  adminAuditLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

const includedOrderStatuses: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.REFUNDED
];

export class AnalyticsService {
  constructor(private readonly fastify: FastifyInstance) {}

  private replayAuditPath = path.join(process.cwd(), 'artifacts', 'replay-audit', 'replay-decisions.ndjson');
  private replayAuditRetentionDays = Number(process.env.REPLAY_AUDIT_RETENTION_DAYS ?? '90');
  private replayAuditWriteChain: Promise<void> = Promise.resolve();

  private async assertReplayRateLimit(actor: string): Promise<void> {
    const currentMinute = Math.floor(Date.now() / 60000);
    const key = `outbox:replay:actor:${actor}:${currentMinute}`;
    const result = await this.fastify.redis.multi().incr(key).expire(key, 120).exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    if (count > 10) {
      throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Replay rate limit exceeded', 429);
    }
  }

  private normalizeReplayReason(reason: string | undefined): string {
    const normalized = reason?.trim() ?? '';
    if (normalized.length < 8) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Replay reason must be at least 8 characters', 400);
    }
    return normalized;
  }

  async getRevenue(query: AnalyticsRevenueQuery) {
    const granularity: AnalyticsGranularity = query.granularity ?? 'day';
    const { from, to } = this.resolveRange(query.from, query.to);
    const orders = await this.fastify.prisma.order.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: includedOrderStatuses }
      },
      select: {
        createdAt: true,
        total: true
      }
    });

    const grouped = new Map<string, { revenuePaise: number; ordersCount: number }>();
    for (const order of orders) {
      const bucket = this.getBucket(order.createdAt, granularity);
      const current = grouped.get(bucket);
      if (current) {
        current.revenuePaise += order.total;
        current.ordersCount += 1;
      } else {
        grouped.set(bucket, { revenuePaise: order.total, ordersCount: 1 });
      }
    }

    return {
      granularity,
      points: Array.from(grouped.entries()).map(([bucket, value]) => ({
        bucket,
        revenuePaise: value.revenuePaise,
        ordersCount: value.ordersCount
      }))
    };
  }

  async recordEvent(input: {
    eventType: AnalyticsEventType;
    sessionId: string;
    userId?: string;
    payload?: Record<string, unknown>;
  }) {
    await this.fastify.prisma.analyticsEvent.create({
      data: {
        eventType: input.eventType,
        sessionId: input.sessionId,
        ...(input.userId ? { userId: input.userId } : {}),
        payload: (input.payload ?? {}) as Prisma.InputJsonValue
      }
    });
    return { ok: true };
  }

  async getFunnel(query: AnalyticsFunnelQuery) {
    const { from, to } = this.resolveRange(query.from, query.to);
    const eventTypes: AnalyticsEventType[] = [
      AnalyticsEventType.PRODUCT_VIEW,
      AnalyticsEventType.ADD_TO_CART,
      AnalyticsEventType.CHECKOUT_STARTED,
      AnalyticsEventType.PAYMENT_INITIATED,
      AnalyticsEventType.PURCHASE
    ];

    // Count distinct sessions per event type so repeated actions by the same
    // session (e.g. multiple product views, payment retries) don't inflate a
    // funnel stage beyond the stage above it.
    const rows = await this.fastify.prisma.$queryRaw<Array<{ event_type: string; unique_sessions: bigint }>>`
      SELECT "eventType"::text AS event_type, COUNT(DISTINCT "sessionId") AS unique_sessions
      FROM "AnalyticsEvent"
      WHERE "eventType"::text = ANY(${eventTypes}::text[])
        AND "occurredAt" >= ${from}
        AND "occurredAt" <= ${to}
      GROUP BY "eventType"
    `;

    const countMap = new Map<AnalyticsEventType, number>();
    for (const row of rows) {
      countMap.set(row.event_type as AnalyticsEventType, Number(row.unique_sessions));
    }

    const base = countMap.get(AnalyticsEventType.PRODUCT_VIEW) ?? 0;
    return {
      steps: eventTypes.map((eventType) => {
        const count = countMap.get(eventType) ?? 0;
        const conversionRatePercent = base > 0 ? Number(((count / base) * 100).toFixed(2)) : 0;
        return {
          eventType,
          count,
          conversionRatePercent
        };
      })
    };
  }

  /**
   * Variants CURRENTLY at or below their low-stock threshold — computed from live
   * inventory (on-hand minus active cart reservations), NOT from the historical
   * `lowStockAlertEvent` log. The log showed the quantity captured at alert time, so a
   * variant restocked back to full still appeared as a qty-0 alert forever; this reflects
   * the real current state and disappears the moment stock is replenished.
   */
  async getInventoryAlerts() {
    let inventory: Array<{
      variantId: string;
      quantity: number;
      lowStockThreshold: number;
      updatedAt: Date;
      variant: { name: string; sku: string; product: { name: string } };
    }>;
    try {
      inventory = await this.fastify.prisma.inventory.findMany({
        orderBy: { quantity: 'asc' },
        select: {
          variantId: true,
          quantity: true,
          lowStockThreshold: true,
          updatedAt: true,
          variant: {
            select: { name: true, sku: true, product: { select: { name: true } } }
          }
        }
      });
    } catch (error) {
      // Gracefully degrade to empty report when migration is not applied in local/dev DB.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        return { items: [] };
      }
      throw error;
    }

    const reserved = await this.fastify.prisma.cartReservation.groupBy({
      by: ['variantId'],
      where: { expiresAt: { gt: new Date() } },
      _sum: { quantity: true }
    });
    const reservedByVariant = new Map(reserved.map((r) => [r.variantId, r._sum.quantity ?? 0]));

    const items = inventory
      .map((item) => {
        const available = Math.max(item.quantity - (reservedByVariant.get(item.variantId) ?? 0), 0);
        return {
          variantId: item.variantId,
          sku: item.variant.sku,
          variantName: item.variant.name,
          // Report AVAILABLE stock (on-hand minus reservations) — the number that matters
          // for "can I still sell this", matching the storefront out-of-stock gate.
          quantity: available,
          lowStockThreshold: item.lowStockThreshold,
          productName: item.variant.product.name,
          occurredAt: item.updatedAt.toISOString()
        };
      })
      .filter((item) => item.quantity <= item.lowStockThreshold);

    return { items };
  }

  async exportRevenueCsv(query: AnalyticsRevenueQuery) {
    const data = await this.getRevenue(query);
    const header = ['bucket', 'ordersCount', 'revenuePaise'];
    const rows = data.points.map((point) => [point.bucket, String(point.ordersCount), String(point.revenuePaise)]);
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    return [header.map(escapeCsv).join(','), ...rows.map((row) => row.map((value) => escapeCsv(value)).join(','))].join('\n');
  }

  async getNotificationDeliveryStats(query: AnalyticsFunnelQuery) {
    const { from, to } = this.resolveRange(query.from, query.to);
    const grouped = await this.fastify.prisma.notificationLog.groupBy({
      by: ['channel', 'status'],
      where: {
        createdAt: { gte: from, lte: to }
      },
      _count: { status: true }
    });

    const aggregate = new Map<string, { total: number; sent: number; failed: number }>();
    for (const row of grouped) {
      const existing = aggregate.get(row.channel) ?? { total: 0, sent: 0, failed: 0 };
      existing.total += row._count.status;
      if (row.status === NotificationStatus.SENT) {
        existing.sent += row._count.status;
      }
      if (row.status === NotificationStatus.FAILED) {
        existing.failed += row._count.status;
      }
      aggregate.set(row.channel, existing);
    }

    return {
      channels: Array.from(aggregate.entries()).map(([channel, stats]) => ({
        channel,
        total: stats.total,
        sent: stats.sent,
        failed: stats.failed,
        deliveryRatePercent: stats.total > 0 ? Number(((stats.sent / stats.total) * 100).toFixed(2)) : 0
      }))
    };
  }

  async getCategoryBreakdown(query: AnalyticsCategoryBreakdownQuery) {
    const { from, to } = this.resolveRange(query.from, query.to);
    const orders = await this.fastify.prisma.order.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: includedOrderStatuses }
      },
      select: {
        items: {
          select: {
            totalPrice: true,
            variant: {
              select: {
                product: {
                  select: {
                    categoryId: true,
                    category: {
                      select: {
                        name: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    const categoryRevenue = new Map<string, { categoryName: string; revenuePaise: number }>();
    for (const order of orders) {
      for (const item of order.items) {
        const categoryId = item.variant.product.categoryId;
        const categoryName = item.variant.product.category?.name ?? 'Uncategorized';
        const existing = categoryRevenue.get(categoryId);
        if (existing) {
          existing.revenuePaise += item.totalPrice;
        } else {
          categoryRevenue.set(categoryId, { categoryName, revenuePaise: item.totalPrice });
        }
      }
    }

    const totalRevenue = Array.from(categoryRevenue.values()).reduce((sum, item) => sum + item.revenuePaise, 0);
    const items = Array.from(categoryRevenue.entries())
      .map(([categoryId, value]) => ({
        categoryId,
        categoryName: value.categoryName,
        revenuePaise: value.revenuePaise,
        sharePercent: totalRevenue > 0 ? Number(((value.revenuePaise / totalRevenue) * 100).toFixed(2)) : 0
      }))
      .sort((a, b) => b.revenuePaise - a.revenuePaise);

    return { items };
  }

  async getShippingProviderStats(query: AnalyticsShippingProviderQuery) {
    const { from, to } = this.resolveRange(query.from, query.to);

    const shipments = await this.fastify.prisma.shipment.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        order: { status: { in: includedOrderStatuses } }
      },
      select: {
        provider: true,
        status: true,
        order: { select: { total: true } }
      }
    });

    const providerMap = new Map<string, { shipmentsCount: number; revenuePaise: number; deliveredCount: number }>();
    for (const shipment of shipments) {
      const key = shipment.provider as string;
      const current = providerMap.get(key) ?? { shipmentsCount: 0, revenuePaise: 0, deliveredCount: 0 };
      current.shipmentsCount += 1;
      current.revenuePaise += shipment.order?.total ?? 0;
      if (shipment.status === ShipmentStatus.DELIVERED) {
        current.deliveredCount += 1;
      }
      providerMap.set(key, current);
    }

    const totalShipments = shipments.length;
    return {
      providers: Array.from(providerMap.entries())
        .map(([provider, stats]) => ({
          provider,
          shipmentsCount: stats.shipmentsCount,
          revenuePaise: stats.revenuePaise,
          deliveredCount: stats.deliveredCount,
          sharePercent: totalShipments > 0 ? Number(((stats.shipmentsCount / totalShipments) * 100).toFixed(2)) : 0
        }))
        .sort((a, b) => b.shipmentsCount - a.shipmentsCount),
      totalShipments
    };
  }

  async listReconciliationIssues(query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const [items, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.reconciliationIssue.findMany({
        where: { isResolved: false },
        orderBy: { detectedAt: 'desc' },
        skip,
        take: limit
      }),
      this.fastify.prisma.reconciliationIssue.count({
        where: { isResolved: false }
      })
    ]);
    return {
      items: items.map((item) => {
        const normalizedDetails = this.normalizeReconciliationDetails(item.details);
        return {
          id: item.id,
          issueType: item.issueType,
          aggregateRef: item.aggregateRef,
          isResolved: item.isResolved,
          severity: normalizedDetails.severity,
          classification: normalizedDetails.healPolicy,
          ageSeconds: Math.max(0, Math.floor((Date.now() - item.detectedAt.getTime()) / 1000)),
          resolutionAction: normalizedDetails.healPolicy === 'auto_heal_safe' ? 'auto' : 'manual',
          detectedAt: item.detectedAt.toISOString(),
          resolvedAt: item.resolvedAt?.toISOString(),
          details: normalizedDetails
        };
      }),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  private assertReplayApproval(approvalToken?: string): void {
    const expected = process.env.REPLAY_APPROVAL_TOKEN?.trim();
    if (!expected) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Replay approval is not configured', 500, {
        code: 'REPLAY_APPROVAL_TOKEN_MISSING'
      });
    }
    if (!approvalToken || approvalToken.trim() !== expected) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Replay approval token is invalid', 403);
    }
  }

  private normalizeReconciliationDetails(details: Prisma.JsonValue): {
    healPolicy: string;
    severity: string;
    retryable?: boolean;
    retryAfterSeconds?: number | null;
    recommendation?: string;
    correlationId?: string;
    traceId?: string;
  } {
    const raw = (details && typeof details === 'object' && !Array.isArray(details))
      ? (details as Record<string, unknown>)
      : {};
    const healPolicy = typeof raw.healPolicy === 'string' && raw.healPolicy.trim().length > 0
      ? raw.healPolicy.trim()
      : 'manual_review';
    const severity = typeof raw.severity === 'string' && raw.severity.trim().length > 0
      ? raw.severity.trim()
      : 'unknown';
    const normalized: {
      healPolicy: string;
      severity: string;
      retryable?: boolean;
      retryAfterSeconds?: number | null;
      recommendation?: string;
      correlationId?: string;
      traceId?: string;
    } = { healPolicy, severity };
    if (typeof raw.retryable === 'boolean') {
      normalized.retryable = raw.retryable;
    }
    if (typeof raw.retryAfterSeconds === 'number' && Number.isFinite(raw.retryAfterSeconds)) {
      normalized.retryAfterSeconds = Math.max(0, Math.floor(raw.retryAfterSeconds));
    } else if (raw.retryAfterSeconds === null) {
      normalized.retryAfterSeconds = null;
    }
    if (typeof raw.recommendation === 'string' && raw.recommendation.trim().length > 0) {
      normalized.recommendation = raw.recommendation.trim().slice(0, 300);
    }
    if (typeof raw.correlationId === 'string' && raw.correlationId.trim().length > 0) {
      normalized.correlationId = raw.correlationId.trim().slice(0, 128);
    }
    if (typeof raw.traceId === 'string' && raw.traceId.trim().length > 0) {
      normalized.traceId = raw.traceId.trim().slice(0, 128);
    }
    return normalized;
  }

  private appendReplayAudit(entry: {
    targetType: 'outbox' | 'inbox';
    targetId: string;
    requestedBy: string;
    decision: 'preview' | 'dry-run' | 'enqueued';
    reason: string;
    metadata: Record<string, unknown>;
  }): void {
    this.replayAuditWriteChain = this.replayAuditWriteChain
      .then(async () => {
        await this.enforceReplayAuditRetention();
        const previousDigest = await this.readLastReplayDigest();
        const sanitizedMetadata = this.redactReplayMetadata(entry.metadata);
        const payload = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          ...entry,
          metadata: sanitizedMetadata
        };
        const normalized = JSON.stringify(payload);
        const digest = crypto.createHash('sha256').update(normalized).digest('hex');
        const immutableEnvelope = {
          ...payload,
          digest,
          previousDigest,
          chainDigest: crypto.createHash('sha256').update(`${previousDigest ?? 'genesis'}:${digest}`).digest('hex'),
          retentionDays: this.replayAuditRetentionDays
        };
        await fs.mkdir(path.dirname(this.replayAuditPath), { recursive: true });
        await fs.appendFile(this.replayAuditPath, `${JSON.stringify(immutableEnvelope)}\n`, 'utf8');
      })
      .catch((error) => {
        void sendTechnicalFailureAlert({
          prisma: this.fastify.prisma,
          template: 'AnalyticsReplayAuditWrite',
          channel: 'UNKNOWN',
          recipient: 'replay-audit-file',
          errorMessage: error instanceof Error ? error.message : 'Unknown replay audit write error',
          failureStage: 'CORE_LOGIC',
          domain: 'analytics',
          component: 'replay-audit-append'
        });
        this.fastify.log.warn(
          { error: error instanceof Error ? error.message : 'Unknown replay audit write error' },
          'Failed to append replay audit entry'
        );
      });
  }

  private async enforceReplayAuditRetention(): Promise<void> {
    const lines = await this.readReplayAuditLines();
    if (lines.length === 0) {
      return;
    }
    const cutoff = Date.now() - this.replayAuditRetentionDays * 24 * 60 * 60 * 1000;
    const filtered = lines.filter((line) => {
      try {
        const parsed = JSON.parse(line) as { timestamp?: string };
        if (!parsed.timestamp) {
          return true;
        }
        return new Date(parsed.timestamp).getTime() >= cutoff;
      } catch {
        return true;
      }
    });
    if (filtered.length !== lines.length) {
      await fs.writeFile(this.replayAuditPath, `${filtered.join('\n')}\n`, 'utf8');
    }
  }

  private async readLastReplayDigest(): Promise<string | null> {
    const lines = await this.readReplayAuditLines();
    if (lines.length === 0) {
      return null;
    }
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      return null;
    }
    try {
      const parsed = JSON.parse(lastLine) as { digest?: string };
      return typeof parsed.digest === 'string' ? parsed.digest : null;
    } catch {
      return null;
    }
  }

  private async readReplayAuditLines(): Promise<string[]> {
    try {
      const content = await fs.readFile(this.replayAuditPath, 'utf8');
      return content.split('\n').filter(Boolean);
    } catch (error) {
      const errorCode = (error as { code?: string }).code;
      if (errorCode === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private sanitizeErrorMessage(value: string | null): string | undefined {
    if (!value) {
      return undefined;
    }
    const sanitized = redactSensitiveData(value);
    const text = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized);
    return text.length > 512 ? `${text.slice(0, 512)}...[TRUNCATED]` : text;
  }

  private redactEventKey(eventKey: string): string {
    const digest = crypto.createHash('sha256').update(eventKey).digest('hex').slice(0, 16);
    return `ek_${digest}`;
  }

  private redactReplayMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const sensitive = /token|secret|signature|password|authorization|cookie/i;
    const visit = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map((item) => visit(item));
      }
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        return Object.fromEntries(
          Object.entries(obj).map(([key, raw]) => {
            if (sensitive.test(key)) {
              return [key, '[REDACTED]'];
            }
            return [key, visit(raw)];
          })
        );
      }
      if (typeof value === 'string' && value.length > 512) {
        return `${value.slice(0, 512)}...[TRUNCATED]`;
      }
      return value;
    };
    return visit(metadata) as Record<string, unknown>;
  }

  async previewOutboxDeadLetterReplay(input: { outboxMessageId: string; requestedBy: string }) {
    const outbox = await this.fastify.prisma.outboxMessage.findUnique({
      where: { id: input.outboxMessageId },
      select: {
        id: true,
        status: true,
        queueName: true,
        jobName: true,
        attemptCount: true,
        payload: true,
        lastError: true,
        updatedAt: true
      }
    });
    if (!outbox || outbox.status !== 'FAILED') {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Failed outbox message not found', 404);
    }

    const preview = {
      id: outbox.id,
      current: {
        status: outbox.status,
        attemptCount: outbox.attemptCount,
        ...(this.sanitizeErrorMessage(outbox.lastError)
          ? { lastError: this.sanitizeErrorMessage(outbox.lastError) }
          : {}),
        updatedAt: outbox.updatedAt.toISOString()
      },
      proposed: {
        action: 'enqueue-replay',
        nextJobName: 'replay-dead-letter',
        nextAttemptCount: outbox.attemptCount + 1
      },
      diff: {
        fields: ['status', 'attemptCount', 'lastError'],
        payloadFingerprint: crypto.createHash('sha256').update(JSON.stringify(outbox.payload)).digest('hex')
      }
    };

    this.appendReplayAudit({
      targetType: 'outbox',
      targetId: outbox.id,
      requestedBy: input.requestedBy,
      decision: 'preview',
      reason: 'preview',
      metadata: preview
    });

    return preview;
  }

  async replayOutboxDeadLetter(input: {
    outboxMessageId: string;
    requestedBy: string;
    reason?: string;
    dryRun?: boolean;
    approvalToken?: string;
  }) {
    await this.assertReplayRateLimit(input.requestedBy);
    this.assertReplayApproval(input.approvalToken);
    const outbox = await this.fastify.prisma.outboxMessage.findUnique({
      where: { id: input.outboxMessageId },
      select: { id: true, status: true, queueName: true, jobName: true, attemptCount: true, lastError: true }
    });
    if (!outbox || outbox.status !== 'FAILED') {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Failed outbox message not found', 404);
    }

    if (!this.fastify.queues.outboxDispatch) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Outbox dispatch queue is unavailable', 500);
    }

    const replayReason = this.normalizeReplayReason(input.reason);
    const auditStamp = `[replay-request actor=${input.requestedBy} reason=${replayReason} at=${new Date().toISOString()}]`;

    // Atomic CAS: only update if still FAILED (prevents races with concurrent replays)
    const updateResult = await this.fastify.prisma.outboxMessage.updateMany({
      where: { id: outbox.id, status: 'FAILED' },
      data: {
        lastError: [auditStamp, outbox.lastError].filter(Boolean).join(' | ').slice(0, 1000)
      }
    });

    if (updateResult.count === 0) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Outbox message already being replayed or status changed', 409);
    }

    if (input.dryRun) {
      this.appendReplayAudit({
        targetType: 'outbox',
        targetId: outbox.id,
        requestedBy: input.requestedBy,
        decision: 'dry-run',
        reason: replayReason,
        metadata: {
          queueName: outbox.queueName,
          jobName: outbox.jobName,
          attemptCount: outbox.attemptCount
        }
      });
      return {
        id: outbox.id,
        status: outbox.status,
        queueName: outbox.queueName,
        jobName: outbox.jobName,
        attemptCount: outbox.attemptCount,
        ...(this.sanitizeErrorMessage([auditStamp, outbox.lastError].filter(Boolean).join(' | ').slice(0, 1000))
          ? { lastError: this.sanitizeErrorMessage([auditStamp, outbox.lastError].filter(Boolean).join(' | ').slice(0, 1000)) }
          : {}),
        mode: 'dry-run'
      };
    }

    await this.fastify.queues.outboxDispatch.add('replay-dead-letter', {
      outboxMessageId: outbox.id,
      requestedBy: input.requestedBy,
      reason: replayReason
    }, {
      jobId: `replay-dead-letter-${outbox.id}-${Date.now()}`
    });
    this.appendReplayAudit({
      targetType: 'outbox',
      targetId: outbox.id,
      requestedBy: input.requestedBy,
      decision: 'enqueued',
      reason: replayReason,
      metadata: {
        queueName: outbox.queueName,
        jobName: outbox.jobName,
        attemptCount: outbox.attemptCount
      }
    });
    const adminAuditLogDelegate = (this.fastify.prisma as PrismaClientExt).adminAuditLog;
    await adminAuditLogDelegate.create({
      data: {
        adminUserId: input.requestedBy,
        action: 'analytics.outbox.replay',
        resourceType: 'outbox',
        resourceId: outbox.id,
        requestPath: '/api/v1/admin/analytics/outbox-dead-letter/:id/replay',
        method: 'POST',
        outcome: 'SUCCESS',
        statusCode: 200,
        summary: {
          mode: 'enqueued',
          reason: replayReason,
          queueName: outbox.queueName,
          jobName: outbox.jobName
        } as Prisma.InputJsonValue
      }
    });

    return {
      id: outbox.id,
      status: outbox.status,
      queueName: outbox.queueName,
      jobName: outbox.jobName,
      attemptCount: outbox.attemptCount,
      ...(this.sanitizeErrorMessage([auditStamp, outbox.lastError].filter(Boolean).join(' | ').slice(0, 1000))
        ? { lastError: this.sanitizeErrorMessage([auditStamp, outbox.lastError].filter(Boolean).join(' | ').slice(0, 1000)) }
        : {}),
      mode: 'enqueued'
    };
  }

  async listOutboxDeadLetters(query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const [items, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.outboxMessage.findMany({
        where: { status: 'FAILED' },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit
      }),
      this.fastify.prisma.outboxMessage.count({
        where: { status: 'FAILED' }
      })
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        queueName: item.queueName,
        jobName: item.jobName,
        attemptCount: item.attemptCount,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        ...(this.sanitizeErrorMessage(item.lastError)
          ? { lastError: this.sanitizeErrorMessage(item.lastError) }
          : {})
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async listWebhookInboxFailures(query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const [items, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.webhookInboxEvent.findMany({
        where: { status: 'FAILED' },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit
      }),
      this.fastify.prisma.webhookInboxEvent.count({
        where: { status: 'FAILED' }
      })
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        provider: item.provider,
        eventKey: this.redactEventKey(item.eventKey),
        eventName: item.eventName,
        status: item.status,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        ...(this.sanitizeErrorMessage(item.lastError)
          ? { lastError: this.sanitizeErrorMessage(item.lastError) }
          : {})
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async previewInboxFailureReplay(input: { inboxEventId: string; requestedBy: string }) {
    const inbox = await this.fastify.prisma.webhookInboxEvent.findUnique({
      where: { id: input.inboxEventId },
      select: {
        id: true,
        status: true,
        provider: true,
        eventName: true,
        eventKey: true,
        lastError: true,
        updatedAt: true
      }
    });
    if (!inbox || inbox.status !== 'FAILED') {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Failed inbox event not found', 404);
    }
    const preview = {
      id: inbox.id,
      current: {
        status: inbox.status,
        ...(this.sanitizeErrorMessage(inbox.lastError)
          ? { lastError: this.sanitizeErrorMessage(inbox.lastError) }
          : {}),
        updatedAt: inbox.updatedAt.toISOString()
      },
      proposed: {
        action: 'canonical-reprocess',
        operationType: 'canonical_reprocess',
        nextStatus: 'PROCESSED'
      },
      diff: {
        fields: ['status', 'lastError'],
        eventRef: `${inbox.provider}:${this.redactEventKey(inbox.eventKey)}`,
        idempotencyKeyMapping: {
          provider: inbox.provider,
          eventKey: this.redactEventKey(inbox.eventKey)
        }
      }
    };
    this.appendReplayAudit({
      targetType: 'inbox',
      targetId: inbox.id,
      requestedBy: input.requestedBy,
      decision: 'preview',
      reason: 'preview',
      metadata: preview
    });
    return preview;
  }

  async replayInboxFailure(input: {
    inboxEventId: string;
    requestedBy: string;
    reason?: string;
    dryRun?: boolean;
    approvalToken?: string;
    operationType?: 'canonical_reprocess' | 'mark_processing';
    rawPayload?: string;
    verificationHeader?: string;
  }) {
    await this.assertReplayRateLimit(input.requestedBy);
    this.assertReplayApproval(input.approvalToken);
    const inbox = await this.fastify.prisma.webhookInboxEvent.findUnique({
      where: { id: input.inboxEventId },
      select: {
        id: true,
        status: true,
        provider: true,
        eventName: true,
        eventKey: true,
        lastError: true
      }
    });
    if (!inbox || inbox.status !== 'FAILED') {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Failed inbox event not found', 404);
    }
    const replayReason = this.normalizeReplayReason(input.reason);
    const operationType = input.operationType ?? 'canonical_reprocess';
    const auditStamp = `[inbox-replay actor=${input.requestedBy} reason=${replayReason} at=${new Date().toISOString()}]`;
    if (input.dryRun) {
      this.appendReplayAudit({
        targetType: 'inbox',
        targetId: inbox.id,
        requestedBy: input.requestedBy,
        decision: 'dry-run',
        reason: replayReason,
        metadata: {
          operationType,
          provider: inbox.provider,
          eventKey: this.redactEventKey(inbox.eventKey),
          eventName: inbox.eventName
        }
      });
      return {
        id: inbox.id,
        provider: inbox.provider,
        eventKey: this.redactEventKey(inbox.eventKey),
        status: inbox.status,
        mode: 'dry-run'
      };
    }

    if (operationType === 'canonical_reprocess') {
      if (!input.rawPayload || !input.verificationHeader) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          'canonical_reprocess requires rawPayload and verificationHeader',
          400
        );
      }
      const ordersService = new OrdersService(this.fastify);
      try {
        if (inbox.provider === 'razorpay') {
          await ordersService.processPaymentWebhook(input.verificationHeader, input.rawPayload, inbox.eventKey);
        } else {
          await ordersService.processShippingWebhook(input.verificationHeader, input.rawPayload);
        }
      } catch (error) {
        // Atomic CAS: only mark failed if still FAILED (prevents races)
        await this.fastify.prisma.webhookInboxEvent.updateMany({
          where: { id: inbox.id, status: 'FAILED' },
          data: {
            status: 'FAILED',
            lastError: [auditStamp, inbox.lastError, error instanceof Error ? error.message : String(error)]
              .filter(Boolean)
              .join(' | ')
              .slice(0, 1000)
          }
        });
        throw error;
      }

      // Atomic CAS: only mark processed if still FAILED (prevents races with concurrent replays)
      const processedResult = await this.fastify.prisma.webhookInboxEvent.updateMany({
        where: { id: inbox.id, status: 'FAILED' },
        data: {
          status: 'PROCESSED',
          lastError: [auditStamp, inbox.lastError].filter(Boolean).join(' | ').slice(0, 1000)
        }
      });

      if (processedResult.count === 0) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Inbox event already being replayed or status changed', 409);
      }
      this.appendReplayAudit({
        targetType: 'inbox',
        targetId: inbox.id,
        requestedBy: input.requestedBy,
        decision: 'enqueued',
        reason: replayReason,
        metadata: {
          operationType,
          executionStatus: 'canonical-processed',
          provider: inbox.provider,
          eventKey: this.redactEventKey(inbox.eventKey),
          eventName: inbox.eventName
        }
      });
      return {
        id: inbox.id,
        provider: inbox.provider,
        eventKey: this.redactEventKey(inbox.eventKey),
        status: 'PROCESSED',
        mode: 'canonical_reprocess'
      };
    }

    // Atomic CAS: only mark processing if still FAILED (prevents races with concurrent replays)
    const processingResult = await this.fastify.prisma.webhookInboxEvent.updateMany({
      where: { id: inbox.id, status: 'FAILED' },
      data: {
        status: 'PROCESSING',
        lastError: [auditStamp, inbox.lastError].filter(Boolean).join(' | ').slice(0, 1000)
      }
    });

    if (processingResult.count === 0) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Inbox event already being replayed or status changed', 409);
    }

    this.appendReplayAudit({
      targetType: 'inbox',
      targetId: inbox.id,
      requestedBy: input.requestedBy,
      decision: 'enqueued',
      reason: replayReason,
      metadata: {
        operationType,
        provider: inbox.provider,
        eventKey: this.redactEventKey(inbox.eventKey),
        eventName: inbox.eventName
      }
    });
    const adminAuditLogDelegate = (this.fastify.prisma as PrismaClientExt).adminAuditLog;
    await adminAuditLogDelegate.create({
      data: {
        adminUserId: input.requestedBy,
        action: 'analytics.inbox.replay',
        resourceType: 'webhookInboxEvent',
        resourceId: inbox.id,
        requestPath: '/api/v1/admin/analytics/inbox-failures/:id/replay',
        method: 'POST',
        outcome: 'SUCCESS',
        statusCode: 200,
        summary: {
          mode: 'enqueued',
          reason: replayReason,
          provider: inbox.provider
        } as Prisma.InputJsonValue
      }
    });

    return {
      id: inbox.id,
      provider: inbox.provider,
      eventKey: this.redactEventKey(inbox.eventKey),
      status: 'PROCESSING',
      mode: 'enqueued'
    };
  }

  private resolveRange(fromInput?: string, toInput?: string) {
    const to = toInput ? new Date(toInput) : new Date();
    const from = fromInput ? new Date(fromInput) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid date range', 400);
    }
    return { from, to };
  }

  private getBucket(value: Date, granularity: AnalyticsGranularity) {
    if (granularity === 'hour') {
      return value.toISOString().slice(0, 13);
    }
    if (granularity === 'week') {
      const weekStart = new Date(value);
      const day = weekStart.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      weekStart.setUTCDate(weekStart.getUTCDate() + diff);
      weekStart.setUTCHours(0, 0, 0, 0);
      return weekStart.toISOString().slice(0, 10);
    }
    return value.toISOString().slice(0, 10);
  }
}

