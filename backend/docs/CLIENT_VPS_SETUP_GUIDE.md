# Multi-Client VPS Setup Guide

This guide is the **deployment runbook** for hosting multiple isolated client stores on **one Ubuntu VPS** using this repository. **Canonical architecture:** `ECOM_MASTER.md` (especially section 5 — VPS and deployment, section 12 — per-client customization) and `TRD.md` (sections 2.3, 3 — infrastructure, 4.2 — plugin order, 7.10–7.12 — webhooks). **Business acceptance for first go-live:** `BRD.md` section 12 (Phase 6 acceptance criteria). **Reusable release checklists:** `docs/BACKEND_GO_LIVE_CHECKLIST.md` + `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`. **Conflict resolution:** `ECOM_MASTER.md` wins.

**Lifecycle:** This is a **Client-Main (Post-Development)** runbook. Use `docs/CLIENT_HANDOFF_INDEX.md` as the primary post-development entrypoint.

> **Putting Cloudflare in front of the VPS? Read `docs/CLOUDFLARE_SHARED_VPS_DEPLOYMENT_GUIDE.md` alongside this one.** It is the battle-tested companion covering the exact Cloudflare TLS posture (`Full (strict)`, never `Flexible`), the certless-`default_server` **525** root cause, stray-`AAAA` pitfalls, origin-IP locking to Cloudflare ranges, the permanent default-server block, and a tightened per-client onboarding checklist. This guide is the base setup; that one is where the real-world Cloudflare gotchas live.

This runbook begins after Phase 5 local gate clears. Frontend Phase 4 must already be completed in the mandatory order documented in `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §1.2: Foundation -> Ops control plane -> Admin read -> Admin mutation -> Reliability -> Storefront customer journey.

---

## 1. What you are building

| Layer | Runs where | Role |
| --- | --- | --- |
| PostgreSQL 16 | **Host** (not in Compose) | One server process; **one database per client** (`TRD.md` §3.2). Containers reach it via `host.docker.internal`. |
| Nginx | **Host** | TLS termination, HTTP→HTTPS redirect, reverse proxy to backend/storefront app. Admin is served as a route within the same frontend deployment. |
| Certbot | **Host** | Certificates under `/etc/letsencrypt/live/<domain>/`. |
| Docker Compose stack | **Per client** | `backend` (Fastify), `workers` (BullMQ consumers), `postgres`, `redis` — see repo root `docker-compose.yml`. |

**Isolation rules (`TRD.md` §2.3, `ECOM_MASTER.md` §5):** never share Redis, database, JWT secrets, or payment/shipping credentials between clients. Each client gets its own `.env`, Compose project, Nginx `server {}` blocks, and TLS identity.

---

## 2. VPS baseline

| Item | Minimum | Notes |
| --- | --- | --- |
| OS | Ubuntu 22.04 LTS | `TRD.md` §3.1 |
| vCPU / RAM | 2 / 4 GB min; 4 / 8 GB recommended for 5–10 sites | Same table in `TRD.md` §3.1 |
| Disk | 40 GB SSD min | 80 GB SSD recommended for 5–10 active sites (`TRD.md` sizing guidance) |
| Nginx | 1.24+ | Required floor from `TRD.md` platform matrix |
| Time sync | **Required** | `systemd-timesyncd` (or NTP). Webhook skew checks (`RAZORPAY_WEBHOOK_MAX_SKEW_SECONDS`, `DELHIVERY_WEBHOOK_MAX_SKEW_SECONDS` in `.env.example`) depend on correct clock. |

Install on the host: **Docker Engine + Compose plugin**, **Nginx**, **Certbot** (nginx plugin), **PostgreSQL 16**, **Node.js 22** (for local `npm ci` / migrations if you do not run them only in CI), **jq** (optional, for JSON scripting). Create a **non-root deploy user** with sudo.

### 2.1 Host hardening checklist (required before first production client)

Use this once per VPS and record completion in your infra runbook:

| Check | Pass criteria |
| --- | --- |
| SSH hardening | `PermitRootLogin no` and `PasswordAuthentication no` in `/etc/ssh/sshd_config` |
| Firewall | `ufw` allows only `22`, `80`, `443` inbound |
| Intrusion protection | `fail2ban` installed, enabled, and running |
| Patch hygiene | `unattended-upgrades` enabled for security updates |
| Time sync | `timedatectl` reports synchronized clock |

Quick verification commands:

```bash
sudo systemctl status fail2ban --no-pager
sudo ufw status
timedatectl status
sudo grep -E "^(PermitRootLogin|PasswordAuthentication)" /etc/ssh/sshd_config
```

### 2.2 Capacity trigger thresholds (operational)

Keep these as scaling signals for the current host:

| Signal | Trigger | Action |
| --- | --- | --- |
| RAM | Sustained >75% during peak windows | Plan vertical resize before onboarding next client |
| CPU | Sustained >70% with request latency increase | Profile workers/provider adapters; plan resize |
| Disk | >70% used on root or data volume | Purge stale artifacts, archive backups, expand storage |
| Redis memory | Frequent eviction pressure or queue lag | Increase Redis limits / reduce retention / resize host |

These are **operational thresholds**, not architecture changes. Canonical stack remains Nginx + host PostgreSQL + per-client isolated app stack.

---

## 3. Port assignment (must follow)

| Client slot N | Backend host port | Typical storefront upstream port |
| --- | --- | --- |
| 1 | 3001 | 3101 |
| 2 | 3002 | 3102 |
| N | 3000 + N | 3100 + N |

**`BACKEND_PORT`** in `.env` maps host port → container `3000` (`docker-compose.yml` `ports: "${BACKEND_PORT}:3000"`). **Do not hardcode** ports inside `docker-compose.yml`; only via env (`TRD.md` §3.3).

---

## 4. Directory layout (recommended)

| Path | Purpose |
| --- | --- |
| `/var/www/<client-id>/backend` | Git clone of **this** template for that client |
| `/var/www/<client-id>/storefront` | Next.js frontend app (App Router — `TRD.md` §12.1) serving both storefront and admin routes (for example `/admin`) |
| `/var/www/<client-id>/storage/media` | Product image files (recommended; set `MEDIA_STORAGE_ROOT`) |
| `/var/www/<client-id>/storage/invoices` | GST invoice PDFs (set `INVOICE_STORAGE_ROOT` via Ops UI) |
| `/var/log/nginx/` | Per-site `access.log` / `error.log` if you split logs |

---

## 5. PostgreSQL (host)

### 5.1 Per-Client Database Setup (VPS)

Each client gets **isolated database credentials**. Never share databases or use generic `postgres/postgres` credentials.

#### Step-by-Step Setup:

**1. Create database and user:**
```bash
# Connect to host Postgres as superuser
sudo -u postgres psql

-- Create client database
CREATE DATABASE client_annapoorna;

-- Create dedicated user with strong password
CREATE USER annapoorna_app WITH PASSWORD 'StrongRandomPass123!';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE client_annapoorna TO annapoorna_app;

-- Connect to new database and grant schema privileges
\c client_annapoorna
GRANT ALL ON SCHEMA public TO annapoorna_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO annapoorna_app;
```

**2. Configure client `.env`:**
```env
POSTGRES_USER=annapoorna_app
POSTGRES_PASSWORD=StrongRandomPass123!
POSTGRES_DB=client_annapoorna
POSTGRES_PORT=5432
# URL-encode special characters if present
DATABASE_URL=postgresql://annapoorna_app:StrongRandomPass123!@host.docker.internal:5432/client_annapoorna
```

**3. Verify connectivity from container:**
```bash
docker compose exec backend node -e "console.log(require('@prisma/client').PrismaClient)"
# Or check logs
docker compose logs backend | head -20
```

### 5.2 Credential Lifecycle Management

| Phase | Action | Command/Location |
|-------|--------|------------------|
| **Initial setup** | Create DB + user | `sudo -u postgres psql` → `CREATE DATABASE/USER` |
| **Rotation** | Update password | `ALTER USER annapoorna_app WITH PASSWORD 'NewPass';` then update `.env` |
| **Verification** | Test connection | `npx prisma migrate status` or backend health check |
| **Backup** | pg_dump | `pg_dump -U annapoorna_app -d client_annapoorna > backup.sql` |

### 5.3 Common VPS PostgreSQL Issues

**Issue: Prisma P1000 (password mismatch after rotation)**
```bash
# If you rotated password in .env but DB still has old password:
sudo -u postgres psql -c "ALTER USER annapoorna_app WITH PASSWORD 'NewPasswordFromDotEnv';"
```

**Issue: Host cannot connect to container Postgres**
- VPS uses `host.docker.internal` in `DATABASE_URL` (containers → host Postgres)
- `docker-compose.yml` includes `extra_hosts: host.docker.internal:host-gateway`
- Verify: `docker compose exec backend nslookup host.docker.internal`

**Issue: `P1001 Can't reach database at host.docker.internal` during host-side migrate (expected if you ran bare migrate)**
- `host.docker.internal` resolves **inside containers only**, not in the VPS shell.
- **Do not** run bare `npx prisma migrate deploy` on the host — Prisma reads `.env` unchanged and fails with P1001. This is not a broken database if `psql -h 127.0.0.1` works.
- **Fix:** override `DATABASE_URL` to `127.0.0.1` for the migrate command only (keep container `.env` on `host.docker.internal`):
  ```bash
  MIGRATE_DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/host\.docker\.internal/127.0.0.1/')"
  DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma
  ```
- Prefer `scripts/vps-deploy.sh`, client `phase7-backend-deploy.sh`, or GitHub CD — they apply this override automatically. See `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` §C.

**Issue: Permission denied for schema**
```bash
# Re-grant schema privileges after DB creation
sudo -u postgres psql -d client_annapoorna -c "GRANT ALL ON SCHEMA public TO annapoorna_app;"
```

---

## 6. Redis on VPS (secure baseline)

Redis is required for BullMQ workers, idempotency, OTP/rate-limit counters, and webhook dedupe. Treat it as a production dependency, not a best-effort cache.

### 6.1 Security posture (mandatory)

1. Run Redis **inside client Docker network only**. Base `docker-compose.yml` exposes Redis on the host for local development (`ports: "${REDIS_PORT:-6379}:6379"`). **On production VPS, use `docker-compose.prod.yml`**, which sets `redis.ports: !reset []` so Redis is not published on host `6379`.
2. Set a strong `REDIS_PASSWORD` per client stack (minimum 32 random characters).
3. Use authenticated URL in `.env`:
   - Compose/VPS: `REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379`
4. Keep Redis isolated per client (`${CLIENT_ID}-redis`), never shared.
5. Keep `protected-mode yes` and avoid public firewall exposure.

### 6.2 Compose configuration (canonical)

This repo’s Compose stack uses:
- `redis-server --requirepass ...`
- append-only persistence (`appendonly yes`, `appendfsync everysec`)
- snapshot saves (`--save 900 1 --save 300 10 --save 60 10000`)
- healthcheck using authenticated `redis-cli ping`
- named volume `redis-data` for persistent state across container restarts

### 6.3 Provisioning checklist

| Check | Pass criteria |
| --- | --- |
| `REDIS_PASSWORD` set | Not placeholder, unique per client |
| `REDIS_URL` auth format | Includes password + service hostname `redis` |
| Redis not publicly exposed | `ports:` mapping removed from Compose Redis service on VPS (default template exposes for local dev — remove for production) |
| Persistence enabled | AOF + RDB settings active |
| Healthcheck green | `docker compose ps` shows Redis healthy |
| App health | `/api/v1/health` returns `redis: connected` |

### 6.4 Quick verification commands

```bash
docker compose ps
docker compose logs -f redis
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" ping
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" INFO persistence
```

Expected:
- `PONG`
- `aof_enabled:1`
- no repeated auth/connect errors in backend/workers logs

### 6.5 Backup and restore notes

- Redis is now persisted via `redis-data` volume.
- Include volume snapshot/backup in client DR runbook (alongside Postgres).
- For restore testing, verify:
  - queue workers recover,
  - idempotency and webhook dedupe keys behave correctly,
  - no cross-client key contamination.

---

## 7. Backend clone, env, and dependencies

1. `git clone <repo-url> /var/www/<client-id>/backend`
2. Copy **`.env.example`** → **`.env`** at repo root.
3. Set **client-specific** values following the **two-tier config model** (full classification in `docs/ENV_VS_DB_CONFIG_REFERENCE.md`):

   > **Config model:** The `.env` file is for **bootstrap/infra keys only**. All provider credentials, webhook tokens, and ops-security parameters are **DB-overlay keys** — they must be stored in `OpsConfigSecret` via the Ops UI/API (`POST /api/v1/ops/config/save`) after first ops invite bootstrap. They must **not** be added to `.env` in production. See `docs/ENV_VS_DB_CONFIG_REFERENCE.md` §2 for the full classification.
   >
   > **First-deploy exception:** `RESEND_API_KEY` and `RESEND_FROM` must be set as live values in `.env` before running `node scripts/ops-newuser.mjs` (needed to send the ops invite email). After first ops login they can be managed exclusively via Ops UI. See `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`.

   **Bootstrap/infra keys — set in `.env` (live values required):**

   | Group | Variables | Notes |
   | --- | --- | --- |
   | Identity / routing | `CLIENT_ID`, `BACKEND_PORT`, `STOREFRONT_URL`, `ADMIN_URL` | Compose names, CORS, emails, redirects |
   | Core | `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `REDIS_PASSWORD` | Redis URL must include auth in production-like profiles |
   | Auth | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `REDIS_KEY_PEPPER` | Tokens. JWT secrets fail fast if missing/empty. |
   | Security | `TURNSTILE_SECRET_KEY`, `AUDIT_ANCHOR_SECRET`, `IDEMPOTENCY_SCOPE_SECRET` | Request integrity |
   | Ops bootstrap | `OPS_DB_ENCRYPTION_KEY`, `OPS_COOKIE_SECRET` | Required to decrypt `OpsConfigSecret` and sign session cookies; bootstrap-only |
   | Alert recipient | `ADMIN_ALERT_EMAIL` | Fallback alert email if overlay unavailable |
   | **Email bootstrap** | `RESEND_API_KEY`, `RESEND_FROM` | **Phase 1 only** — needed for `ops-newuser.mjs` invite email. After first ops login, manage via Ops UI. |
   | Features | `FEATURE_COUPONS_ENABLED`, `FEATURE_REVIEWS_ENABLED`, `FEATURE_WISHLIST_ENABLED`, `FEATURE_GST_INVOICING_ENABLED`, `FEATURE_RESPONSE_ENVELOPE_ENABLED` | Toggle modules |
   | Runtime tuning | `RISK_*`, `HOT_SKU_*`, `CART_RESERVATION_TTL_MINUTES`, `HEALTH_*`, `LOAD_SHED_MODE` | Ops/risk thresholds |
   | Product media | `MEDIA_STORAGE_ROOT`, `MEDIA_CDN_BASE_URL`, `PUBLIC_STORE_URL` | VPS image files + public CDN origin for `ProductImage.url` |
   | Validation verbosity | `ENABLE_VERBOSE_VALIDATION_ERRORS` | Keep `false` in production |
   | Observability | `OTEL_TRACING_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` | Distributed tracing |

**`NODE_ENV` profile classification:**

| `NODE_ENV` value | Runtime profile | Provider guard behavior |
|---|---|---|
| `development`, `test` | development-like | `noop` providers allowed |
| `production`, `staging`, `qa`, `uat`, or any other value | production-like | `noop` blocked; placeholder secrets blocked |

   **DB-overlay keys — stored via Ops UI, NOT in `.env`:**

   These appear as **commented stubs** (`# KEY=`) in `.env.example` for documentation purposes only. They must be populated in `OpsConfigSecret` via `POST /api/v1/ops/config/save` after ops invite bootstrap. After saving, **restart both backend and workers** for the overlay to take effect.

   | Group | Keys (representative) | Notes |
   | --- | --- | --- |
   | Payments | `PAYMENT_PROVIDER`, `RAZORPAY_*`, `PAYMENT_CB_*` | `PAYMENT_PROVIDER`: `razorpay` or `cod`; never `noop` in production |
   | Shipping | `DELHIVERY_*`, `SHIPROCKET_*`, `SHIPPING_*` | Detection is credential-based — set keys for whichever provider(s) you use; both can be active simultaneously (cheapest rate wins). `SHIPPING_PROVIDER` is ignored. At least one provider must be configured for production. |
   | Webhook security | `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR`, `SHIPPING_WEBHOOK_ALLOWLIST_CIDR`, skew windows, webhook tokens | Hard-fail in production-like profiles if missing |
   | Notifications | `NOTIFY_*`, `RESEND_*`, `MSG91_*`, `FAST2SMS_API_KEY`, `META_WHATSAPP_*`, `SMS_PROVIDER` | Provider credentials; per-template channels configured in `StoreSettings` |
   | Invoice storage | `INVOICE_STORAGE_ROOT` | Local filesystem root for invoice PDFs |
   | Ops security | `OPS_METRICS_TOKEN`, `OPS_METRICS_ALLOWLIST`, `REPLAY_APPROVAL_TOKEN`, `REPLAY_AUDIT_RETENTION_DAYS`, `TRUSTED_PROXY_ALLOWLIST_CIDR` | Managed via Ops UI after first invite |

   **Product images (Ops UI → Product Media / Cloudflare R2 — not bootstrap `.env`):**

   - Cloudflare: create R2 bucket + API token (Object Read & Write); bind custom domain (e.g. `cdn.<storefront-domain>`) to the bucket
   - After ops login: Ops console → **Product Media (Cloudflare R2)** → set `MEDIA_STORAGE_PROVIDER=r2`, `R2_*`, `R2_PUBLIC_BASE_URL`; save and **restart** API/workers
   - Confirm `GET /api/v1/health/ready` has no `runtimeConfigMissingKeys` for media
   - Run `npm run verify:r2-media` on VPS (ensures R2 keys were not left in `backend/.env`)
   - Storefront `.env`: `NEXT_PUBLIC_IMAGE_CDN_URL` = same hostname as `R2_PUBLIC_BASE_URL`
   - Admin upload: `POST /api/v1/admin/products/:id/images/upload` — multipart batch, **5 MiB max** each; automatic R2 `PutObject`
   - Local dev: Ops UI `MEDIA_STORAGE_PROVIDER=local` (optional `MEDIA_STORAGE_ROOT`); origin `GET /api/v1/media/products/*`

   **Store/GST seller profile:** `storeName`, `sellerLegalName`, `sellerAddress`, `sellerState`, `gstin`, `fssaiNumber` — set via admin settings API (`PATCH /api/v1/admin/settings`), stored in `StoreSettings` DB row. No env fallback.

4. **`npm ci`** on the host (or in CI) before image build so `package-lock.json` is respected.

5. Post-deploy observability sanity check (required):
   - Verify `/api/v1/ops/metrics` is reachable with `x-ops-token`.
   - Confirm crash metric family is present: `process_crash_total{reason="unhandled_rejection|uncaught_exception"}`.
   - Confirm queue/outbox SLO metric families are present (`queue_*`, `outbox_*`) before go-live.
   - Confirm atomic operations and race-condition hardening is active: all CAS-hardened services pass unit tests (`ops.service.test.ts`, `auth.service.mfa-refresh.test.ts`, `admin-invites.service.test.ts`, `reconciliation.worker.test.ts`, `idempotency.test.ts`).
6. **Never commit `.env`.** Secrets live only on the server / secret manager (`TRD.md` §11.4).

---

## 8. Docker Compose services (this repo)

From **`docker-compose.yml`**:

| Service | Image / command | Purpose |
| --- | --- | --- |
| `backend` | Build `Dockerfile`; `CMD` → `node bootstrap-backend.js` | HTTP API (`src/main.ts` bootstrap). |
| `workers` | Same image; `command: ["node", "bootstrap-workers.js"]` → `dist/queues/workers/index.js` | BullMQ job processors (`TRD.md` §10). **Must run** for webhooks, notifications, shipping jobs, refunds, scheduled repeatables. |
| `postgres` | `postgres:16-alpine`, healthchecked, persistent (`pg-data` volume) | Database; credentials set via `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` in `.env`. |
| `redis` | `redis:7-alpine`, auth-enabled (when `REDIS_PASSWORD` set), persistent (`appendonly` + volume), `maxmemory 100mb`, `noeviction` | Queues + cache; **isolated per client stack** (`TRD.md` §3.4). |

**Important:** The Compose file uses `env_file: .env` to inject **all** environment variables into `backend` and `workers` containers. You never need to manually mirror new vars into `docker-compose.yml` — any variable added to `.env` is automatically available in the container. `NODE_ENV=production` and `OTEL_SERVICE_NAME` are explicitly overridden in the compose `environment:` block.

**Build (`Dockerfile`):** multi-stage Node 22 Alpine; `npx prisma generate` + `npm run build` in builder; production stage copies `dist/`, `node_modules/`, `prisma/`, `bootstrap-backend.js`, and `bootstrap-workers.js`. Entrypoint matches **`package.json`** `"start": "node bootstrap-backend.js"`.

---

## 9. Start Infrastructure & Migrate Database

If using the local Docker-based PostgreSQL, start the database and cache services first so Prisma can connect:

```bash
docker compose up -d postgres redis
```

Wait a few seconds for PostgreSQL to initialize, then apply migrations on the deployment host.

> **VPS with host PostgreSQL:** Production `.env` keeps `DATABASE_URL` on `host.docker.internal` so **containers** reach the host DB. That hostname does **not** work in the VPS shell. **Never** run bare `npx prisma migrate deploy` on the host — you will get `P1001` at `host.docker.internal:5432` even when Postgres is healthy on `127.0.0.1`. Use the override below or `scripts/vps-deploy.sh` / `phase7-backend-deploy.sh`.

```bash
npm ci   # required before npx prisma — bare npx can pull wrong Prisma major
npx prisma generate --schema prisma/schema.prisma

MIGRATE_DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/host\.docker\.internal/127.0.0.1/')"
DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma
```

Use **`migrate deploy`** in production (not `migrate dev`). Migration SQL lives under **`prisma/migrations/`** as a single squashed baseline (`0_init`). After deploy, spot-check tables and `_prisma_migrations` history. Success looks like `No pending migrations to apply.` — re-running the override command is safe.

> **If you are applying to a database that was already built from the old incremental migrations** (pre-squash), run this once to mark the baseline as applied without re-executing the SQL:
> ```bash
> npx prisma migrate resolve --applied 0_init
> ```

> **Troubleshooting Note:** If Prisma complains about `query_engine_bg.postgresql.wasm-base64.js` missing, the migration still succeeded. Simply run `npx prisma generate`. If `migrate deploy` connects to `ecom_template` instead of your client database, ensure `.env` is properly configured, then wipe the Docker volume (`docker compose down -v`) and try again. See **`MASTER_DEPLOYMENT_PLAYBOOK.md` Appendix H** for details.

---

## 10. Start the backend stack

> **One-time recommendation — set Docker Compose's special vars in the VPS `.env` before running any compose command:**
>
> Append these two lines to `/var/www/<client-id>/backend/.env` (next to `CLIENT_ID`). Compose reads them automatically as special variables, so every `docker compose ...` command run from this directory will merge both files and use the right project name — no `-f` / `-p` flags to remember:
>
> ```bash
> COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
> COMPOSE_PROJECT_NAME=<client-id>   # same value as CLIENT_ID
> ```
>
> Without these, a bare `docker compose up -d backend workers` falls back to the base file only, tries to start the containerised Postgres, collides with the host's native Postgres on port 5432, and creates a stale orphan container on retry. CD (`backend/scripts/vps-deploy.sh`) passes flags explicitly and is unaffected — these only fix manual ops commands. See `OPS_CONTROL_PLANE_GUIDE.md` §6.10 and `PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` §3.

Now build and start the Node application services. The explicit `-f`/`-p` form below works regardless of whether the `.env` shortcut is set:

```bash
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend workers
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml logs -f backend
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml logs -f workers
```

With the `.env` shortcut applied, the same becomes:

```bash
docker compose up -d --build backend workers
docker compose logs -f backend
docker compose logs -f workers
```

Verify:

1. Containers: `${CLIENT_ID}-redis`, `${CLIENT_ID}-backend`, `${CLIENT_ID}-workers`. **There is no `${CLIENT_ID}-postgres` container on the VPS** — the prod overlay hides the `postgres` service behind a `compose-local-postgres-only` profile so the host's native PostgreSQL stays authoritative.
2. Health: `curl -sS http://127.0.0.1:<BACKEND_PORT>/api/v1/health` — must report DB + Redis connected (`TRD.md` §4.3).
3. Readiness: `curl -sS http://127.0.0.1:<BACKEND_PORT>/api/v1/health/ready` — before go-live this must be `status=ready` with `runtimeConfigMissingKeys=[]`.
4. Workers processing: trigger a test flow or inspect **`GET /api/v1/ops/queues`** (Bull Board, ops session + `ops:read` — `TRD.md` §10.1).

---

### 10.1 Runtime stability validation (memory-leak and worker-liveness gate)

This is a **mandatory pre-go-live gate** for OTP/auth and queue-dependent flows.

#### A) Run API and workers as separate long-lived processes

Your deployment must keep backend API and workers independent so one process crash does not hide the other:

- Docker Compose model (recommended): keep both `backend` and `workers` services healthy and independently restartable.
- Bare process model (if not using Compose): run `npm run start` and `npm run start:workers` under process supervision (`systemd` or PM2).

Compose quick checks:

```bash
docker compose ps
docker compose logs -f --tail=200 backend
docker compose logs -f --tail=200 workers
```

Pass criteria:

- `backend` and `workers` are both `Up` and stable for >=30 minutes.
- No crash-loop pattern or repeated OOM/restart entries in logs.
- Redis connectivity is stable in both services.

#### B) Monitor RSS/heap over time (not point-in-time only)

Capture memory trend, not just snapshots. Monitor both API and workers:

- Container/process RSS (`docker stats`, cgroup memory, or PM2/systemd metrics).
- Node heap metrics from ops metrics endpoint (for API and worker process if exposed via your telemetry pipeline).

Recommended metrics to record every 60s during soak:

- `process_resident_memory_bytes`
- `nodejs_heap_size_used_bytes`
- `nodejs_heap_size_total_bytes`
- `nodejs_eventloop_lag_seconds` (if instrumented)

Ops metrics snapshot (API):

```bash
curl -sS -H "x-ops-token: $OPS_METRICS_TOKEN" "https://<domain>/api/v1/ops/metrics" > /tmp/ops-metrics.prom
grep -E "process_resident_memory_bytes|nodejs_heap_size_used_bytes|nodejs_heap_size_total_bytes" /tmp/ops-metrics.prom
```

Interpretation guidance:

- Healthy profile: heap usage shows GC sawtooth behavior; RSS may rise initially then stabilize.
- Risk profile: sustained monotonic RSS growth without stabilization after warm-up window.

#### C) Run sustained OTP/login soak (customer auth path)

Run a 30–60 minute sustained test for:

- `POST /api/v1/auth/send-otp`
- `POST /api/v1/auth/verify-otp`

Include realistic concurrency and retry patterns. Ensure SMS provider credentials are valid (MSG91: `MSG91_AUTH_KEY` + `MSG91_SENDER_ID`; Fast2SMS: `FAST2SMS_API_KEY`) and workers are active.

Soak checklist:

1. Warm-up 5 minutes at low concurrency.
2. Ramp to target concurrency (for example 10 -> 25 -> 50 virtual users).
3. Sustain for >=30 minutes.
4. Record latency p95/p99, non-2xx rate, and memory trend for backend + workers.
5. Continue for 10 minutes after load ends to check memory recovery.

Pass criteria (recommended baseline):

- Error rate for auth endpoints remains within your SLO budget (no prolonged 5xx spikes).
- Notification queue backlog does not grow unbounded.
- Worker process remains healthy (no crash/restart loop).
- RSS/heap stabilizes after warm-up; no unbounded post-load climb.

#### D) Verify notification worker is always up (OTP dependency)

OTP delivery depends on notification jobs (`send-sms`) being consumed by workers.

Required checks:

- `workers` service stays up while OTP traffic is active.
- `send-sms` jobs are consumed continuously (no stuck queue growth).
- Dead-letter queue does not show sustained growth for notification jobs.

Operational response if worker is down:

1. Treat as auth-impacting incident (OTP login degraded).
2. Restart workers immediately and verify Redis + provider connectivity.
3. Check backlog drain and confirm fresh OTP delivery recovery.
4. Capture incident evidence in deployment log.

Evidence to archive before go-live:

- Time-series snapshots for RSS/heap (backend + workers)
- OTP/login soak command + summary output
- Queue depth / DLQ screenshots or metric extracts
- Backend + worker log excerpts showing stable operation window

---

## 11. Nginx and TLS

### 11.0 Multi-client VPS rules (mandatory when several clients share one host)

| Rule | Do | Do not |
| --- | --- | --- |
| **Site config file** | Add `/etc/nginx/sites-available/<domain.com>` (domain-based name) | Replace or delete other clients' files in `sites-enabled/` |
| **Enable site** | `sudo ln -sf sites-available/<domain.com> sites-enabled/<domain.com>` | `sudo rm sites-enabled/default` unless you confirmed no other site uses it (`ls sites-enabled/`) |
| **Rate-limit zones** | Install `snippets/rate-zones.conf` **once**; `include` it in `nginx.conf` `http {}` | Duplicate `limit_req_zone` lines in `nginx.conf` and the snippet (nginx reload will fail) |
| **Ports** | Assign unique `BACKEND_PORT` / storefront port per client (§3); run `ss -tlnp` before deploy | Reuse another client's `3001`/`3101` (or their slot) |
| **Redis** | Keep Redis on the Docker network only — deploy with `docker-compose.prod.yml` (`redis.ports: !reset []`) | Publish `6379` on `0.0.0.0` (only one client can bind host `6379`; local dev may use base compose port mapping) |
| **TLS** | `certbot --nginx -d <this-domain> -d www.<this-domain>` per client | Assume one certificate covers all clients |
| **Routing** | `server_name` matches **this** client's domain; `proxy_pass` to **this** client's loopback ports | Single catch-all `server {}` for all domains on one port |

**Preflight script (per client, before Nginx/Certbot):** `docs/templates/scripts/phase7.5-nginx-tls-preflight.sh` (copy to `docs/clients/<client-id>/scripts/`).

```bash
export CLIENT_ID=<client-id>
export PRODUCTION_DOMAIN=<domain.com>
export BACKEND_PORT=<host-api-port>
export STOREFRONT_PORT=<host-storefront-port>
bash docs/clients/<client-id>/scripts/phase7.5-nginx-tls-preflight.sh
```

### 11.1 Per-client Nginx + TLS steps

> **Important (May 2026):** `nginx/client.conf.template` is **not byte-installable** — it contains `${CLIENT_DOMAIN}`, `${STOREFRONT_PORT}`, and `${BACKEND_PORT}` placeholders that must be rendered with `envsubst` before installing. Copying the raw template verbatim will fail `nginx -t` with `cannot load certificate /etc/letsencrypt/live/${CLIENT_DOMAIN}/fullchain.pem`. The CD script (`backend/scripts/vps-deploy.sh` §3.5b) renders automatically on every deploy when `NGINX_AUTO_RELOAD=1`. For manual installs, render with:
>
> ```bash
> export CLIENT_DOMAIN=<your-domain.com> STOREFRONT_PORT=3101 BACKEND_PORT=3001
> envsubst '${CLIENT_DOMAIN} ${STOREFRONT_PORT} ${BACKEND_PORT}' \
>   < nginx/client.conf.template \
>   | sudo tee /etc/nginx/sites-available/${CLIENT_DOMAIN} >/dev/null
> sudo nginx -t && sudo systemctl reload nginx
> ```

1. Start from repo **`nginx/client.conf.template`** — it encodes **`TRD.md` §3.5** edge limits:
   - HTTP → HTTPS **301**
   - **TLSv1.2** and **TLSv1.3** only, `ssl_prefer_server_ciphers on`
   - **Security headers** (added in deep audit May 2026, updated June 2026): `Strict-Transport-Security` (HSTS, 2-year max-age + includeSubDomains + preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection: 1; mode=block`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
   - **Note (June 2026):** The Next.js frontend (`frontend/next.config.ts`) also emits its own security headers via the `async headers()` export, including a full Content-Security-Policy and `Cross-Origin-Opener-Policy: same-origin-allow-popups` (required for Razorpay popup flow). The Nginx layer and Next.js layer are complementary — do not remove Nginx headers on the assumption that Next.js covers them. Both must be present in production. When both layers set `X-Frame-Options`, browsers use the most restrictive value.
   - **TLS hardening**: `ssl_ciphers` ECDHE-only AEAD suite, `ssl_session_cache shared:SSL:10m`, `ssl_session_timeout 1d`, `ssl_session_tickets off`, `ssl_stapling on`, `ssl_stapling_verify on`
   - **Rate-limit zones**: copy **`nginx/rate-zones.conf.template`** to `/etc/nginx/snippets/rate-zones.conf` and add `include /etc/nginx/snippets/rate-zones.conf;` inside the `http {}` block of your top-level `nginx.conf`. The template defines `limit_req_zone` for all route classes (auth, checkout, admin, catalog, cart, webhook, health, default). Per-route `limit_req` directives stay in dedicated `location` blocks inside `client.conf.template` — never inside `if` blocks.
   - **`client_max_body_size 20M`**
   - **`proxy_set_header`** `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` — required because Fastify uses **`trustProxy: true`** (`src/main.ts`) for correct client IP behind Nginx.
   - **Maintenance page**: the template configures `error_page 502 503 /maintenance.html` — deploy the static page before enabling the site:
     ```bash
     sudo mkdir -p /etc/nginx/maintenance
     sudo cp nginx/maintenance.html /etc/nginx/maintenance/maintenance.html
     ```
     The page auto-refreshes every 15 s and includes a `Retry-After: 15` header. It is served during the ~3–5 s restart window when a process restart is scheduled via `POST /api/v1/ops/system/restart`.
2. The template uses placeholders for everything that varies per client: `${CLIENT_DOMAIN}` for `server_name` + certificate paths, `${STOREFRONT_PORT}` for the Next.js upstream (typically `3101`), and `${BACKEND_PORT}` for the Fastify upstream (defaults to `3001`). Render with `envsubst` (see top of this section). Webhook paths must proxy to the same backend without stripping body (next step).
3. **Webhook paths** must proxy to the **same** backend without stripping body: `location /api/` → backend. Webhook URLs for provider dashboards:
   - `https://<customer-domain>/api/v1/payments/webhook`
   - `https://<customer-domain>/api/v1/shipping/webhook`
4. **Admin route model (canonical):** admin is served on the same frontend host as a route (for example `/admin`) through the same frontend upstream; do not configure a separate static admin subdomain unless you intentionally maintain a non-canonical legacy setup.
5. `nginx -t` && `systemctl reload nginx`.
6. Certbot: obtain certs for customer + `www` domains used by the single frontend host; confirm auto-renew (`certbot renew --dry-run`).

If **`RAZORPAY_WEBHOOK_ALLOWLIST_CIDR`** / **`SHIPPING_WEBHOOK_ALLOWLIST_CIDR`** (or fallback `DELHIVERY_WEBHOOK_ALLOWLIST_CIDR`) are set, ensure **real client IP** reaches the app (Nginx forwards `X-Forwarded-For`; app trusts proxy — validate with a test webhook and your actual egress IPs).

---

## 12. Webhook behaviour (implementation tie-in)

**`src/main.ts`** registers a single `application/json` parser with `parseAs: 'buffer'`. For **`/api/v1/payments/webhook`** and **`/api/v1/shipping/webhook`** only, the raw `Buffer` is preserved directly for HMAC/token verification (no UTF-8 roundtrip — eliminates potential byte-sequence alteration); **all other JSON routes** are parsed to objects (`TRD.md` §7.10). Handlers must **enqueue BullMQ** and return **200 quickly** (< 200ms target); heavy work runs in **`workers`** (`TRD.md` §10.3).

---

## 13. CORS and public URLs

Backend CORS must allow the frontend origin configured for that client. If storefront/admin are same-origin routes (for example `/` and `/admin` on one domain), keep **`STOREFRONT_URL`** and **`ADMIN_URL`** aligned to that same HTTPS origin in `.env` (`TRD.md` §11.2).

Customer phone OTP auth contract:

- Phone OTP login: `POST /api/v1/auth/send-otp` + `POST /api/v1/auth/verify-otp`
- Phone OTP signup (phone required, profile optional): `POST /api/v1/auth/signup-phone` with `phone`, `otp`, and optional `firstName`, `lastName`, `email`

Invoice serving policy (required):
- Customer invoice download: `GET /api/v1/orders/:id/invoice.pdf` (authenticated customer only)
- Admin invoice download: `GET /api/v1/admin/orders/:id/invoice.pdf` (authenticated admin with `orders:read`)
- No public/signed invoice URLs should be exposed in API payloads (`invoice.hasPdf` metadata only).

**Admin permission enforcement:** keep **`ADMIN_SCOPE_ENFORCEMENT`** enabled in production so operation-level admin scopes stay enforced (`TRD.md` §6.3; `src/common/guards/admin-permissions.guard.ts`). Canonical role model is two-role only: `merchant` (business `/api/v1/admin/*`) and `developer` (platform `/api/v1/ops/*`). Set enforcement to `false` only for controlled non-prod or incident response — never as a default on a live store.

### 13.1 Frontend deployment contract (for AI-generated frontends)

Before switching traffic, verify frontend implementation follows backend integration invariants:

> Execute and attach: `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` (frontend) + `docs/BACKEND_GO_LIVE_CHECKLIST.md` (backend release gates + full env-to-implementation parity across core/auth/data/providers/webhooks/risk/features/notifications/ops/observability).

Provider lifecycle controls for this stage:
- `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`
- `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`

| Check | Pass criteria |
| --- | --- |
| API env naming | Frontend uses `NEXT_PUBLIC_API_BASE_URL` (includes `/api/v1`) and `NEXT_PUBLIC_STOREFRONT_URL` |
| Frontend rules sync | Frontend repo copies latest `frontend-agent-rules.md` to `.agents/rules/dev-rules.md` and verifies via `diff` before release |
| Response parser | Handles both success modes (enveloped/raw) via `FEATURE_RESPONSE_ENVELOPE_ENABLED` |
| Mutation idempotency | Critical order/payment/admin writes send `idempotency-key` |
| Checkout split | PREPAID uses `/payments/initiate` + `/payments/verify`; COD skips Razorpay init path |
| Webhook boundary | No browser calls to `/payments/webhook` or `/shipping/webhook` |
| Auth refresh | On first `401`, frontend performs single refresh + retry policy |
| Production provider posture | `PAYMENT_PROVIDER=noop` is forbidden in production. For shipping, at least one provider's credentials must be set (Delhivery and/or Shiprocket). `SHIPPING_PROVIDER` env var is ignored. |

---

## 14. Postman monitor compatibility note

Postman monitors run from Postman cloud, not from this VPS shell context. If the Postman environment uses `127.0.0.1` or `localhost` as `baseUrl`, monitor runs will fail with DNS/network errors by design. Use a reachable host URL for monitor runs, and classify localhost monitor failures as **config/env blocker** in compliance reports.

---

## 15. Observability and ops metrics

- Prometheus-format metrics: **`GET /api/v1/ops/metrics`** — production access requires a valid **`OPS_METRICS_TOKEN`**; allowlist is defense-in-depth (`src/common/plugins/observability.plugin.ts`).
- SLO / alert rule files under **`observability/`** (e.g. `observability/slo-rules.yml`, `observability/alert-routing.yml`) — wire your scraper and alertmanager to match your hosting.
- Webhook SLO expectation: handlers should return **200** quickly (<200ms target) while async work runs in queues; executable alerting currently monitors `slo:webhook_latency:p95_5m` with threshold `0.5s` (`observability/slo-rules.yml`).

### 15.1 Layer C operator-only controls runbook

| Control | Owner | Change path | Rollback |
|---|---|---|---|
| Load shed mode (`normal/reduced/emergency`) | Platform ops | `POST /api/v1/ops/load-shed` with platform scope | Revert mode to `normal` |
| Metrics exposure auth (`OPS_METRICS_*`) | Platform ops | Rotate env + restart | Restore prior env values |
| Redis/Postgres credentials | Platform ops | Secret manager + rolling restart | Restore previous secret version |

Merchant admin UI may display diagnostics, but must not expose mutation controls for these Layer C settings.

### 15.2 First-time ops identity invite bootstrap (mandatory)

Run from backend path on the VPS only, after env and migrations are ready:

```bash
cd /var/www/<client-id>/backend
npm run ops:newuser -- --email=<ops@email> --name="Primary Ops" --setup-base-url="https://<client-domain>" --yes
```

`--setup-base-url` must be base origin only (for example, `https://<client-domain>`), not `https://<client-domain>/ops/setup`. Backend appends `/ops/setup?token=...`.

Pre-checks:
- `OPS_DB_ENCRYPTION_KEY` is configured.
- Command is executed from a trusted operator shell (not CI logs, not shared terminal sessions).
- Invite email must not already exist in `User` (customer/admin) domain; cross-domain email reuse fails closed with `409 CONFLICT`.
- Frontend `/ops/setup` is reachable with configured Basic Auth before issuing invite (use real values from `frontend/.env.production.local`):
  ```bash
  curl -sS -o /dev/null -w "%{http_code}\n" \
    -u "<OPS_UI_BASIC_AUTH_USERNAME>:<OPS_UI_BASIC_AUTH_PASSWORD>" \
    "http://127.0.0.1:<STOREFRONT_PORT>/ops/setup"
  ```
  Expect `200` (or redirect). If `401`, fix credentials and redeploy frontend before running `ops:newuser`.
- `scripts/ops-newuser.mjs` now auto-normalizes `DATABASE_URL` from `host.docker.internal` to `127.0.0.1` when run on the VPS host shell (outside containers), so invite bootstrap does not fail with Prisma `P1001`.

Post-checks:
- Invite email is received and setup is completed from `https://<client-domain>/ops/setup?...` within 10 minutes.
- Runtime credentials are stored in vault after setup completion.
- Login validation succeeds: email OTP flow completes and `GET /api/v1/ops/session` returns 200.
- Expired unconsumed invites are cleaned and logged in ops audit timeline.

Compromise/loss runbook:
- Deactivate compromised `OpsUser` record immediately.
- Issue replacement invite via `ops:newuser`.
- Issue new invite and verify ops login flow (email OTP) succeeds.

### 15.3 First-time merchant admin invite bootstrap (mandatory)

Run this after ops bootstrap is verified and before client admin panel go-live:

```bash
cd /var/www/<client-id>/backend
npm run admin:newuser -- --email=<admin@email> --name="Merchant Admin" --setup-base-url="https://<client-domain>" --yes
```

`--setup-base-url` must be base origin only (for example, `https://<client-domain>`), not `https://<client-domain>/admin/setup`. Backend appends `/admin/setup?token=...`.

Optional flags:

- `--permissions=products:read,orders:read,...`
- `--created-by-email=<ops-user-email>`

Pre-check:

- Invite email must not already exist in `OpsUser` domain; cross-domain email reuse fails closed with `409 CONFLICT`.

Post-checks:

- Invite email is received and setup is completed from `https://<client-domain>/admin/setup?...` within 10 minutes.
- Merchant admin can login via 2-step email OTP (`POST /api/v1/auth/admin/login/request-otp` → `POST /api/v1/auth/admin/login/verify-otp`) and JWT is issued with merchant-only permissions.
- Admin JWT permissions include merchant-only scopes (no ops/developer scopes).
- Invite lifecycle is auditable (`CREATED -> EMAIL_SENT -> CONSUMED`) and expired invite cleanup path remains available.

Production policy:

- Do not use `scripts/seed-admin.mjs` for VPS production onboarding.
- Use invite-based provisioning (`admin:newuser` or ops-authenticated admin invite API) only.

---

## 16. Edge security and numeric gate checklist (pass/fail)

| Gate | Pass criteria |
| --- | --- |
| TLS protocol floor | Nginx serves only `TLSv1.2` and `TLSv1.3` |
| Security headers | HTTPS block includes: `Strict-Transport-Security` (HSTS 2yr + preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection: 1; mode=block`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()` |
| TLS hardening | `ssl_ciphers` ECDHE-only AEAD, `ssl_session_cache shared:SSL:10m`, `ssl_session_timeout 1d`, `ssl_session_tickets off`, `ssl_stapling on/verify on` |
| Rate-limit context | `limit_req_zone` in `http {}` (top-level `nginx.conf`), per-route `limit_req` in `location` blocks (not `if`) |
| Request body limit | `client_max_body_size 20M` in active server block |
| Auth route limit | `limit_req_zone api_auth rate=20r/m` with `burst=8` |
| Checkout route limit | `limit_req_zone api_checkout rate=35r/m` with `burst=12` |
| Admin route limit | `limit_req_zone api_admin rate=60r/m` with `burst=15` |
| Catalog route limit | `limit_req_zone api_catalog rate=240r/m` with `burst=40` |
| Cart route limit | `limit_req_zone api_cart rate=90r/m` with `burst=20` |
| Webhook route limit | `limit_req_zone api_webhook rate=300r/m` with `burst=30` |
| Fastify plugin order parity | `helmet -> cors -> jwt -> rate-limit -> multipart -> swagger(dev) -> prisma -> redis -> bullmq -> error-handler -> observability -> load-shed -> modules -> response-envelope` |
| Fastify app-layer limiter | `@fastify/rate-limit` is active with tiered route profiles, not edge-only limiting |
| Container auto-restart | `docker compose` services use `restart: unless-stopped` (supports BRD recovery expectation for container crashes) |

---

## 17. Quality gates before calling it “deployed”

Run from the backend repo (same commands as CI subsets):

> Recommended: execute and archive `docs/BACKEND_GO_LIVE_CHECKLIST.md` as the release evidence wrapper for this section, including complete environment-to-implementation parity validation.

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript strict |
| `npm run test:unit:coverage` | Unit coverage confidence for touched domains |
| `npm run coverage:ratchet` | Coverage floor gate |
| `npm run test:security` | Security-focussed tests |
| `npm run route:discipline-check` | Route structure guardrail |
| `npm run serializer:exposure-check` | Serializer leak guardrail |
| `npm run test:guardrails` | Tests for the scripts above |
| `npm run contract:admin` | Admin contract smoke checks |

Full release parity (when infra available): `npm run ci:reliability-gates` (`package.json`).

CI also runs **Security Scans** (`.github/workflows/security.yml`): CodeQL, npm audit (`--omit=dev`, critical/high blocks), OSV Scanner (respects `osv-scanner.toml` at repo root for dev-group ignores), and Trivy container scan. See `MASTER_DEPLOYMENT_PLAYBOOK.md` Appendix G.0 for details.

Important parity note: CI includes additional build/reliability workflows beyond this local subset; passing local checks does not guarantee full CI parity.

Safety note: run `contract:admin` only against a controlled non-production target because it executes authenticated admin mutations.

---

## 18. Backup, DR, and operations

- **Postgres:** daily `pg_dump` (or managed backup) **off** the VPS; periodic restore test (`ECOM_MASTER.md` / `TRD.md` DR themes; repo scripts `npm run dr:*`).
- **Artifacts:** record image tag, git SHA, **non-secret** env checksum in a deploy manifest.
- **Queues:** if jobs backlog, check **`workers`** container, Redis memory, and provider outages (`TRD.md` §10).

---

## 19. Failure patterns (quick diagnosis)

| Symptom | Likely cause |
| --- | --- |
| Webhook **401** spikes | Wrong `RAZORPAY_WEBHOOK_SECRET` / shipping provider token; clock skew; allowlist mismatch |
| Payments stuck **PENDING_PAYMENT** | Workers down; Redis down; queue failure — check workers logs and Bull Board |
| **502** from Nginx | Backend container not listening on `BACKEND_PORT` |
| `/ops/setup` returns **401** even with `curl -u` | Basic-auth creds mismatched vs frontend runtime, or stale frontend build not reading latest env |
| Duplicate charges / emails | Idempotency — verify Redis and worker idempotency keys (`BRD.md` AC-05) |
| Wrong client data | Isolation breach — wrong `DATABASE_URL` or shared Redis between clients |
| `docker compose up` prints `No such container: <sha>` every run, services start anyway | Dead-container tombstones from prior deploys (see §19.2) |
| Maintenance mode set but storefront still accessible after countdown | (a) Workers image stale → rebuild + restart; or (b) Nginx config drift → see §19.3; or (c) wait 7 min for read-side self-heal |
| `docker compose up` fails with `failed to bind host port 0.0.0.0:5432/tcp` | Missing prod overlay — see §19.4 |
| Recently-pushed nginx changes not actually live | Nginx config drift — see §19.3 |
| Storefront shows **bare** `nginx/1.x (Ubuntu)` 500/503 page (not the friendly maintenance page) but `/ops` reaches the React shell | Maintenance gate auth_request failing OR `maintenance.html` not deployed — see §19.5. Post-2026-05-26: a missing `maintenance.html` now serves a minimal inline branded page instead of nginx's default. Bare nginx page = gate subrequest itself is failing (case A). |
| Storefront shows a **minimal "We'll be back shortly"** page during maintenance (no rich styling, no dark-mode handling) | The full styled `maintenance.html` is not on disk. Run `sudo bash scripts/install-maintenance-page.sh` on the VPS — see §19.5 Recovery. |
| **OTP/notification emails silently stop arriving** even though backend health is `db: connected, redis: connected`, `RESEND_API_KEY` is loaded, and `OpsOtpChallenge` rows are created in `PENDING` state with no error logs anywhere | The `notifications` queue (possibly also `outbox-dispatch` or others) is paused in Redis from an incomplete drain protocol exit on a prior `scheduled-process-restart` or `maintenance-activation`. See §19.6 Recovery. |

### 19.2 Dead-container tombstones — two failure modes (`No such container: <sha>`)

**Symptom A — noisy but services live.** Every `docker compose up -d ...` prints a noisy block like:

```
✘ Container 1b268e1da8d8       Error response from daemon: No such container: ...
```

…but `docker ps` shows backend/workers/redis running. `docker compose down --remove-orphans` reports the ghosts as "Removed" but they reappear on the next `up`.

**Symptom B — deploy exits 1 with phantom-start error.** A CD deploy log shows:

```
Container raghava-organics-redis    Started
Container f6b1a3c38046              Stopping
Container f6b1a3c38046_raghava-organics-backend  Recreate   ← rename-as-backup pattern
Container 1b268e1da8d8              Stopping
Container 1b268e1da8d8_raghava-organics-workers  Recreate
Container f6b1a3c38046              Error while Stopping
Container f6b1a3c38046              Removed
Container 1b268e1da8d8              Error while Stopping
Container 1b268e1da8d8              Removed
Container f6b1a3c38046_raghava-organics-backend  Recreated
Container 1b268e1da8d8_raghava-organics-workers  Recreated
Container raghava-organics-workers  Starting
Container raghava-organics-backend  Starting
Container raghava-organics-workers  Started
Container 1b268e1da8d8              Starting               ← Compose tries to start the ghost ID
Container raghava-organics-backend  Started
Container f6b1a3c38046              Starting               ← same
Error response from daemon: No such container: 1b268e1da8d8…
Error: Process completed with exit code 1.
```

The new canonical containers are live and serving traffic, but Compose's bookkeeping queued a trailing `start` call against the original ghost IDs, which failed and made CD exit 1. **Both symptoms have the same root cause and the same fix.**

**Why.** Earlier deploys built new backend/workers images and then ran `docker image prune`. That removed an image while a Compose container record still referenced it, marking the container `Dead`. `docker rm -f` reports "No such container" because the container is gone from Docker's runtime, but the on-disk directory at `/var/lib/docker/containers/<full-sha>/` survives — only root can delete it. Compose picks it up by label on every subsequent listing. With `--force-recreate` Compose then enters its rename-then-replace path, which queues a trailing `start` against the old ghost ID — and that's symptom B.

**Recovery.** Run the standalone cleanup script as a user with sudo:

```bash
cd /var/www/<client>/backend
bash scripts/cleanup-stale-compose-state.sh "$CLIENT_ID"
```

It lists every container labeled with this project that is in `dead`, `exited`, `created`, or `removing` state, force-removes them, deletes their on-disk tombstones (requires sudo for the `rm -rf /var/lib/docker/containers/<id>/` step), restarts the Docker daemon to refresh the container index, and waits for it to come back. Live containers come back via `restart: unless-stopped`. Once it finishes, bring up cleanly:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml -p $CLIENT_ID \
  up -d --remove-orphans backend workers
```

(Note: no more `--force-recreate` — see "Prevention" below for why.)

**Prevention — three layers.**

1. **`scripts/vps-deploy.sh §1.75` (already in place).** Runs the same sweep before every CD deploy. The sweep now verifies the tombstones are gone after its destructive pass and **aborts the deploy with `Deploy aborted: Dead-container tombstones detected and could not be fully cleaned automatically.`** if any survive — so you get a clear instruction to run `cleanup-stale-compose-state.sh` rather than a misleading `No such container` trace 10 minutes later.
2. **`scripts/vps-deploy.sh §4 explicit stop+rm+up (replaces `--force-recreate`).** The deploy script no longer uses `docker compose up --force-recreate`. Instead it runs `docker compose stop <services>`, then `docker rm -f <canonical-names>` per service, then `docker compose up -d --remove-orphans <services>`. This bypasses Compose's rename-then-replace path entirely, so even if a ghost slips through it can't trigger the symptom-B phantom-start failure. Same downtime as `--force-recreate` (3–5 s per service, covered by the Nginx maintenance page).
3. **Optional: passwordless sudo for the CI runner.** If you grant the runner user passwordless sudo on `/usr/bin/rm -rf /var/lib/docker/containers/*` (and optionally `/usr/bin/systemctl restart docker`), §1.75 can fully self-heal in CD without ever needing the manual `cleanup-stale-compose-state.sh` step. See §22 below for the exact sudoers entries.

### 19.3 Nginx config drift (storefront ignores recent template changes)

**Symptom.** A change to `nginx/client.conf.template` is pulled to the VPS via `git pull`, but the storefront's actual behaviour matches the old config (e.g. a new `auth_request` directive doesn't gate traffic, a new `location` block doesn't take effect, rate limits unchanged).

**Why.** The repo template is **not** the live config. Nginx reads from `/etc/nginx/sites-available/<client>.conf` (linked into `sites-enabled/`). A `git pull` updates the template but leaves the live file untouched until you explicitly sync it and reload nginx.

**Recovery.**

```bash
cd /var/www/<client>/backend

# Resolve placeholder values from .env (or set them explicitly).
export CLIENT_DOMAIN="$(grep -E '^STOREFRONT_URL=' .env | head -1 | cut -d= -f2- | sed -E 's,^https?://,,;s,/.*$,,')"
export STOREFRONT_PORT="$(grep -E '^STOREFRONT_PORT=' .env | head -1 | cut -d= -f2-)"
export BACKEND_PORT="$(grep -E '^BACKEND_PORT=' .env | head -1 | cut -d= -f2- || echo 3001)"

# Render the template with substituted values, then install:
envsubst '${CLIENT_DOMAIN} ${STOREFRONT_PORT} ${BACKEND_PORT}' \
  < nginx/client.conf.template \
  | sudo tee /etc/nginx/sites-available/${CLIENT_ID}.conf >/dev/null

# Sanity check: rendered config must not contain unsubstituted ${...} placeholders.
sudo grep -nE '\$\{[A-Z_]+\}' /etc/nginx/sites-available/${CLIENT_ID}.conf && \
  echo "FAIL: placeholders still unsubstituted — set the missing env vars and retry" || \
  echo "OK: all placeholders substituted"

sudo nginx -t && sudo systemctl reload nginx
```

If `nginx -t` fails, the previous config stays live (the `tee` overwrote the file but the running nginx process only re-reads on `reload`). Common causes: SSL certs at the rendered path don't exist (`certbot certonly` first), or `STOREFRONT_PORT` not set (rendered file has `127.0.0.1:` with empty port). Fix and retry.

**Why not just `cp template live` directly?** Doing that installs a file with literal `${CLIENT_DOMAIN}` strings, which fail nginx -t with `cannot load certificate /etc/letsencrypt/live/${CLIENT_DOMAIN}/fullchain.pem`. This was the May 2026 production incident behind parameterising the template — see HARDENING_HISTORY.md.

**Prevention.** Set `NGINX_AUTO_RELOAD=1` in the VPS `.env`. The CD script then renders the template via `envsubst`, diffs the rendered output against live, and auto-syncs + reloads on every deploy when they differ. The script also validates that the rendered file has no remaining `${...}` placeholders and aborts the deploy if it does (so a config with a missing env var never reaches nginx). Requires passwordless sudo for the runner user on `cp`, `nginx -t`, and `systemctl reload nginx`.

### 19.4 Manual `docker compose up` fails or leaves ghosts (missing prod overlay)

**Symptom.** Either:

- `docker compose -p <project> up -d backend workers` prints `Error response from daemon: failed to bind host port 0.0.0.0:5432/tcp: address already in use`, OR
- the command appears to succeed but on the next run the Dead-container ghosts from §19.2 start showing up.

**Why.** Without `-f docker-compose.prod.yml` (or `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` in `.env`), Compose uses only the base `docker-compose.yml` which declares an in-compose `postgres` service. That service tries to bind port 5432 — colliding with the host's native Postgres — leaks a half-initialised container as a Dead tombstone, and the cycle from §19.2 begins.

**Recovery + prevention.** Add both lines to `/var/www/<client>/backend/.env` (they're commented in `.env.example`):

```env
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
COMPOSE_PROJECT_NAME=<your CLIENT_ID>
```

After that, plain `docker compose up -d backend workers` Just Works — no `-f` or `-p` flags needed for either CD or manual ops. The CD script also passes them explicitly so it's unaffected by your local shell env, but every other invocation (incident debugging, log tailing, `docker compose exec`) benefits.

### 19.5 Storefront returns bare `nginx/1.x (Ubuntu)` 5xx (maintenance gate / maintenance.html)

**Symptom (pre-2026-05-26).** Hitting the storefront (`https://<domain>/`) returns the **bare Nginx default 500/503 page** — black on white, "5xx ..." headline + the Nginx version banner. The friendly maintenance page is NOT shown. Meanwhile `/ops` reaches its React shell ("Authenticating ops session…" loading state) because that location bypasses the maintenance gate.

**Symptom (post-2026-05-26 with the inline fallback).** With the inline fallback now present in `nginx/client.conf.template`, a missing `maintenance.html` no longer falls through to nginx's compiled-in page. You'll instead see a **minimal branded "We'll be back shortly"** page (`@maintenance_inline`). That's acceptable but **not the full styled experience** — for that the static file still needs to be installed on disk. Reproduce by deleting `/etc/nginx/maintenance/maintenance.html` and triggering maintenance: you should now see the inline page, not the bare nginx default.

**Why this happens.** The Nginx template wires every storefront/admin/`/api/` location to a subrequest gate. As of the 2026-05-26 fix (see `docs/HARDENING_HISTORY.md` "Maintenance gate bypass"), the canonical pattern is:

```nginx
location / {
  auth_request /_maintenance_gate;
  error_page 401 = @maintenance_block;
  proxy_pass http://127.0.0.1:3101;
}

# server-level — converts the auth_request 401 into a 503 that flows into
# `error_page 502 503 /maintenance.html;`
location @maintenance_block {
  internal;
  return 503;
}
```

The previous template (pre-2026-05-26) used `auth_request_set $maintenance_active …` + `if ($maintenance_active = "1") { return 503; }`, which was structurally broken — `if` runs in Nginx's REWRITE phase before `auth_request` populates the variable in the ACCESS phase, so the `if` never fired and traffic was never blocked. If you see that pattern in any live config, it is stale — re-render `nginx/client.conf.template` via `envsubst` (see §19.3 below) and reload.

Two distinct failure modes can produce a degraded maintenance experience:

| Failure | What happens (pre-2026-05-26) | What happens (post-2026-05-26 with `@maintenance_inline`) | What to look for |
|---|---|---|---|
| **A. Gate subrequest itself fails** (backend `/api/v1/maintenance/gate` times out, refuses connection, or returns a 5xx that isn't 401/403) | Nginx's `auth_request` semantics: any non-2xx-other-than-401/403 from the subrequest → return 500 directly to client. `error_page 502 503` does NOT fire on a 500. | Same — `error_page 502 503` still does not fire on a 500. The inline fallback only catches 502/503. | Nginx error log: `auth request unexpected status: 500` or `upstream timed out (110: Connection timed out) while reading response header from upstream, subrequest: "/_maintenance_gate"` |
| **B. Gate succeeds with 401 (maintenance active) OR upstream returns 502/503**, but `/etc/nginx/maintenance/maintenance.html` is missing | `error_page 502 503 /maintenance.html` fires → Nginx tries to serve the missing file → falls back to its compiled-in default 500 page. **Bare nginx 5xx page shown.** | `try_files $uri @maintenance_inline` inside `location = /maintenance.html` catches the missing file and routes to the inline fallback. **Minimal branded page shown — never the bare nginx default.** | Nginx error log: `open() "/etc/nginx/maintenance/maintenance.html" failed (2: No such file or directory)` (still emitted because nginx attempts the static file first; this is normal under the inline-fallback design). |

`/ops` works (loads HTML) because the `location ^~ /ops` block in the template doesn't call `auth_request` — it proxies directly to the Next.js frontend port. `/ops` then fetches `/api/v1/ops/session`, which also bypasses the gate via `location ~ ^/api/v1/ops/`. If the backend itself is slow or unhealthy, that fetch hangs and the React shell stays on "Authenticating ops session…" — same root cause, different presentation.

**Triage on the VPS** (copy-paste, expects to run from `/var/www/<client>/backend`):

```bash
cd /var/www/$(basename "$(pwd)" 2>/dev/null || echo raghava-organics)/backend 2>/dev/null || \
  cd /var/www/raghava-organics/backend

echo "=== 1. Container state ==="
docker ps -a --filter "label=com.docker.compose.project=raghava-organics" \
  --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

echo
echo "=== 2. Backend health (bypasses Nginx + gate) ==="
curl -sS -m 5 http://127.0.0.1:3001/api/v1/health | head -200 || echo "BACKEND UNREACHABLE on :3001"

echo
echo "=== 3. Maintenance gate direct (HTTP status is the answer; 401 = blocked, 200 = allowed) ==="
curl -sS -m 5 -D - -o /dev/null -H "X-Original-URI: /" \
  http://127.0.0.1:3001/api/v1/maintenance/gate \
  | grep -iE '^(HTTP|X-Maintenance-Active|date)'

echo
echo "=== 4. maintenance.html on disk ==="
ls -la /etc/nginx/maintenance/maintenance.html 2>&1

echo
echo "=== 5. Nginx error log (last 20 relevant lines) ==="
sudo tail -200 /var/log/nginx/error.log 2>/dev/null | \
  grep -iE 'maintenance|auth.?request|upstream|timed.?out' | tail -20

echo
echo "=== 6. Current MaintenanceState row (DB truth) ==="
DB_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed 's/host\.docker\.internal/127.0.0.1/')"
PGPASSWORD="$(echo "$DB_URL" | sed -E 's,^postgres(ql)?://[^:]+:([^@]+)@.*,\2,')" \
  psql "$(echo "$DB_URL" | sed 's/host\.docker\.internal/127.0.0.1/')" \
  -c "SELECT mode, phase, \"pendingUntil\", \"activatedAt\", reason, \"setAt\" FROM \"MaintenanceState\";" 2>/dev/null \
  || echo "(could not query DB directly — try via container: docker exec raghava-organics-backend npx prisma studio)"

echo
echo "=== 7. Quick backend log scan for gate errors ==="
docker logs raghava-organics-backend --tail 200 2>&1 | grep -iE 'maintenance|gate|error' | tail -20
```

**Interpreting the output:**

- **Step 2 fails / step 7 shows backend crashlooping** → backend is unhealthy. Look at the full `docker logs raghava-organics-backend` for the actual error (env mismatch, DB unreachable, migration not deployed, etc.). The gate route fails because the backend itself is failing. **Recovery:** fix the underlying issue; you may also need to `docker compose -p raghava-organics -f docker-compose.yml -f docker-compose.prod.yml restart backend`.
- **Step 3 returns `HTTP/1.1 401`** (with `X-Maintenance-Active: 1` for backward compat) → maintenance mode is active and Nginx **should** be serving the maintenance page. If the storefront still returns a bare 500, the cause is symptom B (missing `maintenance.html`) — install it (see §19.5 Recovery below). To exit maintenance mode, use the ops console: `POST /api/v1/ops/load-shed` with `mode: 'normal'` (OTP required).
- **Step 3 returns `HTTP/1.1 200` with `X-Maintenance-Active: 0`** → gate is healthy, maintenance is OFF, yet storefront still 500. Look harder at step 5 (Nginx error log) — likely an `upstream timed out` on the proxy to port 3101 (frontend), or a missing upstream entirely. Check `docker ps` for the frontend / PM2 process and whether `STOREFRONT_PORT` matches the nginx `proxy_pass` port.
- **Step 3 returns `HTTP/1.1 200` with `X-Maintenance-Active: 1`** → stale backend. This was the old gate contract (always 200) that we superseded on 2026-05-26. The running backend container is on a pre-fix image — rebuild with `docker compose -p raghava-organics build backend && docker compose -p raghava-organics up -d --force-recreate backend`. Until then Nginx will silently let traffic through during active maintenance.
- **Step 3 returns 5xx or times out** → backend's gate handler itself is broken. Symptom A. Check step 7 for the actual error in the backend logs.
- **Step 4 shows `ls: cannot access`** → `maintenance.html` is not installed on disk. Even if the gate is healthy right now, *any* future backend hiccup will surface as a bare 500 instead of the friendly page. **Install it now** (see Recovery below) — this is the fix that prevents this whole symptom from being incident-grade.

**Recovery.**

```bash
# 1. Install the static maintenance page so error_page → /maintenance.html resolves
#    to the FULL styled experience (instead of the minimal inline fallback).
#    Use the helper script — it validates source, creates the directory, copies
#    with the right permissions, and verifies the live nginx config references
#    the page. Idempotent.
cd /var/www/raghava-organics/backend
sudo bash scripts/install-maintenance-page.sh

# Or, equivalently, the underlying two commands the script wraps:
#   sudo mkdir -p /etc/nginx/maintenance
#   sudo cp nginx/maintenance.html /etc/nginx/maintenance/maintenance.html

# 2. If you're stuck in maintenance mode (step 3 above returned HTTP/1.1 401),
#    exit via the ops UI: POST /api/v1/ops/load-shed with mode='normal'. The ops
#    console at https://<domain>/ops/load-shed has the form for this. (You can
#    only do this from the ops console because the API requires OTP.)

# 3. If the backend is unhealthy and you want the storefront back NOW while you
#    debug the backend, you can temporarily DISABLE the maintenance gate by
#    commenting out the auth_request + error_page directives in the live nginx
#    config. The current canonical pattern (post-2026-05-26) has two lines per
#    gated location:
#
#      sudo sed -i.bak \
#        -e 's,^\(\s*auth_request\s*/_maintenance_gate;\),# &,' \
#        -e 's,^\(\s*error_page\s*401\s*=\s*@maintenance_block;\),# &,' \
#        /etc/nginx/sites-available/raghava-organics.conf
#      sudo nginx -t && sudo systemctl reload nginx
#
#    Pre-2026-05-26 configs used auth_request_set + if instead — if you find
#    those, also comment them out (they were never doing anything useful, but
#    leaving them in is confusing):
#      -e 's,^\(\s*auth_request_set\s*\$maintenance_active.*\),# &,' \
#      -e 's,^\(\s*if (\$maintenance_active = "1") { return 503; }\),# &,' \
#
#    To restore: `sudo cp /etc/nginx/sites-available/raghava-organics.conf.bak /etc/nginx/sites-available/raghava-organics.conf && sudo systemctl reload nginx`
#    NOTE: with the gate disabled the storefront will NOT serve the maintenance
#    page even if maintenance mode is active in the DB. Re-enable as soon as the
#    backend is healthy. Better: re-render client.conf.template via envsubst
#    (see §19.3) — that gives you a known-good config without any manual sed.

# 4. Reload nginx after any nginx config change
sudo nginx -t && sudo systemctl reload nginx
```

**Prevention.** The CD deploy script (§3.5 in `vps-deploy.sh`) now installs `maintenance.html` automatically on every deploy. As long as you grant the runner user the sudoers entries from §22 ("Maintenance page install" block), the file stays in sync with the repo and this symptom can't recur.

### 19.6 OTP/notification emails silently stop arriving (paused BullMQ queue)

**Symptom.** Operators stop receiving OTP emails (or admin/customer OTPs, order confirmations, refund alerts, technical failure emails) even though:
- `curl http://127.0.0.1:<BACKEND_PORT>/api/v1/health` reports `db: connected, redis: connected`
- `RESEND_API_KEY` and `RESEND_FROM` are present in both `backend` and `workers` container env (`docker exec <client-id>-backend env | grep RESEND_`)
- `OpsOtpChallenge` rows are being created in Postgres with status `PENDING`
- No error/warn lines appear in `docker logs <client-id>-backend` or `docker logs <client-id>-workers`

**Diagnose.** This is the queue-paused failure mode. Confirm with one shell loop:

```bash
for q in notifications order-processing shipping inventory-alerts refunds analytics cart-cleanup outbox-dispatch reconciliation dead-letter; do
  RESULT=$(docker exec <client-id>-redis sh -lc \
    "redis-cli -a \"\$REDIS_PASSWORD\" --no-auth-warning HGET bull:$q:meta paused" 2>/dev/null)
  if [ "$RESULT" = "1" ]; then echo "  $q: PAUSED"; else echo "  $q: ok"; fi
done
```

Any queue printed as `PAUSED` is the problem. The notifications queue is by far the most operationally painful one — the failure mode is silent because the alert path itself routes through the paused queue.

**Recover (immediate, no rebuild required).** Run the manual recovery script that ships inside the workers image:

```bash
docker exec <client-id>-workers node scripts/resume-paused-queues.js
```

The script calls BullMQ's `Queue.resume()` on every paused queue (which atomically clears `meta.paused` AND moves jobs from `bull:<q>:paused` back to `bull:<q>:wait`). Output reports `resumed`, `already running`, and `failed` per queue. Within seconds of the resume, any stuck OTP jobs will be processed and emails will start arriving — **note that the `OpsOtpChallenge` row has a 10-minute TTL, so any challenge older than 10 minutes has expired and the operator must request a fresh OTP from the ops console.** The script supports `--dry-run` (inspect state without resuming) and `--queues=a,b` (restrict to specific queue names).

**Self-heal (automatic, since May 26, 2026).** Every time the `workers` container starts, `bootstrapWorkers()` re-checks every drainable queue and auto-resumes any that are still paused before any `Worker` begins polling. Look for this log line on container boot:

```
Detected queues paused at boot — likely incomplete drain from a prior restart. Auto-resumed.
```

If you see that line right after starting workers, the previous restart left a queue paused and the worker has already recovered — no operator action required. If the auto-resume itself fails on any queue, the worker fires a terminal `WorkerBootQueueResumeFailed` technical alert (which CAN reach operators at that moment in the boot sequence because the alert is generated before the notifications Worker starts processing the queue).

**Root cause (for context).** The `scheduled-process-restart` and `maintenance-activation` flows in `cart-cleanup.worker.ts` both pause queues for drain, then resume them before exiting. If the application-layer `await q.resume()` resolves but the Redis Lua flush is clipped by `process.exit(0)` racing the round-trip, or if the resume-failure alert is itself enqueued onto the now-paused notifications queue and orphaned, the queue stays paused indefinitely. The new worker container boots but `bull:<queue>:meta paused = 1` is still set in Redis. Every subsequent `Queue.add(...)` lands jobs in `bull:<queue>:paused` instead of `bull:<queue>:wait`, and the workers correctly refuse to claim from the paused list.

**Forbidden.** **Never** "fix" a paused queue by running `HDEL bull:<queue>:meta paused` in `redis-cli` directly. That clears the `paused` flag in the meta hash but does NOT move jobs from `bull:<queue>:paused` back to `bull:<queue>:wait`. Workers will then poll `wait` (empty) while the parked jobs sit forever in `paused`. Always use `Queue.resume()` via the recovery script or Bull Board.

Full operator runbook lives in `OPS_CONTROL_PLANE_GUIDE.md` §9.2; architectural decision log in `DECISIONS.md` (`[2026-05-26] Worker boot self-heals paused queues`); incident write-up in `HARDENING_HISTORY.md`.

### 19.1 API error-code triage for frontend + VPS ops

Use this when frontend reports API failures after deployment.

| HTTP | `error.code` | First-response action (frontend) | VPS/operator checks |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Show field errors; block submit | Confirm frontend request schema matches `TRD.md` and route schema. |
| 401 | `TOKEN_EXPIRED` | Refresh once then retry once | Verify cookie domain/secure flags and `/api/v1/auth/refresh` behavior. |
| 401 | `UNAUTHORISED` / `INVALID_CREDENTIALS` | Re-authenticate user | Check auth headers/cookies forwarding through Nginx and backend env secrets. |
| 403 | `FORBIDDEN` | Hide/disable action | Verify JWT role/permission grants (`AdminPermissionGrant` or ops permissions). |
| 404 | `NOT_FOUND` | Show not-found state | Validate tenant data/IDs and route path correctness in frontend client. |
| 409 | `CONFLICT` | Refresh state and retry safe actions | Check CAS/idempotency conflicts; for identity flows, verify cross-domain email boundary (`User` vs `OpsUser`). |
| 422 | `PINCODE_NOT_SERVICEABLE` | Block checkout for that address | Verify shipping serviceability config/provider availability. |
| 429 | `RATE_LIMIT_EXCEEDED` | Backoff + cooldown UX | Inspect rate-limit policy and burst traffic from client/IP. |
| 500/502/503 | `INTERNAL_ERROR` (or upstream failure) | Show generic retry-safe error + support path | Inspect backend and worker logs, provider health, Redis/Postgres connectivity, and recent deploy/env changes. |

Operational notes:

- Frontend must branch on `error.code`, not free-form error message text.
- Webhook routes are provider-only ingress; never call `/api/v1/payments/webhook`, `/api/v1/shipping/webhook`, or `/api/v1/notifications/webhook/*` from browser clients.
- During incident triage, correlate frontend failure timestamps with backend logs and queue health before retrying destructive mutations.
- For webhook anomaly triage, inspect Prometheus metrics `webhook_events_total` and `webhook_processing_duration_seconds` by labels `provider`, `event`, and `result`:
  - invalid signature/token spikes -> `result="rejected"`
  - replay/dedupe activity -> `result="duplicate"`
  - enqueue pressure/failures -> `result="enqueue_failed"`

---

## 20. Migration note for existing `/srv/...` installs

If you currently deploy under `/srv/...`, standardize to `/var/www/...` on the next controlled maintenance window to align all runbooks and onboarding instructions with `ECOM_MASTER.md`. Keep symlinks temporarily if needed, but update systemd/nginx/deploy scripts to the `/var/www/...` canonical paths.

---

## 21. Doc map (read in this order for deployment)

1. `ECOM_MASTER.md` — §5 VPS layout, §12 per-client checklist, §11 security pipeline diagram  
2. `TRD.md` — §3 infrastructure, §4.2 plugin order, §7 API and webhooks, §10 queues  
3. `BRD.md` — §12 Phase 6 acceptance (maps to `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md`)  
4. `docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md` — **push-to-deploy** (one runner per client repo; Phase 7.6)  
5. Repo: `docker-compose.yml`, `Dockerfile`, `nginx/client.conf.template`, `.env.example`, `src/main.ts`, `queues/workers/`
6. `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` + `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md` — provider setup, dry-run, rotation, compromise drill, and evidence register

Next.js integration for storefront/admin is **`docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`**.

**Frontend delivery model requirement:** Before go-live, frontend/admin/ops delivery must follow **simultaneous build + integration via contract-first vertical slices**. UI-only page completion is not accepted as release evidence. Each slice must have: real backend route integration, permission-aware UX, `idempotency-key` on critical writes, and passing integration + UI tests. See `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §1.2 and `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` §8.1 for the mandatory gate checklist.

Canonical matrix note: route/control and permission ownership matrices remain canonical in `TRD.md`; this VPS guide intentionally references that source instead of duplicating full matrices.

---

## 22. Continuous Deployment (push-to-deploy via GitHub Actions)

> **Full step-by-step guide (use for every new client):** [`docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md`](GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md)  
> **Per-client filled checklist:** copy [`docs/templates/client-GITHUB_CD_SETUP.template.md`](templates/client-GITHUB_CD_SETUP.template.md) → `docs/clients/<client-id>/GITHUB_CD_SETUP.md`  
> **Onboarding phase:** `docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md` — Phase 7.6

This template ships with a **Vercel-like developer experience** on the client's own VPS: every `git push` to `main` on a **client GitHub repo** automatically deploys after CI passes.

**Mechanism:** Install **one self-hosted GitHub Actions runner per client repository** on that client's VPS. The runner **polls GitHub over outbound HTTPS (port 443)** — GitHub never opens an inbound connection to the VPS. Deploy jobs execute `vps-deploy.sh` and `vps-frontend-deploy.sh` locally on the server. **No SSH is required during deploys**; restrict port 22 to your office IP after the runner is Online.

**The pipeline is opt-in.** The backend template repo itself never deploys — set `VPS_DEPLOY_ENABLED=true` only on each **client** GitHub repository.

### How it works

```
git push origin main
  → Reliability CI runs all gates
      (monorepo: .github/workflows/reliability-ci.yml at repo root)
      (backend-only client repo: backend/.github/workflows/ci.yml)
  → if CI passes → deploy job queued on GitHub
      → self-hosted runner on VPS picks up job via outbound HTTPS (port 443)
      → git pull + SHA verification
      → docker compose build   (new image built; old containers still serve)
      → prisma migrate deploy on host with 127.0.0.1 DATABASE_URL override (see scripts/vps-deploy.sh — not bare npx on .env)
      → docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers   (container swap — ~3–5s window)
      → nginx maintenance page auto-serves during the window
      → health check: /api/v1/health (30 retries × 2s)
      → readiness gate: /api/v1/health/ready must be status=ready with runtimeConfigMissingKeys=[]
      → done ✅ (or deploy marked failed if health check times out)
```

No inbound connection is made to the VPS at any point. The runner pulls job instructions, executes `vps-deploy.sh` locally, and reports results back over the same HTTPS channel.

### One-time setup per client (VPS side)

Run once as the deploy user. The exact download URL and registration token are shown at **GitHub repo → Settings → Actions → Runners → New self-hosted runner** (token expires after 1 hour).

```bash
# Create runner directory
mkdir -p ~/actions-runner && cd ~/actions-runner

# Download the runner — use the exact version shown on the GitHub page
curl -o actions-runner-linux-x64.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.x.x/actions-runner-linux-x64-2.x.x.tar.gz
tar xzf ./actions-runner-linux-x64.tar.gz

# Configure with the registration token shown on the GitHub page
# --labels must include both 'self-hosted' AND a unique client label.
# The unique label prevents cross-client deploy misfires when multiple
# client runners share the same VPS (each repo targets its own runner).
./config.sh \
  --url https://github.com/<org-or-user>/<client-repo> \
  --token <REGISTRATION_TOKEN> \
  --name "<client-id>-vps" \
  --labels "self-hosted,<client-id>-vps" \
  --unattended

# Install as a systemd service so it survives VPS reboots
sudo ./svc.sh install
sudo ./svc.sh start

# Confirm it is online
sudo ./svc.sh status
```

After this, the runner shows as **Online** under **Settings → Actions → Runners** in the repo. Once confirmed, restrict SSH port 22 to your office CIDR — deploys no longer use SSH at all.

### One-time setup per client (GitHub repo side)

Go to **Settings → Secrets and variables → Actions** in the client's GitHub repo and add:

| Type | Name | Value |
|------|------|-------|
| Secret | `VPS_CLIENT_PATH` | `/var/www/<client-id>/backend` |
| **Variable** | `VPS_DEPLOY_ENABLED` | `true` |
| **Variable** | `VPS_RUNNER_LABEL` | `<client-id>-vps` (e.g. `greengrocer-vps`) |

> **Secrets vs Variables:** `VPS_DEPLOY_ENABLED` and `VPS_RUNNER_LABEL` must be *Variables* (not Secrets) because the workflow reads them via `vars.*` to control job routing and gating.

> **Multi-client VPS:** `VPS_RUNNER_LABEL` is critical when multiple clients share one VPS. Without it, GitHub may route GreenGrocer's deploy job to FreshMart's runner. Each client repo must set this to the unique label registered in `config.sh` above. The workflow warns (not fails) if unset, and falls back to the generic `self-hosted` label.

### Deploy flow details

| Step | What happens | Notes |
|------|-------------|-------|
| CI gate | Reliability CI must pass | Deploy never runs on CI failure |
| SHA verification | Script checks pulled SHA matches CI-validated SHA | Prevents race if another push lands mid-deploy |
| Migrations first | `prisma migrate deploy` runs before container swap | Migrations must be backward-compatible (additive) |
| Container swap | `docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers` | Host-Postgres prod overlay; uses `restart: unless-stopped` |
| Health check | 30 retries × 2s = 60s window | `/api/v1/health` must respond |
| Readiness gate | After health passes | `/api/v1/health/ready` must be `status=ready` with `runtimeConfigMissingKeys=[]` |
| Worker check | Verifies `workers` container is running | Emits warning (not hard failure) if workers are degraded |
| Image cleanup | `docker image prune -f` | Removes dangling images from previous builds |

### What is never touched by the pipeline

- `.env` on the VPS — secrets stay on VPS only; the pipeline has zero knowledge of them
- DB-overlay keys in `OpsConfigSecret` — unaffected
- Nginx config — not modified by deploy
- The `main` branch of the **template** repo — pipeline only runs on client repos where `VPS_DEPLOY_ENABLED=true`

### Runner maintenance

GitHub periodically deprecates old runner versions (approximately once or twice per year) and sends email warnings. When that happens, re-register on the VPS:

```bash
cd ~/actions-runner
sudo ./svc.sh stop
# Download new version, extract to same directory
./config.sh remove --token <REMOVAL_TOKEN>
./config.sh --url https://github.com/<org>/<repo> --token <NEW_TOKEN> --name "<client-id>-vps" --labels "self-hosted,<client-id>-vps" --unattended
sudo ./svc.sh install && sudo ./svc.sh start
```

This is the only ongoing maintenance cost of this approach (~5 minutes per client, once or twice per year).

### Optional: passwordless sudo grants for full self-healing CD

The deploy script (`vps-deploy.sh`) can fully self-heal two classes of state corruption in CD — Dead-container tombstones at `/var/lib/docker/containers/` (see §19.2) and Nginx config drift (see §19.3) — but only when it can run a few specific commands as root without interactive password prompts. Without these grants the script falls back to **warn + abort** behaviour: it tells the operator exactly which command to run manually, but won't fix things on its own.

If you want fully hands-off recovery, add this to `/etc/sudoers.d/<runner-user>` (e.g. `/etc/sudoers.d/deploy`). Use `visudo -f /etc/sudoers.d/deploy` so syntax errors don't lock you out:

```sudoers
# Replace <runner-user> with the username the GitHub Actions runner runs as
# (the user that owns ~/actions-runner — usually 'deploy' or 'ubuntu')

# Tombstone cleanup — required for §1.75 auto-recovery
<runner-user> ALL=(root) NOPASSWD: /usr/bin/rm -rf /var/lib/docker/containers/*

# Docker daemon restart — required only if you want fully automatic recovery
# from corrupted Compose project state (cleanup-stale-compose-state.sh's
# equivalent). Omit this if you prefer to do daemon restarts manually.
<runner-user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart docker

# Maintenance page install (every deploy) — required for the nginx error_page
# 502/503 → /maintenance.html mapping to actually find the file on disk.
# Without this grant the deploy logs a warning and the storefront falls back
# to nginx's bare default 500 page during any backend hiccup instead of the
# friendly maintenance page.
<runner-user> ALL=(root) NOPASSWD: /usr/bin/mkdir -p /etc/nginx/maintenance
<runner-user> ALL=(root) NOPASSWD: /usr/bin/cp /var/www/*/backend/nginx/maintenance.html /etc/nginx/maintenance/maintenance.html

# Nginx auto-sync — required only if NGINX_AUTO_RELOAD=1 is set in .env.
# vps-deploy.sh renders client.conf.template into a tmpfile under /tmp via envsubst,
# then copies the tmpfile to /etc/nginx/sites-available/*.conf (not the template directly),
# so the cp source pattern below intentionally matches /tmp/*.nginx.conf.
<runner-user> ALL=(root) NOPASSWD: /usr/bin/cp /tmp/*.nginx.conf /etc/nginx/sites-available/*.conf
# Also allow installing the rendered config on first deploy (initial install path).
<runner-user> ALL=(root) NOPASSWD: /usr/bin/cp /tmp/tmp.* /etc/nginx/sites-available/*.conf
<runner-user> ALL=(root) NOPASSWD: /usr/sbin/nginx -t
<runner-user> ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx
```

Then verify:

```bash
sudo -u <runner-user> sudo -n rm -rf /var/lib/docker/containers/nonexistent-test-path
# should exit 0 with no password prompt
```

**Security note.** These grants are scoped to specific commands with specific argument patterns — they don't give the runner user general root. The container-tombstone wildcard only matches paths under `/var/lib/docker/containers/`, which is already a directory only the runner needs to touch during the cleanup pass. The nginx grants are scoped to the project's own template path. Review the entries against your VPS user model before committing.

**If you don't grant these.** Both layers stay functional, just less convenient:

- §1.75 still detects tombstones and aborts the deploy with a clear "run `cleanup-stale-compose-state.sh`" message. That script needs sudo itself, so you'd run it directly as the deploy user (which has sudo via `sudo bash scripts/cleanup-stale-compose-state.sh`).
- Nginx drift detection runs in warn-only mode by default (no `NGINX_AUTO_RELOAD=1`), printing the exact `sudo cp + nginx -t + systemctl reload` command for the operator to run.

### Rollback procedure

```bash
# Option A: revert commit + push (pipeline re-runs automatically, redeploys previous code)
git revert HEAD
git push origin main

# Option B: manual on VPS (immediate, bypasses pipeline)
cd /var/www/<client-id>/backend
git checkout <previous-good-sha>
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend workers
```

### Downtime expectation

~3–5 seconds during `docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers`. The nginx maintenance page (`/etc/nginx/maintenance/maintenance.html`) is configured via `error_page 502 503` in the nginx config template and serves automatically during this window with a `Retry-After: 15` header and 15s auto-refresh.

For zero-downtime deploys, a blue-green or Docker Swarm approach would be required — outside the scope of the current single-VPS model.

---

### Frontend CD pipeline (Next.js + PM2)

For monorepo setups where the Next.js frontend lives alongside the backend in the same repository, the same self-hosted runner handles automated frontend deploys via PM2 — achieving **zero-downtime** hot swaps.

**How it works:**

```
git push origin main
  → CI passes
  → deploy-frontend job picked up by runner
  → vps-frontend-deploy.sh runs locally on VPS:
      → git pull + SHA verification
      → detect if frontend-relevant files changed (skips build if not)
      → npm ci + npm run build
      → pm2 reload <client-id>-frontend --update-env  (zero-downtime)
      → health check: http://127.0.0.1:<STOREFRONT_PORT>/
```

**Backend and frontend deploy independently.** Changing only a CSS file will not trigger `docker compose build`. Changing only a Prisma schema will not restart the frontend PM2 process.

#### One-time PM2 setup per client (VPS side)

Run once after the first manual frontend build:

```bash
cd /var/www/<client-id>/frontend

# Start the PM2 process (replace port with client's STOREFRONT_PORT, e.g. 3101)
pm2 start npm --name "<client-id>-frontend" -- start -- -p <STOREFRONT_PORT>

# Persist the process list (survives pm2 restarts)
pm2 save

# Install startup hook (survives VPS reboots)
pm2 startup
# Run the command that pm2 startup prints — it looks like:
# sudo env PATH=... pm2 startup systemd -u <user> --hp /home/<user>
```

After this, `vps-frontend-deploy.sh` uses `pm2 reload` for all subsequent deploys — zero downtime.

> **PM2 process name convention:** `<client-id>-frontend` (e.g. `foodstore-frontend`). The script auto-derives this from `CLIENT_ID` in the frontend `.env.local` file, or falls back to the parent directory name.

#### One-time GitHub repo setup (frontend)

Add to **Settings → Secrets and variables → Actions** in the client repo:

| Type | Name | Value |
|------|------|-------|
| **Variable** | `FRONTEND_DEPLOY_ENABLED` | `true` |
| Secret | `VPS_FRONTEND_PATH` | `/var/www/<client-id>/frontend` |

> **API-only clients:** Do not set `FRONTEND_DEPLOY_ENABLED`. The `deploy-frontend` job will remain dormant — only the backend job runs.
>
> **Critical type boundary:** `VPS_CLIENT_PATH` and `VPS_FRONTEND_PATH` must be configured as **Secrets** (workflow reads `secrets.*`), not Variables. If stored under Variables, deploy jobs fail at "Missing required secrets".

#### Frontend `.env.local` requirements

The script reads `CLIENT_ID` and `STOREFRONT_PORT` from `.env.local` (or `.env.production.local`) at `VPS_FRONTEND_PATH`. Ensure these are present:

```env
CLIENT_ID=foodstore
STOREFRONT_PORT=3101
```

Recommended bootstrap flow:

```bash
cd /var/www/<client-id>/frontend
cp .env.production.example .env.production.local
```

Then fill at minimum:
- `CLIENT_ID`
- `STOREFRONT_PORT`
- `NEXT_PUBLIC_API_BASE_URL` (`https://<domain>/api/v1`)
- `NEXT_PUBLIC_STOREFRONT_URL` (`https://<domain>`)
- `NEXT_PUBLIC_RAZORPAY_KEY_ID`

On shared/staging/production VPS also set:
- `OPS_UI_BASIC_AUTH_USERNAME`
- `OPS_UI_BASIC_AUTH_PASSWORD`

After first deploy/reload, verify using the values from `.env.production.local`:

```bash
OPS_USER="$(grep -E '^OPS_UI_BASIC_AUTH_USERNAME=' .env.production.local | cut -d= -f2- | tr -d '\r\"')"
OPS_PASS="$(grep -E '^OPS_UI_BASIC_AUTH_PASSWORD=' .env.production.local | cut -d= -f2- | tr -d '\r\"')"
curl -sS -o /dev/null -w "%{http_code}\n" -u "${OPS_USER}:${OPS_PASS}" "http://127.0.0.1:${STOREFRONT_PORT}/ops/setup"
```

Expected: `200` (or redirect). If you get `401`, rebuild/reload frontend after confirming env values and ensure latest `frontend/proxy.ts` is deployed (runtime env read).

Runtime env files are **never written by deploy scripts** — they must be placed on the VPS manually before first deploy, like backend `.env`.

#### Frontend downtime expectation

**Zero.** PM2 `reload` is graceful: a new worker process starts and begins accepting connections, the old worker drains its existing connections, then exits. Nginx routes to the port throughout — no maintenance page needed.

---

### Relevant files

| File | Purpose |
|------|---------|
| `.github/workflows/deploy.yml` | Deploy workflow at **repo root** for monorepos, or `backend/.github/workflows/deploy.yml` for backend-only repos. `runs-on: ${{ vars.VPS_RUNNER_LABEL \|\| 'self-hosted' }}` — jobs `deploy-backend` and `deploy-frontend` |
| `scripts/vps-deploy.sh` | Backend deploy script — Docker Compose build + migration + container swap |
| `scripts/vps-frontend-deploy.sh` | Frontend deploy script — Next.js build + PM2 zero-downtime reload |
| `scripts/vps-cleanup-template.sh` | **Template** for daily automated VPS cleanup (Docker, PM2, logs, cache) |
| `scripts/install-vps-cleanup.sh` | **Installer** for per-client cron cleanup (`/etc/cron.daily/vps-cleanup-<client>`) |
| `backend/docs/templates/scripts/install-github-runner.sh` | Reusable runner installer for client docs/scripts |
| `backend/docs/templates/scripts/verify-cd-status.sh` | Reusable VPS verification helper (runner/CD/PM2/Docker) |
| `backend/docs/templates/scripts/migrate-runner-directory.sh` | One-time legacy runner dir migration helper |
| `backend/docs/templates/scripts/phase9-github-cd-setup.sh` | Reusable preflight gate before enabling CD |
| `nginx/client.conf.template` | Nginx config with `error_page 502 503 /maintenance.html` |
| `nginx/maintenance.html` | Maintenance page served during the backend restart window |

---

### CD incident learnings (May 24, 2026)

- `deploy.yml` uses `vars.VPS_DEPLOY_ENABLED` / `vars.FRONTEND_DEPLOY_ENABLED` and `secrets.VPS_CLIENT_PATH` / `secrets.VPS_FRONTEND_PATH`; wrong placement silently skips or fails jobs.
- Self-hosted runner under systemd can have minimal PATH; VPS scripts must prefer project-local CLIs (`node_modules/.bin/*`) over global `npx`.
- Production backend image intentionally strips `npm`/`npx`; do not run `npx prisma generate` inside runtime containers.
- Runtime readiness (`/api/v1/health/ready`) is a hard gate. Missing Ops DB-overlay keys (`PAYMENT_PROVIDER`, `SMS_PROVIDER`, shipping provider credentials, strict tokens/allowlists) correctly fail deploy until Phase 8 config is complete.

---

## 12. Automated VPS cleanup (per client)

Multi-client VPS deployments accumulate disk space pressure from Docker images, build caches, PM2 logs, and frontend build artifacts. Each client should have an automated daily cleanup script installed.

### 12.1 Cleanup script template

**Template file:** `backend/scripts/vps-cleanup-template.sh`
**Installer:** `backend/scripts/install-vps-cleanup.sh`

The template is client-agnostic with placeholder variables:
- `{{CLIENT_ID}}` — client identifier (e.g., `raghava-organics`)
- `{{FRONTEND_PATH}}` — path to deployed frontend (e.g., `/var/www/raghava-organics`)
- `{{PM2_PROCESS_NAME}}` — PM2 process name (e.g., `raghava-organics-frontend`)

### 12.2 What the cleanup script handles

| Resource | Action | Safety |
|----------|--------|--------|
| Docker images | `docker system prune -f` (dangling only) | Running containers untouched |
| Docker build cache | `docker buildx prune --keep-storage 5GB` | Retains 5GB recent cache |
| PM2 logs | `pm2 flush <process-name>` | Client-scoped only |
| Next.js cache | Removes `.next/cache/*` | Rebuilds on next deploy |
| Old rotated logs | Deletes `.gz`/`.old` files >7 days | Preserves current logs |
| NPM cache | `npm cache clean --force` | Global cleanup |
| System journal | `journalctl --vacuum-size=200M` | Caps at 200MB |
| **Actions Runner** | Removes `_work/*` and `_tool/*` | Clears old build artifacts/downloads |

### 12.3 Installation (one-time per client)

Run during Phase 7 backend deploy or manually:

```bash
# On VPS, from backend directory
sudo ./scripts/install-vps-cleanup.sh \
  "raghava-organics" \
  "/var/www/raghava-organics" \
  "raghava-organics-frontend"
```

This creates `/etc/cron.daily/vps-cleanup-raghava-organics` which runs daily at 06:25 AM (system cron schedule).

### 12.4 Verification

```bash
# Check script exists and is executable
ls -la /etc/cron.daily/vps-cleanup-<client-id>

# Check log from last run
cat /var/log/vps-cleanup-<client-id>.log

# Manual test run
sudo /etc/cron.daily/vps-cleanup-<client-id>
```

### 12.5 Multi-client considerations

- **Docker cleanup is global** — affects all clients on the VPS. This is intentional; unused images/volumes benefit all clients.
- **PM2 log flush is client-scoped** — only touches the specified process name, leaving other clients' logs intact.
- **Install once per client** during initial deploy. The `phase7-backend-deploy.sh` script auto-installs this if the installer is present.

---

> **Starting a new client deployment?** Use **[`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](CLIENT_ONBOARDING_EXECUTION_ORDER.md)** as the top-level sequenced runbook. It covers all 13 phases (intake → credentials → VPS baseline → backend config → dry-runs → frontend build → VPS deploy → ops bootstrap → admin provisioning → frontend deploy → webhook registration → go-live validation → DNS cutover → post-handoff) with evidence gates and links back to this guide and every other canonical doc. Do not use this VPS guide alone to sequence a first-time deployment.

---

## Phase 7 live incident reference (May 2026)

If backend/workers enter restart loops during initial VPS bootstrap, use:

- `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md`

This incident playbook includes exact signatures and remediations for:
- Prisma CLI version mismatch (`npx prisma` pulling v7),
- host PostgreSQL routing from containers (`host.docker.internal` / bridge IP / `pg_hba.conf`),
- compose postgres bind conflict on `5432`,
- DB-overlay runtime config readiness gaps (surfaced via `/api/v1/health/ready` `runtimeConfigMissingKeys`),
- production-safe compose command sequence.
