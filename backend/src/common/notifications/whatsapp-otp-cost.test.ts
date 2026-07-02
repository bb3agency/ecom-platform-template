import { describe, expect, it, vi } from 'vitest';

import {
  computeWhatsappOtpCost,
  currentBillingCycleStart,
  DEFAULT_WHATSAPP_OTP_COST_PAISE,
  resolveWhatsappOtpCostPaise
} from './whatsapp-otp-cost';

describe('resolveWhatsappOtpCostPaise', () => {
  it('falls back to the default when unset or invalid', () => {
    expect(resolveWhatsappOtpCostPaise({})).toBe(DEFAULT_WHATSAPP_OTP_COST_PAISE);
    expect(resolveWhatsappOtpCostPaise({ WHATSAPP_OTP_COST_PAISE: 'abc' })).toBe(DEFAULT_WHATSAPP_OTP_COST_PAISE);
    expect(resolveWhatsappOtpCostPaise({ WHATSAPP_OTP_COST_PAISE: '-5' })).toBe(DEFAULT_WHATSAPP_OTP_COST_PAISE);
  });

  it('uses a configured non-negative integer', () => {
    expect(resolveWhatsappOtpCostPaise({ WHATSAPP_OTP_COST_PAISE: '20' })).toBe(20);
    expect(resolveWhatsappOtpCostPaise({ WHATSAPP_OTP_COST_PAISE: '0' })).toBe(0);
  });
});

describe('currentBillingCycleStart', () => {
  it('returns the first day of the current UTC month', () => {
    const start = currentBillingCycleStart(new Date('2026-07-02T08:00:00.000Z'));
    expect(start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('computeWhatsappOtpCost', () => {
  it('multiplies successful WhatsApp OTP sends by the per-message rate for all-time and current cycle', async () => {
    const count = vi.fn()
      .mockResolvedValueOnce(10) // all-time
      .mockResolvedValueOnce(4); // current cycle
    const prisma = { notificationLog: { count } } as never;

    const result = await computeWhatsappOtpCost(
      prisma,
      { WHATSAPP_OTP_COST_PAISE: '14' },
      new Date('2026-07-02T08:00:00.000Z')
    );

    expect(result.costPerMessagePaise).toBe(14);
    expect(result.billingCycleStart).toBe('2026-07-01T00:00:00.000Z');
    expect(result.allTime).toEqual({ count: 10, costPaise: 140 });
    expect(result.currentCycle).toEqual({ count: 4, costPaise: 56 });

    // Only SENT WhatsApp OTP templates are counted.
    const firstWhere = count.mock.calls[0]?.[0]?.where as {
      channel: string;
      status: string;
      template: { in: string[] };
    };
    expect(firstWhere.channel).toBe('WHATSAPP');
    expect(firstWhere.status).toBe('SENT');
    expect(firstWhere.template.in).toContain('CustomerOtpVerification');
    // Current-cycle query is date-bounded.
    const secondWhere = count.mock.calls[1]?.[0]?.where as { createdAt: { gte: Date } };
    expect(secondWhere.createdAt.gte).toBeInstanceOf(Date);
  });
});
