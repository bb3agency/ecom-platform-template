# Co-Development Sync Guide (Client Repo ↔ Template Repo)

This guide defines safe, repeatable ways to upstream reusable backend changes discovered during client development.

> **For the versioning + changelog + design-isolation + drift-enforcement layer on top of these git mechanics, see `docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`.** That guide covers semver'd `backend-core`/`frontend-core`, the changelog-as-propagation-recipe format, per-client `PLATFORM_VERSION` pinning, `FEATURE_*`-flag-based feature differences, the `merge=ours` design layer, and the `check-core-drift.sh` / `check-token-contract.sh` CI gates. This guide is *how to move a change upstream*; that guide is *how the fleet stays versioned and in sync without losing per-client design/features*.

---

## 1) Core Rule

When your client repo contains both `frontend/` and `backend/`, pushing to client remote does **not** automatically push backend changes to the template repo.

You must do a separate upstream step for template-worthy backend changes.

---

## 2) Change Classification (always first)

Before syncing, classify backend changes:

- **Template-worthy**: reusable bug fixes, security hardening, reliability improvements, generic API/contract upgrades.
- **Client-specific**: one-off business rules, branding, custom integrations for one client only.

Only template-worthy changes should be upstreamed to template repo.
Documentation-only reliability fixes are also template-worthy when they change baseline deployment behavior.

**Frontend agent rules sync:** When ops/admin auth UX conventions change (for example ops console routes gated post-login, or new load-shed modes like `maintenance` that require a storefront banner), update `backend/frontend-agent-rules.md` in the template/backend repo and re-sync into each client frontend via `cp ../backend/frontend-agent-rules.md .agents/rules/dev-rules.md` (see workspace dev-rules sync verification).

**Template-worthy reliability changes pattern (e.g. May 2026 persistent maintenance mode):** When a client repo adds new durable runtime state (new Prisma model, migration, worker job, Nginx subrequest, dedicated public routes, frontend banner component), classify and propagate every layer together:

- Backend: Prisma model + migration, runtime-state helpers, route handlers, worker job, rate-limit/load-shed/Nginx integration, unit + end-to-end route-matrix tests.
- Frontend: typed client (`lib/*.ts`), banner / control panel components, layout mount, test for any countdown / state-derivation helper.
- Docs: `OPS_CONTROL_PLANE_GUIDE.md`, `ROUTE_SURFACE_COMPLETE_REFERENCE.md`, `API_ENDPOINT_INDEX.md`, `ENV_VS_DB_CONFIG_REFERENCE.md`, `HARDENING_HISTORY.md`, `DECISIONS.md`, `BRD.md`, `ECOM_MASTER.md`, `TRD.md`, `README.md`, `frontend-agent-rules.md`, `starter-prompt.md`, this guide.
- Tests: both unit-level mocks and an end-to-end Fastify-inject test that exercises the real guard + route matrix against an in-memory Prisma/Redis pair, so the audit can confirm the actual implementation matches the docs (not just the mocks).

---

## 3) Flow A — Single Repo with `frontend/` + `backend/`

### Recommended when

- You have one repo root containing both folders.
- You want minimal duplicate implementation work.

### Repo shape

- `clientsite/.git` ✅
- `clientsite/frontend/` ✅
- `clientsite/backend/` ✅
- `clientsite/backend/.git` ❌

### One-time setup

Run from client repo root:

```bash
git remote add template-remote https://bb3agency@github.com/bb3agency/ecom-backend-template.git
git fetch template-remote
```

### Upstream commands (template-worthy backend change)

Run from client repo root:

```bash
# 1) Commit backend change in client repo
git add backend
git commit -m "fix(backend): <template-worthy change>"

# 2) Create backend-only branch from subtree
git subtree split --prefix backend -b backend-sync

# 3) Push backend-only branch to template repo
git push template-remote backend-sync:feature/<short-change-name>

# 4) Cleanup local temporary branch
git branch -D backend-sync
```

Then open PR in template repo:
- `feature/<short-change-name>` → `main`

### Why this works

`git subtree split --prefix backend` extracts only `backend/` and rewrites it as root-level history, which matches template repo layout.

---

## 4) Flow B — Separate Local Template Clone

### Recommended when

- You prefer explicit repo separation and no subtree commands.
- You are okay re-applying minimal template-worthy changes in template clone.

### Repo shape

- `clientsite/` (client repo with its own `.git`)
- `ecom-backend-template/` (separate local clone with its own `.git`)

### Upstream commands (inside template repo)

```bash
git checkout -b feature/<short-change-name>
git add .
git commit -m "fix(<scope>): <template-worthy change>"
git push -u origin feature/<short-change-name>
```

Then open PR:
- `feature/<short-change-name>` → `main`

### Important

Flow B is not “copy entire backend folder every time”.
Prefer re-applying only minimal relevant file changes.

---

## 5) Copy/Paste Safety Checklist (Flow B)

If you choose copy/paste style sync, use this checklist before committing in template repo.

### 5.1 Scope filter

- Confirm change is template-worthy.
- Exclude client-only behavior and branding.

### 5.2 Copy only changed files

- Do not copy full backend tree.
- Copy exact changed files only.

### 5.3 Dependency/migration integrity

- If `package.json` changed, update `package-lock.json` too.
- If Prisma schema changed, include required migration files.

### 5.4 Diff sanity

```bash
git status
git diff --name-only
git diff
```

Verify no accidental files are included.

### 5.5 Validation in template repo

```bash
npm ci
npm run prisma:generate:safe
npm run typecheck
npm run test:unit
```

Run extra checks if change touches reliability/security/build.

### 5.6 Branching discipline

- Push feature branch and open PR.
- Do not push directly to `main`.

---

## 6) Guardrails — Never Upstream

Never copy or commit:

- Real `.env` values or secrets
- Client domains/branding
- Client-only provider credentials
- One-off client-specific business rules

---

## 7) Documentation Sync Set (deployment behavior changes)

When an incident reveals a reusable deployment fix, update these documents together in one PR to avoid drift:

- `ECOM_MASTER.md`
- `TRD.md`
- `BRD.md` (business impact wording)
- `starter-prompt.md`
- `frontend-agent-rules.md`
- `docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`
- `docs/CLIENT_VPS_SETUP_GUIDE.md` and linked playbook/template docs

---

## 8) Practical Recommendation

For your current setup (`frontend/` + `backend/` in one client repo), default to **Flow A**.
Use **Flow B** when you prefer strict repository separation and explicit manual control.
