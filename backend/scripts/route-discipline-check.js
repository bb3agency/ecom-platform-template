#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');
const { parseFastifyRouteConfigsFromAst } = require('./route-ast-utils.js');

const ROUTE_DIR = path.join(process.cwd(), 'src', 'modules');
const AUTH_ADMIN_EXEMPT_ROUTES = new Set([
  // Admin login is a 2-step email OTP flow — both steps are intentionally pre-auth (no JWT exists yet).
  'POST /api/v1/auth/admin/login/request-otp',
  'POST /api/v1/auth/admin/login/verify-otp',
  // Guarded via scoped onRequest hook in queues.routes.ts (not inline preHandler)
  'GET /api/v1/ops/queues/dlq/summary',
  // Invite consume routes are intentionally public bootstrap endpoints.
  'POST /api/v1/admin/invites/consume',
  'POST /api/v1/ops/invites/consume',
  // Invite setup OTP routes are intentionally unauthenticated — the invite token IS the auth credential.
  'POST /api/v1/admin/invites/setup/send-otp',
  'POST /api/v1/ops/invites/setup/send-otp',
  // Browser login routes are intentionally pre-auth — no session exists yet when requesting/verifying the login OTP.
  'POST /api/v1/ops/auth/login/request-otp',
  'POST /api/v1/ops/auth/login/verify-otp',
  // Admin OTP channel config is intentionally public — needed before login session exists.
  'GET /api/v1/auth/admin/otp-channel',
  // Self-service own-profile notification prefs: any authenticated ADMIN (jwt + role
  // guard) manages ONLY their own row — a permission grant would wrongly gate opt-in.
  'GET /api/v1/admin/me/notification-preferences',
  'PATCH /api/v1/admin/me/notification-preferences',
]);

function shouldRequireCustomerPreHandler(method, routePath) {
  if (routePath.startsWith('/api/v1/users')) return true;
  if (routePath.startsWith('/api/v1/wishlist')) return true;
  if (routePath.startsWith('/api/v1/orders')) return true;
  if (routePath === '/api/v1/payments/initiate') return true;
  if (routePath === '/api/v1/payments/verify') return true;
  if (routePath.startsWith('/api/v1/shipping/track/')) return true;
  if (routePath === '/api/v1/reviews/me') return true;
  if (routePath === '/api/v1/reviews' && method === 'post') return true;
  return false;
}

function inspectRouteConfig(filePath, method, routePath, configSource) {
  const issues = [];

  if (!routePath.startsWith('/api/v1/')) {
    issues.push(`${filePath}: ${method.toUpperCase()} ${routePath} must start with /api/v1/`);
  }
  if (!/schema\s*:/.test(configSource)) {
    issues.push(`${filePath}: ${method.toUpperCase()} ${routePath} is missing schema`);
  }

  const hasPreHandler = /preHandler\s*:/.test(configSource);
  const isAdminRoute = routePath.startsWith('/api/v1/admin/');
  const isOpsRoute = routePath.startsWith('/api/v1/ops/');
  const isAuthAdminRoute = routePath.startsWith('/api/v1/auth/admin/');
  if (isAdminRoute || isOpsRoute || isAuthAdminRoute) {
    const routeKey = `${method.toUpperCase()} ${routePath}`;
    if (AUTH_ADMIN_EXEMPT_ROUTES.has(routeKey)) {
      return issues;
    }
    if (!hasPreHandler) {
      issues.push(`${filePath}: ${method.toUpperCase()} ${routePath} is missing preHandler`);
    }
    if (isOpsRoute) {
      if (!/opsAuthGuard/.test(configSource)) {
        issues.push(`${filePath}: ${method.toUpperCase()} ${routePath} is missing opsAuthGuard wiring`);
      }
      if (!/opsPermissionGuard\(/.test(configSource)) {
        issues.push(`${filePath}: ${method.toUpperCase()} ${routePath} is missing opsPermissionGuard`);
      }
      return issues;
    }
    if (!/rolesGuard\(Role\.ADMIN\)|adminGuard/.test(configSource)) {
      issues.push(`${filePath}: ${method.toUpperCase()} ${routePath} is missing ADMIN role guard wiring`);
    }
    if (!/adminPermissionGuard\(/.test(configSource)) {
      issues.push(`${filePath}: ${method.toUpperCase()} ${routePath} is missing adminPermissionGuard`);
    }
  } else if (shouldRequireCustomerPreHandler(method, routePath) && !hasPreHandler) {
    issues.push(`${filePath}: ${method.toUpperCase()} ${routePath} is missing customer preHandler`);
  }

  return issues;
}

function inspectRouteFile(filePath, source) {
  const issues = [];
  const routes = parseFastifyRouteConfigsFromAst(source);
  for (const route of routes) {
    const method = route.method;
    const routePath = route.path;
    const configSource = route.configSource;
    issues.push(...inspectRouteConfig(filePath, method, routePath, configSource));
  }
  return issues;
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

function runRouteDisciplineCheck() {
  const routeFiles = listRouteFiles(ROUTE_DIR);
  const issues = [];
  for (const filePath of routeFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    issues.push(...inspectRouteFile(filePath, source));
  }
  return issues;
}

if (require.main === module) {
  const issues = runRouteDisciplineCheck();
  if (issues.length > 0) {
    logger.error('Route discipline check failed');
    for (const issue of issues) {
      logger.error(`  - ${issue}`);
    }
    process.exit(1);
  }
  logger.success('Route discipline check passed');
}

module.exports = {
  inspectRouteFile,
  inspectRouteConfig,
  shouldRequireCustomerPreHandler,
  runRouteDisciplineCheck
};
