import { PaymentProviderAdapter } from '@common/interfaces/payment-provider.interface';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import { CodPaymentAdapter } from './adapters/cod-payment.adapter';
import { NoopPaymentAdapter } from './adapters/noop-payment.adapter';
import { RazorpayAdapter } from './adapters/razorpay.adapter';

export type PaymentProviderRuntime = {
  provider: 'razorpay' | 'noop' | 'cod' | 'unconfigured';
  failoverEnabled: boolean;
  capabilities: {
    supportsOrderCreation: boolean;
    supportsRefunds: boolean;
    supportsWebhookVerification: boolean;
  };
  adapter: PaymentProviderAdapter;
};

class MissingConfigPaymentAdapter implements PaymentProviderAdapter {
  constructor(private readonly reason: string) {}

  private fail(): never {
    throw new AppError(ERROR_CODES.CONFIG_NOT_READY, this.reason, 503);
  }

  async createOrder(): Promise<never> {
    this.fail();
  }

  verifyPaymentSignature(): boolean {
    this.fail();
  }

  verifyWebhookSignature(): boolean {
    this.fail();
  }

  async initiateRefund(): Promise<never> {
    this.fail();
  }
}

function parseBooleanFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

// IN-PROCESS CIRCUIT BREAKER — REPLICA ISOLATION NOTE:
// `CircuitBreakerPaymentAdapter` holds all state (`failures`, `openUntil`) in instance-local memory.
// Each process/worker replica maintains its own independent CB state; there is no shared Redis or
// database backing for the open/closed decision.
//
// Operational consequence: under a multi-replica deployment a provider outage will open the CB on
// whichever replica first reaches `failureThreshold` consecutive failures, but other replicas will
// continue sending requests until they independently accumulate the same failure count.  The net
// effect is that burst traffic during a provider outage may still reach the provider from replicas
// whose CBs have not yet opened.
//
// This is an accepted trade-off for operational simplicity.  If cross-replica protection is needed,
// replace the in-memory counters with Redis INCR + TTL and a shared `rzp:cb:open_until` key.
class CircuitBreakerPaymentAdapter implements PaymentProviderAdapter {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly delegate: PaymentProviderAdapter,
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 30_000
  ) {}

  private assertClosed(): void {
    if (Date.now() < this.openUntil) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Payment provider temporarily unavailable', 503);
    }
  }

  private recordSuccess(): void {
    this.failures = 0;
    this.openUntil = 0;
  }

  private recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.openUntil = Date.now() + this.cooldownMs;
      this.failures = 0;
    }
  }

  async createOrder(input: Parameters<PaymentProviderAdapter['createOrder']>[0]) {
    this.assertClosed();
    try {
      const result = await this.delegate.createOrder(input);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  verifyPaymentSignature(input: Parameters<PaymentProviderAdapter['verifyPaymentSignature']>[0]): boolean {
    return this.delegate.verifyPaymentSignature(input);
  }

  verifyWebhookSignature(input: Parameters<PaymentProviderAdapter['verifyWebhookSignature']>[0]): boolean {
    return this.delegate.verifyWebhookSignature(input);
  }

  async initiateRefund(input: Parameters<PaymentProviderAdapter['initiateRefund']>[0]) {
    this.assertClosed();
    try {
      const result = await this.delegate.initiateRefund(input);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}

export function resolvePaymentProviderRuntime(runtimeConfig: NodeJS.ProcessEnv = process.env): PaymentProviderRuntime {
  const isTest = runtimeConfig.NODE_ENV === 'test';
  const explicitProvider = runtimeConfig.PAYMENT_PROVIDER?.trim().toLowerCase();
  const testDefault = isTest && !runtimeConfig.RAZORPAY_WEBHOOK_SECRET ? 'noop' : 'razorpay';
  const primary = explicitProvider && explicitProvider.length > 0 ? explicitProvider : testDefault;
  const testImplicitRazorpay = isTest && !explicitProvider;
  const failoverEnabled = parseBooleanFlag(runtimeConfig.PAYMENT_PROVIDER_FAILOVER_ENABLED);

  if (!explicitProvider && !isTest) {
    return {
      provider: 'unconfigured',
      failoverEnabled,
      capabilities: {
        supportsOrderCreation: false,
        supportsRefunds: false,
        supportsWebhookVerification: false
      },
      adapter: new MissingConfigPaymentAdapter(
        'Payment provider is not configured. Set PAYMENT_PROVIDER in Ops config and restart.'
      )
    };
  }

  if (primary === 'noop') {
    return {
      provider: 'noop',
      failoverEnabled,
      capabilities: {
        supportsOrderCreation: false,
        supportsRefunds: false,
        supportsWebhookVerification: false
      },
      adapter: new NoopPaymentAdapter()
    };
  }
  if (primary === 'cod') {
    return {
      provider: 'cod',
      failoverEnabled: false,
      capabilities: {
        supportsOrderCreation: true,
        supportsRefunds: false,
        supportsWebhookVerification: false
      },
      adapter: new CodPaymentAdapter()
    };
  }
  if (primary !== 'razorpay') {
    return {
      provider: 'unconfigured',
      failoverEnabled,
      capabilities: {
        supportsOrderCreation: false,
        supportsRefunds: false,
        supportsWebhookVerification: false
      },
      adapter: new MissingConfigPaymentAdapter(
        `Unsupported PAYMENT_PROVIDER: ${primary}. Configure PAYMENT_PROVIDER via Ops config.`
      )
    };
  }

  const keyId = (runtimeConfig.RAZORPAY_KEY_ID ?? '').trim();
  const keySecret = (runtimeConfig.RAZORPAY_KEY_SECRET ?? '').trim();
  const webhookSecret = (runtimeConfig.RAZORPAY_WEBHOOK_SECRET ?? '').trim();
  if ((!keyId || !keySecret || !webhookSecret) && !testImplicitRazorpay) {
    const missing: string[] = [];
    if (!keyId) missing.push('RAZORPAY_KEY_ID');
    if (!keySecret) missing.push('RAZORPAY_KEY_SECRET');
    if (!webhookSecret) missing.push('RAZORPAY_WEBHOOK_SECRET');
    return {
      provider: 'unconfigured',
      failoverEnabled,
      capabilities: {
        supportsOrderCreation: false,
        supportsRefunds: false,
        supportsWebhookVerification: false
      },
      adapter: new MissingConfigPaymentAdapter(
        `Payment provider config missing: ${missing.join(', ')}. Configure via Ops UI and restart.`
      )
    };
  }

  return {
    provider: 'razorpay',
    failoverEnabled,
    capabilities: {
      supportsOrderCreation: true,
      supportsRefunds: true,
      supportsWebhookVerification: true
    },
    adapter: new RazorpayAdapter(
      keyId,
      keySecret,
      webhookSecret,
      runtimeConfig.RAZORPAY_WEBHOOK_SECRET_OLD ?? undefined
    )
  };
}

export function createPaymentProvider(runtimeConfig: NodeJS.ProcessEnv = process.env): PaymentProviderAdapter {
  const failureThreshold = Number(runtimeConfig.PAYMENT_CB_FAILURE_THRESHOLD ?? 5);
  const cooldownMs = Number(runtimeConfig.PAYMENT_CB_COOLDOWN_MS ?? 30_000);
  return new CircuitBreakerPaymentAdapter(resolvePaymentProviderRuntime(runtimeConfig).adapter, failureThreshold, cooldownMs);
}
