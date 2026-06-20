import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import type { CheckoutRiskAssessmentPort, InitiatePaymentRiskContext } from '@common/interfaces/checkout-risk.interface';

/**
 * Default checkout risk controls: optional Redis velocity per user for payment initiation.
 * Swap implementation via DI for external fraud scoring when a deployment needs it.
 */
export class CheckoutRiskService implements CheckoutRiskAssessmentPort {
  constructor(private readonly fastify: FastifyInstance) {}

  async assertInitiatePaymentAllowed(ctx: InitiatePaymentRiskContext): Promise<void> {
    if (process.env.RISK_VELOCITY_ENABLED !== 'true') {
      return;
    }

    const maxPerHour = Number(process.env.RISK_PAYMENT_INIT_MAX_PER_HOUR ?? 30);
    if (!Number.isFinite(maxPerHour) || maxPerHour < 1) {
      return;
    }

    const hourBucket = Math.floor(Date.now() / 3_600_000);
    const key = `risk:velocity:payment-init:user:${ctx.userId}:hour:${hourBucket}`;
    const count = await this.fastify.redis.incr(key);
    if (count === 1) {
      await this.fastify.redis.expire(key, 7_200);
    }
    if (count > maxPerHour) {
      throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many payment initiation attempts; try again later', 429);
    }
  }
}
