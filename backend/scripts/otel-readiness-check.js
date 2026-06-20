#!/usr/bin/env node

/**
 * OTEL Readiness Check
 *
 * Validates that the OpenTelemetry collector endpoint is reachable and that
 * required service identification env vars are set.
 *
 * Usage: node scripts/otel-readiness-check.js
 * Exit 0 = ready, Exit 1 = not ready
 *
 * Evidence output: JSON to stdout for parity scorecard consumption.
 */

const http = require('node:http');
const logger = require('./lib/logger');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const TIMEOUT_MS = 5000;

function main() {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim();
  const tracingEnabled = (process.env.OTEL_TRACING_ENABLED ?? 'false').toLowerCase() === 'true';

  const evidence = {
    timestamp: new Date().toISOString(),
    tracingEnabled,
    serviceName: serviceName || null,
    endpoint: endpoint || null,
    endpointReachable: false,
    checks: [],
    pass: false
  };

  // Check 1: OTEL_TRACING_ENABLED
  if (!tracingEnabled) {
    evidence.checks.push({
      name: 'OTEL_TRACING_ENABLED',
      status: 'skip',
      message: 'Tracing is disabled — set OTEL_TRACING_ENABLED=true to enable'
    });
    printAndExit(evidence, true); // skip is acceptable — not a failure
    return;
  }
  evidence.checks.push({ name: 'OTEL_TRACING_ENABLED', status: 'pass', message: 'Tracing is enabled' });

  // Check 2: OTEL_SERVICE_NAME
  if (!serviceName) {
    evidence.checks.push({
      name: 'OTEL_SERVICE_NAME',
      status: 'fail',
      message: 'Missing OTEL_SERVICE_NAME — traces will not be identifiable'
    });
    printAndExit(evidence, false);
    return;
  }
  evidence.checks.push({ name: 'OTEL_SERVICE_NAME', status: 'pass', message: `Service: ${serviceName}` });

  // Check 3: Endpoint reachable
  if (!endpoint) {
    evidence.checks.push({
      name: 'OTEL_EXPORTER_OTLP_ENDPOINT',
      status: 'fail',
      message: 'No OTLP endpoint configured'
    });
    printAndExit(evidence, false);
    return;
  }

  evidence.checks.push({ name: 'OTEL_EXPORTER_OTLP_ENDPOINT', status: 'pass', message: `Endpoint: ${endpoint}` });

  // Probe the endpoint
  probeEndpoint(endpoint, (reachable, statusCode, errorMsg) => {
    evidence.endpointReachable = reachable;
    if (reachable) {
      evidence.checks.push({
        name: 'endpoint_reachable',
        status: 'pass',
        message: `Endpoint responded with HTTP ${statusCode}`
      });
    } else {
      evidence.checks.push({
        name: 'endpoint_reachable',
        status: 'fail',
        message: `Endpoint unreachable: ${errorMsg}`
      });
    }
    printAndExit(evidence, reachable);
  });
}

function probeEndpoint(endpoint, callback) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    callback(false, null, `Invalid URL: ${endpoint}`);
    return;
  }

  const client = url.protocol === 'https:' ? https : http;
  const req = client.request(
    url,
    { method: 'HEAD', timeout: TIMEOUT_MS },
    (res) => {
      callback(true, res.statusCode, null);
    }
  );

  req.on('error', (err) => {
    callback(false, null, err.message);
  });

  req.on('timeout', () => {
    req.destroy();
    callback(false, null, `Timeout after ${TIMEOUT_MS}ms`);
  });

  req.end();
}

function printAndExit(evidence, pass) {
  evidence.pass = pass;

  // Write evidence file
  const evidenceDir = path.join(process.cwd(), 'artifacts', 'otel');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, 'readiness-check.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));

  // Print summary using logger
  logger.section('OTEL Readiness Check');
  for (const check of evidence.checks) {
    const level = check.status === 'pass' ? 'info' : check.status === 'skip' ? 'warn' : 'error';
    const icon = check.status === 'pass' ? '✓' : check.status === 'skip' ? '⏭' : '✗';
    logger[level](`  ${icon} ${check.name}: ${check.message}`);
  }
  logger.info(`Result: ${pass ? 'READY' : 'NOT READY'}`);
  logger.info(`Evidence written to: ${evidencePath}`);

  process.exit(pass ? 0 : 1);
}

main();
