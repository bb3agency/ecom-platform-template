# ECOM_MASTER.md
## E-Commerce Backend Template — Supreme Architecture Document

> **This is the source of truth.**  
> Every TRD, BRD, ADR, and implementation decision traces back to this file.  
> If it isn't here, it isn't decided. If it's here, it isn't up for debate.

**Prepared by:** Freelance Developer — Hyderabad, India  
**Stack Version:** v2.0  
**Date:** April 2026  
**Status:** 🔒 Locked — All decisions final. Active implementation has progressed through Phase 5 hardening.

**May 2026 hardening closeout policy notes (normative):**
- Process crash boundaries are observability-visible (`process_crash_total{reason}`) and must be preserved in bootstrap behavior.
- All technical error paths emit structured alerts via `sendTechnicalFailureAlert` to active ops identities and verified admin users; new error-handling code must follow the same pattern.
- Admin MFA key material is isolated from refresh-token secrets in production-like profiles.
- Admin authorization remains fail-closed until explicit permission grants exist.
- Admin permission changes are access-token issuance scoped; immediate enforcement requires revocation/logout.
- Provider circuit breakers are intentionally process-local unless a deliberate shared-state architecture upgrade is approved.
- Deferred refund completion is queue-driven; synchronous admin mutation responses are not the source of truth for final refunded state.
- Frontend/storefront/admin/ops implementation must follow simultaneous build + integration via contract-first vertical slices; UI-only page completion is not accepted as release evidence.
- Ops frontend route discipline: `/ops/login` and `/ops/setup` are public (no console navigation). All other `/ops/*` UI requires an active `ops_session` cookie; layout calls `GET /api/v1/ops/session` and redirects unauthenticated users to `/ops/login`.
- Process restarts triggered via the ops control plane (`POST /api/v1/ops/system/restart`) are queue-backed (BullMQ, survives logout) and use Redis pub/sub (`system:restart` channel) to signal both the `backend` container (API) and the `workers` container simultaneously. Before publishing the restart signal, the worker performs a **payment-safe drain**: it polls `prisma.order.count({ status: 'PENDING_PAYMENT' })` every 5 s until all in-flight payments reach a terminal state or a configurable timeout elapses (default 5 min, `RESTART_PAYMENT_DRAIN_TIMEOUT_MS`). If the timeout fires with pending orders, a `sendTechnicalFailureAlert` is sent to ops/admin (`terminalFailure: false`) and the restart proceeds — never deadlocks. If the Redis publish itself fails, a second alert is sent (`terminalFailure: true`) to signal that the API process requires manual restart. The pre-exit `ProcessRestartAlert` email is wrapped in its own `try/catch` so email-send failures never block the restart. `process.exit(0)` is always reached. The API process calls `fastify.close()` to drain in-flight HTTP requests before exiting; the worker process calls `shutdown()` to close all BullMQ workers/queues before exiting. Docker `restart: unless-stopped` brings both containers back with the fresh DB config overlay.

---

## Table of Contents

1. [Core Ideology](#1-core-ideology)
2. [Architecture Philosophy](#2-architecture-philosophy)
3. [Technology Stack — All Decisions Locked](#3-technology-stack--all-decisions-locked)
4. [Repository & Git Workflow](#4-repository--git-workflow)
5. [VPS & Deployment Architecture](#5-vps--deployment-architecture)
6. [Folder Structure](#6-folder-structure)
7. [Database Schema](#7-database-schema)
8. [API Contract](#8-api-contract)
9. [Module Definitions](#9-module-definitions)
10. [Background Job Queues](#10-background-job-queues)
11. [Security Architecture](#11-security-architecture)
12. [Per-Client Customisation Checklist](#12-per-client-customisation-checklist)
13. [Development Phases](#13-development-phases)
14. [Future Module Roadmap](#14-future-module-roadmap)

> Configuration source-of-truth and recent hardening: see `docs/ENV_VS_DB_CONFIG_REFERENCE.md`. For the first-deploy Phase 1/2 setup model (what goes in `.env` vs Ops UI), see `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`.

---

## 1. Core Ideology

### 1.1 The Single Founding Principle

> **Build it once. Deploy it for every client.**

This is not a one-off application. This is a **private, production-grade template** — a master recipe. Every client gets their own independent instance of this codebase, deployed in full isolation. You never build from scratch again. You clone, configure, and ship.

### 1.2 What This Template Is

- A **Modular Monolith** — one Fastify process per client, structured internally with clean module boundaries and adapter interfaces that make every integration point swappable without touching business logic.
- A **plug-and-play system** — switching payment gateway, delivery partner, or notification provider requires no code changes and no redeploy of other modules. Provider selection and credentials are updated via the Ops UI (stored encrypted in `OpsConfigSecret`) and take effect after a container restart.
- A **freelancer's compounding asset** — every bug fixed, every feature hardened, every edge case handled in the template raises the quality of every future client deployment automatically.
- An **IP-protected master** — the template repo never contains client data, credentials, or customisations. It is the recipe, not any one dish.

### 1.3 What This Template Is Not

- Not a SaaS product — there is no shared runtime between clients. Every client is fully isolated.
- Not a microservices architecture — running true distributed microservices on a VPS hosting 5–10 clients is resource-prohibitive and operationally unjustifiable at this scale.
- Not a CMS — the admin dashboard is a purpose-built operations panel, not a generic content management interface.
- Not a monolith that fights you — the modular structure means module boundaries are already clean. When a future client needs microservices scale, physical separation is minimal refactoring.

### 1.4 The Compound Effect Over Time

```
Template v1.0  →  Client 1 (food store)        ← template proven in production
Template v1.1  →  Client 2 (apparel)           ← bug fixes + apparel-specific attrs
Template v1.2  →  Client 3 (electronics)       ← WhatsApp module added
Template v2.0  →  Client 4 ...                 ← abandoned cart, subscriptions added
```

Each client improves the template. The template never regresses a live client. This is the flywheel.

---

## 2. Architecture Philosophy

### 2.1 Modular Monolith — The Right Choice at This Scale

One Fastify process per client. Internally structured exactly like microservices — fully decoupled modules, no cross-module deep/internal imports (adapters/helpers/private types), and communication through public service interfaces — but deployed as a single container.

**Why not microservices:**
- A VPS hosting 5–10 clients cannot afford the memory overhead of 8+ separate Node processes per client.
- Operational complexity (inter-service networking, distributed tracing, service discovery) on a single VPS is unjustifiable.
- Clean module boundaries now mean physical separation later is straightforward if a client outgrows the VPS.

**What the modular monolith gives you:**
- Full code isolation between domains: modules may consume other modules only through public service interfaces; deep/internal cross-module imports are forbidden.
- Single Docker container per client backend — easy to debug, monitor, and restart.
- Swap any integration by changing one provider without touching other modules.

### 2.2 The Adapter Pattern — The Plug-and-Play Contract

Every external integration point follows this three-layer pattern without exception:

```
Layer 1:  Abstract TypeScript interfaces    →  see `src/common/interfaces/*.ts` (e.g. `PaymentProviderAdapter`)
Layer 2:  Concrete adapter implementations →  Razorpay adapter, Delhivery adapter, Resend / MSG91 / MetaWhatsApp adapters
Layer 3:  Environment variable selection   →  PAYMENT_PROVIDER=razorpay
```

No business logic code knows or cares which adapter is active. It calls the interface. To swap Razorpay for Cashfree in production: update `PAYMENT_PROVIDER` and the new provider's credentials via the Ops UI (`POST /api/v1/ops/config/save`) and restart containers — `applyOpsConfigRuntimeOverlay()` applies the change before provider initialization. Nothing else changes. **This is the invariant.**

> In local dev (`NODE_ENV=development`) you may set `PAYMENT_PROVIDER` and credentials directly in `.env` for fast iteration before ops bootstrap.

**Defined adapter interfaces:** Authoritative type names and method shapes live in the repository under `src/common/interfaces/`. The canonical payment abstraction is `PaymentProviderAdapter` in `payment-provider.interface.ts`; shipping and notification providers follow the same pattern with concrete adapters selected by env.

```typescript
// Illustrative only — use payment-provider.interface.ts, shipping-provider.interface.ts,
// notification-provider.interface.ts for exact signatures and DTOs.

// payment-provider.interface.ts — export interface PaymentProviderAdapter { ... }
// shipping-provider.interface.ts — shipping provider contract + Delhivery adapter
// notification-provider.interface.ts — email (Resend), SMS (MSG91 or Fast2SMS), WhatsApp (Meta Cloud API) channels
```

### 2.3 Multi-Tenancy Model — Isolated Per-Client Deployment

Each client is fully isolated at every layer. There is no shared runtime, no shared database, no shared Redis.

| Layer | Isolation Strategy |
|---|---|
| Codebase | Independent Git repo cloned from template |
| Process | Separate Docker container — own Fastify process |
| Database | Separate PostgreSQL database on shared host PostgreSQL server |
| Cache | Separate Redis container in each client's Docker Compose stack |
| Domain / SSL | Separate Nginx `server {}` block + separate Certbot certificate |
| Environment | Separate `.env` file — all secrets isolated, never shared |

**Resource efficiency:** One VPS, one PostgreSQL server (host process), one Nginx instance, shared Docker base image layers. **Full isolation:** separate databases, Redis instances, processes, env files. Result: 5–10 client sites on a single mid-range VPS (4 vCPU / 8GB RAM) with zero data bleed.

---

## 3. Technology Stack — All Decisions Locked

> These decisions are final. Rationale is documented. Reopening requires a new ADR with strong justification.

| Layer | Technology | Decision Rationale |
|---|---|---|
| **Backend Framework** | **Fastify + TypeScript** | 3–5× faster than Express in benchmarks. Built-in JSON Schema validation on every route. First-class TypeScript. Pino structured logging included. Plugin architecture maps perfectly to the modular template pattern. |
| **Language** | **TypeScript (strict mode)** | Type safety prevents entire classes of runtime bugs — wrong price types, null order IDs. Prisma generates types from schema. AI IDEs (Cursor, Copilot) are dramatically more productive with typed code. |
| **ORM** | **Prisma** | Schema-first: `schema.prisma` is the single source of truth for the database. Auto-generates fully typed client. Clean migration system. Parameterised queries make SQL injection structurally impossible. |
| **Database** | **PostgreSQL 16** | ACID compliance is non-negotiable for e-commerce. Order creation snapshots + cart clear run atomically, while paid-order inventory decrement is handled in the queue-driven payment-confirmation flow. JSONB columns handle flexible product attributes (nutrition info, specs, allergens) without schema changes. **MongoDB was considered and rejected** — ACID multi-document transactions in MongoDB are slower and less proven at this workload. |
| **Cache / Queue Broker** | **Redis 7** | Guest cart sessions. Rate limiting. BullMQ job queue. Razorpay webhook idempotency store. OTP TTL cache. |
| **Job Queue** | **BullMQ** | Order processing, notification dispatch, inventory alerts — all non-blocking background jobs. Retry logic + dead-letter queue + Bull Board UI included out of the box. |
| **Payment Gateway** | **Razorpay (default adapter)** | India-first. Supports UPI / Cards / NetBanking / Wallets. Best webhook reliability in India. PCI DSS compliant — card data never touches your server. Swappable via `IPaymentProvider`. |
| **Logistics Partner** | **Delhivery (default adapter)** | API token auth (simpler than Shiprocket's JWT refresh). Programmatic AWB generation. Push webhook tracking. 18,700+ pin codes. Rapid Commerce same-day option. Swappable via `IShippingProvider`. |
| **Email** | **Resend + React Email** | Modern API, excellent deliverability, generous free tier. React Email templates are typed, version-controlled TSX — not fragile drag-and-drop builders. |
| **SMS** | **MSG91 / Fast2SMS** | India-first. MSG91: DLT-compliant OTP + transactional routes. Fast2SMS: no DLT required, Quick SMS and OTP routes. Provider selected via `SMS_PROVIDER` ops config key (`msg91` \| `fast2sms` \| `noop`). |
| **WhatsApp** | **Meta Cloud API direct** | No BSP platform fees (vs Interakt/Wati). Template-based messaging for order updates. Direct Graph API integration via `MetaWhatsAppAdapter`. |
| **Storefront Frontend** | **Next.js (App Router)** | SSR is critical for product page SEO. App Router for streaming, layouts, and server components. Connects to Fastify API via REST. |
| **Admin Dashboard** | **Next.js + Refine** | Refine handles data fetching, pagination, CRUD forms, table sorting/filtering, auth provider, and access control. Runs inside the same Next.js frontend deployment and is exposed via route (for example `/admin`). |
| **Containerisation** | **Docker + Docker Compose** | One `docker-compose.yml` per client. Full process isolation, easy rollback, portable environments. |
| **Reverse Proxy** | **Nginx (host process)** | Domain-based routing to client containers. SSL termination. Rate limiting at the network edge. Static file serving for admin build. |
| **SSL** | **Certbot / Let's Encrypt** | Free, auto-renewing. Nginx plugin handles provisioning and renewal in one command. |
| **VPS OS** | **Ubuntu 22.04 LTS** | LTS support until 2027. Widest package availability. Docker and Nginx best documented on Ubuntu. |

### 3.1 Money: Integer Paise — Non-Negotiable

All monetary values are stored as **integers in paise** (₹1 = 100 paise) throughout the entire system — database columns, runtime variables, API payloads to Razorpay, BullMQ job data. No exceptions.

```typescript
// ✅ CORRECT — store and compute in paise
const price   = 9950                         // ₹99.50
const gst     = Math.round(price * 0.12)     // 1194 paise = ₹11.94
const total   = price + gst                  // 11144 paise = ₹111.44
const display = (total / 100).toFixed(2)     // "111.44" — only at render time

// ❌ WRONG — never store or compute with floats
const price = 99.50  // floating point arithmetic causes rounding errors in GST and discount calculations
```

**Prisma schema money columns:** `Int` type. **Razorpay API:** already expects paise as integers. **Display layer:** divide by 100 only at render time, never store the divided value.

---

## 4. Repository & Git Workflow

### 4.1 Repository Structure

```
GitHub (your account)
│
├── ecommerce-backend-template      ← 🔒 Private master. Your IP. Never has client data.
├── ecommerce-frontend-template     ← 🔒 Private master. Single frontend template (storefront + admin routes).
│
├── client-foodstore-backend        ← Client 1 backend (cloned from template v2.0)
├── client-foodstore-frontend       ← Client 1 single frontend app (storefront + admin routes)
├── client-clothingstore-backend    ← Client 2 (cloned from template v2.1)
└── ...
```

### 4.2 Starting a New Client Project

```bash
# ── On your local machine ───────────────────────────────────────────────
# 1. Clone the template into a new independent repo
git clone https://github.com/you/ecommerce-backend-template client-foodstore-backend
cd client-foodstore-backend

# 2. Detach from template history — this is now THIS client's repo
rm -rf .git
git init
git remote add origin https://github.com/you/client-foodstore-backend

# 3. First client-specific commit
git add .
git commit -m "init: bootstrapped from ecommerce-backend-template v2.0"
git push -u origin main
```

From this point the client repo is **fully independent.** No connection to the template. Customise freely.

### 4.3 What Lives Where

| Item | Template Repo | Client Repo |
|---|---|---|
| Fastify source code | ✅ Complete | ✅ Copied, then customised |
| Prisma base schema | ✅ All core models | ✅ Extended with client-specific fields |
| `.env.example` | ✅ All variables documented | ✅ Becomes `.env` with real values |
| `.env` (real secrets) | ❌ Never — ever | ✅ Only here, in `.gitignore` |
| Docker Compose | ✅ Parameterised template | ✅ Used as-is or tweaked |
| Nginx config template | ✅ Template file | ✅ Filled with client domain and ports |
| Email / SMS templates | ✅ Base design | ✅ Customised with client branding |
| Client logo / brand colours | ❌ Never | ✅ Only in client repo |
| Razorpay / Delhivery API keys | ❌ Never | ✅ In `OpsConfigSecret` (prod) / `.env` (local dev only) |

### 4.4 Template Versioning

Each client repo commit message records which template version it was bootstrapped from. Future template improvements (security patches, new modules) are applied to active client repos as deliberate, reviewed changes — never automatically. This prevents surprise breaking changes on live sites.

---

## 5. VPS & Deployment Architecture

### 5.1 VPS Layout

```
┌──────────────────────────────────────────────────────────────────┐
│                    VPS (Ubuntu 22.04 LTS)                        │
│             Recommended: 4 vCPU / 8 GB RAM (handles 5–10 sites) │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Nginx (Host Process)                     │   │
│  │  Port 80  → redirect to 443                               │   │
│  │  Port 443 → SSL termination + reverse proxy               │   │
│  │                                                            │   │
│  │  client1.com        → Docker: client1-backend :3001        │   │
│  │  client1.com/admin  → Served by same frontend deployment    │   │
│  │  client2.com        → Docker: client2-backend :3002        │   │
│  │  client2.com/admin  → Served by same frontend deployment    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────┐  ┌─────────────────────┐  ...         │
│  │   Client 1 Stack    │  │   Client 2 Stack    │              │
│  │  (Docker Compose)   │  │  (Docker Compose)   │              │
│  │                     │  │                     │              │
│  │  client1-backend    │  │  client2-backend    │              │
│  │  (Fastify :3001)    │  │  (Fastify :3002)    │              │
│  │                     │  │                     │              │
│  │  client1-redis      │  │  client2-redis      │              │
│  │  (:6379 internal)   │  │  (:6379 internal)   │              │
│  └─────────────────────┘  └─────────────────────┘              │
│                                                                  │
│  ┌─────────────────────┐  ┌─────────────────────┐  ...         │
│  │ client1-frontend    │  │ client2-frontend    │              │
│  │ (PM2, Next.js host) │  │ (PM2, Next.js host) │              │
│  │ :3101               │  │ :3102               │              │
│  │ Auto-deployed via   │  │ Auto-deployed via   │              │
│  │ GitHub Actions CD   │  │ GitHub Actions CD   │              │
│  └─────────────────────┘  └─────────────────────┘              │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  PostgreSQL 16 (Host Process — Port 5432)                  │ │
│  │  DB: client1_ecom    DB: client2_ecom    DB: client3_ecom  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  GitHub Actions self-hosted runners (host processes)            │
│  client1-vps-runner   client2-vps-runner   ...                  │
│  (one per client — unique VPS_RUNNER_LABEL per repo)            │
│                                                                  │
│  /etc/letsencrypt/live/client1.com/  (Certbot — auto-renews)    │
│  /etc/letsencrypt/live/client2.com/                             │
└──────────────────────────────────────────────────────────────────┘
```

**Key architectural decisions:**
- **PostgreSQL runs on the host** (not in Docker) — simpler backup (`pg_dump`), accessible from all client containers via `host.docker.internal`, no volume management needed.
- **Redis per client** inside each Docker Compose stack — memory footprint < 50MB per instance at this scale, complete isolation.
- **Nginx on the host** — one instance handles all domain routing and SSL. Certbot (host-installed) manages all certificates.
- **Admin frontend is route-based in same app** — Next.js frontend serves storefront and admin routes from one deployment (no separate admin host/container).
- **Frontend runs as a PM2 host process** — Next.js is NOT containerised; it runs directly on the VPS host under PM2 for zero-downtime reloads. Each client gets an independent process (`<client-id>-frontend`) on its own port (`3100 + N`).
- **GitHub Actions self-hosted runner per client** — each client repo has its own runner on that client's VPS (polls GitHub outbound; no inbound SSH for deploys). On every push to `main` after CI passes: `deploy-backend` + optional `deploy-frontend` via `vps-deploy.sh` / `vps-frontend-deploy.sh`. **Setup:** `docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md` (Phase 7.6); summary: `docs/CLIENT_VPS_SETUP_GUIDE.md` §22. Monorepos use repo-root `.github/workflows/`; backend-only repos use `backend/.github/workflows/`.

### 5.2 Docker Compose (Per Client)

```yaml
# docker-compose.yml — each client fills via .env
services:
  backend:
    build: .
    container_name: ${CLIENT_ID:-ecom}-backend
    restart: unless-stopped
    ports:
      - "${BACKEND_PORT:-3000}:3000"       # e.g. 3001 for client1, 3002 for client2
    extra_hosts:
      - "host.docker.internal:host-gateway"   # reach host PostgreSQL on VPS
    env_file: .env                             # all vars injected from .env
    environment:
      - NODE_ENV=production                    # override — containers always run prod
      - OTEL_SERVICE_NAME=${CLIENT_ID:-ecom}-backend
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    networks: [client-network]

  workers:
    build: .
    container_name: ${CLIENT_ID:-ecom}-workers
    restart: unless-stopped
    command: ["node", "bootstrap-workers.js"]
    env_file: .env
    environment:
      - NODE_ENV=production
      - OTEL_SERVICE_NAME=${CLIENT_ID:-ecom}-workers
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    networks: [client-network]

  # ── Infrastructure (used in both dev and prod) ──────────
  postgres:
    image: postgres:16-alpine
    container_name: ${CLIENT_ID:-ecom}-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_USER=${POSTGRES_USER:-postgres}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
      - POSTGRES_DB=${POSTGRES_DB:-ecom_template}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres}"]
      interval: 10s
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes: [pg-data:/var/lib/postgresql/data]
    networks: [client-network]

  redis:
    image: redis:7-alpine
    container_name: ${CLIENT_ID:-ecom}-redis
    restart: unless-stopped
    command: >-
      sh -c "redis-server ${REDIS_PASSWORD:+--requirepass \"$REDIS_PASSWORD\"}
      --appendonly yes --appendfsync everysec
      --maxmemory 100mb --maxmemory-policy noeviction"
    healthcheck:
      test: ["CMD-SHELL", "redis-cli ${REDIS_PASSWORD:+-a \"$REDIS_PASSWORD\"} ping | grep PONG"]
      interval: 10s
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes: [redis-data:/data]
    networks: [client-network]

networks:
  client-network:
    driver: bridge

volumes:
  pg-data:
  redis-data:
```

> **Development vs Production usage:**
> - **Dev laptop:** `docker compose up -d postgres redis` — only infrastructure. Run Node on the host with `npm run dev`.
> - **VPS production:** `docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend workers` — host Postgres + Redis; no compose postgres. Go-live requires `/api/v1/health/ready` with `runtimeConfigMissingKeys=[]`.
> - **Shared VPS Redis safety:** in production, Redis must stay internal to the client Docker network. Comment out `redis.ports` in client `docker-compose.yml` to avoid publishing host `:6379` and cross-client port conflicts.
> - **No inline env var warnings:** All application config is injected via `env_file: .env`. Docker Compose never sees `${DELHIVERY_API_KEY}` etc., so there are zero "variable is not set" warnings when starting only infrastructure services.

### 5.3 Nginx Config (Per Client)

```nginx
server {
  listen 80;
  server_name client1.com www.client1.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  server_name client1.com www.client1.com;
  ssl_certificate     /etc/letsencrypt/live/client1.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/client1.com/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers on;

  limit_req_zone $binary_remote_addr zone=api_client1:10m rate=30r/m;
  limit_req zone=api_client1 burst=10 nodelay;

  location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 20M;
  }

  location / {
    proxy_pass http://127.0.0.1:3101;   # Next.js storefront
  }
}

# Admin routes (for example /admin) are handled by the same frontend upstream.
```

**Payment pages & browser script integrity:** Checkout HTML and Razorpay’s hosted checkout script load from the **storefront** origin or PSP/CDN—not from this Fastify API. For PCI SAQ-A eligibility and script-injection risk (e.g. Magecart-class attacks), **Content-Security-Policy**, **Subresource Integrity** where applicable, script inventory, and optional **WAF** rules belong at the **Nginx/CDN/storefront** layer. See `TRD.md` §11.5 for ownership split; this backend continues to enforce JSON API headers via Helmet only.

### 5.4 New Client Onboarding — Step by Step

```bash
# ── LOCAL MACHINE ─────────────────────────────────────────────────────────────
# Step 1: Create the client repo from the template
git clone https://github.com/you/ecommerce-backend-template client-foodstore
cd client-foodstore && rm -rf .git && git init
git remote add origin https://github.com/you/client-foodstore
git add . && git commit -m "init: bootstrapped from ecommerce-backend-template v2.0"
git push -u origin main

# ── VPS ───────────────────────────────────────────────────────────────────────
# Step 2: Clone client repo to VPS
ssh deploy@your-vps
git clone https://github.com/you/client-foodstore /var/www/client-foodstore
cd /var/www/client-foodstore

# Step 3: Create PostgreSQL database
psql -U postgres -c "CREATE DATABASE client_foodstore;"
psql -U postgres -c "CREATE USER foodstore_user WITH PASSWORD 'strongpassword';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE client_foodstore TO foodstore_user;"

# Step 4: Fill .env with BOOTSTRAP KEYS ONLY
# (provider credentials + ops-security keys are set via Ops UI after Step 8)
# EXCEPTION: RESEND_API_KEY + RESEND_FROM must also be set as live values for the first ops invite email.
# After first ops login, manage them via Ops UI. See docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md.
cp .env.example .env
nano .env   # Fill CLIENT_ID, BACKEND_PORT, DATABASE_URL, JWT_SECRET, OPS_DB_ENCRYPTION_KEY, RESEND_API_KEY, etc.
# See docs/ENV_VS_DB_CONFIG_REFERENCE.md for bootstrap vs DB-overlay classification

# Step 5: Run Prisma migrations (creates all tables) — on VPS host shell only
npm ci
npx prisma generate --schema prisma/schema.prisma
# Do NOT run bare `npx prisma migrate deploy` when .env uses host.docker.internal (P1001 on host).
MIGRATE_DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/host\.docker\.internal/127.0.0.1/')"
DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma

# Step 6: Build and start containers (VPS host-Postgres prod overlay)
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend workers
curl -fsS http://127.0.0.1:<BACKEND_PORT>/api/v1/health
# Do NOT use -f here during Phase 7 bootstrap; readiness may be 503 until Phase 8 runtime keys are saved.
curl -sS http://127.0.0.1:<BACKEND_PORT>/api/v1/health/ready

# Step 7: Configure Nginx
sudo cp nginx/client.conf.template /etc/nginx/sites-available/foodstore.com
sudo nano /etc/nginx/sites-available/foodstore.com   # fill domain + ports
sudo ln -s /etc/nginx/sites-available/foodstore.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Step 8: SSL certificate
sudo certbot --nginx -d foodstore.com -d www.foodstore.com -d admin.foodstore.com

# Step 9: First-time frontend bootstrap (one-time only)
# After this, all subsequent deploys are handled automatically by the GitHub Actions
# deploy-frontend job (see .github/workflows/deploy.yml) via vps-frontend-deploy.sh
cd /var/www/client-foodstore-frontend
# Ensure .env.production.local exists. Recommended:
# cp .env.production.example .env.production.local
# Fill: CLIENT_ID, STOREFONT_PORT, NEXT_PUBLIC_API_BASE_URL, NEXT_PUBLIC_STOREFRONT_URL, NEXT_PUBLIC_IMAGE_CDN_URL, NEXT_PUBLIC_RAZORPAY_KEY_ID
# Storefront COD/module flags: GET /api/v1/store/config (runtime) — not build-time NEXT_PUBLIC_FEATURE_*
npm ci && npm run build
pm2 start npm --name "foodstore-frontend" -- start -- -p 3101
pm2 save && pm2 startup   # persist across VPS reboots
# Subsequent deploys: push to main → GitHub Actions CD runs vps-frontend-deploy.sh automatically

# Step 8b: Ops bootstrap — create ops invite, complete setup, then
# provision DB-overlay keys via Ops UI (POST /api/v1/ops/config/save)
# See docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md Phase 8
npm run ops:newuser -- --email ops@foodstore.internal --name "Primary Ops" --setup-base-url "https://foodstore.com" --yes

# After completing ops setup from email link:
# - Set all DB-overlay keys via Ops UI: RAZORPAY_*, DELHIVERY_*, RESEND_*, OPS_METRICS_TOKEN, etc.
# - Restart: docker compose -p foodstore up -d backend workers

echo "✅  foodstore.com is live"
```

### 5.5 Shared VPS hard constraints (operational)

These constraints are mandatory for multi-client VPS operation and are now treated as normative, not advisory:

- Nginx site provisioning is **additive** per domain (`/etc/nginx/sites-available/<domain>` + matching symlink). Never delete `sites-enabled/default` blindly; remove only after explicit audit of enabled sites.
- Install rate-limit zones exactly once per VPS via `snippets/rate-zones.conf` and include it from top-level `nginx.conf` `http {}`. Do not duplicate `limit_req_zone` definitions.
- Redis host port `6379` must not be published by each client stack on shared VPS. Only one host bind is possible and exposing Redis publicly breaks isolation expectations.
- Treat `GET /api/v1/health/ready` as a diagnostic contract: before Phase 8 it may correctly return `503` with `runtimeConfigMissingKeys`. Inspect response body first; do not gate bootstrap steps with `curl -f` against readiness.
- Frontend deploy automation depends on a tracked `frontend/.env.production.example` and runtime `frontend/.env.production.local` on VPS. Missing template files are deployment blockers and must be fixed in source control before next client rollout.

| Step | Time |
|---|---|
| Git setup (local + push) | ~3 min |
| VPS clone + PostgreSQL setup | ~3 min |
| `.env` bootstrap config (infra keys only) | ~5 min |
| Docker build (first client — downloads base images) | ~10 min |
| Docker build (subsequent clients — cached layers) | ~2 min |
| Prisma migrations | ~30 sec |
| Nginx config + SSL | ~2 min |
| Admin frontend first-time bootstrap (PM2 start) | ~3 min |
| **Total — first client on fresh VPS** | **~26 min** |
| **Total — each additional client (Docker cached)** | **~16 min** |

---

## 6. Folder Structure

### 6.1 Backend Template (`ecommerce-backend-template/`)

```
ecommerce-backend-template/
│
├── prisma/
│   ├── schema.prisma              ← Single source of truth for all DB models
│   └── migrations/                ← Auto-generated migration files
│
├── src/
│   ├── main.ts                    ← Bootstrap: Fastify instance, global plugins, server start
│   ├── app.ts                     ← Root plugin — registers all feature modules
│   │
│   ├── config/
│   │   ├── app.config.ts          ← Port, API version, environment
│   │   ├── database.config.ts     ← PostgreSQL / Prisma connection
│   │   ├── redis.config.ts        ← Redis connection
│   │   └── feature-flags.ts       ← Which modules are active (read from .env)
│   │
│   ├── common/
│   │   ├── decorators/            ← @CurrentUser(), @Public(), @Roles()
│   │   ├── guards/                ← jwtAuthGuard, rolesGuard (Fastify preHandler hooks)
│   │   ├── hooks/                 ← onRequest (Helmet, CORS), onSend (response envelope)
│   │   ├── plugins/               ← JWT plugin, rate-limit plugin, multipart
│   │   ├── errors/                ← Custom AppError class, global error handler
│   │   └── interfaces/
│   │       ├── payment-provider.interface.ts
│   │       ├── shipping-provider.interface.ts
│   │       └── notification-provider.interface.ts
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.schemas.ts    ← JSON Schema validation (Fastify native)
│   │   │   └── auth.types.ts
│   │   │
│   │   ├── users/                 ← Customer profiles, address book
│   │   ├── products/              ← Catalogue, categories, variants, images
│   │   ├── inventory/             ← Stock tracking, low-stock alerts
│   │   ├── cart/                  ← Guest + auth carts, merge on login
│   │   ├── wishlist/              ← Saved products per customer (feature-flagged)
│   │   ├── orders/                ← Order lifecycle, state machine, order number gen
│   │   ├── reviews/               ← Verified-purchase reviews + moderation (feature-flagged)
│   │   │
│   │   ├── payments/
│   │   │   └── adapters/
│   │   │       └── razorpay.adapter.ts    ← Primary provider adapter (order/payment/refund/signature ops)
│   │   │
│   │   ├── shipping/
│   │   │   └── adapters/
│   │   │       └── delhivery.adapter.ts   ← Primary provider adapter (shipment create/track)
│   │   │
│   │   ├── notifications/
│   │   │   ├── adapters/
│   │   │   │   ├── resend.adapter.ts
│   │   │   │   ├── msg91.adapter.ts
│   │   │   │   └── fast2sms.adapter.ts
│   │   │   └── templates/
│   │   │       ├── email-templates.ts
│   │   │       └── email-template-components.ts
│   │   │
│   │   ├── invoices/              ← GST-compliant PDF generation (React PDF renderer)
│   │   ├── coupons/               ← Admin coupon CRUD + analytics, cart coupon validation
│   │   └── analytics/             ← KPIs, sales charts, funnel + category breakdown
│   │
│   └── database/
│       └── prisma.service.ts      ← PrismaClient singleton
│
├── queues/
│   ├── queue-registry.ts          ← All BullMQ queue definitions
│   └── workers/
│       ├── order-processing.worker.ts
│       ├── notifications.worker.ts
│       ├── shipping.worker.ts
│       ├── inventory-alerts.worker.ts
│       ├── refunds.worker.ts
│       ├── analytics.worker.ts
│       ├── cart-cleanup.worker.ts
│       ├── reconciliation.worker.ts
│       └── outbox-dispatch.worker.ts
│
├── src/** and queues/**           ← Colocated `*.test.ts` unit/e2e-style coverage
├── package.json scripts:
│   ├── `test:unit`                ← Vitest unit suite
│   └── `test:e2e`                 ← Vitest integration/e2e contract suite
│
├── .env.example                   ← Every variable documented with description + example
├── .gitignore                     ← .env* entries here — secrets never committed
├── docker-compose.yml
├── Dockerfile
├── nginx/
│   └── client.conf.template
└── scripts/
    ├── dr-*.js / release-*.js     ← Reliability, DR, and release-guard automation
    └── parity-scorecard.js        ← Evidence-oriented parity scoring
```

---

## 7. Database Schema

> Defined in `prisma/schema.prisma` — the single source of truth.  
> All tables have `createdAt` and `updatedAt`. UUID primary keys throughout.  
> Money columns are **`Int` (paise)**. No `Decimal` or `Float` for monetary values.

### 7.1 Users & Addresses

```prisma
model User {
  id           String    @id @default(uuid())
  email        String    @unique
  phone        String?   @unique
  passwordHash String
  firstName    String
  lastName     String
  role         Role      @default(CUSTOMER)   // enum: CUSTOMER | ADMIN
  isVerified   Boolean   @default(false)
  addresses    Address[]
  orders       Order[]
  cart         Cart?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}

model Address {
  id        String  @id @default(uuid())
  userId    String
  user      User    @relation(fields: [userId], references: [id])
  fullName  String
  phone     String
  line1     String
  line2     String?
  city      String
  state     String
  pincode   String
  isDefault Boolean @default(false)
}
```

### 7.2 Product Catalogue

```prisma
model Category {
  id       String     @id @default(uuid())
  name     String
  slug     String     @unique
  parentId String?
  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children Category[] @relation("CategoryTree")
  imageUrl String?
  isActive Boolean    @default(true)
  products Product[]
}

model Product {
  id              String           @id @default(uuid())
  name            String
  slug            String           @unique
  description     String
  categoryId      String
  category        Category         @relation(fields: [categoryId], references: [id])
  tags            String[]
  attributes      Json?            // food: { nutritionInfo, allergens, shelfLife, fssaiNumber, hsnCode }
  metaTitle       String?          // SEO
  metaDescription String?          // SEO
  isActive        Boolean          @default(true)
  isFeatured      Boolean          @default(false)
  images          ProductImage[]
  variants        ProductVariant[]
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
}

model ProductImage {
  id        String  @id @default(uuid())
  productId String
  product   Product @relation(fields: [productId], references: [id])
  url       String
  altText   String
  sortOrder Int     @default(0)
}

model ProductVariant {
  id             String     @id @default(uuid())
  productId      String
  product        Product    @relation(fields: [productId], references: [id])
  sku            String     @unique
  name           String                      // "500g", "Mango Flavour", "Red / XL"
  attributes     Json?                       // { size: "500g", flavor: "Mango" }
  price          Int                         // paise
  compareAtPrice Int?                        // paise — strike-through original price
  weight         Int?                        // grams — for shipping calculation
  isActive       Boolean    @default(true)
  inventory      Inventory?
  cartItems      CartItem[]
  orderItems     OrderItem[]
}

model Inventory {
  id                String         @id @default(uuid())
  variantId         String         @unique
  variant           ProductVariant @relation(fields: [variantId], references: [id])
  quantity          Int            @default(0)
  lowStockThreshold Int            @default(5)
  lowStockAlerted   Boolean        @default(false)   // prevents duplicate alerts until restocked
  updatedAt         DateTime       @updatedAt
}
```

### 7.3 Cart

```prisma
model Cart {
  id           String     @id @default(uuid())
  userId       String?    @unique
  user         User?      @relation(fields: [userId], references: [id])
  sessionToken String?    @unique                  // guest cart — httpOnly cookie
  expiresAt    DateTime                            // guest carts expire after 30 days
  items        CartItem[]
  updatedAt    DateTime   @updatedAt
}

model CartItem {
  id            String         @id @default(uuid())
  cartId        String
  cart          Cart           @relation(fields: [cartId], references: [id])
  variantId     String
  variant       ProductVariant @relation(fields: [variantId], references: [id])
  quantity      Int
  priceSnapshot Int            // paise — price at time of adding (prevents silent price changes)
}
```

### 7.4 Orders

```prisma
model Order {
  id              String        @id @default(uuid())
  orderNumber     String        @unique               // ORD-2026-00001
  userId          String
  user            User          @relation(fields: [userId], references: [id])
  status          OrderStatus
  shippingAddress Json                                // snapshot at order time
  subtotal        Int                                 // paise
  shippingCharge  Int                                 // paise
  discountAmount  Int           @default(0)           // paise
  total           Int                                 // paise
  notes           String?
  items           OrderItem[]
  payment         Payment?
  shipment        Shipment?
  statusHistory   OrderStatusHistory[]
  invoice         Invoice?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
}

model OrderItem {
  id          String         @id @default(uuid())
  orderId     String
  order       Order          @relation(fields: [orderId], references: [id])
  variantId   String
  variant     ProductVariant @relation(fields: [variantId], references: [id])
  productName String                                  // snapshot at order time
  variantName String                                  // snapshot
  sku         String                                  // snapshot
  quantity    Int
  unitPrice   Int                                     // paise — snapshot
  totalPrice  Int                                     // paise — snapshot
}

model OrderStatusHistory {
  id         String      @id @default(uuid())
  orderId    String
  order      Order       @relation(fields: [orderId], references: [id])
  fromStatus OrderStatus?
  toStatus   OrderStatus
  note       String?
  createdAt  DateTime    @default(now())
}

enum OrderStatus {
  PENDING_PAYMENT
  PAYMENT_FAILED
  CONFIRMED
  PROCESSING
  SHIPPED
  OUT_FOR_DELIVERY
  DELIVERED
  CANCELLED
  REFUNDED
}
```

### 7.5 Payments & Shipments

```prisma
model Payment {
  id                String          @id @default(uuid())
  orderId           String          @unique
  order             Order           @relation(fields: [orderId], references: [id])
  provider          PaymentProvider                   // enum: RAZORPAY | CASHFREE | COD
  providerOrderId   String
  providerPaymentId String?                           // set after successful capture
  amount            Int                               // paise
  currency          String          @default("INR")
  status            PaymentStatus                     // CREATED | CAPTURED | FAILED | REFUNDED
  method            String?                           // upi | card | netbanking | wallet
  webhookPayload    Json?                             // sanitized provider metadata for audit trail
  capturedAt        DateTime?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
}

model Shipment {
  id                String          @id @default(uuid())
  orderId           String          @unique
  order             Order           @relation(fields: [orderId], references: [id])
  provider          ShippingProvider                  // enum: DELHIVERY | SHIPROCKET
  awbNumber         String?
  status            ShipmentStatus
  trackingUrl       String?
  estimatedDelivery DateTime?
  webhookPayload    Json?                             // sanitized provider metadata for audit trail
  events            ShipmentEvent[]
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
}

model ShipmentEvent {
  id         String   @id @default(uuid())
  shipmentId String
  shipment   Shipment @relation(fields: [shipmentId], references: [id])
  status     String
  location   String?
  description String
  occurredAt DateTime
}
```

### 7.6 Notifications, Analytics & Invoices

```prisma
model NotificationLog {
  id                String              @id @default(uuid())
  channel           NotificationChannel // EMAIL | SMS | WHATSAPP
  recipient         String
  template          String              // ORDER_CONFIRMED | SHIPPED | DELIVERED | etc.
  status            NotificationStatus  // SENT | FAILED | PENDING
  provider          String              // resend | msg91 | fast2sms | meta-whatsapp
  providerMessageId String?
  errorMessage      String?
  createdAt         DateTime            @default(now())
}

model Invoice {
  id            String   @id @default(uuid())
  orderId       String   @unique
  order         Order    @relation(fields: [orderId], references: [id])
  invoiceNumber String   @unique                    // FOOD-2026-00001
  pdfUrl        String
  issuedAt      DateTime @default(now())
}

model AnalyticsEvent {
  id        String   @id @default(uuid())
  eventType String   // PAGE_VIEW | ADD_TO_CART | CHECKOUT_STARTED | PURCHASE | etc.
  sessionId String
  userId    String?
  payload   Json
  occurredAt DateTime @default(now())
}
```

---

## 8. API Contract

### 8.1 Standard Response Envelope

Every API response — success or error — **can be** wrapped in this envelope via a global Fastify `onSend` hook, activated by setting `FEATURE_RESPONSE_ENVELOPE_ENABLED=true`. When disabled (default), success responses return route-specific payloads directly; error responses always use the standard error envelope via the global error handler regardless of the flag.

```json
// Success
{
  "success": true,
  "data": { "...": "..." },
  "meta": { "page": 1, "total": 42, "limit": 20 }
}

// Error
{
  "success": false,
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "No order found with the given ID",
    "statusCode": 404
  }
}
```

**Exception:** Non-JSON file downloads (for example CSV exports with `text/csv`) are returned as raw payloads and are exempt from JSON envelope wrapping.

PCI scope, caller-class JSON minimisation (public vs customer vs admin vs ops), optional webhook IP allowlists / Razorpay timestamp skew, checkout risk velocity, and Redis guest-key hashing are specified in `TRD.md` (sections 7.11–7.13).

### 8.2 Auth & Users

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/register` | Public | Customer registration → JWT pair + refresh cookie |
| POST | `/api/v1/auth/send-otp` | Public | Send OTP to phone (MSG91 or Fast2SMS per `SMS_PROVIDER`) |
| POST | `/api/v1/auth/verify-otp` | Public | Verify OTP → JWT pair |
| POST | `/api/v1/auth/forgot-password` | Public | Request password reset email |
| POST | `/api/v1/auth/login` | Public | Email + password login → JWT pair |
| POST | `/api/v1/auth/refresh` | Cookie | Refresh access token |
| POST | `/api/v1/auth/logout` | Customer | Invalidate refresh token |
| POST | `/api/v1/auth/admin/login/request-otp` | Public | Admin login step 1 — verify credentials, send OTP to admin email |
| POST | `/api/v1/auth/admin/login/verify-otp` | Public | Admin login step 2 — verify OTP, issue JWT pair |
| GET | `/api/v1/users/me` | Customer | Get own profile |
| PATCH | `/api/v1/users/me` | Customer | Update profile |
| GET/POST | `/api/v1/users/me/addresses` | Customer | List / add addresses |
| PATCH/DELETE | `/api/v1/users/me/addresses/:id` | Customer | Update / delete address |
| GET | `/api/v1/users/me/orders` | Customer | Own order history |

### 8.3 Catalogue

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/products` | Public | List products — filter, sort, paginate, full-text search |
| GET | `/api/v1/products/:slug` | Public | Product detail + variants + reviews |
| GET | `/api/v1/products/categories` | Public | Full category tree |
| GET | `/api/v1/products/categories/:slug/products` | Public | Products in a category |

### 8.4 Cart & Checkout

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/store/config` | Public | Runtime storefront config: COD, min order, mobile OTP signup, `FEATURE_*` mirrors |
| GET | `/api/v1/cart` | Public / Customer | Get current cart (session token or JWT) |
| POST | `/api/v1/cart/items` | Public / Customer | Add item to cart |
| PATCH | `/api/v1/cart/items/:id` | Public / Customer | Update item quantity |
| DELETE | `/api/v1/cart/items/:id` | Public / Customer | Remove item |
| DELETE | `/api/v1/cart` | Public / Customer | Clear cart |
| POST | `/api/v1/cart/merge` | Customer | Merge guest cart on login |
| POST | `/api/v1/cart/coupon` | Public / Customer | Apply coupon code |
| DELETE | `/api/v1/cart/coupon` | Public / Customer | Remove coupon |
| POST | `/api/v1/cart/check-pincode` | Public | Shipping provider serviceability check |
| GET | `/api/v1/cart/delivery-rates` | Public / Customer | Shipping rate from active provider; query `pincode`, optional `paymentMode=PREPAID\|COD` |

### 8.5 Wishlist

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/wishlist` | Customer | List saved products (paginated) |
| POST | `/api/v1/wishlist/items` | Customer | Add product to wishlist |
| DELETE | `/api/v1/wishlist/items/:productId` | Customer | Remove product from wishlist |

### 8.6 Reviews

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/reviews/recent` | Public | Latest merchant-approved reviews with written body (homepage testimonials; query `limit`, default 3, max 10) |
| GET | `/api/v1/reviews/product/:slug` | Public | Approved reviews for a product |
| GET | `/api/v1/reviews/me` | Customer | Customer's own reviews |
| POST | `/api/v1/reviews` | Customer | Create review for delivered purchased item |

### 8.7 Orders & Payments

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/orders` | Customer | Create order from cart |
| GET | `/api/v1/orders/:id` | Customer | Order detail (own only) |
| POST | `/api/v1/orders/:id/cancel` | Customer | Request cancellation |
| POST | `/api/v1/payments/initiate` | Customer | Create Razorpay order → returns `order_id` |
| POST | `/api/v1/payments/verify` | Customer | Verify Razorpay signature after frontend callback |
| POST | `/api/v1/payments/webhook` | Public (HMAC verified) | Razorpay webhook receiver |
| GET | `/api/v1/shipping/track/:awb` | Customer | Track shipment by AWB for customer-owned orders |
| POST | `/api/v1/shipping/webhook` | Public (verified) | Shipping provider push webhook receiver (Delhivery or Shiprocket) |

### 8.8 Admin Routes (JWT + ADMIN role on all)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/admin/dashboard/kpis` | Revenue, orders, AOV, conversion — today/7d/30d |
| GET | `/api/v1/admin/dashboard/sales-chart` | Time-series sales data |
| GET | `/api/v1/admin/dashboard/top-products` | Best-selling by revenue |
| GET | `/api/v1/admin/products` | List products (paginated) |
| POST | `/api/v1/admin/products/import-csv` | Bulk create/update products from CSV |
| POST | `/api/v1/admin/products` | Create product |
| GET | `/api/v1/admin/products/:id` | Product detail including all variants + images |
| POST | `/api/v1/admin/products/:id/variants` | Create product variant |
| PATCH | `/api/v1/admin/products/:id/variants/:variantId` | Update variant + inventory fields |
| DELETE | `/api/v1/admin/products/:id/variants/:variantId` | Delete a product variant (`products:write`). Returns 400 if last variant. |
| PATCH | `/api/v1/admin/products/:id` | Update product |
| DELETE | `/api/v1/admin/products/:id` | Soft-delete (deactivate) product |
| DELETE | `/api/v1/admin/products/:id/permanent` | Hard-delete product — blocked when orders/reviews reference it (`409`) |
| POST | `/api/v1/admin/products/:id/images/upload` | Batch multipart upload (max 5 MiB each; optional `altText`; sort order server-assigned). Auto **Cloudflare R2** when `MEDIA_STORAGE_PROVIDER=r2` (`products:write`) |
| POST | `/api/v1/admin/products/:id/images` | Add image by URL. Body: `{ url, altText, sortOrder }` — `https://` or hosted media path (`products:write`) |
| PATCH | `/api/v1/admin/products/:id/images/reorder` | Reorder — body: `{ images: [{ id, sortOrder }] }` (`products:write`) |
| DELETE | `/api/v1/admin/products/:id/images/:imageId` | Remove image + R2 object or legacy VPS file when hosted (`products:write`) |
| GET | `/api/v1/media/products/:productId/:filename` | Public image serve when provider is `local` only; R2 uses `R2_PUBLIC_BASE_URL` (allowed during maintenance) |
| GET | `/api/v1/admin/categories` | Category tree list |
| POST | `/api/v1/admin/categories` | Create category |
| PATCH | `/api/v1/admin/categories/:id` | Update category |
| DELETE | `/api/v1/admin/categories/:id` | Deactivate category |
| GET | `/api/v1/admin/inventory` | All variants with stock levels |
| PATCH | `/api/v1/admin/inventory/:variantId` | Update stock quantity |
| GET | `/api/v1/admin/inventory/low-stock` | Variants below threshold |
| GET | `/api/v1/admin/orders` | All orders — filter by status, date, search |
| GET | `/api/v1/admin/orders/board` | Kanban board grouped by status (CONFIRMED/PROCESSING/SHIPPED/DELIVERED/CANCELLED); up to 100 orders per column with `canShipNow` + `shippingMode` per card |
| GET | `/api/v1/admin/orders/export` | Export filtered orders as CSV (`orders:export`) |
| GET | `/api/v1/admin/orders/:id` | Full order detail + payment + shipment timeline + invoice metadata + `canShipNow`/`shipBlockReason`/`shippingMode` |
| GET | `/api/v1/admin/orders/:id/invoice.pdf` | Admin invoice PDF download for any order (`orders:read`; gated by `invoice.hasPdf`) |
| GET | `/api/v1/admin/orders/:id/timeline` | Status-transition audit trail for the order (`orders:read`) |
| PATCH | `/api/v1/admin/orders/:id/status` | Manually update order status |
| POST | `/api/v1/admin/orders/:id/ship` | Trigger shipment booking via active shipping provider |
| POST | `/api/v1/admin/orders/:id/schedule-pickup` | Schedule courier pickup (Shiprocket) |
| POST | `/api/v1/admin/orders/:id/print-label` | Generate and return shipping label URL (Shiprocket) |
| POST | `/api/v1/admin/orders/:id/cancel` | Cancel + refund if paid |
| POST | `/api/v1/admin/orders/:id/notifications/retrigger` | Re-trigger selected order notification template via selected channels (`EMAIL`/`SMS`/`WHATSAPP`) |
| GET | `/api/v1/admin/reviews` | List reviews for moderation (`productName`, `productSlug`, date filters) |
| PATCH | `/api/v1/admin/reviews/:id/moderate` | Approve or reject a review |
| DELETE | `/api/v1/admin/reviews/:id` | Hard-delete a review (`reviews:moderate`) |
| GET | `/api/v1/admin/settings/shipping` | Read effective pickup pincode + minimum order value (DB/env source) |
| PATCH | `/api/v1/admin/settings/shipping` | Update pickup pincode and minimum order value used in checkout/shipping validation |
| GET | `/api/v1/admin/settings/store` | Read store profile (identity/regulatory) |
| PATCH | `/api/v1/admin/settings/store` | Update store profile (identity/regulatory) |
| GET | `/api/v1/admin/settings/notifications` | Read notification channel toggles |
| PATCH | `/api/v1/admin/settings/notifications` | Update notification channel toggles |
| GET | `/api/v1/admin/settings/inventory` | Read default low-stock threshold |
| PATCH | `/api/v1/admin/settings/inventory` | Update default low-stock threshold |
| GET | `/api/v1/admin/users` | Customer list with search + aggregates; phone masked; includes `totalOrders` + `totalSpendPaise` |
| GET | `/api/v1/admin/users/:id` | Customer detail + addresses + order history + ban status (`isBanned`, `bannedAt`, `bannedReason`) |
| GET | `/api/v1/admin/users/:id/orders` | Paginated order history for a specific customer (`users:read`) |
| PATCH | `/api/v1/admin/users/:id/ban` | Ban customer account (`users:write`). Cannot ban admins or already-banned users. |
| DELETE | `/api/v1/admin/users/:id/ban` | Unban customer account (`users:write`). Returns 400 if not banned. |
| GET | `/api/v1/admin/users/:id/notes` | List admin notes on customer (`users:read`) |
| POST | `/api/v1/admin/users/:id/notes` | Create admin note on customer (`users:write`) |
| DELETE | `/api/v1/admin/users/:id/notes/:noteId` | Delete admin note (`users:write`) |
| GET | `/api/v1/admin/analytics/revenue` | Revenue over time (custom date range) |
| GET | `/api/v1/admin/analytics/revenue/export` | Revenue CSV export (`analytics:export`) |
| GET | `/api/v1/admin/analytics/funnel` | Sessions → cart → checkout → payment funnel |
| GET | `/api/v1/admin/analytics/inventory-alerts` | Low stock report |
| GET | `/api/v1/admin/analytics/notifications` | Notification delivery rates per channel |
| GET | `/api/v1/admin/analytics/category-breakdown` | Revenue contribution by category |
| GET | `/api/v1/admin/analytics/reconciliation-issues` | Orders where payment-provider state mismatches internal order state — severity/classification/age metadata (`analytics:read`) |
| GET | `/api/v1/admin/analytics/outbox-dead-letter` | Permanently failed outbox jobs — job type, order, error, attempts (`analytics:replay`) |
| POST | `/api/v1/admin/analytics/outbox-dead-letter/:id/replay-preview` | Dry-run preview of replaying a dead-letter job (`analytics:replay`) |
| POST | `/api/v1/admin/analytics/outbox-dead-letter/:id/replay` | Replay a failed outbox job. Body: `{ reason, dryRun?, approvalToken? }` (`analytics:replay`) |
| GET | `/api/v1/admin/analytics/inbox-failures` | Webhook events that failed inbound processing — provider, event type, error (`analytics:replay`) |
| POST | `/api/v1/admin/analytics/inbox-failures/:id/replay-preview` | Preview replaying a failed webhook event (`analytics:replay`) |
| POST | `/api/v1/admin/analytics/inbox-failures/:id/replay` | Replay a failed inbound webhook. Body: `{ reason, dryRun?, operationType?, rawPayload?, verificationHeader? }` (`analytics:replay`) |
| GET | `/api/v1/admin/coupons` | Coupon list + filters |
| GET | `/api/v1/admin/coupons/:id` | Single coupon detail |
| POST | `/api/v1/admin/coupons` | Create coupon |
| PATCH | `/api/v1/admin/coupons/:id` | Update coupon |
| PATCH | `/api/v1/admin/coupons/:id/status` | Pause/resume coupon |
| DELETE | `/api/v1/admin/coupons/:id` | Soft-delete coupon |
| POST | `/api/v1/admin/coupons/:id/restore` | Restore soft-deleted coupon (`coupons:write`) |
| POST | `/api/v1/admin/coupons/:id/clone` | Clone coupon (`coupons:write`) |
| GET | `/api/v1/admin/coupons/analytics` | Coupon redemption analytics |
| GET | `/api/v1/admin/coupons/:id/audit` | Full coupon audit trail (`coupons:read`) |
| GET | `/api/v1/admin/return-requests` | List return requests (`orders:read`) |
| GET | `/api/v1/admin/return-requests/:id` | Single return request detail (`orders:read`) |
| PATCH | `/api/v1/admin/return-requests/:id` | Approve/reject/update return request (`orders:write`) |
| PATCH | `/api/v1/admin/orders/:id/items` | Update order line-item quantities (`orders:write`) |
| GET | `/api/v1/admin/shipments` | Paginated shipment list across all orders. Query: `status`, `provider`, `page`, `limit`. (`shipments:read`) |
| GET | `/api/v1/admin/shipments/:id` | Single shipment detail — `awbNumber`, `provider`, `status`, `pickupScheduledDate` (`shipments:read`) |
| GET | `/api/v1/admin/payments` | Paginated payment list. Query: `status`, `method`, `orderId`, `from`, `to`, `page`, `limit`. Items include `customerName`, `customerEmail` from order user. (`payments:read`) |
| GET | `/api/v1/admin/payments/:id` | Single payment detail — `amount` (Int paise), `provider`, `status` (`payments:read`) |
| POST | `/api/v1/admin/inventory/bulk-update` | Bulk stock adjustment — max 100 variants per `$transaction` (`inventory:write`) |
| GET | `/api/v1/admin/inventory/history/:variantId` | Paginated `InventoryAdjustment` history for a variant (`inventory:read`) |
| GET | `/api/v1/admin/settings/cod` | Read COD settings (`settings:read`) |
| PATCH | `/api/v1/admin/settings/cod` | Update COD settings (`settings:write`) |
| GET | `/api/v1/ops/queues` | Bull Board UI — queue monitor, ops plane only (`ops:read`, Layer C) |
| GET | `/api/v1/ops/queues/dlq/summary` | Summary card: total DLQ jobs, breakdown by source queue (`ops:read`, Layer C) |

---

## 9. Module Definitions

### 🔐 Auth Module
- Stateless JWT: access token (15 min TTL) + refresh token (7 days, stored hashed in DB, invalidated on logout)
- Frontend stores `accessToken` in memory; `refreshToken` in `httpOnly` cookie — **never** `localStorage`
- OTP-based login via SMS provider (MSG91 or Fast2SMS per `SMS_PROVIDER`) — standard for Indian mobile-first e-commerce
- Admin login is a **2-step email OTP flow**: `POST /auth/admin/login/request-otp` (verify email+password, send OTP on success) → `POST /auth/admin/login/verify-otp` (verify OTP, issue JWT pair). Step 1: wrong password for known admin → `401 INVALID_CREDENTIALS`; deactivated admin → `401 UNAUTHORISED`; unknown email → generic `200` without OTP. OTP TTL: 300s, max 5 attempts. Stricter rate limit than customer login. No TOTP/authenticator-app MFA — email OTP is the MFA layer.
- Both roles share JWT structure with `role` claim (`CUSTOMER` vs `ADMIN`); admin tokens also carry operation permissions (`permissions[]`).
- `rolesGuard` on all admin routes rejects non-admin JWTs with 403, and sensitive admin routes enforce operation-level permissions (`dashboard:read`, `analytics:read`, `orders:read`, `orders:write`, `orders:export`, `orders:refund`, `orders:notify`, `users:read`, `users:write`, `shipments:read`, `payments:read`, `inventory:read`, `inventory:write`, `products:read`, `products:write`, `categories:read`, `categories:write`, `coupons:read`, `coupons:write`, `reviews:read`, `reviews:moderate`, `settings:read`, `settings:write`, `analytics:export`, `analytics:replay`) across catalogue, coupons, settings, reviews, inventory, orders, analytics, users, shipments, payments, and queues.
- Customer namespaces (`/users/me*`, `/wishlist*`, `/orders*`, `/payments/*`, `/shipping/track/:awb`) enforce `rolesGuard(Role.CUSTOMER)` in addition to JWT validation.
- All JWT secrets are per-client — compromise of one client doesn't affect others

### 📦 Product Catalogue Module
- Products with slugs (SEO), description, tags, category, `attributes` JSON for flexible fields
- `attributes` JSON handles food-specific data: `nutritionInfo`, `allergens`, `shelfLife`, `fssaiNumber`, `hsnCode`
- Categories as self-referencing tree (`parentId`) — supports `Snacks > Namkeen > Bhujia`
- `ProductVariant` is the atomic unit in carts and orders — price, SKU, weight, stock are per-variant
- `compareAtPrice` for strike-through original price on storefront
- Full-text search via PostgreSQL `tsvector` — no external search service needed at this scale
- Soft-delete (`isActive=false`) — order history remains intact
- Bulk CSV import endpoint for clients with large catalogues

### 🛒 Cart Module
- Guest cart: created on first item add, tracked by `sessionToken` in `httpOnly` cookie, stored in PostgreSQL
- Cart response contracts do not expose `sessionToken`; the token remains cookie-bound only.
- Auth cart: linked to `userId`, persists across devices and sessions
- Cart merge on login: guest cart items moved to user's cart, quantities combined
- `priceSnapshot` on `CartItem`: price at add-time — prevents silent price changes from affecting cart total
- Cart reservation TTL (`CartReservation`): line-item stock hold (default 20 min), extended on cart activity, released on expiry/clear/merge/order conversion
- Reservation-aware stock semantics: available stock = inventory quantity - active reservations from other carts
- Cart expiry: guest carts expire after 30 days; BullMQ cleanup handles expired guest carts and expired reservations
- Delhivery serviceability check before checkout to validate delivery address
- Delivery rate calculation at cart stage using Delhivery rate calculator with total cart weight

### 📋 Orders Module
- Order creation is a single **Prisma transaction**: cart → order items, cart clear (inventory decremented later in `process-order-update` after captured payment — `deduct-inventory` and `confirm-order` are thin delegation stubs that enqueue this canonical job)
- If any variant has insufficient stock, the entire transaction rolls back — no partial orders, no overselling
- Order number format: `ORD-2026-00001` — human-readable, per-store sequential counter
- Full state machine with `OrderStatusHistory` audit trail on every transition
- `shippingAddress` is a JSON snapshot at order time — address book changes don't affect old orders
- Customer cancellation only allowed in `CONFIRMED` or `PROCESSING` — not after shipment; enforced within `cancellationWindowHours` from StoreSettings (default 24h)
- Post-delivery return requests: `POST /orders/:id/return-requests` → `ReturnRequest` model with status `REQUESTED → APPROVED/REJECTED → COMPLETED`

### 💳 Payments Module (Pluggable — `IPaymentProvider`)

**PREPAID flow (Razorpay):**
1. Customer places order with `paymentMode: PREPAID` → `POST /orders` → Order created in `PENDING_PAYMENT`
2. Frontend calls `POST /payments/initiate` → Backend calls Razorpay API → Returns `razorpay_order_id`
3. Frontend opens Razorpay Checkout modal
4. Customer pays → Razorpay sends `payment.captured` webhook
5. Backend verifies HMAC-SHA256 on **raw Buffer** — never parsed JSON body
6. On valid signature → BullMQ jobs: inventory deduct + confirm order + invoice + notifications
7. Redis idempotency: hashed keys derived from provider identifiers are checked before processing — duplicate webhooks ignored without storing raw provider IDs in Redis key names
8. Webhook responds `200 OK` in < 200ms — Razorpay's 5-second timeout is never at risk
9. Frontend also calls `POST /payments/verify` as secondary confirmation (belt-and-suspenders)
10. Critical mutation retries support deterministic replay with optional `Idempotency-Key` header

**COD flow (Shiprocket handles collection):**
1. Admin enables COD via `PATCH /admin/settings/cod` (`isCodEnabled: true`) — on/off toggle per store
2. Customer places order with `paymentMode: COD` → Order immediately created in `CONFIRMED` — no Razorpay step
3. Payment record created with `provider: COD`, `status: CREATED`
4. Admin packs order and triggers shipment → Shiprocket API called with `payment_method: "COD"` — Shiprocket's delivery agent collects cash at the customer's door
5. Shiprocket fires `delivered` webhook → `shipping.worker.ts` auto-marks `Payment.status = CAPTURED`; merchant website does nothing
6. Shiprocket remits net COD amount to merchant (D+8 working days standard; D+2 with Early COD plan)
7. `POST /payments/retry` returns `400 VALIDATION_ERROR` for COD orders
8. `CodPaymentAdapter` implements `PaymentProviderAdapter`: `verifyPaymentSignature` always returns `true`; `verifyWebhookSignature` always returns `false`; `initiateRefund` returns a manual-refund reference

### 🚚 Shipping Module (Dual-provider — `IShippingProvider`)
- **Delhivery**: API token auth (`Authorization: Token <key>`). Programmatic AWB generation. Push webhook tracking.
- **Shiprocket**: JWT auth with 9-day auto-refresh. Courier comparison + NDR management. Pickup scheduling. Label generation. Push webhook tracking.
- Both providers can be **simultaneously active**. Provider detection is credential-based (`resolveDualShippingRuntime()`): Delhivery active if `DELHIVERY_API_KEY` present; Shiprocket active if `SHIPROCKET_EMAIL`+`SHIPROCKET_PASSWORD` present. At checkout, rates from all active providers are compared and the cheapest wins.
- Both adapters implement the same `ShippingProviderAdapter` interface — business logic is provider-agnostic.
- `createShipment`: maps Order to provider API, returns AWB number + tracking URL
- Admin triggers shipment manually from admin panel after packing
- Provider push webhooks → `ShipmentEvent` records created → `Shipment.status` updated → BullMQ notification job
- `OUT_FOR_DELIVERY` → high-priority SMS/WhatsApp alert
- `DELIVERED` → order status `DELIVERED`, email with confirmation + review request; for COD orders, `Payment.status` auto-set to `CAPTURED` in the same transaction

### 🔔 Notifications Module (Pluggable — multi-channel)
- Three independent channel adapters: Email (Resend), SMS (MSG91 or Fast2SMS — selectable via `SMS_PROVIDER` ops config key), WhatsApp (Meta Cloud API direct)
- Each channel enabled/disabled by env var: `NOTIFY_EMAIL_ENABLED` (default: on), `NOTIFY_SMS_ENABLED` (default: **off** — opt-in), `NOTIFY_WHATSAPP_ENABLED` (default: off)
- 8 React Email templates: `ORDER_CONFIRMED`, `PAYMENT_FAILED`, `ORDER_SHIPPED`, `OUT_FOR_DELIVERY`, `ORDER_DELIVERED`, `ORDER_CANCELLED`, `LOW_STOCK_ALERT` (admin), `PASSWORD_RESET`
- All notifications queued via BullMQ — never synchronous in the request cycle
- Every send attempt creates a `NotificationLog` record
- Retry logic: 3 attempts with exponential backoff → dead-letter queue on permanent failure

### 🏷️ Coupons Module (Feature-Flagged: `FEATURE_COUPONS_ENABLED`)
- Discount types: `PERCENTAGE_OFF`, `FLAT_AMOUNT_OFF`, `FREE_SHIPPING`, `BUY_X_GET_Y`
- Minimum order value, per-customer usage limit, global usage limit
- Category or product-specific scope
- Validity window (start date, end date — auto-expires)
- Coupons are code-based and validated against date window, usage caps, minimum order, and optional product/category scope.
- **Soft delete only** — coupons are never hard-deleted; `deletedAt`/`deletedBy` are set and the coupon is excluded from active lists. Restoring sets `isActive=true` and clears soft-delete fields via `POST /api/v1/admin/coupons/:id/restore`.
- **Full mutation audit trail** — every create/update/status change/delete/restore writes a `CouponAuditLog` row with `previousState`, `newState`, and field-level diffs. Accessible at `GET /api/v1/admin/coupons/:id/audit`.
- **Tamper-evident hash chain** — each `CouponAuditLog` row carries a `chainHash` (SHA-256) and links to the prior row's hash via `previousChainHash`. First entry per coupon uses sentinel `'GENESIS'` as the anchor.
- **Per-admin mutation rate limits** — enforced by `AdminRateLimitStore` (Redis sliding window, bounded in-memory fallback): create 10/min, update 20/min, status-toggle 20/min, delete 5/min, restore 5/min. Exceeds return `429 RATE_LIMIT_EXCEEDED`.
- **Singleton service** with bounded 1000-entry TTL cache (1 min) — prevents redundant DB reads across concurrent requests.

### 🧾 GST Invoicing Module
- Invoice generated automatically on order confirmation, attached to confirmation email
- PDF contains: GSTIN, FSSAI number (food), HSN codes, CGST+SGST / IGST breakdown, invoice number
- Invoice number format: `FOOD-2026-00001` — sequential per store, configurable
- Generated in worker context with React PDF renderer (`@react-pdf/renderer`) using an Invoicely-style composition pattern, stored on local filesystem
- Authenticated download routes:
  - Customer: `GET /api/v1/orders/:id/invoice.pdf`
  - Admin: `GET /api/v1/admin/orders/:id/invoice.pdf`
- API payload contract exposes `invoice.hasPdf` metadata only (no public/signed invoice URLs)
- Credit note on refund, referencing original invoice number
- **Important:** For B2C food e-commerce (AATO < ₹5 Cr), PDF invoice is sufficient. IRP e-invoicing is not mandatory in the current template release.

### 🔐 Ops Config Mutation Policy (Contract-Driven)
- Ops config visibility/mutation is controlled by `src/modules/ops/ops-config-contract.ts`.
- `DATABASE_URL`, initial `REDIS_URL`, and `OPS_DB_ENCRYPTION_KEY` are bootstrap-only deployment env values; they are visible/read-only in ops metadata and are never activated from DB-backed config.
- Non-bootstrap `mutableViaOps: true` keys are editable only through ops auth + verified OTP save flow (`POST /api/v1/ops/config/save`) with encrypted DB persistence.
- API and worker processes apply the encrypted DB runtime overlay before provider/worker initialization; saved non-bootstrap values override real env only after restart.

### ⚙️ Admin Dashboard (Next.js + Refine)
- Admin routes are served from the same frontend deployment (for example `/admin`)
- Refine handles: data fetching, pagination, CRUD forms, table sorting/filtering, auth provider, access control
- Pages: Dashboard (KPIs + sales chart), Orders, Order Detail, Products, Product Editor, Inventory, Categories, Customers, Analytics, Queue Monitor, Settings
- Recharts for sales chart and funnel visualisation
- Bull Board UI at `/api/v1/ops/queues` (ops plane) — inspect job status, retry failed jobs, view dead-letter queue; requires ops session (`ops:read`)
- Branding per client: logo + 5 CSS variable changes = 15 minutes

---

## 10. Background Job Queues

All async work is handled by named BullMQ queues. Workers run in a dedicated worker process (`npm run dev:workers` / `npm run start:workers`) separate from the Fastify API process. Every job has: 3-attempt retry with exponential backoff, dead-letter queue for permanent failures, 24-hour job history inspectable via Bull Board.

| Queue | Jobs | Triggered By |
|---|---|---|
| `order-processing` | `process-order-update` (canonical), `deduct-inventory` (stub), `confirm-order` (stub), `payment-webhook`, `generate-invoice`, `generate-credit-note` | Payment/refund webhook lifecycle — `process-order-update` is the single authoritative handler for order confirmation and all side effects |
| `notifications` | `send-email`, `send-sms`, `send-whatsapp` | Order status/auth/inventory lifecycle events (template-driven) |
| `shipping` | `create-shipment` (backward compat: `create-delhivery-shipment`), `update-shipment-status`, `shipment-webhook` (legacy alias), `shiprocket-token-refresh` | Admin triggers / Provider webhook |
| `inventory-alerts` | `check-low-stock` (repeatable — every 1 hour) | Scheduled — runs continuously |
| `refunds` | `initiate-razorpay-refund` | Order cancellation with captured payment |
| `analytics` | `record-event` (page-view, add-to-cart, purchase) | Storefront events |
| `cart-cleanup` | `delete-expired-guest-carts` (daily), `release-expired-reservations` (every 60s), `scheduled-process-restart` (on-demand, deferred via `POST /api/v1/ops/system/restart`) | Scheduled cleanup + stock release + ops-triggered payment-safe container restart |
| `outbox-dispatch` | `publish-pending` (repeatable — every 10 sec) | Publishes persisted outbox events to target queues |
| `reconciliation` | `run-order-lifecycle-check` (repeatable — every 60 min) | Detects lifecycle drift and records reconciliation issues |

**Why BullMQ for payment webhooks specifically:**
> Razorpay has a 5-second webhook response timeout. After `payment.captured`, the downstream chain — inventory decrement + email + SMS + invoice generation — can take 2–10 seconds. The webhook handler verifies the signature, pushes jobs to BullMQ queues with minimal payload metadata, and responds `200 OK` in < 200ms. Redis idempotency key prevents duplicate processing when Razorpay retries.

---

## 11. Security Architecture

| Layer | Implementation |
|---|---|
| Authentication | JWT (HS256), refresh token rotation, refresh token stored hashed in DB, invalidated on logout |
| Password Storage | bcrypt with cost factor 12 |
| Input Validation | JSON Schema on every Fastify route — invalid body rejected before service layer. All 300+ `type: 'object'` declarations enforce `additionalProperties: false` (only webhook header schemas intentionally use `true`). |
| SQL Injection | Prisma parameterised queries — structurally impossible via the ORM |
| Rate Limiting | Fastify `rate-limit` plugin (tiered + dynamic by load-shed mode) + Nginx route-class `limit_req` zones — dual layer |
| Webhook Verification | Razorpay: HMAC-SHA256 on **raw Buffer** with timing-safe compare. Shipping: token-authenticated webhook payload using provider-specific inbound token (`DELHIVERY_WEBHOOK_TOKEN` or `SHIPROCKET_WEBHOOK_TOKEN`) with timing-safe compare. |
| CORS | Whitelist only the client's frontend domain — no wildcard `*` |
| Security Headers | **App layer:** `@fastify/helmet` — sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options. **Nginx layer:** `Strict-Transport-Security` (HSTS 2yr + preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection: 1; mode=block` (see `nginx/client.conf.template`). |
| HTTPS | Enforced at Nginx — HTTP always redirected, TLSv1.2 minimum |
| Secrets | Bootstrap secrets stay in `.env` / deployment secret manager and `.env*` is ignored. DB-overlay eligible ops config values are encrypted in `OpsConfigSecret` and applied only after restart. Production merchant admin provisioning is invite-only; legacy seed scripts are local/emergency tools and read credentials from env vars. `JWT_SECRET` and `JWT_REFRESH_SECRET` fail-fast if missing/empty after overlay. |
| Admin Routes | Role guard + operation permission guard + stricter auth throttling (progressive account+IP lockout) + dedicated admin read/write limits |
| Ops Routes | Layer C only: browser email-OTP session cookie (httpOnly `ops_session` cookie) → email OTP challenge for critical writes (`ops:write`). No API key path. No merchant access. |
| Payment Data | Never store raw card details — Razorpay handles all PCI DSS compliance |
| Cookie Security | Refresh token: `httpOnly=true`, `secure=true`, `sameSite=strict` |
| Reliability Guardrails | Load-shed mode (`normal/reduced/emergency`), optional idempotency replay, outbox/inbox persistence, reconciliation checks |
| **Technical Failure Alerting** | Centralised email pipeline via `sendTechnicalFailureAlert()` — all `catch`/`log.error` paths across modules, plugins, workers, and process-level handlers emit structured alerts to active Ops identities (`opsUser.isActive`) and verified Admin users (`User.role=ADMIN`, `isVerified=true`). Eight failure stages (`QUEUE_ENQUEUE`, `OUTBOX_DISPATCH`, `WORKER_TERMINAL`, `WORKER_DELIVERY`, `CORE_LOGIC`, `ROUTE_HANDLER`, `WEBHOOK_PROCESSING`, `PROVIDER_RUNTIME`). DB-first client metadata (`StoreSettings.storeName`/`websiteUrl`) with env fallbacks. Best-effort transport; alert send failures are intentionally swallowed. |
| **Per-Template Primary Notification Channel** | DB-backed per-template primary channel configuration stored in `StoreSettings.primaryNotificationChannels` (JSON mapping: `TemplateName` → `EMAIL` | `SMS` | `WHATSAPP`). 13 templates supported with `EMAIL` default. `send-primary` job resolves channel from DB mapping with no fallback — if configured channel fails (disabled, missing credentials, provider error), notification fails immediately and triggers alert. Admin UI exposes per-template radio selection via `PATCH /api/v1/admin/settings/notifications`. |
| **Concurrency & Atomicity** | TOCTOU (Time-of-Check-to-Time-of-Use) vulnerabilities eliminated via Prisma `updateMany` Compare-And-Swap (CAS) pattern: atomic updates guarded by status/field conditions prevent race conditions. Distributed Redis locks serialize audit chain writes (`OpsAuditLog`, `CouponAuditLog`). All CAS paths include test-mock fallbacks for backward compatibility. See §11.2 for surface-by-surface coverage. |

### 11.1 Atomic Operations & Distributed Locking (Race-Condition Hardening)

All critical state transitions use atomic CAS patterns to prevent TOCTOU races:

| Surface | Atomic Pattern | Guard Condition |
|---------|----------------|-----------------|
| Idempotency first-write | `create` + unique-conflict catch + `updateMany` | `status: PROCESSING` → `COMPLETED`/`FAILED` |
| Admin invite expiry | `updateMany` | `status in ['CREATED', 'EMAIL_SENT']` → `EXPIRED_CLEANED` |
| Admin invite consumption | `updateMany` | `status in ['CREATED', 'EMAIL_SENT']` → `CONSUMED` |
| Refresh token consume | `updateMany` | `consumedAt: null` → `new Date()` (prevents double-spend) |
| Ops OTP verification | `updateMany` | `attempts < max AND status = PENDING` |
| Ops invite cleanup | `deleteMany` | `status in ['CREATED', 'EMAIL_SENT']` |
| Reconciliation auto-heal | `updateMany` | `status: not REFUNDED` → `REFUNDED`; `status = PENDING_PAYMENT` → `CANCELLED` |
| Webhook inbox claim | `create` + unique-violation + `updateMany` | `status = FAILED` → `PROCESSING` |
| Analytics replay | `updateMany` | `status = PENDING` ↔ `FAILED` |
| Audit chain append | Redis lock + Prisma `create` | `withOpsAuditChainLock()` serializes chain-head reads |

**Compatibility strategy (updated):** Mock-detection shims (`'mock' in delegate.method` / `preferUpdateForMock`) were removed in Round 11/12 hardening. All test mocks now provide `updateMany` directly. Production and test code paths are identical — all CAS guards execute unconditionally.

### 11.1.1 Idempotency Implementation Details

The idempotency system prevents duplicate side effects when clients retry failed requests. It uses a **header-based key** (`Idempotency-Key`) with **DB-backed records** and a **state machine**.

**Database Model (`IdempotencyRecord`):**
- Composite unique key: `(scopeKey, route, method, idempotencyKey)`
- `scopeKey`: Isolates keys by caller identity (`user:{hash}`, `cart:{hash}`, `anon:{hash}`)
- `requestHash`: SHA256 of request body — ensures retries send identical payload
- `status`: `PROCESSING` | `COMPLETED` | `FAILED`
- `responsePayload`: Cached response (sensitive data redacted via `redactSensitiveData()`)
- `expiresAt`: 24-hour TTL (`IDEMPOTENCY_TTL_HOURS`)

**State Machine:**

| Status | Behavior on Retry |
|--------|-------------------|
| `PROCESSING` | 409 Conflict — request in-flight, client should poll or backoff |
| `COMPLETED` | Returns cached response with `Idempotent-Replayed: true` header |
| `FAILED` | Allows retry (same key + payload) — CAS-guarded transition back to `PROCESSING` |

**Scope Resolution (prevents cross-user collision):**
- **Authenticated users**: `user:{SHA256(sub)}`
- **Guest carts**: `cart:{SHA256(cart_session cookie)}`
- **Anonymous**: `anon:{SHA256(IP)}`

**Request Hash Validation:**
If a retry sends a different payload with the same idempotency key, the backend returns:
```
409 CONFLICT — Idempotency-Key payload mismatch
```
This prevents accidental retries with modified parameters from being treated as the same intent.

**Routes with Idempotency Guards:**
- Customer: `POST /orders`, `POST /orders/:id/cancel`, `POST /payments/initiate`, `POST /payments/verify`, `POST /payments/retry`, `POST /orders/:id/return-requests`
- Admin: `POST /admin/orders/:id/refund`, `POST /admin/orders/:id/ship`, `POST /admin/orders/:id/cancel`, `POST /admin/orders/:id/schedule-pickup`, `POST /admin/orders/:id/notifications/retrigger`, `POST /admin/return-requests/:id`, `POST /admin/orders/:id/items`, `POST /admin/reviews/:id/delete`

### 11.1.2 Load Shedding Implementation Details

Load shedding gracefully drops non-essential traffic during system stress (high load, downstream failures, resource exhaustion). Controlled via three modes: `normal`, `reduced`, `emergency`.

**Mode Resolution (priority order):**
1. `LOAD_SHED_MODE` environment variable (immediate override)
2. Redis key `ops:load_shed:mode` (set dynamically via ops panel)
3. Default: `normal`

Mode is **cached for 5 seconds** per request to avoid Redis hammering.

**Route Classification:**

```typescript
// Never shed — always serve. These prefixes pass through every mode,
// including `maintenance/active`. The maintenance status + Nginx gate
// routes are listed here so the storefront banner and Nginx subrequest
// can keep polling/evaluating while the platform is degraded.
ALWAYS_ALLOWED_PREFIXES = [
  '/api/v1/health',
  '/api/v1/auth',
  '/api/v1/media',
  '/api/v1/payments/webhook',
  '/api/v1/shipping/webhook',
  '/api/v1/notifications/webhook',
  '/api/v1/ops',
  '/api/v1/maintenance'
];

// Shed in reduced + emergency modes (and `maintenance/pending`)
NON_CRITICAL_ADMIN_PREFIXES = [
  '/api/v1/admin/analytics',
  '/api/v1/admin/dashboard',
  '/api/v1/admin/orders/export',
  '/api/v1/admin/coupons',
  '/api/v1/admin/settings',
  '/api/v1/admin/inventory',
  '/api/v1/admin/reviews',
  '/api/v1/admin/users',
  '/api/v1/admin/products',
  '/api/v1/admin/categories'
];

// Shed in emergency mode and `maintenance/pending` (checkout mutations)
REDUCED_MODE_MUTATION_PREFIXES = [
  '/api/v1/orders',
  '/api/v1/payments/initiate',
  '/api/v1/cart'
];

// Carved out of the maintenance/pending block so in-flight payments
// can finish during the 2-minute warning window.
PAYMENT_DRAIN_ALLOWLIST = [
  '/api/v1/payments/verify',
  '/api/v1/payments/retry'
];
```

**Shedding Rules:**

| Mode | Phase | Shed Behavior |
|------|-------|---------------|
| `normal` | n/a | All traffic allowed |
| `reduced` | n/a | Non-critical admin routes return `503` |
| `emergency` | n/a | Non-critical admin + checkout mutations return `503` |
| `maintenance` | `pending` (2-min warning) | Like `emergency`, but `PAYMENT_DRAIN_ALLOWLIST` is allowed so verify/retry can finalise in-flight payments. Storefront banner shows a countdown |
| `maintenance` | `active` (post-cutover) | Everything outside `ALWAYS_ALLOWED_PREFIXES` returns `503`. Nginx serves the static maintenance.html for non-ops customer traffic |

**503 Response Body:**
```json
{
  "error": "INTERNAL_ERROR",
  "message": "Emergency degraded mode enabled. Non-critical and mutation traffic is temporarily shed."
}
```

**Guard Application:**
The `loadShedGuard` is a Fastify preHandler applied to all admin/ops mutation routes. It runs **after** auth/permission guards but **before** idempotency and business logic handlers. The `maintenance` mode short-circuits before the legacy `reduced/emergency` checks because its rules are stricter and its state lives in Postgres rather than only Redis (so it survives a Redis flush).

**Durable maintenance state:**
`mode = maintenance` is durable — backed by a single-row `MaintenanceState` table in Postgres (source of truth) with a Redis cache (`ops:maintenance:state`) for hot reads. Survives Redis flush, container restart, and database failover. Exits **only** when an ops user POSTs a different mode to `/api/v1/ops/load-shed` (OTP required). `LOAD_SHED_MODE` env var cannot force `maintenance`, preventing accidentally stuck downtime windows.

**Rate limit interaction:**
Both `pending` and `active` maintenance phases are mapped to `emergency` inside the rate-limit policy resolver, so the protective per-tier limits kick in during the warning window even though the load-shed guard's mode-string is `maintenance`.

**Operational Control:**
Ops users with `ops:write` permission can set modes via `POST /api/v1/ops/load-shed` (OTP-confirmed). Mode changes apply immediately after OTP verification. Setting `mode: 'maintenance'` writes the durable row in `phase: 'pending'` with `pendingUntil = now + 120s` and enqueues a `maintenance-activation` job on the `cart-cleanup` queue that pauses outbox + producer queues, drains BullMQ active counts (timeout `MAINTENANCE_QUEUE_DRAIN_TIMEOUT_MS`, default 120s), drains `PENDING_PAYMENT` orders (timeout `MAINTENANCE_PAYMENT_DRAIN_TIMEOUT_MS`, default 5min), flips the durable row to `phase: 'active'`, then resumes every paused queue so internal background work keeps flowing while customer traffic is gated at Nginx. **If the resume step fails silently (process exit racing the Redis Lua flush, or the resume-failure alert getting orphaned on the still-paused notifications queue), every notification channel goes silent indefinitely with no observable error.** The defence-in-depth fix added May 26, 2026: every `workers` container boot calls `isPaused()` on every drainable queue and auto-resumes any left paused by an incomplete drain — see `OPS_CONTROL_PLANE_GUIDE.md` §9.2 and `DECISIONS.md` (`[2026-05-26] Worker boot self-heals paused queues`).

### 11.2 Fastify Request Pipeline

Every incoming API request passes through this pipeline in order. No bypassing at any layer.

```
Request
  → Nginx               (edge rate limiting, HTTPS enforcement, SSL termination)
  → Fastify onRequest   (Helmet headers, CORS check)
  → Fastify preHandler  (jwtAuthGuard → rolesGuard)
  → Route preValidation (JSON Schema validation — body / params / query)
  → Controller          (thin — calls service only, no business logic)
  → Service Layer       (all business logic lives here)
  → Prisma              (parameterised database queries)
  → Fastify onSend      (wraps response in standard envelope)
  → Response

Exception at any layer → Global Error Handler → standard error envelope → correct HTTP status
```

---

## 12. Per-Client Customisation Checklist

When deploying for a new client, **only these items change**. No core business logic changes.

Operational release sign-off must pair:
- `docs/BACKEND_GO_LIVE_CHECKLIST.md` (full backend environment-to-implementation parity across required env groups)
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` (frontend integration contract and browser boundary checks)

Integration operations controls (mandatory before go-live):
- `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`
- `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`
- One staging dry run per provider class is completed and archived.
- 90-day rotation calendar is assigned with primary + backup owners.
- Compromise drill (`revoke -> regenerate -> redeploy -> verify`) evidence is archived.
- Shipment dispatch policy is validated as manual-only (`POST /api/v1/admin/orders/:id/ship`); payment confirmation does not auto-book shipments.

### 12.1 Environment Variables (`.env`)

```bash
# Store identity
STORE_NAME="Annapoorna Foods"
STORE_GSTIN=29AAAAA0000A1Z5
STORE_FSSAI=12345678901234     # food clients only
STORE_TIMEZONE=Asia/Kolkata

# Infrastructure
CLIENT_ID=annapoorna
BACKEND_PORT=3001
DATABASE_URL=postgresql://user:pass@host.docker.internal:5432/client_annapoorna
JWT_SECRET=<openssl rand -base64 64>
JWT_REFRESH_SECRET=<openssl rand -base64 64>

# Payment adapter
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=rzp_live_XXXXXXXX
RAZORPAY_KEY_SECRET=<secret>
RAZORPAY_WEBHOOK_SECRET=<webhook-secret>

# Shipping — provider detection is credential-based (SHIPPING_PROVIDER is not a valid key)
# Set credentials for whichever provider(s) are active — both can coexist for dual-provider mode

# Delhivery credentials (active when DELHIVERY_API_KEY is present)
DELHIVERY_API_KEY=<api-key>
DELHIVERY_WEBHOOK_TOKEN=<webhook-secret>
DELHIVERY_PICKUP_PINCODE=<pincode>

# Shiprocket credentials (active when SHIPROCKET_EMAIL + SHIPROCKET_PASSWORD are present)
SHIPROCKET_EMAIL=<shiprocket-email>
SHIPROCKET_PASSWORD=<shiprocket-password>
SHIPROCKET_WEBHOOK_TOKEN=<webhook-secret>
SHIPROCKET_PICKUP_PINCODE=<pincode>

# Notifications
NOTIFY_EMAIL_ENABLED=true
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_XXXXXXXX
EMAIL_FROM=orders@annapoorna.com

NOTIFY_SMS_ENABLED=false      # Opt-in — set to true only after configuring provider credentials via Ops UI
SMS_PROVIDER=msg91           # msg91 | fast2sms | noop
MSG91_AUTH_KEY=<auth-key>    # Required when SMS_PROVIDER=msg91
MSG91_SENDER_ID=ANNFDS       # Required when SMS_PROVIDER=msg91
# FAST2SMS_API_KEY=<key>     # Required when SMS_PROVIDER=fast2sms

NOTIFY_WHATSAPP_ENABLED=false
```

### 12.2 Feature Flags (also in `.env`)

```bash
FEATURE_COUPONS_ENABLED=false              # Enable when client needs promos
FEATURE_REVIEWS_ENABLED=false              # Enable when reviews module is active
FEATURE_WISHLIST_ENABLED=false             # Enable when wishlist module is active
FEATURE_GST_INVOICING_ENABLED=true         # Always true for Indian clients
FEATURE_RESPONSE_ENVELOPE_ENABLED=false    # Wraps all 2xx JSON in { success, data, meta? }
```

### 12.3 Product Schema Extensions (Prisma — client repo only)

```prisma
// Food client — add to Product model
nutritionInfo Json?    // { per100g: { calories, protein, fat, carbs } }
allergens     String[] // ["gluten", "nuts", "dairy"]
shelfLife     Int?     // days
fssaiNumber   String?
hsnCode       String?

// Apparel — ProductVariant.attributes Json already handles { size: "L", color: "Red" }
// Electronics — add to Product model
specifications Json?   // { processor: "M3", ram: "16GB", storage: "512GB" }
warranty       String?
```

### 12.4 Notification Templates
- Copy React Email templates from `/src/modules/notifications/templates/`
- Update brand colours, logo, store name, footer links
- ~30 minutes to brand all 8 templates

### 12.5 Admin Dashboard Branding
- Replace `frontend/public/images/raghava-organics-logo.png` (path constant: `BRAND_LOGO_SRC` in `frontend/lib/constants.ts`)
- Update 5 CSS variables in `/src/styles/theme.css`
- Set `NEXT_PUBLIC_STORE_NAME` in admin `.env`
- **Total: ~15 minutes**

---

## 13. Development Phases

Six phases. Sequential. Do not start a phase until the previous phase's deliverable is verified end-to-end.

### Phase 1 — Foundation ⏱ Weeks 1–2
- Fastify project: TypeScript strict mode, ESLint, Prettier, path aliases
- Prisma setup: all core models in `schema.prisma`, first migration, `PrismaService` singleton
- PostgreSQL + Redis connection, health check endpoint (`/api/v1/health`)
- Auth module: OTP send/verify (SMS provider per `SMS_PROVIDER`), JWT issue/refresh, admin login, `jwtAuthGuard`, `rolesGuard`
- Users module: profile CRUD, address book
- Global error handler, standard response envelope via `onSend` hook, Helmet, CORS
- BullMQ setup: queue registry, all worker stubs (empty — wired up in later phases)
- Docker Compose: `docker compose up -d postgres redis` for infrastructure; Node runs on host via `npm run dev` *(Ensure `REDIS_PASSWORD` is set in `.env` to prevent protected-mode `ECONNRESET` loops)*
- **Deliverable:** Authenticated API with working OTP login, all infrastructure wired

### Phase 2 — Core Commerce ⏱ Weeks 3–4
- Products module: CRUD, categories (tree), variants, VPS image upload (5 MiB) + CDN URLs via `/api/v1/media/products/*`
- Inventory module: stock tracking, `lowStockThreshold`, `lowStockAlerted` flag
- Cart module: guest cart (session token), auth cart (userId), merge on login, `priceSnapshot`, cart expiry job
- Orders module: order creation transaction (cart → order items + cart clear atomically), with inventory decrement in `order-processing` `process-order-update` after captured payment (`deduct-inventory`/`confirm-order` are delegation stubs)
- Order state machine fully implemented with `OrderStatusHistory` audit trail
- **Deliverable:** Full browse → add-to-cart → prepaid checkout flow, end-to-end

### Phase 3 — Payment & Logistics Integrations ⏱ Weeks 5–6
- Payments module: Razorpay adapter (`createOrder`, `verifyPayment`, `verifyWebhookSignature`, `initiateRefund`)
- Webhook handler: HMAC verification on raw Buffer, Redis idempotency, BullMQ dispatch, `200 OK` in < 200ms
- `order-processing` BullMQ worker: deduct inventory, confirm order, generate invoice
- Shipping module: Delhivery adapter (`createShipment`, `trackShipment`, `cancelShipment`, webhook processing)
- `ShipmentEvent` records created on each Delhivery push
- Delhivery webhook → order status update → BullMQ notification job
- GST invoice PDF generation with React PDF renderer (`@react-pdf/renderer`), stored on local filesystem, linked to order
- **Deliverable:** Full prepaid checkout with real Razorpay payment + Delhivery shipment creation

### Phase 4 — Notifications & Admin API ⏱ Weeks 7–8
- Notifications module: Resend email adapter + all 8 React Email templates
- SMS adapter: MSG91 (DLT-compliant) or Fast2SMS (no DLT required), selectable via `SMS_PROVIDER` — OTP + transactional order notifications
- `notifications` BullMQ worker — processes all jobs, creates `NotificationLog` records
- Inventory alerts repeatable job (hourly) + refunds worker
- All admin REST endpoints: dashboard KPIs, products, orders, inventory, users, analytics
- Bull Board UI mounted at `/api/v1/ops/queues` (ops session + `ops:read` required)
- **Deliverable:** Full order lifecycle with notifications + complete admin API

### Phase 5 — Admin Frontend & Hardening ⏱ Weeks 9–10
- Next.js + Refine admin dashboard: all pages (dashboard, orders, products, inventory, customers, analytics, settings)
- Refine data provider wired to `/api/v1/admin/*` endpoints
- Recharts sales chart and funnel chart in analytics page
- Security audit: Helmet config, CORS whitelist, rate limit tuning, all JSON schemas reviewed
- Swagger / OpenAPI docs auto-generated from Fastify JSON schemas
- `.env.example` finalised — every variable documented with description and example value
- Reliability automation scripts finalised and tested (`dr-*`, `release:*`, `parity:scorecard`)
- End-to-end test: browse → cart → Razorpay payment → order confirmed → Delhivery shipment → delivered notification
- Clean all TODO comments, dead code, placeholder values
- **Deliverable:** Hardened, documented, deployable template

### Phase 6 — First Client Deployment (Food Store) ⏱ Week 11
- Clone template → create `client-foodstore-backend` and `client-foodstore-admin` repos
- Add food-specific Prisma fields: `nutritionInfo`, `allergens`, `shelfLife`, `fssaiNumber`, `hsnCode`
- Configure `.env`: Razorpay keys, Delhivery API key, Resend, SMS provider (MSG91 or Fast2SMS), `STORE_FSSAI`, `STORE_GSTIN`
- Enable: email + SMS notifications. Disable: guest checkout and WhatsApp. Keep reviews/wishlist OFF until storefront modules are enabled.
- Customise email templates with food client branding
- Deploy to VPS: Nginx config, SSL, Docker Compose up, Prisma migrations
- Seed initial product catalogue via CSV import or admin panel
- Go-live monitoring: watch BullMQ queues, Nginx logs, PostgreSQL for 48 hours
- **Deliverable:** Live production food e-commerce site — template proven in production

---

## 14. Future Module Roadmap

## 15. Operational Parity Controls (90%+ Closeout v3)

- Edge and app abuse-defense controls share a single policy source (`src/common/security/edge-policy.ts`) to prevent drift.
- Edge/app parity drift checks are executable via `npm run edge:drift-check`.
- Reliability SLO and burn-rate automation rules are versioned in `observability/slo-rules.yml` with test harness `observability/slo-rules.test.yml`.
- Deploy freeze guardrails are executable via `npm run release:guard` (supports env + file-based reliability state truth).
- Ops metrics endpoint (`/api/v1/ops/metrics`) is protected by allowlist/token and not publicly exposed by default.
- Reconciliation control-plane visibility is exposed at `/api/v1/admin/analytics/reconciliation-issues` with severity/classification/age metadata.
- Outbox dead-letter replay can be operator-triggered at `/api/v1/admin/analytics/outbox-dead-letter/:id/replay`.
- Auth abuse defense supports server-side challenge validation and challenge-outcome observability.
- Flash-sale no-oversell contention simulation is executable via `npm run stress:flash-sale:api:matrix`.
- Flash-sale API evidence is only valid when fixture preconditions are met; runs with `fixturePreconditionMet=false` (for example all `rejected_client`) must fail invariant enforcement.
- DR/game-day cadence is executable with `npm run dr:drill:checklist` and evidence freshness validation via `npm run dr:drill:stale-check`.

### 15.1 Implemented vs Roadmap Boundary

- **Implemented now:** reliability scripts, replay governance APIs, queue/SLO artifacts, CI reliability/security workflows, and parity evidence scorecards.
- **Roadmap/ops rollout:** full production telemetry wiring for live release policy, production-grade ephemeral DR orchestration commands, and full per-client Prometheus/Alertmanager/Grafana infrastructure.
- **Rule:** roadmap controls must be explicitly labeled and never represented as active runtime guarantees without evidence artifacts.


Drop-in additions — each is a self-contained Fastify plugin, added to `app.ts`, enabled via a feature flag. Adding to an existing client deployment is a code update + Prisma migration, not a rebuild.

| Module | Description | Priority |
|---|---|---|
| **Abandoned Cart Recovery** | BullMQ job emails customers who added items but didn't checkout (triggered 1h after cart inactivity) | High |
| **Return & Exchange Flow** | Structured return requests, admin approval, reverse pickup via Delhivery, refund trigger | High |
| **WhatsApp Commerce** | Full order status flow via WhatsApp Business API (Meta Cloud API or Interakt) | High |
| **Subscription Orders** | Recurring orders with billing schedule (weekly ghee, monthly spice box, etc.) | Medium |
| **Referral Program** | Referral codes, credit wallet, refer-a-friend tracking | Medium |
| **Delivery Time Slots** | Time-window selection (morning/evening) for hyperlocal or perishable food delivery | Medium |
| **Cloudflare R2 product media** | Implemented 2026-06: automatic R2 upload on admin image save; Ops UI config (`media` domain); batch multipart | — |
| **Multi-Warehouse Inventory** | Zone-based stock allocation per fulfilment centre | Low |
| **Product Q&A** | Customer questions on product pages, answered by admin | Low |
| **Prometheus + Grafana full stack rollout** | Metrics endpoint and alert artifacts exist in backend; full per-client observability stack rollout remains optional operational work | Low |
| **Stripe Adapter** | Payment adapter for international clients | Low |
| **Shopify-style Webhooks** | Outbound webhooks for clients who want to sync orders to external systems | Low |

---

## Final Decision Log — All Locked

| Decision | Answer | Rationale |
|---|---|---|
| Backend Framework | Fastify + TypeScript | 3–5× faster than Express. Built-in schema validation. Plugin architecture = modular template. |
| Frontend (Storefront) | Next.js (App Router) | SSR for product page SEO. App Router for streaming + server components. |
| Admin Dashboard | Next.js + Refine | Refine handles CRUD/tables/auth/pagination. One framework for both frontends. |
| Database | PostgreSQL 16 | ACID is non-negotiable for financial transactions. JSONB for flexible product data. MongoDB rejected. |
| ORM | Prisma | Type-safe, schema-first, auto-migrations, impossible SQL injection. |
| Money Storage | Integer paise | No float rounding. ₹1 = 100 paise. All math is integer math. |
| Cache + Queue | Redis 7 + BullMQ | Sessions, rate limiting, webhook idempotency, async job processing. |
| Payment (default) | Razorpay | India-first, best webhook reliability. Swappable via `IPaymentProvider`. |
| Delivery (default) | Delhivery | API token auth, 18,700+ pincodes, push webhooks. Swappable via `IShippingProvider`. |
| Email | Resend + React Email | Typed, version-controlled templates. Great deliverability. Free tier sufficient. |
| SMS | MSG91 | India-first, OTP + transactional, cheapest rates. |
| Architecture | Modular Monolith | One Fastify process per client. Clean module boundaries. Swap-anything adapter pattern. |
| VPS Isolation | Docker Compose per client | Full process isolation. Easy rollback. Independent restart. Zero data bleed. |
| Reverse Proxy | Nginx (host) + Certbot | All domains → correct containers. SSL auto-renew. Rate limiting at edge. |
| Git Workflow | 1 template → clone per client | Template is master IP. Each client repo is independent. No shared runtime ever. |
| VPS OS | Ubuntu 22.04 LTS | 5-year LTS. Best Docker + Nginx documentation. |
| Concurrency Safety Pattern | CAS `updateMany` + mock-compat fallback | All critical state mutations (inventory, alerts, outbox, coupon cap, MFA, invites, refunds, reconciliation, idempotency) use Prisma `updateMany` with guard conditions. Zero-count result → `409 CONFLICT`. Test mock detection (`vi.fn` in delegate) falls back to single-row `update`/`delete` for backward test compatibility without weakening production atomicity. |
| SQL Injection Prevention | Parameterized Prisma SQL + CI guard | All raw SQL uses `prisma.$executeRaw\`...\`` / `prisma.$queryRaw\`...\`` tagged templates (never `$executeRawUnsafe` or `$queryRawUnsafe`). CI gate `scripts/sql-injection-guard.js` scans `src/`, `queues/`, `scripts/` for unsafe patterns and fails build on detection. |

---

*This document is the canonical source of truth for the e-commerce backend template.*  
*TRD and BRD are derived from this document — they do not contradict it.*  
*Development begins with Phase 1. First code generated: `prisma/schema.prisma` and Fastify bootstrap.*

---

> **Deploying this template for a new client?** The end-to-end sequenced execution order — from client intake and third-party account setup, through VPS provisioning, backend configuration, staging dry-runs, frontend build, VPS deploy, ops bootstrap, admin provisioning, webhook registration, go-live validation, DNS cutover, and post-handoff maintenance setup — is consolidated in **[`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md)**. All isolation rules defined in this document (§5, §11) are enforced as evidence gates in that runbook.

> **Operational addendum (May 2026):** For deterministic Phase 7 backend startup on VPS (strict env, Prisma version pinning, host-Postgres routing, compose overlay), use **[`docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md`](docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md)**.
