import { describe, expect, it } from 'vitest';

import { REFUND_OWED_GRACE_MS, buildRefundOwed, refundOwedWhere } from './refund-owed';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function order(overrides: Record<string, unknown> = {}) {
  return {
    status: 'CANCELLED',
    updatedAt: ago(60 * 60_000),
    payment: {
      providerPaymentId: 'pay_1',
      status: 'CAPTURED',
      amount: 108572,
      refundedAmountPaise: 0,
      refundPendingAmountPaise: 0
    },
    statusHistory: [] as Array<{ note: string | null; createdAt: Date; toStatus: string }>,
    ...overrides
  };
}

describe('buildRefundOwed', () => {
  it('flags a cancelled, captured order with nothing refunded or in flight', () => {
    expect(buildRefundOwed(order(), NOW)).toEqual({
      amountPaise: 108572,
      autoRetrying: false,
      lastError: null,
      lastFailedAt: null
    });
  });

  it('is null while a refund is with the provider, once refunded, for COD and for live orders', () => {
    const base = order();
    expect(buildRefundOwed(order({ payment: { ...base.payment, refundPendingAmountPaise: 108572 } }), NOW)).toBeNull();
    expect(buildRefundOwed(order({ payment: { ...base.payment, status: 'REFUNDED' } }), NOW)).toBeNull();
    expect(buildRefundOwed(order({ payment: { ...base.payment, providerPaymentId: null } }), NOW)).toBeNull();
    expect(buildRefundOwed(order({ status: 'SHIPPED' }), NOW)).toBeNull();
  });

  it('owes only the remainder of a partially refunded payment', () => {
    const base = order();
    expect(
      buildRefundOwed(order({ payment: { ...base.payment, status: 'PARTIALLY_REFUNDED', refundedAmountPaise: 8572 } }), NOW)
        ?.amountPaise
    ).toBe(100000);
  });

  it('gives a just-cancelled order a grace period (its refund job runs within seconds)', () => {
    expect(buildRefundOwed(order({ updatedAt: ago(REFUND_OWED_GRACE_MS - 1000) }), NOW)).toBeNull();
    expect(
      buildRefundOwed(order({ updatedAt: ago(1000) }), NOW, { ignoreGracePeriod: true })?.amountPaise
    ).toBe(108572);
  });

  it('reports the latest failure reason and whether automatic retries are still running', () => {
    const failed = {
      toStatus: 'CANCELLED',
      createdAt: ago(2 * 60 * 60_000),
      note: 'Refund failed (108572 paise): Your account does not have enough balance. Retrying automatically for up to 3 days.'
    };
    expect(buildRefundOwed(order({ updatedAt: ago(1000), statusHistory: [failed] }), NOW)).toEqual({
      amountPaise: 108572,
      autoRetrying: true,
      lastError: 'Your account does not have enough balance',
      lastFailedAt: failed.createdAt.toISOString()
    });

    const gaveUp = {
      toStatus: 'CANCELLED',
      createdAt: ago(60_000),
      note: 'Refund still owed (108572 paise) — automatic retries stopped after 3 days. Last error: Low balance. Retry from the order page.'
    };
    const result = buildRefundOwed(order({ statusHistory: [failed, gaveUp] }), NOW);
    expect(result?.autoRetrying).toBe(false);
    expect(result?.lastError).toBe('Low balance');
  });
});

describe('refundOwedWhere', () => {
  it('matches the same rule as buildRefundOwed', () => {
    expect(refundOwedWhere(NOW)).toEqual({
      status: 'CANCELLED',
      updatedAt: { lt: new Date(NOW.getTime() - REFUND_OWED_GRACE_MS) },
      payment: {
        is: {
          providerPaymentId: { not: null },
          status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] },
          refundPendingAmountPaise: 0
        }
      }
    });
  });
});
