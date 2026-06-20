const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');

// Load .env so REDIS_URL / ADMIN_EMAIL etc. are available when run outside CI
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const FETCH_TIMEOUT_MS = Number(process.env.CONTRACT_ADMIN_FETCH_TIMEOUT_MS || 10000);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345';

function stableHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function fetchOtpFromRedis(email) {
  // REDIS_URL_LOCAL lets scripts running on the host use a different Redis URL than
  // the backend (which may use a Docker service-name like redis://redis:6379).
  // Set REDIS_URL_LOCAL=redis://:password@localhost:6379 in .env when running the
  // backend in Docker Compose with Redis port-mapped to the host.
  const redisUrl = process.env.REDIS_URL_LOCAL || process.env.REDIS_URL;
  if (!redisUrl) {
    process.stderr.write('[admin-contract-check] REDIS_URL not set — cannot auto-read OTP from Redis.\n');
    return null;
  }

  const ciKey = `auth:admin:login-otp:ci-plaintext:${stableHash(email.trim().toLowerCase())}`;
  const client = new Redis(redisUrl, { lazyConnect: true, enableOfflineQueue: false, connectTimeout: 3000 });
  try {
    await client.connect();
    const otp = await client.get(ciKey);
    if (otp) return otp;
    // Connected but key not present — backend likely running with NODE_ENV=production
    process.stderr.write(
      `[admin-contract-check] Connected to Redis but ci-plaintext OTP key not found.\n` +
      '  Ensure the backend is NOT running with NODE_ENV=production (ci-plaintext key is only written in non-production).\n'
    );
    return null;
  } catch (err) {
    process.stderr.write(
      `[admin-contract-check] Redis connect failed (${redisUrl}): ${err instanceof Error ? err.message : String(err)}\n` +
      '  If the backend runs in Docker, set REDIS_URL_LOCAL=redis://:password@localhost:6379 in .env.\n'
    );
    return null;
  } finally {
    client.disconnect();
  }
}

function formatFetchFailure(path, error) {
  const reason = error instanceof Error ? error.message : String(error);
  return [
    `Admin contract check could not reach ${BASE_URL}${path}.`,
    `Reason: ${reason}`,
    'Ensure the backend is running and BASE_URL points to that running server.',
    `Also seed or configure an admin user matching credentials ADMIN_EMAIL/ADMIN_PASSWORD (${ADMIN_EMAIL} / ${ADMIN_PASSWORD}).`
  ].join(' ');
}

async function request(path, options = {}) {
  const requestOptions = {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS)
  };

  try {
    return await fetch(`${BASE_URL}${path}`, requestOptions);
  } catch (error) {
    throw new Error(formatFetchFailure(path, error), {
      cause: error instanceof Error ? error : undefined
    });
  }
}

async function requestJson(path, options = {}) {
  const response = await request(path, options);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { status: response.status, json, headers: response.headers };
}

async function main() {
  const unauthProbe = await requestJson('/api/v1/admin/users');
  if (unauthProbe.status !== 401) {
    throw new Error(`Expected 401 on unauthenticated admin route probe, received ${unauthProbe.status}`);
  }

  // Step 1 — verify credentials and trigger OTP email
  const loginStep1Res = await requestJson('/api/v1/auth/admin/login/request-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  if (loginStep1Res.status !== 200) {
    throw new Error(`Admin login step 1 failed: ${loginStep1Res.status} ${JSON.stringify(loginStep1Res.json)}`);
  }

  // Step 2 — verify OTP: prefer ADMIN_OTP env var, fall back to Redis CI plaintext key (NODE_ENV=test only)
  let adminOtp = process.env.ADMIN_OTP;
  if (!adminOtp) {
    adminOtp = await fetchOtpFromRedis(ADMIN_EMAIL);
  }
  if (!adminOtp) {
    throw new Error('ADMIN_OTP env var is required for admin-contract-check. Set it to the OTP sent to the admin email after step 1. In CI (NODE_ENV=test), it is auto-read from Redis.');
  }
  const loginRes = await requestJson('/api/v1/auth/admin/login/verify-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, otp: adminOtp })
  });

  const token = loginRes.json?.data?.accessToken ?? loginRes.json?.accessToken;
  if (loginRes.status !== 200 || !token) {
    throw new Error(`Admin login step 2 failed: ${loginRes.status} ${JSON.stringify(loginRes.json)}`);
  }

  const authHeaders = { authorization: `Bearer ${token}` };

  const listUsersRes = await requestJson('/api/v1/admin/users', { headers: authHeaders });
  process.stdout.write(`/api/v1/admin/users => ${listUsersRes.status}\n`);
  if (listUsersRes.status !== 200) {
    throw new Error(`Contract check failed for /api/v1/admin/users: ${listUsersRes.status} ${JSON.stringify(listUsersRes.json)}`);
  }

  const listOrdersRes = await requestJson('/api/v1/admin/orders?page=1&limit=20', { headers: authHeaders });
  process.stdout.write(`/api/v1/admin/orders => ${listOrdersRes.status}\n`);
  if (listOrdersRes.status !== 200) {
    throw new Error(`Contract check failed for /api/v1/admin/orders: ${listOrdersRes.status}`);
  }
  const listProductsRes = await requestJson('/api/v1/admin/products?page=1&limit=20', { headers: authHeaders });
  process.stdout.write(`/api/v1/admin/products => ${listProductsRes.status}\n`);
  if (listProductsRes.status !== 200) {
    throw new Error(`Contract check failed for /api/v1/admin/products: ${listProductsRes.status}`);
  }

  // Extract candidate IDs: responses return { items: [...], meta: {...} } directly (no data wrapper).
  const candidateUserId = listUsersRes.json?.items?.[0]?.id ?? listUsersRes.json?.data?.items?.[0]?.id;
  const candidateOrderId = listOrdersRes.json?.items?.[0]?.id ?? listOrdersRes.json?.data?.items?.[0]?.id;
  const candidateProductId = listProductsRes.json?.items?.[0]?.id ?? listProductsRes.json?.data?.items?.[0]?.id;

  if (candidateOrderId) {
    const retriggerRes = await requestJson(`/api/v1/admin/orders/${candidateOrderId}/notifications/retrigger`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        template: 'OrderConfirmed',
        channels: ['EMAIL']
      })
    });
    process.stdout.write(
      `/api/v1/admin/orders/${candidateOrderId}/notifications/retrigger => ${retriggerRes.status}\n`
    );
    if (retriggerRes.status !== 200) {
      throw new Error(`Contract check failed for /api/v1/admin/orders/${candidateOrderId}/notifications/retrigger: ${retriggerRes.status}`);
    }
  }

  const jsonEndpoints = [
    ...(candidateUserId ? [`/api/v1/admin/users/${candidateUserId}`] : []),
    ...(candidateProductId ? [`/api/v1/admin/products/${candidateProductId}`] : []),
    '/api/v1/admin/categories',
    '/api/v1/admin/inventory?page=1&limit=20',
    '/api/v1/admin/inventory/low-stock',
    '/api/v1/admin/orders?page=1&limit=20',
    ...(candidateOrderId ? [`/api/v1/admin/orders/${candidateOrderId}`] : []),
    '/api/v1/admin/coupons?page=1&limit=20',
    '/api/v1/admin/coupons/analytics?page=1&limit=20',
    ...((process.env.FEATURE_REVIEWS_ENABLED ?? 'false').toLowerCase() === 'true'
      ? ['/api/v1/admin/reviews?page=1&limit=20']
      : []),
    '/api/v1/admin/settings/store',
    '/api/v1/admin/settings/notifications',
    '/api/v1/admin/settings/inventory',
    '/api/v1/admin/dashboard/kpis',
    '/api/v1/admin/dashboard/sales-chart',
    '/api/v1/admin/dashboard/top-products',
    '/api/v1/admin/analytics/revenue',
    '/api/v1/admin/analytics/funnel',
    '/api/v1/admin/analytics/inventory-alerts',
    '/api/v1/admin/analytics/notifications',
    '/api/v1/admin/analytics/category-breakdown',
    '/api/v1/admin/analytics/reconciliation-issues?page=1&limit=20',
    '/api/v1/admin/analytics/outbox-dead-letter?page=1&limit=20',
    '/api/v1/admin/analytics/inbox-failures?page=1&limit=20'
  ];

  for (const path of jsonEndpoints) {
    const res = await requestJson(path, { headers: authHeaders });
    process.stdout.write(`${path} => ${res.status}\n`);
    if (res.status !== 200) {
      throw new Error(`Contract check failed for ${path}: ${res.status} ${JSON.stringify(res.json)}`);
    }
  }

  const exportCsvRes = await request(
    `/api/v1/admin/orders/export?from=${encodeURIComponent('2026-01-01T00:00:00.000Z')}&to=${encodeURIComponent(
      new Date().toISOString()
    )}`,
    { headers: authHeaders }
  );
  const exportCsvContentType = exportCsvRes.headers.get('content-type') || '';
  process.stdout.write(`/api/v1/admin/orders/export => ${exportCsvRes.status} content-type=${exportCsvContentType}\n`);
  if (exportCsvRes.status !== 200 || !exportCsvContentType.includes('text/csv')) {
    throw new Error('Contract check failed for /api/v1/admin/orders/export');
  }

  const shippingSettingsPatchRes = await requestJson('/api/v1/admin/settings/shipping', {
    method: 'PATCH',
    headers: {
      ...authHeaders,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      pickupPincode: '522006',
      minOrderValuePaise: 10000
    })
  });
  process.stdout.write(
    `/api/v1/admin/settings/shipping [PATCH] => ${shippingSettingsPatchRes.status}\n`
  );
  if (shippingSettingsPatchRes.status !== 200) {
    throw new Error(`Contract check failed for PATCH /api/v1/admin/settings/shipping: ${shippingSettingsPatchRes.status}`);
  }
  // minOrderValuePaise may be at root or under .data depending on envelope
  const patchedMin = shippingSettingsPatchRes.json?.minOrderValuePaise ?? shippingSettingsPatchRes.json?.data?.minOrderValuePaise;
  if (patchedMin !== 10000) {
    throw new Error('Contract check failed for PATCH /api/v1/admin/settings/shipping: minOrderValuePaise mismatch');
  }

  const shippingSettingsGetRes = await requestJson('/api/v1/admin/settings/shipping', {
    headers: authHeaders
  });
  process.stdout.write(
    `/api/v1/admin/settings/shipping [GET] => ${shippingSettingsGetRes.status}\n`
  );
  if (shippingSettingsGetRes.status !== 200) {
    throw new Error(`Contract check failed for GET /api/v1/admin/settings/shipping: ${shippingSettingsGetRes.status}`);
  }
  const getMin = shippingSettingsGetRes.json?.minOrderValuePaise ?? shippingSettingsGetRes.json?.data?.minOrderValuePaise;
  if (typeof getMin !== 'number') {
    throw new Error('Contract check failed for GET /api/v1/admin/settings/shipping: minOrderValuePaise must be number');
  }
  if (getMin !== 10000) {
    throw new Error('Contract check failed for GET /api/v1/admin/settings/shipping: persisted minOrderValuePaise mismatch');
  }

  const refundedOrderRes = await requestJson('/api/v1/admin/orders?page=1&limit=1&status=REFUNDED', {
    headers: authHeaders
  });
  process.stdout.write(
    `/api/v1/admin/orders?status=REFUNDED => ${refundedOrderRes.status}\n`
  );
  if (refundedOrderRes.status !== 200) {
    throw new Error(`Contract check failed for /api/v1/admin/orders?status=REFUNDED: ${refundedOrderRes.status}`);
  }

  const refundedOrderId = refundedOrderRes.json?.items?.[0]?.id ?? refundedOrderRes.json?.data?.items?.[0]?.id;
  if (refundedOrderId) {
    const refundedOrderDetailRes = await requestJson(`/api/v1/admin/orders/${refundedOrderId}`, {
      headers: authHeaders
    });
    process.stdout.write(
      `/api/v1/admin/orders/${refundedOrderId} => ${refundedOrderDetailRes.status}\n`
    );
    if (refundedOrderDetailRes.status !== 200) {
      throw new Error(`Contract check failed for refunded order detail: ${refundedOrderDetailRes.status}`);
    }

    const creditNotes = refundedOrderDetailRes.json?.creditNotes ?? refundedOrderDetailRes.json?.data?.creditNotes;
    if (!Array.isArray(creditNotes)) {
      throw new Error('Refunded order detail contract check failed: creditNotes must be an array');
    }

    for (const creditNote of creditNotes) {
      if (
        typeof creditNote !== 'object' ||
        creditNote === null ||
        typeof creditNote.creditNoteNumber !== 'string' ||
        typeof creditNote.originalInvoiceNumber !== 'string' ||
        typeof creditNote.reason !== 'string'
      ) {
        throw new Error('Refunded order detail contract check failed: invalid creditNotes item shape');
      }
    }
  } else {
    process.stdout.write('No refunded orders found; skipped refunded order detail creditNotes validation.\n');
  }

  // Bull Board is ops-session protected (not admin Bearer). Verify the route exists and
  // returns 401 when accessed without a valid ops session — this proves registration + guard.
  const queuesRes = await request('/api/v1/ops/queues', {
    headers: authHeaders
  });
  process.stdout.write(`/api/v1/ops/queues => ${queuesRes.status} (expect 401 — ops-session guard)\n`);

  if (queuesRes.status !== 401) {
    throw new Error(`Bull Board contract check failed: expected 401 (ops-session guard), got ${queuesRes.status}`);
  }


}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
