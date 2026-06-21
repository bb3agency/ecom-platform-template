# Backend Core — Changelog

Semantic versioning (`MAJOR.MINOR.PATCH`). This file is the **propagation instruction set**: each entry tells every client repo exactly what to apply when syncing this core version. See `docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`.

- **PATCH** — bug/security fix, no contract change. Safe to merge into all clients.
- **MINOR** — backward-compatible feature. Ships **OFF** behind a flag where it adds surface area.
- **MAJOR** — breaking change / migration required. Deliberate per-client upgrade.

Each entry MUST carry the **Propagation** block (layers · migration · flag · design impact · severity · breaking · rollback).

---

## [Unreleased]

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
