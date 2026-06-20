import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  isMaintenanceActive,
  readMaintenanceStateFromRequest
} from '@common/reliability/maintenance-state';
import { shouldBlockForMaintenance } from '@common/reliability/load-shed.guard';

/**
 * Routes that power the storefront maintenance banner and the Nginx
 * `auth_request` gating that serves the static `maintenance.html` page
 * for all non-ops traffic during `maintenance` mode phase `active`.
 *
 * Public endpoints (no auth):
 *   - GET /api/v1/maintenance/status — JSON snapshot the frontend banner
 *     polls every few seconds to render the countdown / active message.
 *     Returns 200 with current mode/phase/timestamps even when maintenance
 *     is active (it is listed in `ALWAYS_ALLOWED_PREFIXES`).
 *
 *   - GET /api/v1/maintenance/gate  — Nginx `auth_request` subrequest.
 *     Nginx forwards every storefront/admin request to this URL with the
 *     original URI in `X-Original-URI`. We respond:
 *       200 → Nginx forwards the original request upstream.
 *       401 → Nginx catches via `error_page 401 = @maintenance_block;` on
 *             the gated location, which then `return 503` → static
 *             `maintenance.html` via `error_page 502 503 /maintenance.html`.
 *     The gate runs inside `loadShedGuard`'s ALWAYS_ALLOWED set so its own
 *     evaluation never goes recursive during maintenance.
 *
 * Neither route is enveloped — they must be parsable by Nginx (which only
 * inspects the HTTP status) and by the public banner client that hits the
 * route directly without going through the storefront's API helper.
 */
export async function registerMaintenanceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/api/v1/maintenance/status',
    {
      // No rate limit — banner polls this every 10s from every active tab.
      // Keeping it ungated avoids a thundering herd of 429s on the very
      // moment maintenance flips, which is exactly when the UX matters most.
      config: { rateLimit: false },
      schema: {
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            // `serverTime` is required so the storefront banner can always
            // align its countdown with the server clock; missing it would
            // cause Fastify's strict response serializer to drop the field
            // even when the handler populated it, leading to drifted
            // countdowns on devices with skewed clocks.
            required: ['mode', 'phase', 'pendingUntil', 'activatedAt', 'serverTime'],
            properties: {
              mode: { type: 'string', enum: ['normal', 'reduced', 'emergency', 'maintenance'], maxLength: 20 },
              phase: { type: ['string', 'null'], enum: ['pending', 'active', null], maxLength: 16 },
              pendingUntil: { type: ['string', 'null'], maxLength: 40 },
              activatedAt: { type: ['string', 'null'], maxLength: 40 },
              serverTime: { type: 'string', maxLength: 40 }
            }
          }
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const state = await readMaintenanceStateFromRequest(request);
      // Banner clients poll this every 5–10 s and need to observe phase
      // transitions in near real-time. Any intermediate cache (browser,
      // CDN, proxy) serving a stale snapshot would silently break the
      // pending→active cutover detection on every open tab. Force
      // bypassing every cache layer for this endpoint.
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');
      return {
        mode: state.mode,
        phase: state.phase,
        pendingUntil: state.pendingUntil,
        activatedAt: state.activatedAt,
        serverTime: new Date().toISOString()
      };
    }
  );

  /**
   * Nginx `auth_request` gate. Returns one of:
   *   200 OK   (with `X-Maintenance-Active: 0`) — allow the request through.
   *   401      (with `X-Maintenance-Active: 1`) — block the request; Nginx
   *            catches the 401 via `error_page 401 = @maintenance_block;`
   *            scoped to each gated `location` (NOT at server level), which
   *            then `return 503` → `error_page 502 503 /maintenance.html;`
   *            for the friendly downtime page.
   *
   * Why 401 (and not the previous 200+header pattern):
   * Nginx's `auth_request` directive runs in the ACCESS phase, but `if`
   * inside a `location` runs in the REWRITE phase — i.e. BEFORE auth_request
   * fires. That means `if ($maintenance_active = "1") { return 503; }`
   * evaluated with an empty variable every time and never blocked traffic.
   * The bug was invisible because `add_header X-Debug $maintenance_active`
   * runs in the OUTPUT phase (after auth_request) and showed the variable
   * was set, masking the phase-ordering issue. See
   * `backend/docs/HARDENING_HISTORY.md` "May 2026 — Maintenance gate bypass"
   * for the full incident write-up.
   *
   * Why 401 doesn't collide with genuine upstream auth failures:
   * Nginx's `error_page` directive ONLY catches errors generated by Nginx
   * itself (including auth_request rejections). It does NOT catch upstream
   * proxy responses unless `proxy_intercept_errors on;` is set, which we
   * deliberately leave OFF. So a 401 from Next.js or Fastify passes through
   * to the client unaffected — only auth_request-generated 401s trigger
   * the maintenance flow. The earlier concern documented here ("can't tell
   * gate 401 from upstream 401") was incorrect.
   *
   * The `X-Maintenance-Active` header is preserved on both 200 and 401
   * responses for backward compatibility with any caller that already
   * relies on it (none in the current codebase — the storefront banner
   * polls `/api/v1/maintenance/status` instead).
   *
   *   X-Maintenance-Active: 0 → Nginx proxies the original request upstream.
   *   X-Maintenance-Active: 1 → Nginx `auth_request_set` captures the value,
   *                              an `if ($maintenance_active = "1") { return 503; }`
   *                              fires, and the `error_page 502 503` chain
   *                              serves the static maintenance.html.
   *
   * The subrequest is internal (`internal;` in Nginx) so it cannot be hit
   * directly. We still read `X-Original-URI` (set by Nginx) so the gate
   * permits ALWAYS_ALLOWED prefixes (e.g. `/api/v1/ops/...`,
   * `/api/v1/health`, webhooks, `/api/v1/maintenance`) during active
   * maintenance, even though the Nginx location-level routing also exempts
   * those paths. Defense-in-depth in case someone wires the gate onto an
   * additional location later.
   */
  fastify.get(
    '/api/v1/maintenance/gate',
    {
      // No rate limit — Nginx fires this once per upstream request, which is
      // already shaped by the location-level zones.
      config: { rateLimit: false },
      schema: {
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            properties: { allowed: { type: 'boolean' } }
          },
          401: {
            type: 'object',
            additionalProperties: false,
            properties: { allowed: { type: 'boolean' } }
          }
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const state = await readMaintenanceStateFromRequest(request);

      if (!isMaintenanceActive(state)) {
        reply.header('X-Maintenance-Active', '0');
        return { allowed: true };
      }

      const originalUri =
        (request.headers['x-original-uri'] as string | undefined) ??
        (request.headers['x-original-url'] as string | undefined) ??
        '';

      // Strip query string before matching prefixes — `ALWAYS_ALLOWED_PREFIXES`
      // are path-only ("/api/v1/ops"), and matching against a URI with query
      // would falsely block ops UI calls that include `?page=…`.
      const pathOnly = originalUri.split('?')[0] ?? '';

      if (shouldBlockForMaintenance(state, pathOnly)) {
        reply.header('X-Maintenance-Active', '1');
        // 401 (not 200) so Nginx's `auth_request` natively rejects the
        // outer request and triggers `error_page 401 = @maintenance_block;`
        // on the gated location. The previous 200+header pattern failed
        // because `if ($maintenance_active = "1") { return 503; }` runs in
        // the rewrite phase BEFORE auth_request populates the variable.
        reply.status(401);
        return { allowed: false };
      }
      reply.header('X-Maintenance-Active', '0');
      return { allowed: true };
    }
  );
}
