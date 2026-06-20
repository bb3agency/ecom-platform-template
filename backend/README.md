# E-Commerce Backend Template

> **Production-grade, modular-monolith backend for Indian e-commerce.**
> Clone → configure → deploy. One template, unlimited clients.

> **Documentation lifecycle:** This README is a **build-time engineering/SOP document**. For post-development and post-go-live client operations, treat `docs/CLIENT_HANDOFF_INDEX.md` as the primary entrypoint.

![Node](https://img.shields.io/badge/Node-22+-339933?logo=node.js&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![BullMQ](https://img.shields.io/badge/BullMQ-5-FF6600)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

---

## Frontend Delivery Model (Mandatory)

For this backend, frontend development must follow **simultaneous build + integration** using **contract-first vertical slices**.

Do not complete all admin/storefront pages first and integrate API calls later.

Required slice flow:

1. freeze route contract + request/response schema,
2. implement typed API client methods,
3. implement UI states (`loading`, `empty`, `error`, `success`),
4. integrate with real backend module routes,
5. verify permissions + idempotency behavior,
6. close slice only when integration + UI tests pass.

Recommended sequence:

1. Foundation (`auth`, refresh, API client, `error.code` mapper, permission-aware nav)
2. Ops control surfaces (public `/ops/login` + `/ops/setup` only; console nav after session; session, load-shed including the durable `maintenance` mode with 2-min warning + Nginx-served static page, audit timeline)
3. Admin read surfaces (dashboard, orders read views, inventory read)
4. Admin mutation surfaces (status/ship/cancel/refund/stock/settings)
5. Reliability surfaces (reconciliation, inbox/outbox replay, queue visibility)
6. Storefront customer journey surfaces (catalogue, cart, checkout, order history/tracking, customer auth/profile)

Per-slice test gate:

- one route-level integration check against backend,
- one permission negative test (`401/403` handling),
- one idempotency/retry test for critical writes,
- one UI interaction test.

Canonical references:

- `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`
- `docs/MASTER_DEPLOYMENT_PLAYBOOK.md`
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`
- `docs/OPS_CONTROL_PLANE_GUIDE.md`
- `docs/ENV_VS_DB_CONFIG_REFERENCE.md`
- `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FASTIFY APPLICATION                          │
│  helmet → cors → jwt → rate-limit → multipart → swagger             │
│  prisma → redis → bullmq → observability → load-shed → modules      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │   Auth   │ │ Products │ │  Orders  │ │   Cart   │ │  Users   │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Payments │ │ Shipping │ │ Coupons  │ │ Reviews  │ │ Wishlist │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │Inventory │ │ Invoices │ │Dashboard │ │Analytics │ │Notifica- │   │
│  │          │ │          │ │          │ │          │ │  tions   │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                             │
│  │ Settings │ │   Ops    │ │  Health  │                             │
│  └──────────┘ └──────────┘ └──────────┘                             │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        WORKER CLUSTER                               │
│  order-processing · shipping · refunds · notifications              │
│  inventory-alerts · analytics · cart-cleanup · reconciliation       │
│  outbox-dispatch · dead-letter                                      │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                    │
    ┌────┴─────┐         ┌────┴────┐          ┌────┴────┐
    │PostgreSQL│         │  Redis  │          │ BullMQ  │
    └──────────┘         └─────────┘          └─────────┘
```

**Key Patterns:**

- **Modular Monolith** — Modules communicate through public service interfaces only. No internal cross-module imports.
- **Adapter Pattern** — Swapping payment/shipping/notification providers = zero code changes. In production, update provider selection and credentials via the Ops UI (`POST /api/v1/ops/config/save`), then restart containers — `applyOpsConfigRuntimeOverlay()` applies changes before provider init. Use `noop` adapters locally for E2E simulation without live credentials.
- **Client Isolation** — Each client deployment gets its own DB, Redis, Docker stack, and `.env`. Never shared.
- **Queue-First Side Effects** — All notifications, analytics, and background tasks run through BullMQ. Never synchronous in the request cycle.
- **System-Wide Failure Alerting** — Every `catch`/`log.error` path across modules, plugins, and workers emits structured email alerts via `sendTechnicalFailureAlert()`, sent to active Ops identities (`opsUser.isActive`) and verified Admin users (`User.role=ADMIN`, `isVerified=true`). Eight failure stages (`QUEUE_ENQUEUE`, `OUTBOX_DISPATCH`, `WORKER_TERMINAL`, `WORKER_DELIVERY`, `CORE_LOGIC`, `ROUTE_HANDLER`, `WEBHOOK_PROCESSING`, `PROVIDER_RUNTIME`) with full contextual metadata.
- **Per-Template Primary Notification Channel** — Each of the 13 notification templates has a configurable primary channel (`EMAIL`/`SMS`/`WHATSAPP`) stored in `StoreSettings.primaryNotificationChannels`. Configure via `PATCH /api/v1/admin/settings/notifications` (admin JWT — no merchant admin UI as of 2026-06-07; ops console manages provider availability). `send-primary` job routes to the configured channel with no fallback — if primary channel fails, notification fails and triggers alert.

---

## Local Development Quickstart (No-Confusion Setup)

### Step 1: Configure Environment

Copy `.env.example` to `.env` and set these **before starting Docker**.

> **Client repos:** change every value marked `# <-- SET THIS` before first boot. Do not copy template defaults verbatim.
>
> **Critical rules before first boot:**
> - `POSTGRES_DB` and the DB name in `DATABASE_URL` **must match exactly** and use **underscores only** (e.g. `raghava_organics`) — hyphens in DB names are invalid in PostgreSQL.
> - `REDIS_PASSWORD` must be **non-empty** — blank password causes `ECONNRESET`/`ECONNABORTED` loops in ioredis.
> - `REDIS_URL` must embed the same password: `redis://:yourpassword@localhost:6379`.
> - Once containers start, changing `POSTGRES_DB` or `POSTGRES_PASSWORD` requires `docker compose down -v` to wipe the volume before changes take effect.

```env
# ── Identity ────────────────────────────────────────────────────────────
# Used as Docker container name prefix. Must be unique per project.
CLIENT_ID=raghava-organics            # <-- SET THIS (slug, no spaces)

# ── Database ─────────────────────────────────────────────────────────────
# Decide NOW before first container start — changing later requires wiping volume.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=yourpassword         # <-- SET THIS
POSTGRES_DB=raghava_organics           # <-- SET THIS (underscores only — hyphens are invalid)
POSTGRES_PORT=5432
# URL-encode special chars in password (@ → %40, # → %23)
# DB name in URL must exactly match POSTGRES_DB above
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/raghava_organics  # <-- SET THIS

# ── Redis ────────────────────────────────────────────────────────────────
# NEVER leave REDIS_PASSWORD blank — blank value causes ECONNABORTED/ECONNRESET loops in ioredis
REDIS_PASSWORD=yourredispassword       # <-- SET THIS (non-empty)
REDIS_URL=redis://:yourredispassword@localhost:6379  # <-- SET THIS (password must match REDIS_PASSWORD)

# ── App ──────────────────────────────────────────────────────────────────
BACKEND_PORT=3000
NODE_ENV=development

# ── Bootstrap secrets (generate once, never rotate without a plan) ───────
JWT_SECRET=<64-char-hex>               # <-- SET THIS
JWT_REFRESH_SECRET=<different-64-char-hex>  # <-- SET THIS
OPS_DB_ENCRYPTION_KEY=<32-char-hex>    # <-- SET THIS
```

> **Generate secrets:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### Step 2: Start Infrastructure

```bash
# Windows CMD
cmd /c docker compose up -d postgres redis

# Verify containers are healthy
cmd /c docker ps
```

### Step 3: Verify DB Connectivity

```bash
# Replace <CLIENT_ID> with your CLIENT_ID value (e.g. raghava-organics)
cmd /c docker exec <CLIENT_ID>-postgres printenv POSTGRES_USER
cmd /c docker exec <CLIENT_ID>-postgres printenv POSTGRES_DB

# Test Prisma connection
cmd /c npx prisma migrate status --schema prisma/schema.prisma
```

**If you see P1000 Authentication Failed:**
```bash
# Password mismatch between .env and container volume — fix without wiping data:
cmd /c docker exec <CLIENT_ID>-postgres psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'yournewpassword';"
# Then update POSTGRES_PASSWORD and DATABASE_URL in .env to match.
```

### Step 4: Install Dependencies

```bash
npm install
```

> Optional manual fallback (only if you are not using `npm run dev:e2e` / `npm run dev:e2e:workers`):
> `cmd /c npx prisma generate` then `cmd /c npx prisma migrate dev`

### Step 5: Start Development Server

```bash
# Terminal 1: Backend
cmd /c npm run dev:e2e

# Terminal 2: Workers (in new window)
cmd /c npm run dev:e2e:workers
```

These startup scripts now fail-closed on Prisma bootstrap and automatically:
- create the target database from `DATABASE_URL` if missing,
- run `prisma generate`, and
- apply migrations via `prisma migrate deploy`.

This prevents first-clone worker/server boot failures such as `Database "ecom_template" does not exist`.

### Step 6: Verify Backend is Healthy

**Do not start frontend development until this passes.**

```bash
curl http://localhost:3000/api/v1/health
# Expected: {"success":true,"data":{"status":"ok","db":"connected","redis":"connected"}}
```

If `db` or `redis` shows `disconnected`:
- `db disconnected` → `DATABASE_URL` wrong or DB not migrated — re-run `npm run dev:e2e`
- `redis disconnected` → `REDIS_URL` / `REDIS_PASSWORD` mismatch — verify both match in `.env` then `docker compose down -v && docker compose up -d postgres redis`

### Troubleshooting Quick Reference

| Symptom | Quick Fix |
|---------|-----------|
| `P1000: Authentication failed` | Update password in container: `docker exec <CLIENT_ID>-postgres psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'YourPassword';"` then update `.env`. |
| Client repo still points to template DB (`ecom_template`) | Set `DATABASE_URL` to a client-specific DB name (for example `raghava_organics`) before first boot. |
| `Database "..." does not exist` on `npm run dev:e2e` / workers boot | Re-run `npm run dev:e2e` (or `npm run dev:e2e:workers`) after confirming `.env` `DATABASE_URL`; scripts now auto-create DB + run migrations. |
| `ECONNRESET` / `ECONNABORTED` Redis loop | `REDIS_PASSWORD` is blank or `REDIS_URL` doesn't embed the password. Set both, then `docker compose down -v && docker compose up -d postgres redis`. Transient `[ioredis] Unhandled error event` spam after password is correct usually means host cannot reach Redis — confirm dev compose publishes `6379:6379` (see `docker-compose.yml`; production overlay removes the port). |
| `POSTGRES_DB` has hyphens (e.g. `raghava-organics`) | PostgreSQL forbids hyphens in DB names. Rename to underscores (`raghava_organics`) in both `POSTGRES_DB` and `DATABASE_URL`, then `docker compose down -v && up -d` |
| `POSTGRES_DB` and `DATABASE_URL` DB name don't match | Both must be identical. Mismatch means migrations run against a different DB than the one Postgres initialized. Fix both and `docker compose down -v`. |
| `DATABASE_URL is not set` in scripts | Scripts auto-load from `.env` now; or set explicitly: `set DATABASE_URL=postgresql://...` |
| `Variant not found` in flash-sale tests | Run: `node scripts/seed-flash-sale-fixtures.js` |
| OTP/notification emails silently stop arriving despite healthy `db: connected, redis: connected` and `RESEND_API_KEY` loaded | A `notifications`/`outbox-dispatch` queue is paused in Redis after an incomplete `system-restart` or `maintenance-activation` drain. Verify with `docker exec <client-id>-redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning HGET bull:notifications:meta paused'` (returns `1` if paused). Recover with `docker exec <client-id>-workers node scripts/resume-paused-queues.js`. Workers also self-heal on every boot since May 26, 2026 — see `docs/CLIENT_VPS_SETUP_GUIDE.md` §19.6 and `docs/OPS_CONTROL_PLANE_GUIDE.md` §9.2 for the full runbook. |

**See `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` Appendix H for full troubleshooting guide.**

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | ≥ 22 | Runtime |
| **Docker** & **Docker Compose** | Latest | PostgreSQL, Redis, application containers |
| **Git** | Latest | Version control |

---

## Quick Start (Local Development)

Use the canonical section: **`Local Development Quickstart (No-Confusion Setup)`** in this file.

That section is the single source for:
- env/bootstrap setup,
- infra startup,
- migration/generate flow,
- server/worker startup,
- health verification.

---

## Project Structure

Minimal map:

```text
src/             core app + modules
queues/          worker runtime
prisma/          schema + migrations
scripts/         CI/reliability gates — see scripts/README.md
docs/            runbooks/checklists
observability/   SLO rules + test rules
nginx/           reverse-proxy template
```

Full architecture and module map: `ECOM_MASTER.md`.

---

## New Client Setup

Canonical runbooks:
- `docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md` (authoritative phase order)
- `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` (implementation SOP)
- `docs/CLIENT_VPS_SETUP_GUIDE.md` (VPS steps)

Quick sequence:
1. Clone template into client project.
2. Fill `.env` from `.env.example` with **Phase 1 bootstrap keys only** (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `OPS_DB_ENCRYPTION_KEY`, `RESEND_API_KEY`, etc.). Provider credentials and ops-security keys are provisioned via Ops UI after first ops login. See `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md` for the full two-phase model.
3. Start infra (`docker compose up -d postgres redis`).
4. Install, generate, migrate.
5. Start API + workers and validate health.
6. Bootstrap ops user (`npm run ops:newuser`), then provision DB-overlay keys via Ops UI (`POST /api/v1/ops/config/save`), then restart containers.
7. Complete go-live checklists before promotion.

---

## Development Workflow

### Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start API server (hot-reload) |
| `npm run dev:workers` | Start worker cluster (hot-reload) |
| `npm run typecheck` | TypeScript strict check — **run after every change** |
| `npm run lint` | ESLint check |
| `npm run format` | Prettier format |
| `npm run test:unit` | Vitest unit tests |
| `npm run test:e2e` | Supertest integration tests |
| `npm run test:security` | Security-focused tests |
| `npm run test:guardrails` | Governance script tests |
| `npm run ci:reliability-gates` | Full CI pipeline (all checks) |

### Production Readiness Gate (CMD)

Before promoting to `staging`/`production`, run these in **Windows CMD** from repo root:

```cmd
cmd /c npm run typecheck
cmd /c npm run test:unit
cmd /c npm run test:e2e
cmd /c npm run test:security
cmd /c npm run test:guardrails
cmd /c npm run build
cmd /c npx prisma validate --schema prisma/schema.prisma
cmd /c npm run prisma:generate:safe
cmd /c npm run edge:drift-check
cmd /c npm run release:policy-state
cmd /c npm run release:guard
cmd /c npm run test:slo-rules
cmd /c npm run stress:flash-sale:api:matrix
cmd /c npm run parity:scorecard
```

Expected result for release sign-off:
- All commands above exit `0`.
- `release:guard` prints `Reliability release guardrail passed.`
- `prisma validate` confirms schema validity.
- `test:guardrails` passes `admin-layer-drift-check`, `docs-runtime-drift-check`, and `config-runtime-parity-check`.
- `stress:flash-sale:api:matrix` does not fail invariant enforcement (including fixture precondition checks).
- App startup in production-like profiles now **fails fast** if `PAYMENT_PROVIDER=noop`, no shipping provider credentials are set (Delhivery or Shiprocket), provider/auth secrets use placeholder values (`replace_with_*`, `change_me*`, `<...>`), or required webhook allowlists are missing. `SHIPPING_PROVIDER` env var is ignored — provider detection is credential-based.
- Release evidence includes completed `docs/BACKEND_GO_LIVE_CHECKLIST.md` (full env + implementation parity) and `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`.

`NODE_ENV` profile mapping used by backend startup guards:

| `NODE_ENV` value | Runtime profile | Guard behavior |
|---|---|---|
| `development` | development-like | `noop` providers allowed for local simulation |
| `test` | development-like | `noop` providers allowed for tests/simulations |
| anything else (`production`, `staging`, `qa`, `uat`, custom values) | production-like | `noop` providers blocked; placeholder secrets blocked |

> Future-proof rule: if `NODE_ENV` is unknown/custom, backend treats it as **production-like** (safe default).

> `npm run test:slo-rules` may print `promtool not found locally ... Skipping ...` on developer machines. This is acceptable outside CI where `promtool` is provisioned.

### Scheduled Background Jobs

The worker cluster runs these recurring jobs automatically via BullMQ job schedulers:

| Job | Queue | Schedule | Purpose |
|-----|-------|----------|---------|
| `check-low-stock` | `inventory-alerts` | Every 1 hour | Detect variants below low-stock threshold |
| `delete-expired-guest-carts` | `cart-cleanup` | Daily 2 AM | Remove anonymous carts past TTL |
| `release-expired-reservations` | `cart-cleanup` | Every 60 seconds | Free inventory held by expired cart reservations |
| `purge-expired-idempotency-records` | `cart-cleanup` | Daily 3 AM | Delete idempotency records past 24h TTL |
| `purge-expired-refresh-tokens` | `cart-cleanup` | Daily 3 AM | Delete expired JWT refresh token rows |
| `purge-published-outbox-messages` | `cart-cleanup` | Weekly Sunday 4 AM | Delete outbox messages published >7 days ago |
| `publish-pending` | `outbox-dispatch` | Every 10 seconds | Relay pending outbox messages to BullMQ |
| `run-order-lifecycle-check` | `reconciliation` | Every 1 hour | Detect stuck orders and reconciliation anomalies |

### After Prisma Schema Changes

```bash
npx prisma generate         # Regenerate client
npx prisma migrate dev      # Create and apply migration
```

### Common Setup Troubleshooting

1. **Prisma connects to `ecom_template` instead of your client DB:**
   If you ran `docker compose up` before setting `POSTGRES_DB` in your `.env`, Docker created the default template database.
   *Fix:* Update your `.env`, run `docker compose down -v`, then `docker compose up -d postgres redis`.

2. **`Cannot find module ... wasm-base64.js` after migration:**
   This is a known Windows glitch when `node_modules` gets out of sync. If the CLI says "Your database is now in sync", the migration succeeded.
   *Fix:* Run `npx prisma generate` to fix the missing module.

---

## Git Branching Strategy

Trunk-based with environment branches:
- `main` (trunk)
- `feature/*`, `fix/*` (short-lived)
- `staging` (pre-prod)
- `production` (live)

Release rule: PR to `main` -> pass reliability gates -> promote `main` to `staging` -> promote `staging` to `production`.

Commit style: Conventional Commits (`feat|fix|refactor|docs|test|chore|perf`).

---

## CI/CD Pipeline

### Deployment Pipeline (GitHub Actions)

On every push to `main` that passes the Reliability CI workflow, `.github/workflows/deploy.yml` runs two independent jobs on the VPS via a self-hosted runner:

| Job | What it does |
|-----|-------------|
| `deploy-backend` | Runs `vps-deploy.sh` — Docker Compose rebuild, Prisma migrations, container swap, nginx config re-render + reload, BuildKit cache trim, health check |
| `deploy-frontend` | Runs `vps-frontend-deploy.sh` — `git pull`, change detection, `npm ci`, `npm run build`, `pm2 reload` (zero-downtime) |

**Required GitHub repo configuration per client:**

| Item | Type | Value |
|------|------|-------|
| `VPS_DEPLOY_ENABLED` | Variable | `true` |
| `FRONTEND_DEPLOY_ENABLED` | Variable | `true` |
| `VPS_RUNNER_LABEL` | Variable | Unique per-client label (e.g. `greengrocer-vps`) |
| `VPS_CLIENT_PATH` | Secret | `/var/www/<client-id>/backend` |
| `VPS_FRONTEND_PATH` | Secret | `/var/www/<client-id>/frontend` |

**Setup guide:** [`docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md`](docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md) (full checklist) · [`docs/CLIENT_VPS_SETUP_GUIDE.md`](docs/CLIENT_VPS_SETUP_GUIDE.md) §22 (summary)

**Monorepo client repos** (e.g. `backend/` + `frontend/` at root): workflows must live at **repository root** `.github/workflows/reliability-ci.yml` and `deploy.yml`. Backend-only repos use `backend/.github/workflows/`.

#### Manual deploy (incidents, hotfixes, runner offline)

The auto-deploy path above is the default — every `git push origin main` that passes CI re-deploys the VPS without anyone touching SSH. When you need to bypass that path (debugging the deploy script itself, the self-hosted runner is offline, or you need to ship a hotfix without going through CI), invoke the **same script** manually on the VPS as your normal user (not `sudo` — the script `sudo`s internally for the steps that need it):

```bash
cd /var/www/<client-id>/backend
bash scripts/vps-deploy.sh /var/www/<client-id>/backend "$(git rev-parse HEAD)"
```

The script is identical to what the runner executes — it pulls latest `main`, rebuilds containers, runs Prisma migrations, re-renders `nginx/client.conf.template` via `envsubst` and reloads nginx if drift is detected, prunes Docker images, trims BuildKit cache, and reports readiness. The only thing the manual path doesn't give you is the CI gate (typecheck + unit + e2e + security + reliability gates must pass before auto-deploy fires; manual deploy will happily ship whatever HEAD points at). For that reason, **prefer push-to-main auto-deploy as the default**; manual deploy is the escape hatch.

If `git pull` inside the script prompts for credentials, your VPS user's git credential helper isn't configured. GitHub deprecated password auth in 2021 — use a Personal Access Token (PAT) stored via `git config --global credential.helper store` or switch the remote to SSH with a deploy key (`docs/CLIENT_VPS_SETUP_GUIDE.md §22` covers both).

### Quality Pipeline

The `npm run ci:reliability-gates` command runs the full quality pipeline:

1. **TypeScript** — Strict type checking
2. **Unit Tests** — With coverage (ratcheted — can only increase)
3. **E2E Tests** — API integration tests via Supertest
4. **Security Tests** — Auth, webhook, permission boundary tests
5. **Guardrail Tests** — Governance script validation
6. **Route Discipline** — Ensures all routes follow conventions; explicit exemptions are limited to public one-time invite consumption/setup endpoints (`POST /api/v1/admin/invites/consume`, `POST /api/v1/ops/invites/consume`, `POST /api/v1/admin/invites/setup/send-otp`). Ops-gated admin invite management routes (`/api/v1/ops/admin-invites*`) require no exemption — they are auto-detected as ops-guarded.
7. **Serializer Exposure** — Prevents internal field leaks in API responses
8. **Build** — Production TypeScript compilation
9. **Admin Contract** — Validates admin permission registry integrity; this smoke requires a running backend at `BASE_URL` (default `http://127.0.0.1:3000`) with seeded/known admin credentials, so local `fetch failed` at this step means the environment is not running rather than a TypeScript/build defect
10. **Endpoint Smoke** — Deep endpoint reachability check
11. **Release Policy** — Validates release readiness state
12. **Release Guard** — Final gate before deployment
13. **SLO Rules** — Prometheus alerting rule validation
14. **Edge Policy Drift** — Edge security policy consistency
15. **DR Drill** — Disaster recovery checklist verification
16. **Stress Tests** — Flash sale contention scenarios (4 attack patterns) with strict invariant enforcement; API runs fail if fixture preconditions are not met (for example, all requests rejected at client layer)
17. **Parity Scorecard** — Cross-cutting quality scoring

---

## Dependency Management & Dependabot

- Critical dependencies are pinned for reproducible client bootstraps.
- Dependabot PRs are expected; treat major-version PRs as manual migrations.
- Merge minor/patch updates only when CI is green.
- Red Dependabot CI on major bumps usually indicates incompatibility in proposed upgrade, not template instability.

---

## Key Documentation

| Document | Purpose |
|----------|---------|
| [`docs/DOC_CONTEXT_MAP.md`](docs/DOC_CONTEXT_MAP.md) | **Low-noise context entrypoint** — what to load first during development vs post-development |
| [`docs/CLIENT_HANDOFF_INDEX.md`](docs/CLIENT_HANDOFF_INDEX.md) | **Post-development primary entrypoint** — use this first for client handoff and ongoing operations |
| [`ECOM_MASTER.md`](ECOM_MASTER.md) | **Source of truth** — Architecture, module design, phase plan |
| [`TRD.md`](TRD.md) | Technical Reference — API routes, error codes, Prisma schema |
| [`docs/API_ENDPOINT_INDEX.md`](docs/API_ENDPOINT_INDEX.md) | Canonical low-noise endpoint index mapped to frontend/admin/ops UI surfaces |
| [`BRD.md`](BRD.md) | Business Requirements — Features, user stories, acceptance criteria |
| [`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md) | **Start here for new clients** — 14-phase dev-first runbook: Phases 0–5 entirely on dev laptop (intake → credentials → backend config → provider dry-runs → frontend build → **full local integration testing gate**) → Phases 6–14 on VPS (provision → deploy → ops → admin → frontend → webhooks → go-live validation → DNS → handoff) |
| [`CO_DEVELOPMENT_SYNC_GUIDE.md`](CO_DEVELOPMENT_SYNC_GUIDE.md) | Canonical backend co-development upstream SOP (Flow A/Flow B, classification, safety checks) |
| [`docs/MASTER_DEPLOYMENT_PLAYBOOK.md`](docs/MASTER_DEPLOYMENT_PLAYBOOK.md) | Build-time engineering playbook (internal SOP) |
| [`docs/CLIENT_VPS_SETUP_GUIDE.md`](docs/CLIENT_VPS_SETUP_GUIDE.md) | VPS provisioning step-by-step |
| [`docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`](docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md) | **Phase 1/2 setup model** — bootstrap keys vs Ops UI config, ops-newuser flow |
| [`docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md`](docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md) | Live-incident Phase 7 runbook — strict env preflight, Prisma version pinning, host-Postgres routing, and crash-loop triage |
| [`docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md`](docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md) | Pre-launch validation checklist |
| [`docs/OPS_CONTROL_PLANE_GUIDE.md`](docs/OPS_CONTROL_PLANE_GUIDE.md) | Detailed ops control plane setup, API usage, and frontend integration flow |
| [`docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`](docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md) | Provider account setup, env mapping, and API key lifecycle runbook |
| [`docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`](docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md) | Per-client credential ownership and lifecycle template |
| [`docs/BACKEND_GO_LIVE_CHECKLIST.md`](docs/BACKEND_GO_LIVE_CHECKLIST.md) | Backend production go-live checklist (reuse per client) |
| [`docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`](docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md) | Frontend AI integration go-live checklist |
| [`docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`](docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md) | Next.js frontend integration reference |
| [`docs/CLIENT_DEV_LOG_TEMPLATE.md`](docs/CLIENT_DEV_LOG_TEMPLATE.md) | **Copy to `client-<id>/CLIENT_DEV_LOG.md` at Phase 0** — primary persistent context log for Phases 0–5: backend config, Phase 1 credentials, Phase 2 validation, Phase 3 dry-runs, Phase 4 frontend milestones, Phase 5 gate sign-off |
| [`docs/FRONTEND_DEV_LOG_TEMPLATE.md`](docs/FRONTEND_DEV_LOG_TEMPLATE.md) | **Copy to `frontend/docs/FRONTEND_DEV_LOG.md` at Phase 4 start** — frontend slice-level tracker for all 6 build tiers |
| [`docs/CLIENT_VPS_DEPLOYMENT_LOG_TEMPLATE.md`](docs/CLIENT_VPS_DEPLOYMENT_LOG_TEMPLATE.md) | **Copy to `client-<id>/CLIENT_VPS_DEPLOYMENT_LOG.md` at Phase 6 start** (only after Phase 5 cleared) — VPS deployment progress log for Phases 6–14; phase-by-phase checklist |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Architectural decision log |
| [`docs/postman/E2E-FLOW-TEST-LOG.md`](docs/postman/E2E-FLOW-TEST-LOG.md) | Postman E2E simulation guide & failure-mode log |
| [`.env.example`](.env.example) | Complete environment variable reference (90+ vars) |
| [`starter-prompt.md`](starter-prompt.md) | Build-time AI prompting playbook (internal SOP, not client-facing handoff doc) |
| [`frontend-agent-rules.md`](frontend-agent-rules.md) | Build-time Antigravity rules file — copy to frontend `.agents/rules/dev-rules.md` |
| [`.agents/rules/dev-rules.md`](.agents/rules/dev-rules.md) | Antigravity rules for this backend repo |

---

## E2E Simulation (Postman — no live credentials needed)

The bundled Postman collection validates the full order lifecycle end-to-end without requiring real Razorpay or shipping provider accounts.

**Covers:** admin seed → Raj prepaid order + Razorpay webhook → Ramu COD order → admin ship both → shipping webhooks → DELIVERED + COD auto-capture.

### Terminal 1 — Server

```cmd
npm run dev:e2e
```

### Terminal 2 — Workers

```cmd
npm run dev:e2e:workers
```

> Both scripts (`scripts/dev-up.cmd` and `scripts/dev-up-workers.cmd`) are idempotent and handle: auto-starting `ecom-postgres`/`ecom-redis` containers, waiting for Redis health, ensuring Prisma DB exists, running Prisma generate+migrations, killing stale Node processes on port 3000, and setting all noop/E2E env vars. They are the **permanent fix** for recurring local startup errors (`ECONNREFUSED`, `EADDRINUSE`, missing target DB).

### Terminal 3 — Frontend (monorepo)

```cmd
cd ..\frontend
npm run dev
```

> Frontend `npm run dev` runs `scripts/ensure-backend-dev.mjs` first and exits if the API on `BACKEND_PROXY_URL` (default `127.0.0.1:3000`) is unreachable. See `frontend/README.md` and `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §1.0.1.

### Postman setup

1. Import `docs/postman/E2E-Flow-Simulation.postman_collection.json`
2. Import `docs/postman/E2E-Sim-Env.postman_environment.json`
3. Select **E2E Sim Env** environment
4. Run folders in order: **0 → 1 → 2 → 3**

**Key notes:**
- Shipment dispatch is manual-only: payment confirmation does not auto-create shipment jobs.
- Admin must trigger `POST /api/v1/admin/orders/:id/ship` (or click Ship Order in admin UI) to create shipment/AWB.
- Shipping webhook token validation is relaxed only when no shipping provider credentials are configured (noop mode — empty `DELHIVERY_API_KEY` and no Shiprocket credentials), where any non-empty auth header is accepted for simulation. In production, Shiprocket sends the token via `x-api-key` header (per official docs); the backend also accepts `Authorization: Bearer` as a fallback. Delhivery uses `Authorization: Token`.
- Order idempotency keys are timestamp-based — each run creates fresh orders; re-running the full sequence is safe.
- Without workers: all tests PASS with warnings; Raj's order stays at `PENDING_PAYMENT` so ship step (3.4) returns `409` warning instead of `200`.
- With workers + restarted server: all steps return `200`; final board shows both orders `DELIVERED`.

See [`docs/postman/E2E-FLOW-TEST-LOG.md`](docs/postman/E2E-FLOW-TEST-LOG.md) for per-step assertion details, environment variable chain, failure-mode table, and complete fix history.

> ⚠️ `PAYMENT_PROVIDER=noop` must **never** be set in production `.env`. For shipping, at least one provider's credentials (Delhivery or Shiprocket) must be configured. `SHIPPING_PROVIDER` is not a valid env var.

---

## Environment Variables

All configuration starts from `.env`, then non-bootstrap Ops-managed runtime keys can be overlaid from encrypted `OpsConfigSecret` rows after restart. The template uses **zero hardcoded production values** — every external dependency, secret, and feature flag is environment/contract-driven. `DATABASE_URL`, initial `REDIS_URL`, and `OPS_DB_ENCRYPTION_KEY` are bootstrap-only real environment values. Merchant admin provisioning is invite-only through `POST /api/v1/admin/invites` and `/admin/setup`, not production seeding.

Categories (see `.env.example` for full details):

| Category | Key Variables |
|----------|--------------|
| **Core Runtime** | `NODE_ENV`, `PORT`, `CLIENT_ID` |
| **Infrastructure** | `DATABASE_URL`, `REDIS_URL`, `STOREFRONT_URL` |
| **Auth** | `JWT_SECRET`, `JWT_REFRESH_SECRET` (both fail-fast on missing/empty — `resolveRefreshSecret()` in auth service, `requireEnv()` in config) |
| **Payments** | `PAYMENT_PROVIDER` (`razorpay`/`cod`/`noop`; unrecognised values rejected at startup), `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (Razorpay keys required only when `PAYMENT_PROVIDER=razorpay`) |
| **Shipping** | `DELHIVERY_API_KEY`, `DELHIVERY_WEBHOOK_TOKEN`, `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_WEBHOOK_TOKEN` — provider detection is credential-based; both can be active simultaneously (cheapest rate wins at checkout). `SHIPPING_PROVIDER` is ignored. |
| **Notifications** | `RESEND_API_KEY`, active SMS provider key (`MSG91_AUTH_KEY` when `SMS_PROVIDER=msg91` or `FAST2SMS_API_KEY` when `SMS_PROVIDER=fast2sms`), channel toggles (`NOTIFY_*`). Provider keys are fail-fast at startup when respective channel is enabled; MSG91 input phones are normalized to `91XXXXXXXXXX`. Merchant SMS templates can be stored in `StoreSettings.smsTemplates` (DB-backed) and override defaults at runtime. |
| **Invoice Storage** | `INVOICE_STORAGE_ROOT` |
| **Feature Flags** | `FEATURE_COUPONS_ENABLED`, `FEATURE_REVIEWS_ENABLED`, `FEATURE_RESPONSE_ENVELOPE_ENABLED`, etc. |
| **Flash-Sale** | `HOT_SKU_VARIANT_IDS`, `HOT_SKU_SHARD_COUNT`, `HOT_SKU_ADMISSION_BUDGET_PER_MINUTE` |
| **Security** | webhook allowlists, rate limits |
| **Observability** | `OTEL_TRACING_ENABLED`, `OTEL_EXPORTER_OTLP_HEADERS`, `OPS_METRICS_TOKEN` |

> **Strict Profile:** In production-like runtime (`NODE_ENV` not `development`/`test`), additional variables become mandatory (metrics token, webhook tokens/allowlists). The application will refuse to start if they're missing.

Invoice access contract:
- Customer invoice PDF download: `GET /api/v1/orders/:id/invoice.pdf` (authenticated, order-owner only)
- Admin invoice PDF download: `GET /api/v1/admin/orders/:id/invoice.pdf` (authenticated admin with `orders:read`)
- Order payloads expose invoice metadata via `invoice.hasPdf` and do not expose direct/public invoice URLs.

Ops encrypted config contract:
- `POST /api/v1/ops/config/save` persists values in encrypted `OpsConfigSecret` storage.
- `OPS_DB_ENCRYPTION_KEY` must be configured from real deployment environment; save and runtime overlay fail closed when missing.
- The Ops config contract is the source of truth for what the Ops UI may edit (`src/modules/ops/ops-config-contract.ts`).
- Bootstrap-only keys (`DATABASE_URL`, initial `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY`) are read-only in Ops config and must come from real environment before DB config can be loaded.
- DB-stored values override real env only for contract-allowed non-bootstrap runtime keys after process restart.
- These changes are DB-backed encrypted runtime overlays and require application restart to take effect because all current contract entries are `requiresRestart: true`.

---

## Hard Constraints

These rules are **non-negotiable** across all client deployments:

| Rule | What It Means |
|------|---------------|
| **Money = `Int` paise** | No `Float`, `Decimal`, or rupee strings. `9950` = ₹99.50 |
| **UUID v4 primary keys** | No sequential integers exposed in any API response |
| **OrderItem snapshots** | Set once at creation — never updated after |
| **Atomic orders** | `prisma.$transaction()` — all or nothing |
| **Webhooks** | HMAC verification → Redis idempotency → BullMQ enqueue → `200 OK` |
| **Notifications** | BullMQ only — never synchronous in request cycle |
| **Refresh tokens** | bcrypt hash in DB — never raw token storage |
| **Request schemas** | `additionalProperties: false`, `maxLength` on all strings |
| **TypeScript** | `strict: true`, no `any` without inline justification |
| **Product deletes** | Soft delete only (`isActive = false`) — hard deletes corrupt order history |
| **Secrets** | `.env` only — never in source code, never in Git |

---

> **Note:** This template currently includes AI agent rules for **Antigravity** only (`.agents/rules/dev-rules.md` for backend, `frontend-agent-rules.md` for frontend). Cursor-specific `.cursor/rules/*.mdc` files are not included — refer to `starter-prompt.md` §3 for Cursor IDE setup instructions if needed.

## License

Proprietary — this template is internal to the agency. Each client deployment is licensed separately.
