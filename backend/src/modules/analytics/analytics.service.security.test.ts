import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AnalyticsService } from './analytics.service';

function createRedisRateLimitStub() {
  const exec = vi.fn(async () => [[null, 1]]);
  const expire = vi.fn(() => ({ exec }));
  const incr = vi.fn(() => ({ expire }));
  const multi = vi.fn(() => ({ incr }));
  return { multi };
}

describe('AnalyticsService replay authorization hardening', () => {
  afterEach(() => {
    process.env.REPLAY_APPROVAL_TOKEN = 'approved-for-tests';
  });

  it('fails closed when replay approval token is not configured', async () => {
    delete process.env.REPLAY_APPROVAL_TOKEN;
    const fastify = {
      redis: createRedisRateLimitStub(),
      prisma: {
        outboxMessage: {
          findUnique: vi.fn()
        }
      },
      log: {
        warn: vi.fn()
      }
    } as unknown as FastifyInstance;
    const service = new AnalyticsService(fastify);

    await expect(
      service.replayOutboxDeadLetter({
        outboxMessageId: 'outbox_1',
        requestedBy: 'admin_1',
        approvalToken: 'any-token'
      })
    ).rejects.toMatchObject({
      statusCode: 500,
      message: 'Replay approval is not configured'
    });
  });

  it('redactReplayMetadata removes sensitive key material from nested replay audit metadata', () => {
    const service = new AnalyticsService({ log: { warn: vi.fn() } } as unknown as FastifyInstance);
    const redact = (
      service as unknown as { redactReplayMetadata: (m: Record<string, unknown>) => Record<string, unknown> }
    ).redactReplayMetadata.bind(service);

    const out = redact({
      safe: 'keep',
      nested: {
        webhookSecret: 'should-not-leak',
        count: 2
      },
      sessionToken: 'st_raw'
    });

    expect(out.safe).toBe('keep');
    expect((out.nested as Record<string, unknown>).webhookSecret).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).count).toBe(2);
    expect(out.sessionToken).toBe('[REDACTED]');
  });

  it('normalizes reconciliation details to safe allowlist shape', () => {
    const service = new AnalyticsService({ log: { warn: vi.fn() } } as unknown as FastifyInstance);
    const normalize = (
      service as unknown as {
        normalizeReconciliationDetails: (m: unknown) => Record<string, unknown>;
      }
    ).normalizeReconciliationDetails.bind(service);
    const out = normalize({
      healPolicy: 'auto_heal_safe',
      severity: 'high',
      retryable: true,
      recommendation: 'retry',
      leakedSecret: 'should_not_pass'
    });
    expect(out).toMatchObject({
      healPolicy: 'auto_heal_safe',
      severity: 'high',
      retryable: true,
      recommendation: 'retry'
    });
    expect(out).not.toHaveProperty('leakedSecret');
  });
});
