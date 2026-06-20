import { ShippingProviderAdapter } from '@common/interfaces/shipping-provider.interface';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import DelhiveryAdapter from './adapters/delhivery.adapter';
import ShiprocketAdapter from './adapters/shiprocket.adapter';
import { NoopShippingAdapter } from './adapters/noop-shipping.adapter';

export type ShippingProviderRuntime = {
  provider: 'delhivery' | 'shiprocket' | 'noop' | 'unconfigured';
  failoverEnabled: boolean;
  capabilities: {
    supportsCreateShipment: boolean;
    supportsTracking: boolean;
    supportsRateCalculation: boolean;
    supportsSchedulePickup: boolean;
    supportsGenerateLabel: boolean;
  };
  adapter: ShippingProviderAdapter | null;
};

class MissingConfigShippingAdapter implements ShippingProviderAdapter {
  constructor(private readonly reason: string) {}

  private fail(): never {
    throw new AppError(ERROR_CODES.CONFIG_NOT_READY, this.reason, 503);
  }

  async createShipment(): Promise<never> {
    this.fail();
  }

  async trackShipment(): Promise<never> {
    this.fail();
  }

  async cancelShipment(): Promise<never> {
    this.fail();
  }

  async checkServiceability(): Promise<never> {
    this.fail();
  }

  async calculateDeliveryRate(): Promise<never> {
    this.fail();
  }

  async schedulePickup(): Promise<never> {
    this.fail();
  }

  async generateLabel(): Promise<never> {
    this.fail();
  }
}

function parseBooleanFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

class CircuitBreakerShippingAdapter implements ShippingProviderAdapter {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly delegate: ShippingProviderAdapter,
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 30_000
  ) {}

  private assertClosed(): void {
    if (Date.now() < this.openUntil) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Shipping provider temporarily unavailable', 503);
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

  async createShipment(input: Parameters<ShippingProviderAdapter['createShipment']>[0]) {
    this.assertClosed();
    try {
      const result = await this.delegate.createShipment(input);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  async trackShipment(awbNumber: string) {
    this.assertClosed();
    try {
      const result = await this.delegate.trackShipment(awbNumber);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  async cancelShipment(awbNumber: string) {
    this.assertClosed();
    try {
      const result = await this.delegate.cancelShipment(awbNumber);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  async checkServiceability(pincode: string, originPincode?: string) {
    this.assertClosed();
    try {
      const result = await this.delegate.checkServiceability(pincode, originPincode);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  async calculateDeliveryRate(input: Parameters<ShippingProviderAdapter['calculateDeliveryRate']>[0]) {
    this.assertClosed();
    try {
      const result = await this.delegate.calculateDeliveryRate(input);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  async schedulePickup(shiprocketShipmentId: string) {
    if (!this.delegate.schedulePickup) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'schedulePickup not supported by this shipping provider', 501);
    }
    this.assertClosed();
    try {
      const result = await this.delegate.schedulePickup(shiprocketShipmentId);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  async generateLabel(shiprocketShipmentId: string) {
    if (!this.delegate.generateLabel) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'generateLabel not supported by this shipping provider', 501);
    }
    this.assertClosed();
    try {
      const result = await this.delegate.generateLabel(shiprocketShipmentId);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}

export function resolveShippingProviderRuntime(runtimeConfig: NodeJS.ProcessEnv = process.env): ShippingProviderRuntime {
  const explicitProvider = runtimeConfig.SHIPPING_PROVIDER?.trim().toLowerCase();
  const hasExplicitProvider = Boolean(explicitProvider && explicitProvider.length > 0);
  const failoverEnabled = parseBooleanFlag(runtimeConfig.SHIPPING_PROVIDER_FAILOVER_ENABLED);

  const noopRuntime = (): ShippingProviderRuntime => ({
    provider: 'noop',
    failoverEnabled,
    capabilities: {
      supportsCreateShipment: false,
      supportsTracking: false,
      supportsRateCalculation: false,
      supportsSchedulePickup: false,
      supportsGenerateLabel: false
    },
    adapter: new NoopShippingAdapter()
  });

  if (!hasExplicitProvider) {
    return noopRuntime();
  }

  const primary = explicitProvider as string;

  if (primary === 'noop') {
    return noopRuntime();
  }

  if (primary === 'shiprocket') {
    const email = runtimeConfig.SHIPROCKET_EMAIL?.trim();
    const password = runtimeConfig.SHIPROCKET_PASSWORD?.trim();
    if (!email || !password) {
      return {
        provider: 'unconfigured',
        failoverEnabled,
        capabilities: {
          supportsCreateShipment: false,
          supportsTracking: false,
          supportsRateCalculation: false,
          supportsSchedulePickup: false,
          supportsGenerateLabel: false
        },
        adapter: new MissingConfigShippingAdapter(
          'Shipping provider config missing: SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD. Configure via Ops UI and restart.'
        )
      };
    }
    const baseUrl = runtimeConfig.SHIPROCKET_BASE_URL?.trim();
    const pickupLocation = runtimeConfig.SHIPROCKET_PICKUP_LOCATION?.trim();
    const adapterOptions = {
      email,
      password,
      ...(baseUrl ? { baseUrl } : {}),
      ...(pickupLocation ? { pickupLocation } : {})
    };
    const adapter = new ShiprocketAdapter(adapterOptions);
    return {
      provider: 'shiprocket',
      failoverEnabled,
      capabilities: {
        supportsCreateShipment: true,
        supportsTracking: true,
        supportsRateCalculation: true,
        supportsSchedulePickup: true,
        supportsGenerateLabel: true
      },
      adapter
    };
  }

  if (primary !== 'delhivery') {
    return {
      provider: 'unconfigured',
      failoverEnabled,
      capabilities: {
        supportsCreateShipment: false,
        supportsTracking: false,
        supportsRateCalculation: false,
        supportsSchedulePickup: false,
        supportsGenerateLabel: false
      },
      adapter: new MissingConfigShippingAdapter(
        `Unsupported SHIPPING_PROVIDER: ${primary}. Configure SHIPPING_PROVIDER via Ops config.`
      )
    };
  }

  const apiKey = runtimeConfig.DELHIVERY_API_KEY;
  if (!apiKey) {
    return {
      provider: 'unconfigured',
      failoverEnabled,
      capabilities: {
        supportsCreateShipment: false,
        supportsTracking: false,
        supportsRateCalculation: false,
        supportsSchedulePickup: false,
        supportsGenerateLabel: false
      },
      adapter: new MissingConfigShippingAdapter(
        'Shipping provider config missing: DELHIVERY_API_KEY. Configure via Ops UI and restart.'
      )
    };
  }

  const baseUrl = runtimeConfig.DELHIVERY_BASE_URL?.trim();
  const pickupLocationName = runtimeConfig.DELHIVERY_PICKUP_LOCATION?.trim();
  const pickupPincode = runtimeConfig.DELHIVERY_PICKUP_PINCODE?.trim();
  const sellerName = runtimeConfig.DELHIVERY_SELLER_NAME?.trim();
  const sellerAddress = runtimeConfig.DELHIVERY_SELLER_ADDRESS?.trim();
  const sellerPhone = runtimeConfig.DELHIVERY_SELLER_PHONE?.trim();
  const sellerCity = runtimeConfig.DELHIVERY_SELLER_CITY?.trim();
  const sellerState = runtimeConfig.DELHIVERY_SELLER_STATE?.trim();

  const adapter = new DelhiveryAdapter({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(pickupLocationName ? { pickupLocationName } : {}),
    ...(pickupPincode ? { pickupPincode } : {}),
    ...(sellerName ? { sellerName } : {}),
    ...(sellerAddress ? { sellerAddress } : {}),
    ...(sellerPhone ? { sellerPhone } : {}),
    ...(sellerCity ? { sellerCity } : {}),
    ...(sellerState ? { sellerState } : {})
  });
  return {
    provider: 'delhivery',
    failoverEnabled,
    capabilities: {
      supportsCreateShipment: true,
      supportsTracking: true,
      supportsRateCalculation: true,
      // Delhivery implements schedulePickup via /fm/request/new/ (warehouse-level
      // pickup). Keep this in sync with the adapter so capability reporting is honest.
      supportsSchedulePickup: true,
      supportsGenerateLabel: true
    },
    adapter
  };
}

export function createShippingProvider(runtimeConfig: NodeJS.ProcessEnv = process.env): ShippingProviderAdapter | null {
  const runtime = resolveShippingProviderRuntime(runtimeConfig);
  // noop and unconfigured adapters throw deterministically — wrapping them in a circuit breaker
  // would trip the breaker on config errors, causing misleading "temporarily unavailable" errors.
  if (runtime.provider === 'noop' || runtime.provider === 'unconfigured') {
    return runtime.adapter as ShippingProviderAdapter;
  }
  const failureThreshold = Number(runtimeConfig.SHIPPING_CB_FAILURE_THRESHOLD ?? 5);
  const cooldownMs = Number(runtimeConfig.SHIPPING_CB_COOLDOWN_MS ?? 30_000);
  return new CircuitBreakerShippingAdapter(runtime.adapter as ShippingProviderAdapter, failureThreshold, cooldownMs);
}

export type DualShippingRuntime = {
  delhivery: ShippingProviderRuntime | null;
  shiprocket: ShippingProviderRuntime | null;
  /** True when both providers are fully configured. */
  isDual: boolean;
  /** True when at least one provider is configured. */
  hasAny: boolean;
};

export function resolveDualShippingRuntime(runtimeConfig: NodeJS.ProcessEnv = process.env): DualShippingRuntime {
  const hasDelhivery = Boolean(runtimeConfig.DELHIVERY_API_KEY?.trim());
  const hasShiprocket =
    Boolean(runtimeConfig.SHIPROCKET_EMAIL?.trim()) &&
    Boolean(runtimeConfig.SHIPROCKET_PASSWORD?.trim());

  if (!hasDelhivery && !hasShiprocket) {
    return { delhivery: null, shiprocket: null, isDual: false, hasAny: false };
  }

  if (hasDelhivery && hasShiprocket) {
    const delhiveryRuntime = resolveShippingProviderRuntime({ ...runtimeConfig, SHIPPING_PROVIDER: 'delhivery' });
    const shiprocketRuntime = resolveShippingProviderRuntime({ ...runtimeConfig, SHIPPING_PROVIDER: 'shiprocket' });
    const delhivery = delhiveryRuntime.provider === 'unconfigured' ? null : delhiveryRuntime;
    const shiprocket = shiprocketRuntime.provider === 'unconfigured' ? null : shiprocketRuntime;
    const isDual = delhivery !== null && shiprocket !== null;
    return { delhivery, shiprocket, isDual, hasAny: isDual || delhivery !== null || shiprocket !== null };
  }

  const providerKey: 'delhivery' | 'shiprocket' = hasDelhivery ? 'delhivery' : 'shiprocket';
  const single = resolveShippingProviderRuntime({ ...runtimeConfig, SHIPPING_PROVIDER: providerKey });
  const isConfigured = single.provider !== 'unconfigured' && single.provider !== 'noop';
  return {
    delhivery: hasDelhivery && isConfigured ? single : null,
    shiprocket: !hasDelhivery && isConfigured ? single : null,
    isDual: false,
    hasAny: isConfigured
  };
}

export function createShippingAdapterForProvider(
  providerKey: 'delhivery' | 'shiprocket',
  runtimeConfig: NodeJS.ProcessEnv = process.env
): ShippingProviderAdapter | null {
  const runtime = resolveShippingProviderRuntime({ ...runtimeConfig, SHIPPING_PROVIDER: providerKey });
  if (runtime.provider === 'unconfigured' || runtime.provider === 'noop') {
    return null;
  }
  const failureThreshold = Number(runtimeConfig.SHIPPING_CB_FAILURE_THRESHOLD ?? 5);
  const cooldownMs = Number(runtimeConfig.SHIPPING_CB_COOLDOWN_MS ?? 30_000);
  return new CircuitBreakerShippingAdapter(runtime.adapter as ShippingProviderAdapter, failureThreshold, cooldownMs);
}
