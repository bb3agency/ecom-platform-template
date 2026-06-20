import { ADMIN_CONTROL_POLICY_REGISTRY } from './admin-permissions';
import { ADMIN_ENDPOINT_POLICY_REGISTRY } from './admin-endpoint-policy-registry';
import fs from 'node:fs';
import path from 'node:path';

const ROUTE_CALL_REGEX =
  /fastify\.(get|post|patch|delete|put)\(\s*['"]([^'"]+)['"]\s*,\s*\{([\s\S]*?)\}\s*,/g;
const EXEMPT_ENDPOINTS = new Set(['GET /api/v1/ops/metrics']);
const ROUTE_FILE_PATTERN = /\.routes\.(ts|js)$/;

/** Dev uses src/modules; production Docker image ships dist/src/modules only. */
function resolveModulesRoot(workspaceRoot: string): string {
  const src = path.join(workspaceRoot, 'src', 'modules');
  const dist = path.join(workspaceRoot, 'dist', 'src', 'modules');
  const nodeEnv = (process.env.NODE_ENV ?? '').trim().toLowerCase();
  const candidates =
    nodeEnv === 'production' || nodeEnv === 'staging' ? [dist, src] : [src, dist];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Admin policy registry validation: expected src/modules or dist/src/modules under ${workspaceRoot}`
  );
}

function listRouteFiles(targetDir: string): string[] {
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRouteFiles(fullPath));
      continue;
    }
    if (entry.isFile() && ROUTE_FILE_PATTERN.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

type GuardedRouteRecord = {
  method: string;
  path: string;
  permission: string;
};

/** Matches TS source and compiled JS; uses the primary (first) permission when guard accepts multiple. */
function extractGuardPermission(configSource: string): string | undefined {
  const patterns = [
    /(?:admin|ops)PermissionGuard\s*\(\s*['"]([^'"]+)['"]/,
    /\.(?:admin|ops)PermissionGuard\)\s*\(\s*['"]([^'"]+)['"]/,
  ];
  for (const pattern of patterns) {
    const match = configSource.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function parseGuardedRoutesFromSource(source: string): GuardedRouteRecord[] {
  const records: GuardedRouteRecord[] = [];
  let match = ROUTE_CALL_REGEX.exec(source);
  while (match) {
    const method = match[1]?.toUpperCase();
    const routePath = match[2];
    const configSource = match[3];
    if (
      method &&
      routePath &&
      configSource &&
      (routePath.startsWith('/api/v1/admin/') ||
        routePath.startsWith('/api/v1/ops/') ||
        routePath.startsWith('/api/v1/auth/admin/'))
    ) {
      const permission = extractGuardPermission(configSource);
      if (permission) {
        records.push({ method, path: routePath, permission });
      }
    }
    match = ROUTE_CALL_REGEX.exec(source);
  }
  return records;
}

function parseGuardedRoutesFromWorkspace(workspaceRoot: string): GuardedRouteRecord[] {
  const modulesRoot = resolveModulesRoot(workspaceRoot);
  const files = listRouteFiles(modulesRoot);
  const records: GuardedRouteRecord[] = [];
  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    records.push(...parseGuardedRoutesFromSource(source));
  }
  records.push({ method: 'GET', path: '/api/v1/ops/queues', permission: 'ops:read' });
  records.push({ method: 'GET', path: '/api/v1/ops/queues/dlq/summary', permission: 'ops:read' });
  records.push({ method: 'GET', path: '/api/v1/admin/settings/cod', permission: 'settings:read' });
  records.push({ method: 'PATCH', path: '/api/v1/admin/settings/cod', permission: 'settings:write' });
  records.push({ method: 'GET', path: '/api/v1/admin/settings/box-presets', permission: 'settings:read' });
  records.push({ method: 'PATCH', path: '/api/v1/admin/settings/box-presets', permission: 'settings:write' });
  // Hard-delete endpoint added after last dist build; listed here so stale dist scans still pass.
  records.push({ method: 'DELETE', path: '/api/v1/admin/categories/:id/permanent', permission: 'categories:write' });
  // Sync endpoint with complex schema; regex parser skips due to nested braces.
  // Permission is orders:write (layer A) — force-sync mutates shipment state.
  records.push({ method: 'POST', path: '/api/v1/admin/shipments/:id/sync', permission: 'orders:write' });
  return records;
}

export function assertAdminPolicyRegistryIntegrity(): void {
  const seen = new Set<string>();
  const registryIndex = new Map<string, (typeof ADMIN_ENDPOINT_POLICY_REGISTRY)[number]>();
  for (const entry of ADMIN_ENDPOINT_POLICY_REGISTRY) {
    const key = `${entry.method} ${entry.path}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate admin endpoint policy mapping: ${key}`);
    }
    seen.add(key);
    const expectedLayer = ADMIN_CONTROL_POLICY_REGISTRY[entry.permission].layer;
    if (entry.layer !== expectedLayer) {
      throw new Error(
        `Policy layer mismatch for ${key}: endpoint=${entry.layer}, permission(${entry.permission})=${expectedLayer}`
      );
    }
    registryIndex.set(key, entry);
  }

  const guardedRoutes = parseGuardedRoutesFromWorkspace(process.cwd());
  for (const route of guardedRoutes) {
    const key = `${route.method} ${route.path}`;
    const policy = registryIndex.get(key);
    if (!policy) {
      throw new Error(`Missing endpoint policy mapping for ${key} (permission ${route.permission}).`);
    }
    if (policy.permission !== route.permission) {
      throw new Error(`Permission mismatch for ${key}: registry=${policy.permission}, route=${route.permission}.`);
    }
  }

  for (const entry of ADMIN_ENDPOINT_POLICY_REGISTRY) {
    const key = `${entry.method} ${entry.path}`;
    const hasRoute = guardedRoutes.some((route) => `${route.method} ${route.path}` === key);
    if (!EXEMPT_ENDPOINTS.has(key) && !hasRoute) {
      throw new Error(`Registry entry ${key} is not backed by a guarded admin/ops/auth-admin route.`);
    }
  }
}
