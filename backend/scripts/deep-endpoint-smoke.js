const fs = require('node:fs');
const path = require('node:path');
const logger = require('./lib/logger');

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';

function walk(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, acc);
    } else {
      acc.push(fullPath);
    }
  }
  return acc;
}

function parseRoutes() {
  const modulesDir = path.join(process.cwd(), 'src', 'modules');
  const routeFiles = walk(modulesDir).filter((filePath) => filePath.endsWith('.routes.ts'));
  const routeRegex = /fastify\.(get|post|patch|put|delete)\(\s*['"]([^'"]+)['"]/g;
  const routes = [];

  for (const filePath of routeFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    let match = routeRegex.exec(content);
    while (match) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2]
      });
      match = routeRegex.exec(content);
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function isAdminRoute(routePath) {
  return routePath.startsWith('/api/v1/admin');
}

function isPublicRoute(routePath) {
  return (
    routePath === '/api/v1/health' ||
    routePath.startsWith('/api/v1/products') ||
    routePath.startsWith('/api/v1/auth/') ||
    routePath.startsWith('/api/v1/cart') ||
    routePath === '/api/v1/payments/webhook' ||
    routePath === '/api/v1/shipping/webhook' ||
    routePath.startsWith('/api/v1/shipping/track')
  );
}

function materializePath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, (_full, param) => {
    if (param.toLowerCase().includes('slug')) return 'test-slug';
    if (param.toLowerCase().includes('awb')) return 'awb-test';
    return '00000000-0000-4000-8000-000000000000';
  });
}

function jsonBodyFor(route) {
  const key = `${route.method} ${route.path}`;
  switch (key) {
    case 'POST /api/v1/auth/register':
      return {
        firstName: 'Smoke',
        lastName: 'User',
        email: `smoke-${Date.now()}@example.com`,
        phone: `9${String(Date.now()).slice(-9)}`,
        password: 'Password@123'
      };
    case 'POST /api/v1/auth/login':
      return {
        email: `smoke-login-${Date.now()}@example.com`,
        password: 'Password@123'
      };
    case 'POST /api/v1/auth/send-otp':
      return {
        phone: `9${String(Date.now()).slice(-9)}`
      };
    case 'POST /api/v1/auth/verify-otp':
      return {
        phone: `9${String(Date.now()).slice(-9)}`,
        otp: '000000'
      };
    case 'POST /api/v1/auth/forgot-password':
      return {
        email: `missing-${Date.now()}@example.com`
      };
    case 'POST /api/v1/auth/admin/login/request-otp':
      return { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
    case 'POST /api/v1/auth/admin/login/verify-otp':
      return { email: ADMIN_EMAIL, otp: process.env.ADMIN_OTP ?? '000000' };
    case 'POST /api/v1/cart/items':
      return {
        variantId: '00000000-0000-4000-8000-000000000000',
        quantity: 1
      };
    case 'PATCH /api/v1/cart/items/:id':
      return { quantity: 1 };
    case 'POST /api/v1/cart/merge':
      return { sessionToken: 'session-token-smoke' };
    case 'POST /api/v1/cart/coupon':
      return { code: 'SMOKE' };
    case 'POST /api/v1/cart/check-pincode':
      return { pincode: '500001' };
    case 'POST /api/v1/cart/delivery-rates':
      return { pincode: '500001' };
    case 'POST /api/v1/orders':
      return { notes: 'smoke' };
    case 'POST /api/v1/payments/initiate':
      return { orderId: '00000000-0000-4000-8000-000000000000' };
    case 'POST /api/v1/payments/verify':
      return {
        orderId: '00000000-0000-4000-8000-000000000000',
        razorpayPaymentId: 'pay_smoke',
        razorpaySignature: 'sig_smoke'
      };
    case 'PATCH /api/v1/admin/orders/:id/status':
      return { status: 'PROCESSING' };
    case 'POST /api/v1/admin/orders/:id/notifications/retrigger':
      return { template: 'OrderConfirmed' };
    case 'PATCH /api/v1/admin/settings/shipping':
      return { pickupPincode: '500001', minOrderValuePaise: 0 };
    case 'PATCH /api/v1/admin/settings/store':
      return { storeName: 'Smoke Store' };
    case 'PATCH /api/v1/admin/settings/notifications':
      return { emailEnabled: true, smsEnabled: true, whatsappEnabled: false };
    case 'PATCH /api/v1/admin/settings/inventory':
      return { defaultLowStockThreshold: 5 };
    case 'POST /api/v1/admin/coupons':
      return { code: `SMOKE${Date.now()}`, type: 'PERCENTAGE_OFF', value: 10, validFrom: new Date().toISOString() };
    case 'PATCH /api/v1/admin/coupons/:id':
      return { value: 5 };
    case 'PATCH /api/v1/admin/coupons/:id/status':
      return { isActive: false };
    case 'POST /api/v1/admin/products':
      return {
        name: 'Smoke Product',
        slug: `smoke-product-${Date.now()}`,
        description: 'Smoke',
        categoryId: '00000000-0000-4000-8000-000000000000'
      };
    case 'POST /api/v1/admin/products/:id/variants':
      return { sku: `SMOKE-SKU-${Date.now()}`, name: 'Default', price: 1000 };
    case 'PATCH /api/v1/admin/products/:id/variants/:variantId':
      return { price: 1000 };
    case 'PATCH /api/v1/admin/products/:id':
      return { name: 'Smoke Updated' };
    case 'POST /api/v1/admin/categories':
      return { name: `Smoke Category ${Date.now()}`, slug: `smoke-category-${Date.now()}` };
    case 'PATCH /api/v1/admin/categories/:id':
      return { name: 'Smoke Category Updated' };
    case 'POST /api/v1/reviews':
      return {
        orderItemId: '00000000-0000-4000-8000-000000000000',
        productId: '00000000-0000-4000-8000-000000000000',
        rating: 5,
        body: 'smoke'
      };
    case 'PATCH /api/v1/admin/reviews/:id/moderate':
      return { approved: true };
    default:
      return {};
  }
}

async function loginAdmin() {
  // Step 1: request OTP (verifies credentials, sends OTP to email)
  let step1;
  try {
    step1 = await fetch(`${BASE_URL}/api/v1/auth/admin/login/request-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    });
  } catch (error) {
    throw error;
  }
  if (!step1.ok) {
    throw new Error(`Admin login step 1 failed: ${step1.status}`);
  }

  // Step 2: verify OTP — requires ADMIN_OTP env var (the OTP sent to admin email).
  // In automated environments without email access, set ADMIN_OTP to the OTP value
  // obtained out-of-band. If ADMIN_OTP is not set, skip step 2 and return null so
  // admin routes are hit unauthenticated (expected to return 401/403, not 5xx).
  const adminOtp = process.env.ADMIN_OTP;
  if (!adminOtp) {
    logger.info('ADMIN_OTP not set — skipping admin token acquisition; admin routes will be exercised unauthenticated (expect 401/403, not 5xx)');
    return null;
  }

  let step2;
  try {
    step2 = await fetch(`${BASE_URL}/api/v1/auth/admin/login/verify-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, otp: adminOtp })
    });
  } catch (error) {
    throw error;
  }
  if (!step2.ok) {
    throw new Error(`Admin login step 2 failed: ${step2.status}`);
  }
  const body = await step2.json();
  return body?.data?.accessToken ?? body?.accessToken ?? null;
}

async function registerAndLoginCustomer() {
  const email = `smoke-user-${Date.now()}@example.com`;
  const registerPayload = {
    firstName: 'Smoke',
    lastName: 'User',
    email,
    phone: `9${String(Date.now()).slice(-9)}`,
    password: 'Password@123'
  };
  await fetch(`${BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registerPayload)
  });

  const loginResponse = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password@123' })
  });
  if (!loginResponse.ok) {
    return null;
  }
  const body = await loginResponse.json();
  return body?.data?.accessToken ?? body?.accessToken ?? null;
}

async function hitRoute(route, adminToken, customerToken) {
  const materialized = materializePath(route.path);
  const url = `${BASE_URL}${materialized}`;
  const headers = {};

  if (isAdminRoute(route.path) && adminToken) {
    headers.Authorization = `Bearer ${adminToken}`;
  } else if (!isPublicRoute(route.path) && customerToken) {
    headers.Authorization = `Bearer ${customerToken}`;
  }

  const requestInit = { method: route.method, headers };

  if (route.path === '/api/v1/admin/products/import-csv' && route.method === 'POST') {
    const form = new FormData();
    form.set(
      'file',
      new Blob(['name,slug,description,categorySlug\nSmoke,smoke,Smoke description,smoke-category'], {
        type: 'text/csv'
      }),
      'products.csv'
    );
    requestInit.body = form;
  } else if (route.method !== 'GET' && route.method !== 'DELETE') {
    const body = jsonBodyFor(route);
    headers['content-type'] = 'application/json';
    requestInit.body = JSON.stringify(body);
  }

  if (route.path === '/api/v1/payments/webhook') {
    delete headers['content-type'];
    requestInit.headers = {
      ...headers,
      'x-razorpay-signature': 'invalid-signature',
      'content-type': 'application/json'
    };
    requestInit.body = JSON.stringify({});
  }

  if (route.path === '/api/v1/shipping/webhook') {
    requestInit.headers = {
      ...headers,
      authorization: 'Token invalid',
      'content-type': 'application/json'
    };
    requestInit.body = JSON.stringify({});
  }

  const response = await fetch(url, requestInit);
  return {
    route: `${route.method} ${route.path}`,
    materialized: `${route.method} ${materialized}`,
    status: response.status
  };
}

async function main() {
  const routes = parseRoutes();
  const adminToken = await loginAdmin();
  const customerToken = await registerAndLoginCustomer();

  const results = [];
  for (const route of routes) {
    try {
      const result = await hitRoute(route, adminToken, customerToken);
      results.push(result);
    } catch (error) {
      results.push({
        route: `${route.method} ${route.path}`,
        materialized: `${route.method} ${materializePath(route.path)}`,
        status: 0,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const serverErrors = results.filter((item) => {
    if (item.status === 0) {
      return true;
    }
    if (item.status < 500) {
      return false;
    }
    // Delhivery outage/unconfigured provider is expected to degrade gracefully on this endpoint.
    if (item.route === 'POST /api/v1/cart/check-pincode' && item.status === 503) {
      return false;
    }
    return true;
  });
  const firstServerError = serverErrors[0] ?? null;
  logger.info(`TOTAL_ROUTES=${results.length}`);
  logger.info(`SERVER_ERRORS=${serverErrors.length}`);
  for (const item of serverErrors) {
    logger.error(`${item.materialized} => ${item.status}${item.error ? ` (${item.error})` : ''}`);
  }

  if (serverErrors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  logger.fatal(error instanceof Error ? error.message : String(error));
});
