#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const logger = require('./lib/logger');

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1];
const scenarioArg = process.argv.find((arg) => arg.startsWith('--scenario='))?.split('=')[1];
const seedArg = process.argv.find((arg) => arg.startsWith('--seed='))?.split('=')[1];
const mode = (modeArg ?? process.env.FLASH_SALE_MODE ?? 'simulation').trim().toLowerCase();
const totalStock = Number(process.env.FLASH_SALE_STOCK ?? '100');
const buyers = Number(process.env.FLASH_SALE_BUYERS ?? '250');
const reservationTtlSeconds = Number(process.env.FLASH_SALE_RESERVATION_TTL_SECONDS ?? '120');
const admissionBudgetPerMinute = Number(process.env.FLASH_SALE_ADMISSION_BUDGET_PER_MINUTE ?? '120');
const perUserReserveCap = Number(process.env.FLASH_SALE_USER_RESERVE_CAP ?? '2');
const userCooldownSeconds = Number(process.env.FLASH_SALE_USER_COOLDOWN_SECONDS ?? '15');
const scenario = (scenarioArg ?? process.env.FLASH_SALE_SCENARIO ?? 'hot-normal').trim().toLowerCase();
const seed = Number(seedArg ?? process.env.FLASH_SALE_SEED ?? '42');
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const PLACEHOLDER_UUID = '00000000-0000-4000-8000-000000000000';
const SEEDED_FALLBACK_VARIANT_ID = 'f1a00000-0000-4000-8000-0000000000a2';
let runtimeVariantId = process.env.FLASH_SALE_VARIANT_ID ?? PLACEHOLDER_UUID;
const paymentOrderId = process.env.FLASH_SALE_PAYMENT_ORDER_ID ?? '00000000-0000-4000-8000-000000000000';
const parallelism = Math.max(1, Number(process.env.FLASH_SALE_PARALLELISM ?? '20'));
const authMode = (process.env.FLASH_SALE_AUTH_MODE ?? 'required').toLowerCase();
const enforceInvariants = String(process.env.FLASH_SALE_ENFORCE_INVARIANTS ?? 'true').toLowerCase() === 'true';
const fairnessMin = Number(process.env.FLASH_SALE_FAIRNESS_MIN ?? '0.2');
const fairnessByUserMin = Number(process.env.FLASH_SALE_FAIRNESS_BY_USER_MIN ?? '0.2');
const p95LatencyMaxMs = Number(process.env.FLASH_SALE_P95_MAX_MS ?? '1500');
const p99LatencyMaxMs = Number(process.env.FLASH_SALE_P99_MAX_MS ?? '2500');
const apiErrorRateMax = Number(process.env.FLASH_SALE_API_ERROR_RATE_MAX ?? '0.2');
const outputDir = path.join(process.cwd(), 'artifacts', 'flash-sale');
const fixtureRunNonce = Date.now().toString(36);
let rngState = seed;
let runtimeFixtureVariantIds = [];

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(2));
}

function ensureDatabaseUrlInProcess() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) {
    return;
  }
  const fromDotEnv = readEnvValueFromDotEnv('DATABASE_URL');
  if (fromDotEnv && fromDotEnv.length > 0) {
    process.env.DATABASE_URL = fromDotEnv;
  }
}

function readEnvValueFromDotEnv(key) {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return undefined;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const k = trimmed.slice(0, idx).trim();
      if (k !== key) continue;
      return trimmed.slice(idx + 1).trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function ensureApiFixtureVariantId() {
  ensureDatabaseUrlInProcess();
  if (runtimeVariantId !== PLACEHOLDER_UUID) {
    return;
  }

  const fixtureScript = path.join(process.cwd(), 'scripts', 'seed-flash-sale-fixtures.js');
  try {
    const databaseUrl = process.env.DATABASE_URL || readEnvValueFromDotEnv('DATABASE_URL');
    const execEnv = databaseUrl ? { ...process.env, DATABASE_URL: databaseUrl } : process.env;
    execFileSync(process.execPath, [fixtureScript], {
      cwd: process.cwd(),
      stdio: 'pipe',
      env: execEnv
    });
  } catch {
    // best-effort fixture preparation; fallback ID resolution below.
  }

  const fixtureJson = path.join(process.cwd(), 'artifacts', 'flash-sale', 'fixtures.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(fixtureJson, 'utf8'));
    runtimeFixtureVariantIds = Array.isArray(parsed?.allVariantIds)
      ? parsed.allVariantIds.filter((id) => typeof id === 'string')
      : [];
    const variants = Array.isArray(parsed?.products)
      ? parsed.products.flatMap((p) => (Array.isArray(p?.variants) ? p.variants : []))
      : [];
    const topVariant = variants
      .filter((v) => typeof v?.variantId === 'string')
      .sort((a, b) => Number(b?.stock ?? 0) - Number(a?.stock ?? 0))[0];
    const candidate = typeof topVariant?.variantId === 'string'
      ? topVariant.variantId
      : (Array.isArray(parsed?.allVariantIds) ? parsed.allVariantIds[0] : null);
    if (typeof candidate === 'string' && candidate.length > 0) {
      runtimeVariantId = candidate;
      return;
    }
  } catch {
    // ignore and use seeded fallback id
  }

  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const selected = await prisma.productVariant.findFirst({
      where: {
        isActive: true,
        product: { isActive: true },
        inventory: { is: { quantity: { gt: 0 } } }
      },
      select: { id: true },
      orderBy: { updatedAt: 'desc' }
    });
    await prisma.$disconnect();
    if (selected?.id) {
      runtimeVariantId = selected.id;
      return;
    }
  } catch {
    // ignore: DB may be unavailable in non-api mode.
  }

  runtimeVariantId = SEEDED_FALLBACK_VARIANT_ID;
  runtimeFixtureVariantIds = [SEEDED_FALLBACK_VARIANT_ID];
}

async function resetApiFixtureState() {
  ensureDatabaseUrlInProcess();
  if (runtimeFixtureVariantIds.length === 0) {
    return;
  }
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.cartReservation.deleteMany({
      where: { variantId: { in: runtimeFixtureVariantIds } }
    });
    await prisma.cartItem.deleteMany({
      where: { variantId: { in: runtimeFixtureVariantIds } }
    });
    await prisma.$disconnect();
  } catch {
    // best-effort cleanup for synthetic stress fixtures
  }
}

function classifyStatus(status) {
  if (status >= 200 && status < 300) return 'success';
  if (status === 429) return 'rejected_rate_limit';
  if (status === 409) return 'rejected_conflict';
  if (status >= 400 && status < 500) return 'rejected_client';
  if (status >= 500) return 'error_server';
  return 'error_network';
}

function baseReport() {
  return {
    mode,
    scenario,
    totalStock,
    buyers,
    reservationTtlSeconds,
    admissionBudgetPerMinute,
    perUserReserveCap,
    userCooldownSeconds,
    seed,
    parallelism,
    success: 0,
    rejected: 0,
    rejectedBudget: 0,
    rejectedCooldown: 0,
    rejectedUserCap: 0,
    oversell: false,
    fairness: 0,
    fairnessByUser: 0,
    p95LatencyMs: 0,
    p99LatencyMs: 0,
    errorRate: 0,
    rejectReasons: {},
    invariantChecks: {}
  };
}

function nextRandom() {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}

function writeArtifact(report) {
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, `flash-sale-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}

async function runSimulation() {
  let remaining = totalStock;
  let success = 0;
  let rejected = 0;
  let rejectedBudget = 0;
  let rejectedCooldown = 0;
  let rejectedUserCap = 0;
  const userState = new Map();
  const latencies = [];

  for (let i = 0; i < buyers; i += 1) {
    const started = Date.now();
    const minuteBucket = Math.floor(i / 60);
    const admissionUsed = i % 60;
    if (admissionUsed >= admissionBudgetPerMinute) {
      rejected += 1;
      rejectedBudget += 1;
      latencies.push(Date.now() - started);
      continue;
    }

    const userId = `buyer-${(i % Math.max(1, Math.floor(buyers / 4))).toString().padStart(4, '0')}`;
    const state = userState.get(userId) ?? { reserved: 0, lastAt: -9999 };
    if (i - state.lastAt <= userCooldownSeconds) {
      rejected += 1;
      rejectedCooldown += 1;
      userState.set(userId, state);
      latencies.push(Date.now() - started);
      continue;
    }
    if (state.reserved >= perUserReserveCap) {
      rejected += 1;
      rejectedUserCap += 1;
      userState.set(userId, state);
      latencies.push(Date.now() - started);
      continue;
    }

    if (remaining >= 1) {
      remaining -= 1;
      success += 1;
      state.reserved += 1;
      state.lastAt = minuteBucket * 60 + (i % 60);
      userState.set(userId, state);
    } else {
      rejected += 1;
    }
    latencies.push(Date.now() - started);
  }

  const fulfilledUsers = [...userState.values()].filter((state) => state.reserved > 0).length;
  return {
    ...baseReport(),
    success,
    rejected,
    rejectedBudget,
    rejectedCooldown,
    rejectedUserCap,
    oversell: remaining < 0,
    fairness: success / Math.max(1, buyers),
    fairnessByUser: fulfilledUsers / Math.max(1, userState.size),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    errorRate: Number((rejected / Math.max(1, buyers)).toFixed(4)),
    rejectReasons: {
      budget: rejectedBudget,
      cooldown: rejectedCooldown,
      userCap: rejectedUserCap
    }
  };
}

function seedFixtureUsers() {
  const userCount = Math.max(5, Math.floor(buyers / 8));
  return Array.from({ length: userCount }, (_value, index) => {
    const suffix = Math.floor(nextRandom() * 1000000).toString().padStart(6, '0');
    return {
      userId: `stress-user-${String(index + 1).padStart(3, '0')}`,
      sessionToken: `stress-session-${suffix}`,
      email: `stress-user-${seed}-${fixtureRunNonce}-${index + 1}@example.com`,
      phone: `9${String(Math.floor(nextRandom() * 1000000000)).padStart(9, '0')}`,
      password: 'Password@123'
    };
  });
}

function requestBodyFor(action, userId) {
  if (action === 'cart-add') return { variantId: runtimeVariantId, quantity: 1 };
  if (action === 'cart-update') return { quantity: scenario === 'fairness-abuse' ? perUserReserveCap + 1 : 1 };
  if (action === 'order-create') return { notes: `flash-stress-${userId}` };
  if (action === 'payment-initiate') return { orderId: paymentOrderId };
  return { orderId: paymentOrderId, razorpayPaymentId: `pay_${Date.now()}`, razorpaySignature: 'sig' };
}

function actionForIteration(iteration) {
  if (mode === 'api') {
    // API mode focuses on contention at cart reservation/admission boundaries.
    // Avoid invalid order/payment payload shapes that turn the run into schema-noise.
    return 'cart-add';
  }
  const phases = ['cart-add', 'cart-update', 'order-create', 'payment-initiate', 'payment-verify'];
  if (scenario === 'bot-burst') return phases[iteration % 2];
  if (scenario === 'payment-drop') return phases[Math.min(phases.length - 1, iteration % phases.length)];
  return phases[iteration % 3];
}

function endpointForAction(action) {
  if (action === 'cart-add') return { method: 'POST', path: '/api/v1/cart/items' };
  if (action === 'cart-update') return { method: 'PATCH', path: '/api/v1/cart/items/00000000-0000-4000-8000-000000000000' };
  if (action === 'order-create') return { method: 'POST', path: '/api/v1/orders' };
  if (action === 'payment-initiate') return { method: 'POST', path: '/api/v1/payments/initiate' };
  return { method: 'POST', path: '/api/v1/payments/verify' };
}

async function runApiStress() {
  await ensureApiFixtureVariantId();
  await resetApiFixtureState();
  const fixtures = seedFixtureUsers();
  const seededAt = new Date().toISOString();
  const runId = `flash-${scenario}-${seed}-${Date.now()}`;
  const authTokens = await bootstrapAuthFixtures(fixtures);
  const latencies = [];
  const outcomeByUser = new Map();
  const rejectReasons = {};
  const clientRejectionSamples = [];
  let success = 0;
  let rejected = 0;
  let errors = 0;
  let oversellSignals = 0;

  const queue = Array.from({ length: buyers }, (_value, index) => index);
  const workers = Array.from({ length: parallelism }, async () => {
    while (queue.length > 0) {
      const iteration = queue.shift();
      if (iteration === undefined) {
        return;
      }
      const fixture = fixtures[iteration % fixtures.length];
      const action = actionForIteration(iteration);
      const endpoint = endpointForAction(action);
      const started = Date.now();
      const headers = {
        'content-type': 'application/json',
        'x-correlation-id': `flash-${Date.now()}-${iteration}`,
        'x-session-token': fixture.sessionToken,
        'idempotency-key': `flash-sale-${scenario}-${seed}-${fixtureRunNonce}-${fixture.userId}-${action}-${iteration}`,
        cookie: `cart_session=${encodeURIComponent(fixture.sessionToken)}`
      };
      const token = authTokens.get(fixture.email);
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      try {
        const response = await fetch(`${baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          headers,
          body: JSON.stringify(requestBodyFor(action, fixture.userId))
        });
        const latency = Date.now() - started;
        latencies.push(latency);
        const reason = classifyStatus(response.status);
        rejectReasons[reason] = (rejectReasons[reason] ?? 0) + 1;
        let responseBody = '';
        const shouldReadBody = reason === 'rejected_client' || response.status === 409;
        if (shouldReadBody) {
          try {
            responseBody = await response.text();
          } catch {
            responseBody = '';
          }
        }
        if ((reason === 'rejected_client' || response.status === 409) && clientRejectionSamples.length < 5) {
          clientRejectionSamples.push({
            action,
            endpoint: endpoint.path,
            status: response.status,
            body: responseBody.slice(0, 500)
          });
        }
        if (reason === 'success') {
          success += 1;
          outcomeByUser.set(fixture.userId, (outcomeByUser.get(fixture.userId) ?? 0) + 1);
        } else if (reason.startsWith('rejected')) {
          rejected += 1;
        } else {
          errors += 1;
        }
        if (response.status === 409 && /oversell|oversold|insufficient_stock/i.test(responseBody)) {
          oversellSignals += 1;
        }
      } catch {
        const latency = Date.now() - started;
        latencies.push(latency);
        rejectReasons.error_network = (rejectReasons.error_network ?? 0) + 1;
        errors += 1;
      }
    }
  });

  await Promise.all(workers);
  const fulfilledUsers = [...outcomeByUser.values()].filter((count) => count > 0).length;
  const report = {
    ...baseReport(),
    mode: 'api',
    baseUrl,
    variantId: runtimeVariantId,
    paymentOrderId,
    seededFixture: {
      variantId: runtimeVariantId,
      users: fixtures.length,
      seed,
      seededAt,
      runId
    },
    fixtureLifecycle: {
      preSeed: {
        usersProvisioned: fixtures.length,
        authMode,
        authenticatedUsers: authTokens.size
      },
      cleanup: {
        status: 'noop',
        reason: 'ephemeral fixture identities only'
      }
    },
    success,
    rejected,
    oversell: oversellSignals > 0,
    fairness: success / Math.max(1, buyers),
    fairnessByUser: fulfilledUsers / Math.max(1, fixtures.length),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    errorRate: Number((errors / Math.max(1, buyers)).toFixed(4)),
    rejectReasons,
    clientRejectionSamples
  };
  return report;
}

async function bootstrapAuthFixtures(fixtures) {
  const tokens = new Map();
  if (authMode !== 'required') {
    return tokens;
  }
  for (const fixture of fixtures) {
    try {
      await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Stress',
          lastName: 'User',
          email: fixture.email,
          phone: fixture.phone,
          password: fixture.password
        })
      });

      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: fixture.email,
          password: fixture.password
        })
      });
      if (!loginResponse.ok) {
        continue;
      }
      const payload = await loginResponse.json();
      const accessToken = payload?.data?.accessToken ?? payload?.accessToken;
      if (typeof accessToken === 'string' && accessToken.length > 0) {
        tokens.set(fixture.email, accessToken);
      }
    } catch {
      // Continue using unauthenticated path for this fixture.
    }
  }
  return tokens;
}

async function main() {
  const report = mode === 'api' ? await runApiStress() : await runSimulation();
  const invariantFailures = [];
  const fixturePreconditionMet = !(mode === 'api' && report.success === 0 && Number(report.rejectReasons.rejected_client ?? 0) >= report.buyers);
  const invariantChecks = {
    fixturePreconditionMet,
    noOversell: report.oversell === false,
    fairnessWithinThreshold: fixturePreconditionMet ? report.fairness >= fairnessMin : true,
    fairnessByUserWithinThreshold: fixturePreconditionMet ? report.fairnessByUser >= fairnessByUserMin : true,
    p95WithinThreshold: report.p95LatencyMs <= p95LatencyMaxMs,
    p99WithinThreshold: report.p99LatencyMs <= p99LatencyMaxMs,
    errorRateWithinThreshold: mode !== 'api' || report.errorRate <= apiErrorRateMax
  };
  if (!invariantChecks.fixturePreconditionMet) {
    invariantFailures.push('fixture precondition not met (all requests rejected at client layer)');
  }
  if (!invariantChecks.noOversell) invariantFailures.push('oversell detected');
  if (!invariantChecks.fairnessWithinThreshold) invariantFailures.push(`fairness below ${fairnessMin}`);
  if (!invariantChecks.fairnessByUserWithinThreshold) invariantFailures.push(`fairnessByUser below ${fairnessByUserMin}`);
  if (!invariantChecks.p95WithinThreshold) invariantFailures.push(`p95 latency above ${p95LatencyMaxMs}ms`);
  if (!invariantChecks.p99WithinThreshold) invariantFailures.push(`p99 latency above ${p99LatencyMaxMs}ms`);
  if (!invariantChecks.errorRateWithinThreshold) invariantFailures.push(`error rate above ${apiErrorRateMax}`);
  const enrichedReport = {
    ...report,
    invariantChecks: {
      ...invariantChecks,
      failures: invariantFailures
    },
    errorBudgetImpactPercent: Number(((mode === 'api' ? report.errorRate : report.rejected / Math.max(1, report.buyers)) * 100).toFixed(2))
  };
  const file = writeArtifact(enrichedReport);
  process.stdout.write(JSON.stringify({ ...enrichedReport, artifactFile: file }, null, 2) + '\n');
  if (enforceInvariants && invariantFailures.length > 0) {
    process.exit(1);
  }
  if (enforceInvariants && (report.oversell || (mode === 'api' && report.errorRate > apiErrorRateMax))) {
    process.exit(1);
  }
}

main().catch((error) => {
  logger.fatal(error instanceof Error ? error.message : String(error));
});
