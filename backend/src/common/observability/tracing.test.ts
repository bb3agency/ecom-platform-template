import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('tracing lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('does not initialize sdk when tracing is disabled', async () => {
    vi.stubEnv('OTEL_TRACING_ENABLED', 'false');

    const startMock = vi.fn();
    const shutdownMock = vi.fn(async () => undefined);

    class MockNodeSDK {
      start = startMock;
      shutdown = shutdownMock;
    }
    vi.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: MockNodeSDK
    }));
    vi.doMock('@opentelemetry/auto-instrumentations-node', () => ({
      getNodeAutoInstrumentations: vi.fn(() => ([]))
    }));
    class MockOTLPTraceExporter {}
    vi.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: MockOTLPTraceExporter
    }));
    vi.doMock('@opentelemetry/resources', () => ({
      resourceFromAttributes: vi.fn(() => ({}))
    }));

    const tracing = await import('./tracing');
    await tracing.initializeTracing();

    expect(startMock).not.toHaveBeenCalled();
  }, 15_000);

  it('initializes and shuts down sdk when enabled', async () => {
    vi.stubEnv('OTEL_TRACING_ENABLED', 'true');
    vi.stubEnv('OTEL_SERVICE_NAME', 'svc-test');
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318');

    const startMock = vi.fn();
    const shutdownMock = vi.fn(async () => undefined);

    const nodeSdkCtor = vi.fn();
    class MockNodeSDK {
      constructor(...args: unknown[]) {
        nodeSdkCtor(...args);
      }

      start = startMock;
      shutdown = shutdownMock;
    }

    vi.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: MockNodeSDK
    }));
    vi.doMock('@opentelemetry/auto-instrumentations-node', () => ({
      getNodeAutoInstrumentations: vi.fn(() => ([]))
    }));
    class MockOTLPTraceExporter {}
    vi.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: MockOTLPTraceExporter
    }));
    vi.doMock('@opentelemetry/resources', () => ({
      resourceFromAttributes: vi.fn(() => ({}))
    }));

    const tracing = await import('./tracing');

    await expect(tracing.initializeTracing()).resolves.toBeUndefined();
    await expect(tracing.shutdownTracing()).resolves.toBeUndefined();
    await expect(tracing.shutdownTracing()).resolves.toBeUndefined();
  });
});
