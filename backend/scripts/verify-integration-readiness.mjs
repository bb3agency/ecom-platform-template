#!/usr/bin/env node
/**
 * Razorpay & Shiprocket Integration Readiness Check
 *
 * Run this after applying the Prisma migration and restarting the backend.
 * It checks:
 *   1. Frontend env has NEXT_PUBLIC_RAZORPAY_KEY_ID
 *   2. Backend runtime config has required payment/shipping keys
 *   3. Backend health endpoints respond correctly
 *
 * Usage:
 *   node scripts/verify-integration-readiness.mjs
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function ok(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}
function fail(msg) {
  console.log(`${RED}✗${RESET} ${msg}`);
}
function warn(msg) {
  console.log(`${YELLOW}⚠${RESET} ${msg}`);
}

function parseEnv(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      env[key] = value;
    }
    return env;
  } catch {
    return null;
  }
}

function isSet(val) {
  return typeof val === 'string' && val.trim().length > 0 && !val.includes('replace_with');
}

async function checkHealth(apiBase) {
  try {
    const res = await fetch(`${apiBase}/health`);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    return { ok: true, body };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

async function checkReady(apiBase) {
  try {
    const res = await fetch(`${apiBase}/health/ready`);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    return { ok: true, body };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

// ── Main ──
console.log('\n=== Razorpay & Shiprocket Integration Readiness ===\n');

const backendRoot = resolve(process.cwd());
const frontendRoot = resolve(backendRoot, '..', 'frontend');

let exitCode = 0;

// 1. Frontend env checks
const frontendEnvPaths = [
  resolve(frontendRoot, '.env.local'),
  resolve(frontendRoot, '.env.production.local'),
];
let frontendEnv = null;
let frontendEnvPath = null;
for (const p of frontendEnvPaths) {
  const parsed = parseEnv(p);
  if (parsed) {
    frontendEnv = parsed;
    frontendEnvPath = p;
    break;
  }
}

console.log('--- Frontend env ---');
if (!frontendEnv) {
  fail(`No frontend env found. Checked: ${frontendEnvPaths.join(', ')}`);
  warn('  → Create frontend/.env.local and set NEXT_PUBLIC_RAZORPAY_KEY_ID');
  exitCode = 1;
} else {
  ok(`Found env file: ${frontendEnvPath}`);
  if (isSet(frontendEnv.NEXT_PUBLIC_RAZORPAY_KEY_ID)) {
    ok(`NEXT_PUBLIC_RAZORPAY_KEY_ID is set (${frontendEnv.NEXT_PUBLIC_RAZORPAY_KEY_ID.slice(0, 12)}...)`);
  } else {
    fail('NEXT_PUBLIC_RAZORPAY_KEY_ID is missing or empty');
    warn('  → Set it to your Razorpay test/public key (rzp_test_xxx or rzp_live_xxx)');
    exitCode = 1;
  }
  if (isSet(frontendEnv.NEXT_PUBLIC_API_BASE_URL)) {
    ok(`NEXT_PUBLIC_API_BASE_URL is set (${frontendEnv.NEXT_PUBLIC_API_BASE_URL})`);
  } else {
    fail('NEXT_PUBLIC_API_BASE_URL is missing');
    exitCode = 1;
  }
}

// 2. Backend env checks
const backendEnvPath = resolve(backendRoot, '.env');
const backendEnv = parseEnv(backendEnvPath);
console.log('\n--- Backend env ---');
if (!backendEnv) {
  fail(`Backend .env not found at ${backendEnvPath}`);
  exitCode = 1;
} else {
  ok(`Found backend .env`);
  const bootstrapKeys = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'OPS_DB_ENCRYPTION_KEY'];
  for (const key of bootstrapKeys) {
    if (isSet(backendEnv[key])) {
      ok(`${key} is set`);
    } else {
      fail(`${key} is missing or empty`);
      exitCode = 1;
    }
  }
}

// 3. Backend runtime config checks (via health/ready)
const apiBase = (backendEnv?.INTERNAL_API_BASE_URL ?? backendEnv?.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
console.log(`\n--- Backend runtime (${apiBase}) ---`);
const health = await checkHealth(apiBase);
if (health.ok) {
  ok('/health responds');
  const data = health.body?.data ?? {};
  if (data.db === 'connected') ok('Database: connected');
  else { fail(`Database: ${data.db}`); exitCode = 1; }
  if (data.redis === 'connected') ok('Redis: connected');
  else { fail(`Redis: ${data.redis}`); exitCode = 1; }
} else {
  fail(`/health unreachable: ${health.detail}`);
  warn('  → Is the backend running? Start it with: npm run dev:e2e');
  exitCode = 1;
}

const ready = await checkReady(apiBase);
if (ready.ok) {
  ok('/health/ready responds');
  const data = ready.body?.data ?? {};
  const missing = data.runtimeConfigMissingKeys ?? [];
  const isReady = data.status === 'ready';

  if (isReady) {
    ok('Backend readiness: ready');
  } else {
    fail(`Backend readiness: ${data.status}`);
    if (data.degradationMode === 'runtime_config_missing') {
      warn('  → Some required runtime config keys are missing');
    }
    exitCode = 1;
  }

  const paymentMissing = missing.filter((k) => k.startsWith('RAZORPAY') || k === 'PAYMENT_PROVIDER');
  const shippingMissing = missing.filter((k) => k.startsWith('SHIPROCKET') || k.startsWith('DELHIVERY'));

  if (paymentMissing.length === 0) {
    ok('Payment provider config: complete');
  } else {
    fail(`Payment provider config missing: ${paymentMissing.join(', ')}`);
    warn('  → Log into the Ops UI (/ops), go to Config → Payments, and set:');
    warn('     PAYMENT_PROVIDER=razorpay, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET');
    exitCode = 1;
  }

  if (shippingMissing.length === 0) {
    ok('Shipping provider config: complete');
  } else {
    fail(`Shipping provider config missing: ${shippingMissing.join(', ')}`);
    warn('  → Log into the Ops UI (/ops), go to Config → Shipping, and set credentials for one or both providers:');
    warn('     Delhivery: DELHIVERY_API_KEY, DELHIVERY_BASE_URL, DELHIVERY_WEBHOOK_TOKEN');
    warn('     Shiprocket: SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD, SHIPROCKET_WEBHOOK_TOKEN');
    warn('  → Note: SHIPPING_PROVIDER is not a config key — provider detection is credential-based.');
    exitCode = 1;
  }

  if (missing.length > 0) {
    const otherMissing = missing.filter((k) => !paymentMissing.includes(k) && !shippingMissing.includes(k));
    if (otherMissing.length > 0) {
      warn(`Other missing config keys: ${otherMissing.join(', ')}`);
    }
  }
} else {
  fail(`/health/ready unreachable: ${ready.detail}`);
  warn('  → Ensure backend is running and migrations are applied');
  exitCode = 1;
}

console.log('\n========================================');
if (exitCode === 0) {
  console.log(`${GREEN}All checks passed!${RESET} Integration is ready.`);
} else {
  console.log(`${RED}Some checks failed.${RESET} Follow the warnings above.`);
}
console.log('========================================\n');
process.exit(exitCode);
