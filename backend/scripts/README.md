# Backend scripts index

Operational and CI scripts for the ecom backend. Prefer **`npm run <script>`** from `backend/` when a mapping exists below.

Client-specific VPS bash steps live under `docs/clients/<client-id>/scripts/` (not listed here). Deploy entrypoints in this folder are **`vps-deploy.sh`** and **`vps-frontend-deploy.sh`**.

---

## Quick reference (npm)

| npm script | Script file | When to run |
|------------|-------------|-------------|
| `build` | `build.js` | Production compile before deploy |
| `typecheck` | `typecheck.js` | Local/CI TypeScript check |
| `lint` | `lint.js` | ESLint on `src/` and `queues/` |
| `dev:e2e` | `dev-up.cmd` | Windows: Postgres/Redis + Prisma + API |
| `dev:e2e:workers` | `dev-up-workers.cmd` | Windows: workers dev stack |
| `prisma:generate:safe` | `prisma-generate-safe.js` | Generate Prisma client (CI + local; Windows EPERM retries) |
| `prisma:generate:force` | `prisma-generate-safe.js --kill-lockers` | Stuck Windows engine lock |
| — | `prisma-generate-safe.js --release-lock-only` | Dev-up step: stop other `node.exe` + clear stale `.tmp` engine files |
| `verify:bootstrap-env` | `verify-client-bootstrap-env.mjs` | Warn if R2/media keys are in `.env` |
| `verify:r2-media` | `verify-r2-media-config.mjs` | **Fail** if R2/media keys are in `.env` (use Ops panel) |
| `verify:vps-preflight` | `verify-vps-deploy-preflight.mjs` | Local check: deploy scripts exist before push |
| `verify:integration` | `verify-integration-readiness.mjs` | Local stack health + readiness |
| `test:guardrails` | multiple `*.test.js` + drift checks | CI guardrail bundle |
| `contract:admin` | `admin-contract-check.js` | Live admin API contract (needs running API) |
| `coverage:ratchet` | `coverage-ratchet-check.js` | After `test:unit:coverage` |
| `ci:reliability-gates` | orchestrates many below | Full reliability CI locally |
| `admin:newuser` | `admin-newuser.mjs` | Merchant admin invite (production path) |
| `ops:newuser` | `ops-newuser.mjs` | Ops console user + invite email |
| `seed:refunded-fixture` | `seed-refunded-order.js` | Dev/test refunded order |
| `cleanup:refunded-fixture` | `cleanup-refunded-fixture.js` | Remove refunded fixture |
| `stress:flash-sale` | `flash-sale-contention.js` | Load/contention simulation |
| `dr:*` | `dr-*.js` / `dr-*.sh` | DR drills and backup (see DR section) |
| `otel:readiness-check` | `otel-readiness-check.js` | OTEL exporter config smoke |
| `ops:config-contract-proposal` | `ops-config-contract-proposal.js` | Propose new Ops config keys |
| `parity:scorecard` | `parity-scorecard.js` | Reliability artifact scorecard |
| `check:token-contract` | `check-token-contract.sh` | Fails if `frontend/app/globals.css` is missing any token in `frontend/design-tokens.contract.json` (needs `jq`). See `docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md` §5 |
| `check:core-drift` | `check-core-drift.sh` | Fails if client core files (per root `core-manifest.json`) diverge from the pinned `template` tag (needs `jq` + a `template` git remote). See guide §7 |
| `check:core-purity` | `check-core-purity.mjs` | **Anti-contamination guard.** Fails if any CORE file contains a client identifier from `core-purity-denylist.txt` (skips tests + the client's own `core-purity-allow.txt`). Keeps brand/copy in the design layer (`constants.ts`/`content.ts`). Wired into `ci:reliability-gates`. See guide §7.1 |
| `sync:core` | `sync-core.mjs` | Pulls core files for a release tag into this repo (`git checkout <tag> -- <core paths>`, design/client/approved-divergence excluded) + bumps `PLATFORM_VERSION`. Used by the `core-sync` workflow; runnable manually. See guide §9, §12 |

---

## Build, typecheck, lint

| File | Purpose |
|------|---------|
| `build.js` | `tsc` compile to `dist/` |
| `typecheck.js` | TypeScript project references check |
| `lint.js` | ESLint runner |

---

## Local development (Windows)

| File | Purpose |
|------|---------|
| `dev-up.cmd` | Start deps, Prisma bootstrap, run API (`npm run dev:e2e`) |
| `dev-up-workers.cmd` | Same for BullMQ workers |
| `dev-ensure-prisma-ready.js` | Safe `prisma generate` + `migrate deploy`; used by `dev-up.cmd` |

---

## Preflight & verification

| File | Purpose |
|------|---------|
| `verify-client-bootstrap-env.mjs` | Bootstrap `.env` sanity; warns on R2 keys in file |
| `verify-r2-media-config.mjs` | Enforces R2/media via Ops DB only (no `.env` keys) |
| `verify-vps-deploy-preflight.mjs` | Ensures `vps-deploy.sh` / `vps-frontend-deploy.sh` present |
| `verify-integration-readiness.mjs` | HTTP checks against local API (`/health`, `/health/ready`) |

---

## VPS deploy & host ops (bash)

Run on the VPS or via GitHub CD (see `docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md`).

| File | Purpose |
|------|---------|
| `vps-deploy.sh` | Backend: migrate, compose build, nginx maintenance, swap containers |
| `vps-frontend-deploy.sh` | Frontend: build, PM2 reload |
| `install-maintenance-page.sh` | Install styled Nginx maintenance page (`sudo`) |
| `diagnose-maintenance.sh` | Debug maintenance mode / nginx |
| `cleanup-stale-compose-state.sh` | Remove dead Docker tombstones before deploy |
| `install-vps-cleanup.sh` | Install daily cron from template |
| `vps-cleanup-template.sh` | Template for Docker/PM2/log cleanup |
| `diagnose-ops-otp.sh` | Ops OTP delivery troubleshooting |

---

## User provisioning

| File | Purpose |
|------|---------|
| `ops-newuser.mjs` | **Production:** create Ops user + send invite (`npm run ops:newuser`) |
| `admin-newuser.mjs` | **Production:** merchant admin invite (`npm run admin:newuser`) |
| `upsert-admin.js` | **Local/CI only:** seed admin from `SEED_ADMIN_*` env (CI smoke) |
| `seed-admin.mjs` | **Local dev only** — not for VPS production |
| `normalize-ops-user-permissions.mjs` | One-time: ensure all Ops users have `OPS_READ` + `OPS_WRITE` |

---

## CI guardrails & contract checks

Invoked by `npm run test:guardrails`, `ci:reliability-gates`, or individually.

| File | npm alias | Purpose |
|------|-----------|---------|
| `route-discipline-check.js` | `route:discipline-check` | Route registration / policy discipline |
| `serializer-exposure-check.js` | `serializer:exposure-check` | Response serializer exposure rules |
| `admin-layer-drift-check.js` | `admin:layer-drift-check` | Admin frontend/backend layer parity |
| `docs-runtime-drift-check.js` | `docs:runtime-drift-check` | Docs vs runtime contract |
| `config-runtime-parity-check.js` | `config:runtime-parity-check` | Env vs runtime config parity |
| `ops-config-contract-drift-check.js` | `ops:config-contract-drift-check` | Ops config contract vs code |
| `sql-injection-guard.js` | `security:sql-injection-guard` | Raw SQL usage guard |
| `edge-policy-drift-check.js` | `edge:drift-check` | Edge/nginx policy drift |
| `admin-contract-check.js` | `contract:admin` | Live admin route contract |
| `deep-endpoint-smoke.js` | (CI direct) | Broad API smoke against running server |
| `coverage-ratchet-check.js` | `coverage:ratchet` | Minimum coverage floors (orders/auth/webhooks) |

### Guardrail unit tests (`node --test`)

| File | Tests |
|------|-------|
| `route-discipline-check.test.js` | Route discipline helpers |
| `serializer-exposure-check.test.js` | Serializer rules |
| `admin-layer-drift-check.test.js` | Admin layer rules |
| `docs-runtime-drift-check.test.js` | Docs drift rules |
| `config-runtime-parity-check.test.js` | Config parity rules |
| `ops-config-contract-drift-check.test.js` | Ops contract drift |
| `ops-config-contract-proposal.test.js` | Ops proposal generator |
| `route-ast-utils.test.js` | Route AST utilities |
| `sql-injection-guard.test.js` | SQL guard rules |

### Shared guardrail libraries (not run directly)

| File | Purpose |
|------|---------|
| `env-runtime-contract.js` | Canonical env/Ops overlay contract (imported by drift checks) |
| `ops-config-contract-proposal.js` | Suggest Ops config keys/domains |
| `route-ast-utils.js` | AST helpers for route discipline |

---

## Reliability, release, SLO

| File | npm alias | Purpose |
|------|-----------|---------|
| `reliability-release-guard.js` | `release:guard` | Release policy gate |
| `release-policy-state.js` | `release:policy-state` | Error-budget / freeze state |
| `promtool-test-rules.js` | `test:slo-rules` | Prometheus rule validation (promtool or fallback) |
| `slo-burnrate-simulate.js` | `simulate:burnrate` | Synthetic burn-rate sanity |
| `parity-scorecard.js` | `parity:scorecard` | Reliability artifact checklist |
| `flash-sale-contention.js` | `stress:flash-sale*` | Flash-sale load scenarios |
| `otel-readiness-check.js` | `otel:readiness-check` | OTEL endpoint readiness |

---

## Disaster recovery (DR)

| File | npm alias | Purpose |
|------|-----------|---------|
| `dr-gameday-checklist.js` | `dr:drill:checklist` | DR drill steps + evidence JSON |
| `dr-gameday-hooked.js` | `dr:drill:checklist:hooked` | Checklist with ephemeral hooks (CI) |
| `dr-ephemeral-pack.js` | (hooks only) | Simulated provision/failover/restore for drills |
| `dr-failover-run.js` | `dr:failover` | Failover step runner |
| `dr-restore-run.js` | `dr:restore` | Restore step runner |
| `dr-reconcile-validate.js` | `dr:reconcile` | Post-restore reconciliation |
| `dr-stale-drill-check.js` | `dr:drill:stale-check` | DR evidence freshness |
| `dr-backup-offsite.sh` | `dr:backup:offsite` | Offsite backup script |
| `dr-rto-rpo-report.js` | `dr:rto-rpo-report` | RTO/RPO report from drill artifacts |

---

## Test fixtures & data seeding

| File | npm alias | Purpose |
|------|-----------|---------|
| `seed-flash-sale-fixtures.js` | (manual) | SKUs/variants for flash-sale stress tests |
| `seed-refunded-order.js` | `seed:refunded-fixture` | Refunded order for admin/ops tests |
| `cleanup-refunded-fixture.js` | `cleanup:refunded-fixture` | Remove refunded fixture |

---

## Runtime recovery

| File | Purpose |
|------|---------|
| `resume-paused-queues.js` | Resume BullMQ queues paused after worker crash (`docker exec … workers node scripts/resume-paused-queues.js`) |

---

## Utilities

| File | Purpose |
|------|---------|
| `generate-postman-collection.js` | Regenerate Postman collection from route modules |
| `fix-enum-drift.sql` | One-off SQL: `npx prisma db execute --file scripts/fix-enum-drift.sql` |
| `lib/logger.js` | CommonJS logger for `.js` scripts |
| `lib/logger.mjs` | ESM logger for `.mjs` scripts |

---

## Removed scripts (2026-06 cleanup)

These were deleted as unused or superseded — do not restore without a new requirement:

- `debug-cwd.js`, `debug-startup.mjs` — ad-hoc debugging
- `check-email-provider.js`, `check-email-provider2.js` — one-off contract probes
- `check-infra.js` — unused TCP probe
- `admin-live-smoke.mjs` — superseded by `admin-contract-check.js` + `deep-endpoint-smoke.js`
- `ops-bootstrap.mjs` — superseded by `ops-newuser.mjs` (`npm run ops:newuser`)

---

## CI entrypoint

GitHub Actions **Reliability CI** (`.github/workflows/reliability-ci.yml`) runs from `backend/` with Postgres + Redis services. Local equivalent:

```bash
cd backend
npm run ci:reliability-gates
```

Requires local Postgres/Redis and (for full smoke) migrated DB + running API for steps that start the server.
