# Backend Core — Changelog

Semantic versioning (`MAJOR.MINOR.PATCH`). This file is the **propagation instruction set**: each entry tells every client repo exactly what to apply when syncing this core version. See `docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`.

- **PATCH** — bug/security fix, no contract change. Safe to merge into all clients.
- **MINOR** — backward-compatible feature. Ships **OFF** behind a flag where it adds surface area.
- **MAJOR** — breaking change / migration required. Deliberate per-client upgrade.

Each entry MUST carry the **Propagation** block (layers · migration · flag · design impact · severity · breaking · rollback).

---

## [Unreleased]

## [0.1.7] — 2026-06-22

### Fixed
- **`check-core-drift.sh` false positives across layers.** The gate built one combined backend+frontend pathspec and diffed it against *each* tag. Since tags are full-repo snapshots, that cross-checked frontend files against the backend tag (and vice-versa) → spurious "drift" whenever backend and frontend are pinned to different commits (e.g. backend 0.1.6 / frontend 0.1.4). Now each layer is diffed against **its own** tag (`backendCore`→`backend-core-v*`, `frontendCore`→`frontend-core-v*`). Verified green on raghava at 0.1.6/0.1.4.

**Propagation:**
- Severity: NORMAL (gate correctness; no runtime/API change)
- Layers: backend (`scripts/check-core-drift.sh`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the script
- Ops note: re-enable the gate per client with Variable `CORE_DRIFT_ENABLED=true` once this lands.

## [0.1.6] — 2026-06-22

> Note: tags `0.1.3`–`0.1.5` were cut without CHANGELOG/`package.json`/`PLATFORM_VERSION` bumps on main; this entry realigns those markers and supersedes the `sync-core.mjs` engine introduced in `0.1.2`.

### Changed
- **`backend/scripts/sync-core.mjs` rewritten as a cruft/copier-style THREE-WAY MERGE engine.** Instead of `git checkout <tag> -- <paths>` (a wholesale overwrite that silently discarded client-local edits and could regress markers), it now applies the **delta** between the client's currently-pinned core tag and the requested tag via `git apply --3way`. Result: client-local edits to unrelated lines survive; only genuine overlaps produce conflict markers (which fail CI → resolved in the PR); **file deletions and renames between versions are now applied** (the old engine could not); `PLATFORM_VERSION` only ever advances (downgrade guard); first-time syncs (no baseline tag) fall back to wholesale checkout.
- **`backend/scripts/check-core-drift.sh` is now a true HARD GATE.** Adds `CORE_DRIFT_STRICT=true` mode (CI): a missing prerequisite (jq / `template` remote / pinned tag) becomes a build FAILURE instead of a silent skip; local dev still skips cleanly. Also now actually honors `approved-divergence` (previously read but unused — those paths are excluded from the gate).

### Added
- **`.github/workflows/core-drift.yml`** (infra, per-client) — runs the strict drift gate on every PR/push: wires the template remote + jq and fails the build on unsanctioned core drift. Self-guards to client repos (inert where `TEMPLATE_REPO` var is unset); opt-out via repo Variable `CORE_DRIFT_ENABLED=false`.
- **`.github/workflows/core-sync.yml`** (infra, per-client) hardened: gates on OPEN PRs only (a closed/merged PR no longer blocks a fresh one); always regenerates the branch from current main (strictly-ahead → clean FF, no stale merge); never reopens (avoids head-desync); sets `delete_branch_on_merge` best-effort; labels PRs `core-sync` / `has-conflicts` and surfaces conflict files in the body.

**Propagation:**
- Severity: NORMAL (process/tooling hardening; no runtime/API change)
- Layers: backend (`scripts/sync-core.mjs`, `scripts/check-core-drift.sh`) [core-synced] · workflows `core-sync.yml`+`core-drift.yml` [infra, copy per repo]
- Migration: NO
- Flag: n/a (gate opt-out via `CORE_DRIFT_ENABLED=false`)
- Design impact: none
- Breaking: NO — but after adopting, clients MUST keep core files identical to the pinned tag (the new gate enforces it); pre-existing drift must be upstreamed or recorded as `approved-divergence` before the gate goes green
- Rollback: revert the two scripts + remove `core-drift.yml`
- Ops note: workflows are infra (not core-synced) — copy `core-sync.yml`+`core-drift.yml` into each client once. The engine (`sync-core.mjs`, `check-core-drift.sh`) propagates via the normal core sync.

## [0.1.2] — 2026-06-21

### Added
- **`backend/scripts/sync-core.mjs`** — core-sync engine: pulls core files for a release tag into a client (`git checkout <tag> -- <core paths>`, design/client/approved-divergence excluded), refreshes the layer CHANGELOG, bumps `PLATFORM_VERSION`. Exposed as `npm run sync:core`.

### Changed
- **`check-core-drift.sh` / `check-token-contract.sh`** now skip cleanly (exit 0) when there is no `template` remote or `jq` is absent, and are wired into `ci:reliability-gates` — so CI stays green everywhere and the gates self-activate where the prerequisites exist.

**Propagation:**
- Severity: NORMAL
- Layers: backend (`scripts/sync-core.mjs` [new], `scripts/check-core-drift.sh`, `scripts/check-token-contract.sh`, `package.json` scripts)
- Migration: NO
- Flag: n/a
- Design impact: none
- Breaking: NO
- Rollback: revert the scripts; remove the `sync:core` alias
- Ops note: the `release-train.yml` (template) + `core-sync.yml` (client) workflows are infra, bootstrapped per repo (not auto-synced). Install `jq` on the runner to activate the gates.

## [0.1.1] — 2026-06-20

### Fixed
- **Guest cart lost in production (vanished on refresh/navigation + post-login merge found nothing):** the `cart_session` cookie was issued `SameSite=Strict` and cart responses carried no `Cache-Control`. Two compounding causes:
  1. **`SameSite=Strict`** is the wrong policy for a guest cart session — it is dropped on top-level navigations (external-link arrivals, payment/redirect returns, the login→checkout round-trip), orphaning the guest cart and leaving the post-login `POST /cart/merge` with no guest session to merge. Now `SameSite=Lax` (same-origin XHR unaffected).
  2. **No `Cache-Control` on cart responses** — behind a CDN/edge (Cloudflare) a GET cart response could be cached and have its `Set-Cookie` stripped, serving a stale/empty cart to all guests and dropping the session (prod-only, no edge locally). Now every cart route sends `Cache-Control: no-store`.
  Cookie logic extracted to a tested `cart-cookies.ts` helper that also makes `Secure` environment-aware (omitted in dev/test for local http), mirroring `auth-cookies.ts`.

**Propagation:**
- Severity: NORMAL
- Layers: backend (`src/modules/cart/cart-cookies.ts` [new] + test · `src/modules/cart/cart.routes.ts`)
- Migration: NO
- Flag: n/a
- Design impact: none
- Breaking: NO
- Rollback: revert the cart cookie helper + routes change (restores `SameSite=Strict` and drops `no-store`)
- Ops note: no infra change required — `no-store` is sent by the origin; if a Cloudflare Cache Rule force-caches `/api/v1/cart*`, exclude it so origin `Cache-Control` is honoured

- **Product image upload reliability (three independent bugs that compounded into intermittent 400/500/"sometimes uploads but errors"):**
  1. **Response serialization 500** — the `/admin/products/:id/images/upload` handler returned the raw Prisma row (with `createdAt`/`updatedAt`); the `oneOf` response schema (`additionalProperties:false`) made `fast-json-stringify` throw `"The value of '#' does not match schema definition"` → 500 **after** the image was already saved to R2 + DB (hence "uploaded but errored"). Now maps to the declared DTO shape.
  2. **Declared-MIME false rejection** — uploads 400'd with `"Image content does not match declared file type"` when the browser/OS MIME differed from the actual bytes (renamed files, non-standard `image/jpg` vs `image/jpeg`, phone exports). The magic-byte–detected type is now authoritative; the untrusted declared MIME is ignored for acceptance (storage already used the detected type). Only true JPEG/PNG/WebP/GIF accepted — security preserved.
  3. **Nginx upload path** — `auth_request` (maintenance gate) on `/api/v1/admin/` buffered the whole multipart body before the subrequest and 500'd on larger images (the POST never reached the backend). Added a dedicated `^/api/v1/admin/.+/images/upload$` location that skips the gate and streams the body (`proxy_request_buffering off`).

**Propagation:**
- Severity: NORMAL
- Layers: backend (`src/modules/products/products.routes.ts`, `src/modules/media/product-media.validation.ts` + test) · infra (`nginx/client.conf.template`)
- Migration: NO
- Flag: n/a
- Design impact: none
- Breaking: NO
- Rollback: revert the three changes; for nginx, remove the upload `location` block and re-render
- Ops note: the nginx change must be applied to each client's live `/etc/nginx/sites-available/<domain>` (re-render from template or hand-insert) + `nginx -t && systemctl reload nginx`

---

## [0.1.0] — 2026-06-19
Baseline. First versioned backend core (raghava-organics + sbgs in production).

**Propagation:**
- Severity: NORMAL
- Layers: backend (full baseline)
- Migration: baseline schema (`prisma migrate deploy`)
- Flag: n/a (baseline feature set governed by existing `FEATURE_*` + Ops config)
- Design impact: none
- Breaking: n/a (baseline)
- Rollback: n/a (baseline)

<!--
TEMPLATE — copy for each new entry:

## [X.Y.Z] — YYYY-MM-DD
### Added | Changed | Fixed | Security | Removed
- <one-line summary of the change>

**Propagation:**
- Severity: NORMAL | SECURITY | CRITICAL
- Layers: backend(routes/service/migration) · docs(<which>)
- Migration: NO | YES → `npx prisma migrate deploy` (expand-contract, additive-first)
- Flag: <FLAG_NAME> (default OFF — enable per client via Ops) | n/a
- Design impact: none | requires frontend-core >= A.B.C
- Breaking: NO | YES (<what breaks + upgrade note>)
- Rollback: <down-migration available? revert to tag vX.Y.Z>
-->
