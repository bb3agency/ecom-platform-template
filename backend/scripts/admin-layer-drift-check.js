const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');
const { parseFastifyRouteConfigsFromAst } = require('./route-ast-utils.js');

const EXEMPT_ENDPOINTS = new Set(['GET /api/v1/ops/metrics']);
const EXEMPT_ADMIN_LAYER_C_ENDPOINTS = new Set([]);

function parseRegistryEntries(registrySource) {
  const entryRegex = /\{\s*method:\s*'([^']+)'\s*,\s*path:\s*'([^']+)'\s*,\s*permission:\s*'([^']+)'\s*,\s*layer:\s*'([^']+)'\s*\}/g;
  const entries = [];
  let match;
  while ((match = entryRegex.exec(registrySource)) !== null) {
    entries.push({ method: match[1], path: match[2], permission: match[3], layer: match[4] });
  }
  return entries;
}

function parsePermissionPolicyLayers(permissionsSource) {
  const policyRegex = /'([^']+)':\s*\{[\s\S]*?layer:\s*'([ABC])'/g;
  const layers = new Map();
  let match;
  while ((match = policyRegex.exec(permissionsSource)) !== null) {
    layers.set(match[1], match[2]);
  }
  return layers;
}

function listRouteFiles(targetDir) {
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRouteFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.routes.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseGuardedAdminOpsRoutesFromSource(source) {
  const records = [];
  const routes = parseFastifyRouteConfigsFromAst(source);
  for (const route of routes) {
    const method = route.method.toUpperCase();
    const routePath = route.path;
    const configSource = route.configSource;
    if (
      routePath.startsWith('/api/v1/admin/') ||
      routePath.startsWith('/api/v1/ops/') ||
      routePath.startsWith('/api/v1/auth/admin/')
    ) {
      const permissionMatch =
        configSource.match(/adminPermissionGuard\s*\(\s*'([^']+)'/) ||
        configSource.match(/opsPermissionGuard\s*\(\s*'([^']+)'/);
      if (permissionMatch) {
        records.push({ method, path: routePath, permission: permissionMatch[1] });
      }
    }
  }
  return records;
}

function parseGuardedAdminOpsRoutes(workspaceRoot) {
  const modulesRoot = path.join(workspaceRoot, 'src', 'modules');
  const files = listRouteFiles(modulesRoot);
  const records = [];
  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    records.push(...parseGuardedAdminOpsRoutesFromSource(source));
  }
  // Bull board + DLQ summary routes are plugin-driven and guarded via scoped onRequest hook.
  records.push({ method: 'GET', path: '/api/v1/ops/queues', permission: 'ops:read' });
  records.push({ method: 'GET', path: '/api/v1/ops/queues/dlq/summary', permission: 'ops:read' });
  return records;
}

function runAdminLayerDriftCheck(workspaceRoot = process.cwd()) {
  const errors = [];
  const registryPath = path.join(workspaceRoot, 'src', 'common', 'auth', 'admin-endpoint-policy-registry.ts');
  const permissionsPath = path.join(workspaceRoot, 'src', 'common', 'auth', 'admin-permissions.ts');
  const registrySource = fs.readFileSync(registryPath, 'utf8');
  const permissionsSource = fs.readFileSync(permissionsPath, 'utf8');
  const registryEntries = parseRegistryEntries(registrySource);
  if (registryEntries.length === 0) {
    errors.push('No endpoint policy entries parsed from admin-endpoint-policy-registry.ts');
  }

  const ownerRoleMatches = permissionsSource.match(/ownerRole:\s*'([^']+)'/g) ?? [];
  for (const entry of ownerRoleMatches) {
    const role = entry.split("'")[1];
    if (!['merchant', 'developer'].includes(role)) {
      errors.push(`Invalid ownerRole '${role}' in policy registry. Expected merchant/developer only.`);
    }
  }
  const legacySignals = ['merchant_ops', 'merchant_superadmin', 'platform_ops', 'security_auditor'];
  for (const signal of legacySignals) {
    if (permissionsSource.includes(signal)) {
      errors.push(`Legacy role label '${signal}' should not exist in admin-permissions.ts.`);
    }
  }

  const registryIndex = new Map(registryEntries.map((entry) => [`${entry.method} ${entry.path}`, entry]));
  const permissionPolicyLayers = parsePermissionPolicyLayers(permissionsSource);
  const routeRecords = parseGuardedAdminOpsRoutes(workspaceRoot);
  for (const route of routeRecords) {
    const key = `${route.method} ${route.path}`;
    const policy = registryIndex.get(key);
    if (!policy) {
      errors.push(`Missing endpoint policy mapping for ${key} (permission ${route.permission}).`);
      continue;
    }
    if (policy.permission !== route.permission) {
      errors.push(`Permission mismatch for ${key}: registry=${policy.permission}, route=${route.permission}.`);
    }
  }

  for (const entry of registryEntries) {
    const key = `${entry.method} ${entry.path}`;
    if (!EXEMPT_ENDPOINTS.has(key) && !routeRecords.some((route) => `${route.method} ${route.path}` === key)) {
      errors.push(`Registry entry ${key} is not backed by a guarded admin/ops/auth-admin route.`);
    }
    if (entry.path.startsWith('/api/v1/ops/') && entry.layer !== 'C') {
      errors.push(`Ops route ${key} must be Layer C.`);
    }
    if (
      entry.path.startsWith('/api/v1/admin/') &&
      entry.layer === 'C' &&
      !EXEMPT_ADMIN_LAYER_C_ENDPOINTS.has(key)
    ) {
      errors.push(`Merchant admin route ${key} cannot be Layer C.`);
    }
    if (entry.layer === 'B' && !['orders:refund', 'analytics:replay', 'ops:write', 'users:write'].includes(entry.permission)) {
      errors.push(`Layer B permission mapping is suspicious for ${key}.`);
    }
    const expectedPolicyLayer = permissionPolicyLayers.get(entry.permission);
    if (expectedPolicyLayer && expectedPolicyLayer !== entry.layer) {
      errors.push(
        `Layer mismatch for ${key}: registry=${entry.layer}, permission-policy(${entry.permission})=${expectedPolicyLayer}.`
      );
    }
  }

  return { errors, registryEntriesCount: registryEntries.length, guardedRouteCount: routeRecords.length };
}

if (require.main === module) {
  const result = runAdminLayerDriftCheck();
  if (result.errors.length > 0) {
    logger.error('admin-layer-drift-check failed:');
    for (const error of result.errors) {
      logger.error(` - ${error}`);
    }
    process.exit(1);
  }
  logger.success(
    `admin-layer-drift-check passed (${result.registryEntriesCount} endpoint mappings, ${result.guardedRouteCount} guarded routes)`
  );
}

module.exports = {
  parseRegistryEntries,
  parsePermissionPolicyLayers,
  parseGuardedAdminOpsRoutesFromSource,
  runAdminLayerDriftCheck
};
