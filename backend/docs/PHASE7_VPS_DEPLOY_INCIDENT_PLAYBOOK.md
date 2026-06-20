# Phase 7 VPS Deploy Incident Playbook (May 2026)

This document captures a real end-to-end deploy incident from live VPS setup and converts it into a deterministic Phase 7 runbook.

Scope:
- Backend API + workers bootstrap on VPS
- Host PostgreSQL + Docker network routing
- Mandatory production env preflight
- Failure signatures and exact fixes

Use this together with:
- `docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md` (phase sequence)
- `docs/CLIENT_VPS_SETUP_GUIDE.md` (host provisioning)
- `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md` (Phase 1/2 env model)

---

## 1) Golden deploy order (Phase 7)

1. Clone repository to VPS and ensure backend path exists.
2. Create host PostgreSQL user/database before any container startup.
3. Place production `backend/.env` (never commit this file).
4. Run env preflight checks (bootstrap keys hard-required, DB-overlay keys surfaced as warnings).
5. Run Prisma using lockfile-pinned version (never floating `npx prisma` without `npm ci`).
6. Start Redis, then backend/workers using production compose overlay.
7. Verify health: `http://127.0.0.1:<BACKEND_PORT>/api/v1/health`.
8. Only after health is stable, continue with Nginx/TLS and ops bootstrap.

---

## 2) Mandatory `.env` preflight (before startup)

The following must exist and be non-placeholder before first boot:

- Bootstrap: `DATABASE_URL`, `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY`
- Auth/secrets: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `OPS_COOKIE_SECRET`, `AUDIT_ANCHOR_SECRET`
- Runtime routing: `NODE_ENV=production`, `PORT=3000`, `BACKEND_PORT=3001`

Runtime keys managed through Ops DB overlay are now allowed to be absent at startup. If absent, provider factories fail only at call-time with `CONFIG_NOT_READY`, and `/api/v1/health/ready` reports `runtimeConfigMissingKeys`.

Notes:
- `PORT` is container-internal app port (must remain `3000` with current compose mapping).
- `BACKEND_PORT` is host-exposed port (for Nginx/local health checks).
- After editing `.env`, use recreate flow (`up -d --force-recreate`), not plain restart.

---

## 3) Production compose behavior on VPS

Do not run plain base compose in VPS production when host PostgreSQL is authoritative.

Use either of these — they're equivalent:

```bash
# Explicit (the only thing CD does):
docker compose -f docker-compose.yml -f docker-compose.prod.yml -p <client-id> up -d backend workers

# Implicit (after the one-time .env setup below — recommended for manual ops):
docker compose up -d backend workers
```

Why:
- Base `docker-compose.yml` declares a `postgres` service that publishes port `:5432` to the host.
- If host PostgreSQL already uses 5432, plain compose startup causes:
  - `failed to bind host port 0.0.0.0:5432: address already in use`
- The `docker-compose.prod.yml` overlay drops the `postgres` `depends_on` from `backend`/`workers` and hides the `postgres` service behind a profile.

### One-time VPS `.env` fix so bare `docker compose` never picks up the wrong files

Add these two lines to `/var/www/<client-id>/backend/.env` (alongside `CLIENT_ID`). Docker Compose v2 reads them automatically as special variables; every subsequent `docker compose ...` command run from that directory merges both files and uses the right project name. Leave them **commented in the repo template `.env.example`** — they're VPS-only:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
COMPOSE_PROJECT_NAME=<client-id>   # same value as CLIENT_ID
```

### Observed second-run "works" anti-pattern

Running `docker compose -p <client-id> up -d backend workers` twice on a VPS that already has host Postgres:

```
1st run:  Error: failed to bind host port 0.0.0.0:5432/tcp: address already in use
2nd run:  ✔ Container <client-id>-postgres   Healthy
          ✔ Container <client-id>-backend    Running
          ✔ Container <client-id>-workers    Running
```

The "Healthy" status on run 2 is misleading — the postgres container is up on the internal docker bridge network but the host port is still owned by native Postgres. The backend container is using `host.docker.internal:5432` (i.e. the host Postgres), not the containerised one. You now have a useless `<client-id>-postgres` container that will reappear on every plain restart and consume disk via its `pg-data` volume. Apply the `.env` fix above, then clean it up:

```bash
docker stop  <client-id>-postgres 2>/dev/null || true
docker rm    <client-id>-postgres 2>/dev/null || true
# Optional: remove the orphan volume (it was never the source of truth)
docker volume rm "<client-id>_pg-data" 2>/dev/null || true
```

---

## 4) Failure signatures observed and fixes

### A) `Missing /backend/.env — copy from vault`
Cause:
- Phase script executed before placing production `.env`.

Fix:
- Copy filled production env to `backend/.env` on VPS before phase script.

### A.5) Ops OTP email never arrives

Symptoms:
- Ops UI shows "OTP sent" / challenge created (HTTP 200).
- The recipient inbox (and spam folder) stays empty.
- No obvious crash in `docker compose logs workers`.

Triage (single command — prints all evidence at once):
```bash
cd /var/www/<client-id>/backend
bash scripts/diagnose-ops-otp.sh
```

This prints: worker container state, `NOTIFY_EMAIL_ENABLED` inside the container, `StoreSettings.notifyEmailEnabled`, presence of `RESEND_API_KEY` + `RESEND_FROM` in `OpsConfigSecret` (masked — only length), the last 5 `OpsOtpChallenge` rows (confirms the API received the request), the last 5 `NotificationLog` rows for `template='OpsActionOtp'` (the actual send outcome), and filtered worker logs.

Most common root causes (from the `NotificationLog.errorMessage` printed in step 6):

| `errorMessage` text | Cause | Fix |
|---|---|---|
| `Email notifications disabled or RESEND_API_KEY missing` | `RESEND_API_KEY` not in `OpsConfigSecret` and not in `.env`, or `StoreSettings.notifyEmailEnabled=false` | Save `RESEND_API_KEY` + `RESEND_FROM` via Ops → Config; restart workers via `docker compose up -d workers`. If `notifyEmailEnabled=false`, flip it via direct API call: `PATCH /api/v1/admin/settings/notifications` with `{ "emailEnabled": true }` (admin JWT). **Note:** The admin settings UI panel for this was removed 2026-06-07; use the API directly. |
| `Resend request failed: 403 — [validation_error] You can only send testing emails to your own email address … verify a domain` | Resend test-mode restriction — recipient ≠ Resend account email and sending domain not verified | Either set the recipient ops user's email to your Resend account email (quickest test) **or** verify your sending domain at `https://resend.com/domains` and set `RESEND_FROM=noreply@<your-verified-domain>`. |
| `Resend request failed: 401 — [missing_api_key] API key not found` | `RESEND_API_KEY` value invalid or revoked | Regenerate at `https://resend.com/api-keys`, save via Ops → Config. |
| `Resend request failed: 422 — [validation_error] The 'from' domain is not verified` | `RESEND_FROM` uses a domain you haven't added at `https://resend.com/domains` | Verify the domain (add DNS records Resend shows) or temporarily switch to `RESEND_FROM=onboarding@resend.dev`. |
| Step 6 has no rows but step 5 does | Job sits in BullMQ queue; worker isn't consuming | Check step 1 (container state) and step 7 (filtered logs) for crash/connection errors. Likely a Redis password/URL mismatch or a worker bootstrap crash. |
| Step 5 also has no fresh rows | API never received the OTP request | Check frontend network tab + the API container logs (`docker compose logs backend --tail 80`). |

Note: prior to May 2026 the worker only logged `Resend request failed: <status>` without the body. If you see bare-status entries, the older code is still deployed — `git pull` + redeploy to get the structured Resend error text in `NotificationLog.errorMessage`.

### B) Prisma `P1012` / datasource `url` no longer supported
Cause:
- `npx prisma` pulled latest Prisma CLI (v7) because dependencies were not installed.

Fix:
- Run `npm ci` first, then use lockfile-pinned Prisma.
- Never run bare `npx prisma` in clean host directory.

### C) `P1001 Can't reach database at host.docker.internal` during host-side migrate
Cause:
- Bare `npx prisma migrate deploy` on the VPS host reads `.env` unchanged. Production `.env` uses `host.docker.internal` for **containers**; that hostname does not resolve in the shell.
- **This is expected**, not a Postgres outage, if `psql -h 127.0.0.1` and the override migrate command succeed.

Fix:
- **Do not** run bare `npx prisma migrate deploy` on the VPS host again.
- For host-side migrate, override to loopback (`127.0.0.1`) for the migration command only:
  ```bash
  cd /var/www/<client-id>/backend
  npm ci
  npx prisma generate --schema prisma/schema.prisma
  MIGRATE_DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/host\.docker\.internal/127.0.0.1/')"
  DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma
  ```
- Prefer `scripts/vps-deploy.sh` or client `phase7-backend-deploy.sh` — they apply the override automatically.
- Keep container runtime `DATABASE_URL` on `host.docker.internal` in `.env` (do not permanently rewrite `.env` to `127.0.0.1` for the stack).
- Success: `No pending migrations to apply.` — safe to proceed to `docker compose ... up -d backend workers`.

### D) Docker startup `Cannot find module './scripts/lib/logger'`
Cause:
- Production image did not include `scripts/lib/logger` used by bootstrap scripts.

Fix:
- Ensure `.dockerignore` allows `scripts/lib/**`.
- Ensure Dockerfile copies `scripts/lib` into production image.

### E) Backend/worker crash loop with DB unreachable from containers
Cause:
- Host PostgreSQL initially bound to localhost only and/or auth/firewall rules incomplete.

Fix:
1. `listen_addresses` must allow non-localhost clients (`*` or explicit host gateway).
2. `pg_hba.conf` must allow DB user/db from Docker private ranges and VPS hairpin case.
3. UFW must allow Docker private CIDR to reach host port 5432.
4. Verify with network-level checks from Docker.

### F) Historical incident: crash loop on missing runtime env keys
Cause:
- Earlier validation hard-failed startup for runtime keys that are now DB-overlay managed.

Fix:
- Startup validation now only hard-fails on true bootstrap keys.
- Configure runtime keys in Ops UI and restart API/workers.

### G) Historical incident: crash loop on missing provider keys
Cause:
- Provider mode/credentials were validated at startup instead of on provider use.

Fix:
- Provider factories now return call-time `CONFIG_NOT_READY` errors when runtime config is incomplete.
- Complete provider config in Ops UI before go-live and verify `/api/v1/health/ready` has `runtimeConfigMissingKeys: []`.

### H) Backend crash loop: `ENOENT: scandir '/app/src/modules'`
Cause:
- `assertAdminPolicyRegistryIntegrity()` scanned `src/modules` at runtime; production Docker images ship `dist/` only.

Symptoms:
- `docker compose ps` shows `raghava-organics-backend` as `Restarting (1)`.
- Logs repeat `Error: ENOENT: no such file or directory, scandir '/app/src/modules'` after ops overlay message.

Fix:
- Pull backend with fix in `admin-policy-registry.validation.ts` (resolves `dist/src/modules` and `.routes.js`).
- Rebuild and restart: `docker compose -p <client> -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend workers`.

### I) Backend crash loop: `Razorpay webhook IP allowlist is EMPTY in production-like profile`
Cause:
- Startup used to hard-fail when `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR` was unset, before Ops UI bootstrap.

Fix:
- API boot logs a warning only; empty allowlist still allows boot (webhook HMAC remains mandatory).
- Configure allowlists in Ops UI before go-live; `/api/v1/health/ready` lists missing keys including `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR` when `PAYMENT_PROVIDER=razorpay`.

### J) Backend crash loop: `Registry entry POST /api/v1/admin/invites is not backed by a guarded ... route`
Cause:
- Startup policy scan read compiled `.routes.js` but only matched TypeScript-style `opsPermissionGuard('ops:write')`, not compiled `(0, ops_permissions_guard_1.opsPermissionGuard)('ops:write')`.

Fix:
- Pull backend with updated `extractGuardPermission()` in `admin-policy-registry.validation.ts`.
- Rebuild backend image (same compose command as incident H).

### K) Storefront 502 + API crash loop after Ops config save (May 2026, Raghava Organics)
Cause:
- Operator saved a partial set of overlay keys via Ops UI (e.g. `PAYMENT_PROVIDER=razorpay` and shipping credentials without the matching secrets).
- After restart, the DB overlay applied those selectors but the matching secrets were still empty.
- Earlier `validateConditionalEnv` in `src/config/app.config.ts` called `requireEnv` on the full provider dependency chain → API exited with `Missing required env var: RAZORPAY_KEY_ID` (or `RAZORPAY_WEBHOOK_SECRET`, `SHIPROCKET_PASSWORD`, etc.).
- Docker's restart policy kept relaunching the container; nginx returned `502 Bad Gateway` on `/api/v1/cart`, `/api/v1/health`, every storefront request.

> **Note:** `SHIPPING_PROVIDER` is NOT a valid `OpsConfigSecret` key — shipping provider selection is credential-based (`DELHIVERY_API_KEY` presence → Delhivery active; `SHIPROCKET_EMAIL`+`SHIPROCKET_PASSWORD` presence → Shiprocket active). The historical incident involved saving payment provider keys without credentials.

Symptoms:
- Storefront homepage: `API error (UNKNOWN_ERROR, HTTP 502)` (or the older generic `API error (UNKNOWN_ERROR)` without HTTP status).
- Browser network tab: `Failed to load resource: the server responded with a status of 502 (Bad Gateway)` for `/api/v1/cart`, `/api/v1/health`, etc.
- `docker compose -p <client-id> ps` shows backend in `Restarting (1)`.
- `docker compose -p <client-id> logs backend --tail 80` shows `Missing required env var: …` immediately after the ops overlay banner.

Fix (template, May 2026 — already in this repo):
- `validateConditionalEnv` no longer calls `requireEnv` on provider chains. It validates only enum values and placeholder safety for keys that are present. Full coverage moved to `GET /api/v1/health/ready`.
- `vps-deploy.sh` readiness step is now warning-only, so CD can still ship the boot-tolerance fix even while config is incomplete.

Recovery on a live VPS:
1. `git pull` the template fix, then rebuild and restart:
   ```bash
   cd /var/www/<client-id>/backend
   git pull origin main
   docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend workers
   curl -fsS http://127.0.0.1:<BACKEND_PORT>/api/v1/health
   ```
2. **Emergency rollback (no pull yet):** deactivate the incomplete overlay rows so the next boot does not enter the crash path:
   ```bash
   docker compose -p <client-id> exec postgres psql -U postgres -d <db_name> -c \
     "UPDATE \"OpsConfigSecret\" SET \"isActive\" = false WHERE \"secretKey\" = 'PAYMENT_PROVIDER' AND \"isActive\" = true;"
   docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers
   ```
   Then finish the remaining provider keys via Ops UI and restart again.
   > **Note:** `SHIPPING_PROVIDER` is never stored in `OpsConfigSecret` — shipping is credential-based. Only deactivate `PAYMENT_PROVIDER` here. If shipping credentials were the issue, deactivate `DELHIVERY_API_KEY` or `SHIPROCKET_EMAIL`/`SHIPROCKET_PASSWORD` rows instead.
3. After recovery, `/health/ready` may still list `runtimeConfigMissingKeys` — that is expected during Phase 8 setup. Complete the keys, restart, then verify `status: ready` before opening to traffic.

Cross-reference: `docs/DECISIONS.md` → `[2026-05-25] Incremental Ops config save + boot tolerance`.

---

## 5) Network verification commands (authoritative)

Host DB availability:

```bash
ss -tlnp | rg 5432
psql "postgresql://<user>@127.0.0.1:5432/<db>" -c "SELECT 1;"
psql "postgresql://<user>@172.17.0.1:5432/<db>" -c "SELECT 1;"
```

Docker-to-host routing:

```bash
docker inspect <backend-container> --format '{{json .HostConfig.ExtraHosts}}'
docker run --rm --add-host=host.docker.internal:host-gateway alpine sh -c "apk add -q netcat-openbsd && nc -zv host.docker.internal 5432"
```

Compose-network DB auth test:

```bash
docker run --rm --network <client-network> --add-host=host.docker.internal:host-gateway alpine sh -c "apk add -q postgresql-client && psql -h host.docker.internal -U <db_user> -d <db_name> -c 'SELECT 1'"
```

If this fails with `no pg_hba.conf entry`, use the source host shown in error to patch `pg_hba.conf`.

---

## 6) Multi-client VPS pitfalls (Nginx / Redis / ports)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `nginx -t` fails with duplicate `limit_req_zone` | Rate zones in both `nginx.conf` and `snippets/rate-zones.conf` | Zones **only** in `snippets/rate-zones.conf`; one `include` in `http {}` |
| Second client cannot start Redis | First client published `6379` on `0.0.0.0` | Comment `ports:` under `redis:` for **every** client stack |
| Wrong site on a domain | Removed/edited another client's `sites-enabled` entry | Additive symlink: `sites-available/<domain.com>` only |
| `address already in use` on backend port | Port slot collision | Next slot per `CLIENT_VPS_SETUP_GUIDE.md` §3 |
| Broke legacy site after `rm sites-enabled/default` | Another client still used default | List `sites-enabled/` before removing default |

Preflight: `backend/docs/templates/scripts/phase7.5-nginx-tls-preflight.sh` (per-client copy under `docs/clients/<id>/scripts/`).

---

## 7) Phase 7 readiness gate (must pass before continuing)

- `docker compose ... ps` shows backend and workers stable (no restarts).
- Backend health endpoint responds consistently:
  - `database: connected`
  - `redis: connected`
- Readiness endpoint confirms runtime completeness:
  - `GET /api/v1/health/ready` => `status: ready`
  - `runtimeConfigMissingKeys` is empty
- No `Missing required env var` in backend/workers logs.
- No Prisma init errors in logs.
- No pending port collisions (`5432`, `3001`).

Do not proceed to Nginx/TLS, Ops bootstrap, or frontend deploy until this gate is green.

---

## 8) Operational reminders

- Never paste live secrets into chat logs or committed docs.
- If a secret was exposed during troubleshooting, rotate it after stabilization.
- Keep provider credentials in Phase 1/Phase 2 boundaries:
  - Bootstrap keys required for first boot
  - Ops-managed keys migrated to encrypted DB overlay after ops login

