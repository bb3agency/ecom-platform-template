const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseRegistryEntries,
  parsePermissionPolicyLayers,
  parseGuardedAdminOpsRoutesFromSource,
  runAdminLayerDriftCheck
} = require('./admin-layer-drift-check.js');

test('parseRegistryEntries extracts endpoint policies', () => {
  const source = `
    export const ADMIN_ENDPOINT_POLICY_REGISTRY = [
      { method: 'GET', path: '/api/v1/admin/orders', permission: 'orders:read', layer: 'A' }
    ];
  `;
  const entries = parseRegistryEntries(source);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].permission, 'orders:read');
});

test('parseGuardedAdminOpsRoutesFromSource extracts guarded admin/ops/auth-admin routes', () => {
  const source = `
    fastify.get('/api/v1/products', { schema: x }, async () => ({}));
    fastify.get('/api/v1/admin/orders', { preHandler: [...adminGuard, adminPermissionGuard('orders:read')] }, async () => ({}));
    fastify.post('/api/v1/ops/load-shed', { preHandler: [...adminGuard, adminPermissionGuard('ops:write')] }, async () => ({}));
    fastify.post('/api/v1/auth/admin/mfa/setup/start', { preHandler: [...adminGuard, adminPermissionGuard('users:read')] }, async () => ({}));
  `;
  const routes = parseGuardedAdminOpsRoutesFromSource(source);
  assert.equal(routes.length, 3);
  assert.equal(routes[0].permission, 'orders:read');
  assert.equal(routes[1].permission, 'ops:write');
  assert.equal(routes[2].permission, 'users:read');
});

test('parseGuardedAdminOpsRoutesFromSource handles double-quoted and non-async handlers', () => {
  const source = `
    fastify.put("/api/v1/admin/orders/:id/status", { preHandler: [...adminGuard, adminPermissionGuard('orders:write')] }, function handler() { return {}; });
  `;
  const routes = parseGuardedAdminOpsRoutesFromSource(source);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].method, 'PUT');
  assert.equal(routes[0].permission, 'orders:write');
});

test('parsePermissionPolicyLayers extracts permission-layer mappings', () => {
  const source = `
    export const ADMIN_CONTROL_POLICY_REGISTRY = {
      'orders:refund': { permission: 'orders:refund', layer: 'B', ownerRole: 'merchant' },
      'ops:write': { permission: 'ops:write', layer: 'C', ownerRole: 'developer' }
    };
  `;
  const layers = parsePermissionPolicyLayers(source);
  assert.equal(layers.get('orders:refund'), 'B');
  assert.equal(layers.get('ops:write'), 'C');
});

test('runAdminLayerDriftCheck returns no errors for minimal coherent workspace', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-drift-check-'));
  fs.mkdirSync(path.join(tempRoot, 'src', 'common', 'auth'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'src', 'modules', 'orders'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'src', 'modules', 'ops'), { recursive: true });

  fs.writeFileSync(
    path.join(tempRoot, 'src', 'common', 'auth', 'admin-endpoint-policy-registry.ts'),
    `
      export const ADMIN_ENDPOINT_POLICY_REGISTRY = [
        { method: 'GET', path: '/api/v1/admin/orders', permission: 'orders:read', layer: 'A' },
        { method: 'POST', path: '/api/v1/ops/load-shed', permission: 'ops:write', layer: 'C' },
        { method: 'GET', path: '/api/v1/ops/queues', permission: 'ops:read', layer: 'C' },
        { method: 'GET', path: '/api/v1/ops/queues/dlq/summary', permission: 'ops:read', layer: 'C' }
      ];
    `,
    'utf8'
  );

  fs.writeFileSync(
    path.join(tempRoot, 'src', 'common', 'auth', 'admin-permissions.ts'),
    `
      export const ADMIN_CONTROL_POLICY_REGISTRY = {
        'orders:read': { permission: 'orders:read', layer: 'A', ownerRole: 'merchant' },
        'ops:write': { permission: 'ops:write', layer: 'C', ownerRole: 'developer' },
        'ops:read': { permission: 'ops:read', layer: 'C', ownerRole: 'developer' }
      };
    `,
    'utf8'
  );

  fs.writeFileSync(
    path.join(tempRoot, 'src', 'modules', 'orders', 'orders.routes.ts'),
    `
      fastify.get('/api/v1/admin/orders', { preHandler: [...adminGuard, adminPermissionGuard('orders:read')] }, async () => ({}));
    `,
    'utf8'
  );

  fs.writeFileSync(
    path.join(tempRoot, 'src', 'modules', 'ops', 'ops.routes.ts'),
    `
      fastify.post('/api/v1/ops/load-shed', { preHandler: [...adminGuard, adminPermissionGuard('ops:write')] }, async () => ({}));
    `,
    'utf8'
  );

  const result = runAdminLayerDriftCheck(tempRoot);
  assert.deepEqual(result.errors, []);
});
