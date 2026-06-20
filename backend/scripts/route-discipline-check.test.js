const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inspectRouteFile,
  shouldRequireCustomerPreHandler
} = require('./route-discipline-check.js');

test('requires customer prehandler for protected customer endpoints', () => {
  assert.equal(shouldRequireCustomerPreHandler('get', '/api/v1/users/me'), true);
  assert.equal(shouldRequireCustomerPreHandler('get', '/api/v1/products'), false);
  assert.equal(shouldRequireCustomerPreHandler('post', '/api/v1/reviews'), true);
});

test('flags missing schema in route config', () => {
  const source = `
    export async function registerX(fastify) {
      fastify.get('/api/v1/orders/:id', { preHandler: customerGuard }, async () => ({}));
    }
  `;
  const issues = inspectRouteFile('x.routes.ts', source);
  assert.equal(issues.some((issue) => issue.includes('missing schema')), true);
});

test('flags admin route without permission guard wiring', () => {
  const source = `
    export async function registerX(fastify) {
      fastify.get('/api/v1/admin/orders', { schema: s, preHandler: adminGuard }, async () => ({}));
    }
  `;
  const issues = inspectRouteFile('x.routes.ts', source);
  assert.equal(issues.some((issue) => issue.includes('adminPermissionGuard')), true);
});

test('flags ops route without permission guard wiring', () => {
  const source = `
    export async function registerX(fastify) {
      fastify.get('/api/v1/ops/load-shed', { schema: s, preHandler: [opsAuthGuard] }, async () => ({}));
    }
  `;
  const issues = inspectRouteFile('x.routes.ts', source);
  assert.equal(issues.some((issue) => issue.includes('/api/v1/ops/load-shed') && issue.includes('opsPermissionGuard')), true);
});

test('flags ops route without ops auth guard wiring', () => {
  const source = `
    export async function registerX(fastify) {
      fastify.get('/api/v1/ops/load-shed', { schema: s, preHandler: [opsPermissionGuard('ops:read')] }, async () => ({}));
    }
  `;
  const issues = inspectRouteFile('x.routes.ts', source);
  assert.equal(issues.some((issue) => issue.includes('/api/v1/ops/load-shed') && issue.includes('opsAuthGuard')), true);
});

test('flags auth-admin route without permission guard wiring', () => {
  const source = `
    export async function registerX(fastify) {
      fastify.post('/api/v1/auth/admin/mfa/setup/start', { schema: s, preHandler: [jwtAuthGuard, rolesGuard(Role.ADMIN)] }, async () => ({}));
    }
  `;
  const issues = inspectRouteFile('x.routes.ts', source);
  assert.equal(
    issues.some((issue) => issue.includes('/api/v1/auth/admin/mfa/setup/start') && issue.includes('adminPermissionGuard')),
    true
  );
});

test('allows auth-admin login OTP routes without admin permission guard', () => {
  const sourceRequestOtp = `
    export async function registerX(fastify) {
      fastify.post('/api/v1/auth/admin/login/request-otp', { schema: s, preHandler: [idempotencyPreHandler] }, async () => ({}));
    }
  `;
  const sourceVerifyOtp = `
    export async function registerX(fastify) {
      fastify.post('/api/v1/auth/admin/login/verify-otp', { schema: s, preHandler: [idempotencyPreHandler] }, async () => ({}));
    }
  `;
  assert.deepEqual(inspectRouteFile('x.routes.ts', sourceRequestOtp), []);
  assert.deepEqual(inspectRouteFile('x.routes.ts', sourceVerifyOtp), []);
});

test('passes valid admin route shape', () => {
  const source = `
    import { Role } from '@prisma/client';
    import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
    import { rolesGuard } from '@common/guards/roles.guard';
    const adminGuard = [jwtAuthGuard, rolesGuard(Role.ADMIN)];
    export async function registerX(fastify) {
      fastify.get(
        '/api/v1/admin/orders',
        { schema: s, preHandler: [...adminGuard, adminPermissionGuard('orders:read')] },
        async () => ({})
      );
    }
  `;
  const issues = inspectRouteFile('x.routes.ts', source);
  assert.deepEqual(issues, []);
});

test('flags unguarded admin route even when another route is guarded', () => {
  const source = `
    import { Role } from '@prisma/client';
    import { adminPermissionGuard } from '@common/guards/admin-permissions.guard';
    import { rolesGuard } from '@common/guards/roles.guard';
    const adminGuard = [jwtAuthGuard, rolesGuard(Role.ADMIN)];
    export async function registerX(fastify) {
      fastify.get(
        '/api/v1/admin/orders',
        { schema: s, preHandler: [...adminGuard, adminPermissionGuard('orders:read')] },
        async () => ({})
      );
      fastify.get(
        '/api/v1/admin/users',
        { schema: s, preHandler: [] },
        async () => ({})
      );
    }
  `;
  const issues = inspectRouteFile('x.routes.ts', source);
  assert.equal(issues.some((issue) => issue.includes('/api/v1/admin/users') && issue.includes('adminPermissionGuard')), true);
});

test('supports put route parsing and validation', () => {
  const source = `
    export async function registerX(fastify) {
      fastify.put('/api/v1/orders/:id', { schema: s }, async () => ({}));
    }
  `;
  const issues = inspectRouteFile('x.routes.ts', source);
  assert.equal(issues.some((issue) => issue.includes('missing customer preHandler')), true);
});

test('parses double-quoted and non-async handlers', () => {
  const source = `
    export async function registerX(fastify) {
      fastify.get(
        "/api/v1/admin/orders",
        { schema: s, preHandler: [...adminGuard, adminPermissionGuard('orders:read')] },
        function handler() { return {}; }
      );
    }
  `;
  const issues = inspectRouteFile('x.routes.ts', source);
  assert.deepEqual(issues, []);
});
