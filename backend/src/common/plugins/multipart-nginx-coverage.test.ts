import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Drift guard: EVERY multipart (file-upload) admin route must be listed in the nginx
 * upload-exemption location.
 *
 * Why this test exists: routes under the generic `^/api/v1/admin/` nginx block carry
 * `auth_request /_maintenance_gate`, which forces nginx to buffer the whole request
 * body before running the subrequest. For multipart uploads that fails and **nginx
 * returns 500 before the request ever reaches the backend** — nothing appears in the
 * API logs, and the browser only sees a generic "Something went wrong". That is
 * exactly how the store-logo upload shipped broken (2026-08-09) and how product image
 * uploads broke before it. A new upload route is one forgotten regex away from the
 * same silent outage, so the coverage is asserted mechanically here.
 */

const repoBackendDir = path.resolve(__dirname, '../../..');
const nginxTemplate = path.join(repoBackendDir, 'nginx', 'client.conf.template');
const modulesDir = path.join(repoBackendDir, 'src', 'modules');

/** The `location ~ ^/api/v1/admin/(...)$` regex nginx actually matches upload routes with. */
function readNginxUploadMatcher(): RegExp {
  const conf = readFileSync(nginxTemplate, 'utf8');
  const match = conf.match(/location\s+~\s+(\^\/api\/v1\/admin\/\([^)]*\)\$)/);
  if (!match?.[1]) {
    throw new Error('nginx upload-exemption location not found in client.conf.template');
  }
  return new RegExp(match[1]);
}

function listRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listRouteFiles(full);
    return entry.isFile() && entry.name.endsWith('.routes.ts') ? [full] : [];
  });
}

/**
 * Route paths whose handler reads a multipart body. Each `fastify.post|put(` block is
 * inspected up to the next route registration, so only the handler that actually calls
 * `request.isMultipart()` / `request.parts()` / `request.file()` is collected.
 */
function findMultipartAdminRoutes(): string[] {
  const found: string[] = [];
  for (const file of listRouteFiles(modulesDir)) {
    const source = readFileSync(file, 'utf8');
    const blocks = source.split(/fastify\.(?=post\(|put\(|patch\(|get\(|delete\()/);
    for (const block of blocks) {
      if (!/^(post|put)\(/.test(block)) continue;
      if (!/request\.(isMultipart\(\)|parts\(\)|file\(\))/.test(block)) continue;
      const pathMatch = block.match(/['"](\/api\/v1\/admin\/[^'"]+)['"]/);
      if (pathMatch) found.push(pathMatch[1]!);
    }
  }
  return [...new Set(found)];
}

/** `:params` are real path segments at runtime — substitute a representative value. */
function toConcretePath(routeTemplate: string): string {
  return routeTemplate.replace(/:[A-Za-z0-9_]+/g, 'abc123');
}

describe('nginx multipart upload coverage', () => {
  it('exempts every multipart admin route from the body-buffering maintenance gate', () => {
    const matcher = readNginxUploadMatcher();
    const multipartRoutes = findMultipartAdminRoutes();

    // Sanity: the scanner must actually find the known upload routes, otherwise this
    // guard would pass vacuously after a refactor.
    expect(multipartRoutes.length).toBeGreaterThanOrEqual(3);

    const uncovered = multipartRoutes.filter((route) => !matcher.test(toConcretePath(route)));
    expect(
      uncovered,
      `These multipart routes are NOT covered by the nginx upload-exemption location — ` +
        `nginx will 500 them before they reach the backend. Add them to the ` +
        `"location ~ ^/api/v1/admin/(...)$" regex in nginx/client.conf.template.`
    ).toEqual([]);
  });

  it('does not exempt ordinary (non-upload) admin routes from the maintenance gate', () => {
    const matcher = readNginxUploadMatcher();
    for (const ordinary of [
      '/api/v1/admin/settings/store',
      '/api/v1/admin/orders/abc123/ship',
      '/api/v1/admin/products/abc123'
    ]) {
      expect(matcher.test(ordinary), `${ordinary} must stay behind the maintenance gate`).toBe(false);
    }
  });
});
