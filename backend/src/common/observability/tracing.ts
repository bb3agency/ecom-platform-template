import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT
} from '@opentelemetry/semantic-conventions';

let tracingSdk: NodeSDK | null = null;

export async function initializeTracing(): Promise<void> {
  const enabled = String(process.env.OTEL_TRACING_ENABLED ?? 'false').toLowerCase() === 'true';
  if (!enabled || tracingSdk) {
    return;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

  const headersRaw = process.env.OTEL_EXPORTER_OTLP_HEADERS?.trim();
  const headers: Record<string, string> = {};
  if (headersRaw) {
    for (const pair of headersRaw.split(',')) {
      const [key, ...rest] = pair.split('=');
      if (key && rest.length > 0) {
        headers[key.trim()] = rest.join('=').trim();
      }
    }
  }

  const exporter = new OTLPTraceExporter({
    ...(endpoint ? { url: endpoint } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {})
  });

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || 'ecom-backend';
  const serviceVersion = process.env.npm_package_version?.trim() || '0.0.0';
  const deploymentEnv = process.env.NODE_ENV?.trim() || 'development';

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: deploymentEnv
  });

  tracingSdk = new NodeSDK({
    resource,
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()]
  });
  tracingSdk.start();
}

export async function shutdownTracing(): Promise<void> {
  if (!tracingSdk) {
    return;
  }
  await tracingSdk.shutdown();
  tracingSdk = null;
}

