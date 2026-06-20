import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveShippingProviderRuntime, resolveDualShippingRuntime, createShippingAdapterForProvider } from './shipping-provider';

describe('shipping provider runtime', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns unconfigured adapter when delhivery key is missing', () => {
    vi.stubEnv('SHIPPING_PROVIDER', 'delhivery');
    vi.stubEnv('DELHIVERY_API_KEY', '');
    const runtime = resolveShippingProviderRuntime();
    expect(runtime.provider).toBe('unconfigured');
    expect(runtime.adapter).not.toBeNull();
    expect(runtime.capabilities.supportsCreateShipment).toBe(false);
  });

  it('supports noop shipping provider selection', () => {
    vi.stubEnv('SHIPPING_PROVIDER', 'noop');
    const runtime = resolveShippingProviderRuntime();
    expect(runtime.provider).toBe('noop');
    expect(runtime.adapter).not.toBeNull();
    expect(runtime.capabilities.supportsTracking).toBe(false);
  });

  it('returns unconfigured adapter when shiprocket credentials are missing', () => {
    vi.stubEnv('SHIPPING_PROVIDER', 'shiprocket');
    vi.stubEnv('SHIPROCKET_EMAIL', '');
    vi.stubEnv('SHIPROCKET_PASSWORD', '');
    const runtime = resolveShippingProviderRuntime();
    expect(runtime.provider).toBe('unconfigured');
    expect(runtime.adapter).not.toBeNull();
    expect(runtime.capabilities.supportsCreateShipment).toBe(false);
  });

  it('creates shiprocket adapter when credentials are present', () => {
    vi.stubEnv('SHIPPING_PROVIDER', 'shiprocket');
    vi.stubEnv('SHIPROCKET_EMAIL', 'test@example.com');
    vi.stubEnv('SHIPROCKET_PASSWORD', 'secret123');
    const runtime = resolveShippingProviderRuntime();
    expect(runtime.provider).toBe('shiprocket');
    expect(runtime.adapter).not.toBeNull();
    expect(runtime.capabilities.supportsCreateShipment).toBe(true);
    expect(runtime.capabilities.supportsTracking).toBe(true);
    expect(runtime.capabilities.supportsRateCalculation).toBe(true);
    expect(runtime.capabilities.supportsSchedulePickup).toBe(true);
    expect(runtime.capabilities.supportsGenerateLabel).toBe(true);
  });

  it('returns unconfigured adapter for unknown SHIPPING_PROVIDER value', () => {
    vi.stubEnv('SHIPPING_PROVIDER', 'unknown-courier');
    const runtime = resolveShippingProviderRuntime();
    expect(runtime.provider).toBe('unconfigured');
    expect(runtime.adapter).not.toBeNull();
  });

  it('returns noop adapter when SHIPPING_PROVIDER is missing', () => {
    vi.stubEnv('SHIPPING_PROVIDER', '');
    const runtime = resolveShippingProviderRuntime();
    expect(runtime.provider).toBe('noop');
    expect(runtime.adapter).not.toBeNull();
  });

  it('delhivery adapter reports schedulePickup and generateLabel as supported', () => {
    vi.stubEnv('SHIPPING_PROVIDER', 'delhivery');
    vi.stubEnv('DELHIVERY_API_KEY', 'test-key');
    const runtime = resolveShippingProviderRuntime();
    expect(runtime.capabilities.supportsSchedulePickup).toBe(true);
    expect(runtime.capabilities.supportsGenerateLabel).toBe(true);
  });
});

describe('dual shipping runtime', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns isDual=true when both providers are configured', () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery-key');
    vi.stubEnv('SHIPROCKET_EMAIL', 'test@example.com');
    vi.stubEnv('SHIPROCKET_PASSWORD', 'secret');
    const dual = resolveDualShippingRuntime();
    expect(dual.isDual).toBe(true);
    expect(dual.delhivery).not.toBeNull();
    expect(dual.shiprocket).not.toBeNull();
    expect(dual.delhivery?.provider).toBe('delhivery');
    expect(dual.shiprocket?.provider).toBe('shiprocket');
  });

  it('returns isDual=false when only delhivery is configured', () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery-key');
    vi.stubEnv('SHIPROCKET_EMAIL', '');
    vi.stubEnv('SHIPROCKET_PASSWORD', '');
    const dual = resolveDualShippingRuntime();
    expect(dual.isDual).toBe(false);
    expect(dual.delhivery).not.toBeNull();
    expect(dual.shiprocket).toBeNull();
  });

  it('returns isDual=false when only shiprocket is configured', () => {
    vi.stubEnv('DELHIVERY_API_KEY', '');
    vi.stubEnv('SHIPROCKET_EMAIL', 'sr@example.com');
    vi.stubEnv('SHIPROCKET_PASSWORD', 'pass');
    const dual = resolveDualShippingRuntime();
    expect(dual.isDual).toBe(false);
    expect(dual.delhivery).toBeNull();
    expect(dual.shiprocket).not.toBeNull();
  });

  it('returns isDual=false when neither provider is configured', () => {
    vi.stubEnv('DELHIVERY_API_KEY', '');
    vi.stubEnv('SHIPROCKET_EMAIL', '');
    vi.stubEnv('SHIPROCKET_PASSWORD', '');
    const dual = resolveDualShippingRuntime();
    expect(dual.isDual).toBe(false);
    expect(dual.delhivery).toBeNull();
    expect(dual.shiprocket).toBeNull();
  });

  it('createShippingAdapterForProvider returns adapter when credentials present', () => {
    vi.stubEnv('DELHIVERY_API_KEY', 'delhivery-key');
    const adapter = createShippingAdapterForProvider('delhivery');
    expect(adapter).not.toBeNull();
  });

  it('createShippingAdapterForProvider returns null when credentials missing', () => {
    vi.stubEnv('DELHIVERY_API_KEY', '');
    const adapter = createShippingAdapterForProvider('delhivery');
    expect(adapter).toBeNull();
  });
});
