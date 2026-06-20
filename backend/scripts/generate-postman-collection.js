const fs = require('node:fs');
const path = require('node:path');
const logger = require('./lib/logger');

const BASE_URL_VAR = '{{baseUrl}}';
const OUTPUT_PATH = path.join(process.cwd(), '.postman', 'ecom-backend-full.collection.json');

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

function splitPathSegments(routePath) {
  return routePath
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(':')) {
        return `{{${segment.slice(1)}}}`;
      }
      return segment;
    });
}

function keyForRoute(route) {
  return `${route.method} ${route.path}`;
}

function requestBodyFor(route) {
  const method = route.method;
  if (method === 'GET' || method === 'DELETE') {
    return undefined;
  }
  const key = keyForRoute(route);
  const bodyByRoute = {
    'POST /api/v1/auth/admin/login/request-otp': { email: 'admin@example.com', password: 'Admin@12345' },
    'POST /api/v1/auth/admin/login/verify-otp': { email: 'admin@example.com', otp: '{{adminOtp}}' },
    'POST /api/v1/auth/login': { email: 'smoke-user@example.com', password: 'Password@123' },
    'POST /api/v1/auth/register': {
      firstName: 'Smoke',
      lastName: 'User',
      email: 'smoke-user@example.com',
      phone: '9876543210',
      password: 'Password@123'
    },
    'POST /api/v1/auth/send-otp': { phone: '9876543210' },
    'POST /api/v1/auth/verify-otp': { phone: '9876543210', otp: '000000' },
    'POST /api/v1/auth/forgot-password': { email: 'smoke-user@example.com' },
    'POST /api/v1/cart/check-pincode': { pincode: '500001' },
    'POST /api/v1/cart/coupon': { code: 'SMOKE' },
    'POST /api/v1/cart/items': { variantId: '{{variantId}}', quantity: 1 },
    'PATCH /api/v1/cart/items/:id': { quantity: 1 },
    'POST /api/v1/cart/merge': { sessionToken: 'session-token-smoke' },
    'POST /api/v1/orders': { notes: 'smoke-order' },
    'POST /api/v1/orders/:id/cancel': { reason: 'Customer requested cancellation' },
    'POST /api/v1/payments/initiate': { orderId: '{{orderId}}' },
    'POST /api/v1/payments/verify': {
      orderId: '{{orderId}}',
      razorpayPaymentId: 'pay_smoke',
      razorpaySignature: 'sig_smoke'
    },
    'PATCH /api/v1/admin/orders/:id/status': { status: 'PROCESSING' },
    'POST /api/v1/admin/orders/:id/cancel': { reason: 'Admin cancellation for test' },
    'POST /api/v1/admin/orders/:id/notifications/retrigger': { template: 'OrderConfirmed' },
    'PATCH /api/v1/admin/settings/shipping': { pickupPincode: '500001', minOrderValuePaise: 0 },
    'PATCH /api/v1/admin/settings/store': { storeName: 'Smoke Store' },
    'PATCH /api/v1/admin/settings/notifications': {
      emailEnabled: true,
      smsEnabled: true,
      whatsappEnabled: false
    },
    'PATCH /api/v1/admin/settings/inventory': { defaultLowStockThreshold: 5 },
    'POST /api/v1/admin/coupons': {
      code: 'SMOKE-COLLECTION',
      type: 'PERCENTAGE_OFF',
      value: 10,
      validFrom: new Date().toISOString()
    },
    'PATCH /api/v1/admin/coupons/:id': { value: 5 },
    'PATCH /api/v1/admin/coupons/:id/status': { isActive: false },
    'POST /api/v1/admin/products': {
      name: 'Smoke Product',
      slug: 'smoke-product',
      description: 'Smoke product from generated collection',
      categoryId: '{{categoryId}}'
    },
    'PATCH /api/v1/admin/products/:id': { name: 'Smoke Product Updated' },
    'POST /api/v1/admin/products/:id/variants': { sku: 'SMOKE-SKU-001', name: 'Default', price: 1000 },
    'PATCH /api/v1/admin/products/:id/variants/:variantId': { price: 1000 },
    'PATCH /api/v1/admin/inventory/:variantId': { quantity: 10 },
    'PATCH /api/v1/admin/reviews/:id/moderate': { approved: true },
    'POST /api/v1/reviews': {
      orderItemId: '{{orderItemId}}',
      productId: '{{productId}}',
      rating: 5,
      body: 'Great product'
    },
    'PATCH /api/v1/users/me': { firstName: 'Smoke' },
    'POST /api/v1/users/me/addresses': {
      fullName: 'Smoke User',
      line1: '123 Test Street',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500001',
      country: 'IN',
      phone: '9876543210'
    },
    'PATCH /api/v1/users/me/addresses/:id': { city: 'Secunderabad' },
    'POST /api/v1/wishlist/items': { productId: '{{productId}}' }
  };
  const payload = bodyByRoute[key] ?? {};
  return {
    mode: 'raw',
    raw: JSON.stringify(payload, null, 2),
    options: {
      raw: {
        language: 'json'
      }
    }
  };
}

function isAdminRoute(routePath) {
  return routePath.startsWith('/api/v1/admin/');
}

function queryParamsForRoute(route) {
  const key = keyForRoute(route);
  const queryByRoute = {
    'GET /api/v1/admin/orders/export': [
      { key: 'from', value: '2026-01-01' },
      { key: 'to', value: '2026-12-31' }
    ],
    'GET /api/v1/admin/orders': [
      { key: 'page', value: '1' },
      { key: 'limit', value: '20' }
    ],
    'GET /api/v1/admin/products': [
      { key: 'page', value: '1' },
      { key: 'limit', value: '20' }
    ],
    'GET /api/v1/admin/users': [
      { key: 'page', value: '1' },
      { key: 'limit', value: '20' }
    ]
  };
  return queryByRoute[key] ?? [];
}

function buildCollection(routes) {
  let requestBodiesWithDefaults = 0;
  let requestQueryDefaults = 0;
  const items = routes.map((route) => {
    const routePath = route.path.replace(/^\/+/, '');
    const pathParts = splitPathSegments(route.path);
    const query = queryParamsForRoute(route);
    const url = `${BASE_URL_VAR}/${routePath}`;
    const request = {
      method: route.method,
      header: [],
      url: {
        raw: url,
        host: [BASE_URL_VAR],
        path: pathParts,
        ...(query.length > 0 ? { query } : {})
      }
    };
    const body = requestBodyFor(route);
    if (isAdminRoute(route.path)) {
      request.header.push({ key: 'Authorization', value: 'Bearer {{adminToken}}' });
    }
    if (body) {
      request.header.push({ key: 'Content-Type', value: 'application/json' });
      request.body = body;
      if (body.raw !== '{}') {
        requestBodiesWithDefaults += 1;
      }
    }
    if (query.length > 0) {
      requestQueryDefaults += 1;
    }
    return {
      name: `${route.method} ${route.path}`,
      request,
      response: []
    };
  });

  const collection = {
    info: {
      name: 'Ecom Backend - Full Route Coverage',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description:
        'Generated from src/modules/**/*.routes.ts. Regenerate with: node scripts/generate-postman-collection.js'
    },
    auth: {
      type: 'bearer',
      bearer: [
        {
          key: 'token',
          value: '{{adminToken}}',
          type: 'string'
        }
      ]
    },
    event: [
      {
        listen: 'prerequest',
        script: {
          type: 'text/javascript',
          exec: [
            "const rawUrl = pm.request.url.toString();",
            "const isAdminRoute = rawUrl.includes('/api/v1/admin/');",
            'if (!isAdminRoute) {',
            '  return;',
            '}',
            "let token = pm.environment.get('adminToken');",
            'if (!token) {',
            '  // Admin login is a 2-step email OTP flow.',
            '  // Step 1: call request-otp to trigger OTP email, then set adminOtp env var.',
            '  // Step 2: call verify-otp with the OTP. The pre-request script below only',
            '  // runs step 2 if adminOtp is already set in the Postman environment.',
            "  const adminOtp = pm.environment.get('adminOtp');",
            '  if (adminOtp) {',
            '    pm.sendRequest({',
            "      url: pm.environment.get('baseUrl') + '/api/v1/auth/admin/login/verify-otp',",
            "      method: 'POST',",
            "      header: { 'Content-Type': 'application/json' },",
            '      body: {',
            "        mode: 'raw',",
            "        raw: JSON.stringify({ email: pm.environment.get('adminEmail') || 'admin@example.com', otp: adminOtp })",
            '      }',
            '    }, (err, res) => {',
            '      if (!err && res && res.code === 200) {',
            '        const json = res.json();',
            "        pm.environment.set('adminToken', json.data ? json.data.accessToken : json.accessToken);",
            "        pm.environment.set('userId', json.data ? json.data.admin.id : json.admin?.id);",
            '      }',
            '    });',
            '  }',
            '}',
            "token = pm.environment.get('adminToken');",
            'if (token) {',
            "  pm.request.headers.upsert({ key: 'Authorization', value: `Bearer ${token}` });",
            '}'
          ]
        }
      },
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            "pm.test('No 5xx responses', function () {",
            '  pm.expect(pm.response.code).to.be.below(500);',
            '});',
            "if (pm.response.code === 429) {",
            "  pm.execution.setNextRequest(null);",
            '}'
          ]
        }
      }
    ],
    item: items,
    variable: [
      {
        key: 'baseUrl',
        value: 'http://127.0.0.1:3000'
      },
      {
        key: 'categoryId',
        value: 'b49d57ea-986a-464d-9770-a4e2a4b6f8f1'
      },
      {
        key: 'productId',
        value: '03d7b507-7954-4ec7-b1b1-3b8d3767af4c'
      },
      {
        key: 'variantId',
        value: '1cec3ae4-011c-411b-b954-74eb794642dd'
      },
      {
        key: 'orderId',
        value: '00000000-0000-4000-8000-000000000000'
      },
      {
        key: 'orderItemId',
        value: '00000000-0000-4000-8000-000000000000'
      },
      {
        key: 'id',
        value: '00000000-0000-4000-8000-000000000000'
      },
      {
        key: 'slug',
        value: 'fixture-refunded-product'
      },
      {
        key: 'awb',
        value: 'awb-test'
      },
      {
        key: 'requestDelayHintMs',
        value: '1200'
      }
    ]
  };
  return collection;
}

function main() {
  const routes = parseRoutes();
  const collection = buildCollection(routes);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(collection, null, 2));

  logger.info(`ROUTES=${routes.length}`);
  logger.info(`OUTPUT=${OUTPUT_PATH}`);
}

main();
