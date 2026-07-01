# Backend Core — Changelog

Semantic versioning (`MAJOR.MINOR.PATCH`). This file is the **propagation instruction set**: each entry tells every client repo exactly what to apply when syncing this core version. See `docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`.

- **PATCH** — bug/security fix, no contract change. Safe to merge into all clients.
- **MINOR** — backward-compatible feature. Ships **OFF** behind a flag where it adds surface area.
- **MAJOR** — breaking change / migration required. Deliberate per-client upgrade.

Each entry MUST carry the **Propagation** block (layers · migration · flag · design impact · severity · breaking · rollback).

---

## [Unreleased]

## [0.1.22] — 2026-07-01

### Added
- **Product review aggregates + write-review eligibility (full reviews feature).** Storefront product **list and detail** now return `rating` (avg, 1 dp) + `reviewCount` from approved reviews, so product cards and the PDP header can show stars without fetching every review — computed via a single batched `review.groupBy` for the list page (resilient: a review-aggregate error degrades to no-stars, never breaks the catalogue) and from the approved-reviews set on detail. New customer endpoint `GET /api/v1/reviews/eligible?orderId=` returns the distinct, active, not-already-reviewed products from one of the caller's **DELIVERED** orders — drives the storefront "write a review" UI (the existing `POST /reviews` verified-purchase create was already present but had no UI). All gated by the existing `FEATURE_REVIEWS_ENABLED` flag; aggregates are 0/0 and the endpoint returns `[]` when off.

**Propagation:**
- Severity: NORMAL (new feature) · Layers: backend (`modules/products/products.{service,schemas}.ts`, `modules/reviews/reviews.{service,schemas,routes}.ts`)
- Migration: NO (uses existing `Review` model) · Flag: `FEATURE_REVIEWS_ENABLED` (OFF by default; set `true` + restart API/workers to activate) · Design impact: none · Breaking: NO
- Rollback: revert the listed files
- Pairs with frontend-core 0.1.13 (ProductCard stars + order-page write-review UI). Operator: enable `FEATURE_REVIEWS_ENABLED` per client that wants reviews.

## [0.1.21] — 2026-07-01

### Fixed
- **Guest cart: blank `cart_session` cookie could collide all guests onto one shared cart.** Follow-up to 0.1.20. `resolveOrCreateCart` guarded the new-cart token with `sessionToken ?? randomUUID()`, but `??` only catches null/undefined — an empty/whitespace token (e.g. an empty `cart_session=` cookie) passed through and was stored as `sessionToken: ''`, so every blank-cookie guest resolved to the same `''` cart row (cross-guest cart bleed). The earlier lookup used a truthy check, so the two branches disagreed on what counts as a token. Now the token is normalized once (`sessionToken?.trim() || undefined`) and that single value is reused for both the `findUnique` lookup and the `upsert` key; blank/whitespace tokens fall back to a fresh UUID instead of `''`.

**Propagation:**
- Severity: NORMAL (guest cart correctness / isolation) · Layers: backend (`modules/cart/cart.service.ts`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the listed file
- Pairs with / hardens 0.1.20.

## [0.1.20] — 2026-07-01

### Fixed
- **Guest carts never persisted (and post-login merge always found nothing).** `CartService.resolveOrCreateCart` created a new guest cart with a **fresh random `sessionToken`** instead of the token the route supplies (the value it writes back to the `cart_session` cookie). So on every first-touch the cookie token never matched any cart row: each request minted a new empty cart, items added as a guest vanished on the next read, the guest cart always appeared empty, and `POST /cart/merge` found no guest cart to merge. Fixed by keying the created cart to the supplied `sessionToken` (`sessionToken ?? randomUUID()`), and switching the create to an `upsert` on `sessionToken` so the first-touch path is race-safe when two concurrent requests share a freshly-issued token. Verified live against prod (same cookie token now returns a stable cart that accumulates items). The merge path was already additive (`existing.quantity + guestItem.quantity`) and deletes the guest cart afterward — it simply never had a guest cart to find before this fix.

**Propagation:**
- Severity: HIGH (guest cart + guest→account merge were completely non-functional) · Layers: backend (`modules/cart/cart.service.ts`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the one method change
- Regression test: `modules/cart/cart.service.guest-session.test.ts` (asserts the created guest cart uses the supplied token).

## [0.1.19] — 2026-06-30

### Added
- **WhatsApp template registry — outbound WhatsApp notifications now actually match approved Meta templates.** Previously the Meta adapter sent the internal PascalCase template name (e.g. `OrderShipped`) straight to the Cloud API and built body parameters by **alphabetically sorting** the data keys. Both are wrong for Meta: template names must be lowercase+underscores (mismatch → Meta error 132001 "template does not exist") and body params are **positional** (`{{1}}..{{n}}`) so order/count must match the approved template (mismatch → error 132000). New `modules/notifications/whatsapp-template-registry.ts` maps each internal template → `{ metaName, language, ordered params }` and the adapter now builds the payload from it; `storeName` is injected at both worker send sites exactly like the SMS path (`WhatsappTemplateRegistry.composeTemplateData`). Mapped templates: `OrderConfirmed→order_confirmed`, `OrderShipped→order_shipped`, `OutForDelivery→out_for_delivery`, `OrderDelivered→order_delivered`, `OrderCancelled→order_cancelled`, `PaymentFailed→payment_failed` (all language `en`, UTILITY category). Unmapped templates fall back to the legacy raw-name behavior (no regression). The merchant must create the matching templates in WhatsApp Manager — canonical bodies + sample values in `docs/WHATSAPP_TEMPLATE_REGISTRY.md`.

**Propagation:**
- Severity: NORMAL (WhatsApp notifications were non-functional before this) · Layers: backend (`modules/notifications/whatsapp-template-registry.ts` [new], `modules/notifications/adapters/meta-whatsapp.adapter.ts`, `queues/workers/notifications.worker.ts`, `docs/WHATSAPP_TEMPLATE_REGISTRY.md` [new])
- Migration: NO · Flag: gated by existing `NOTIFY_WHATSAPP_ENABLED` (OFF by default) · Design impact: none · Breaking: NO
- Rollback: revert the listed files
- **Operator action required (per client that enables WhatsApp):** create the 6 UTILITY templates in WhatsApp Manager with the exact names/params/language above and wait for Meta approval before routing any template to the WHATSAPP primary channel. To send a template over WhatsApp, set its entry in the notifications `primaryChannels` config to `WHATSAPP`.

## [0.1.18] — 2026-06-30

### Fixed
- **Register the new variant-reorder endpoint in the admin policy registry.** `admin-endpoint-policy-registry.ts` was missing the mapping for `PATCH /api/v1/admin/products/:id/variants/reorder` (added in 0.1.17), so `assertAdminPolicyRegistryIntegrity()` (and its unit test) failed with *"Missing endpoint policy mapping …"*. Added the entry (`products:write`, layer A). No behavior change — the route was already permission-guarded; this just satisfies the registry-completeness invariant.

**Propagation:**
- Severity: NORMAL (CI gate / follow-up to 0.1.17) · Layers: backend (`common/auth/admin-endpoint-policy-registry.ts`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the one line

## [0.1.17] — 2026-06-30

### Added
- **Manual variant ordering (drag-and-drop).** New `ProductVariant.sortOrder` column + `PATCH /admin/products/:id/variants/reorder` (`{ variantIds: [...] }`, `products:write`) which sets each variant's `sortOrder` to its position. All variant reads (admin editor, product detail, product cards / listings) now order by `[{ sortOrder: 'asc' }, { price: 'asc' }]` instead of price only, so the admin-chosen order is what customers see. New variants append to the end; `adminReorderProductVariants` validates the payload lists every variant of the product exactly once.

**Propagation:**
- Severity: NORMAL (new feature) · Layers: backend (`prisma/schema.prisma`, `modules/products/products.{service,schemas,routes}.ts`)
- Migration: **YES** — `20260630120000_add_variant_sort_order` adds `sortOrder INT NOT NULL DEFAULT 0` and **backfills each product's variants by current price order** (so existing catalogs look unchanged until reordered) + adds a `(productId, sortOrder)` index. Run `prisma migrate deploy` + `prisma generate`.
- Flag: n/a (additive; default order = old price order until an admin drags) · Design impact: none · Breaking: NO
- Rollback: revert the listed files + drop the column/migration
- Pairs with frontend-core 0.1.12 (drag-and-drop UI).

## [0.1.16] — 2026-06-30

### Fixed
- **`sync-core.mjs` no longer breaks the core-sync PR on a CHANGELOG conflict.** The 3-way `applyDelta([changelog])` reliably conflicted (clients diverge from the core changelog) and left `backend/CHANGELOG.md` **unmerged in the index**, which failed the workflow's `git checkout -B` with *"you need to resolve your current index first / backend/CHANGELOG.md: needs merge"*. The CHANGELOG is append-only, core-owned documentation, so the sync now takes it **wholesale from the tag** (`git checkout <tag> -- <changelog>`) instead of 3-way-merging it — never conflicts.

**Propagation:**
- Severity: NORMAL (CI/automation reliability) · Layers: backend (`backend/scripts/sync-core.mjs`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the script change
- Note: clients pick this up on their next sync; existing failed core-sync runs go green on re-run (downgrade guard no-ops once the client is already at the tag).

## [0.1.15] — 2026-06-30

### Fixed
- **"Compare-at price must be greater than the price" error when the field is empty (legacy `0` data).** The pre-0.1.14 bug wrote `compareAtPrice = 0` (`Math.floor(null)`) onto variants. After 0.1.14 those stored zeros made every edit-save fail: the form re-sent `0`, and `assertValidCompareAtPrice` rejected it (`0 <= price`). Now `compareAtPrice <= 0` is treated as **"none"** everywhere: `assertValidCompareAtPrice` ignores `<= 0`, and create/update **normalize `<= 0 → null`** so the stale `0` is cleaned on the next save. A genuine positive compare-at price below the selling price is still rejected.

**Propagation:**
- Severity: NORMAL (unblocks product editing on affected catalogs) · Layers: backend (`modules/products/products.service.ts`)
- Migration: NO (self-heals — zeros are rewritten to null on save) · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the service change
- Pairs with frontend-core 0.1.11 (form shows `0` as empty and never re-sends it).

## [0.1.14] — 2026-06-29

### Fixed
- **`compareAtPrice` is now truly optional and clearable (was effectively mandatory on edit).** The admin edit form sends `compareAtPrice: null` when the field is blank, but the variant schema only allowed an integer → schema rejected it as "must be integer", and `assertValidCompareAtPrice(price, null)` also threw "must be greater than price" (since `null <= price`). Net effect: you couldn't save a product/variant edit without entering a valid compare-at price. Now: the variant `compareAtPrice` schema accepts `integer | null`; `assertValidCompareAtPrice` ignores `null`/`undefined` and only validates a positive value (`> price`); and the create/update write-sites map `null → null` (clears the column) instead of `Math.floor(null) → 0`. Error message reworded to "Compare-at price must be greater than the price".

**Propagation:**
- Severity: NORMAL (admin UX bug fix) · Layers: backend (`modules/products/products.schemas.ts`, `products.service.ts`, `products.types.ts`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO (additive — `null` now accepted where it was rejected)
- Rollback: revert the three files
- Pairs with frontend-core 0.1.9 (Compare-at-Price marked optional; `weightGrams→weight` add-variant fix; store-address always editable).

## [0.1.13] — 2026-06-28

### Added
- **Per-variant `keepUpright` packing constraint.** New `ProductVariant.keepUpright` boolean (default `false`) for fragile / "this side up" / liquid items. When set, the cartonization packer only rotates the item about its vertical axis (its configured height stays the height) so the computed box reflects how the parcel actually ships. Wired through products schemas/types/service (create + single variant create/update), the admin product editor (checkbox on add + edit rows and the primary-variant card), the shipping worker, and the cart chargeable-weight quote.
- **Recommended packing box on the admin order detail** (`GET /admin/orders/:id` → `packingBox`). `adminGetOrderById` now runs the live `cartonize` engine over the order's variant dimensions + configured box presets and returns the exact L×W×H + weight + source/boxName used to rate the order, so the merchant sees which carton to pack into. Optional field (only on the detail route; other order responses omit it).

### Changed
- **Cartonization model is now stable flat-stacking instead of pure min-volume.** `computeBoundingBox` pre-orients every free item to its stable flat orientation (largest face down, smallest dimension vertical) and packs with vertical-axis rotation only. This fixes a latent **under-billing** risk where the old min-volume search could stand a large item on its end to find an unrealistically tight "thin column" box (smaller than the parcel the merchant actually ships). Candidate footprints now also include the actual item dimensions, and ties are broken by **smallest footprint then smallest longest side**, so the packer finds the realistic stacked box for the common "large item fills the floor, smaller items stack on top" pack (e.g. base 15×10×4 + two 10×5×2 → exactly 15×10×6, not the equal-volume 15×15×4; base 38×25×10 + two 25×13×5 → 38×25×15).
- **Default safety padding reduced from +2 cm to +1 cm** per dimension (`DEFAULT_PACKING_PADDING_CM`), better matching tight-packing merchants while still never undersizing.

**Propagation:**
- Severity: NORMAL (shipping accuracy + new optional fields) · Layers: backend (`common/shipping/cartonize.ts`, `chargeable-weight.ts`, `queues/workers/shipping.worker.ts`, `modules/products/products.{schemas,types,service}.ts`, `modules/cart/cart.service.ts`, `modules/orders/orders.{service,schemas}.ts`, `prisma/schema.prisma`)
- Migration: **YES** — `20260628120000_add_variant_keep_upright` adds `ProductVariant.keepUpright BOOLEAN NOT NULL DEFAULT false` (non-breaking; backfills `false`). Run `prisma migrate deploy` + `prisma generate` on each client.
- Flag: n/a (additive; defaults to old free-rotation behavior when `keepUpright=false`) · Design impact: none · Breaking: NO
- Rollback: revert the listed files + the migration (drop the column).
- Ops note: pairs with frontend-core 0.1.8 (admin editor keepUpright checkbox). Padding change slightly lowers computed box sizes — re-quotes remain quote==billed.

## [0.1.12] — 2026-06-22

### Added
- **Store identity/contact in the public store config.** `GET /store/config` (`getPublicStoreConfig`) now returns `storeName`, `storeAddress` (from `StoreSettings.sellerAddress`), `storeState`, `contactEmail`, `contactPhone` so the storefront can render a merchant-managed address/contact (footer, contact surfaces) without admin auth. All merchant-editable in Admin → Settings → Store; no schema change (reuses existing fields).

**Propagation:**
- Severity: NORMAL (additive public-config fields) · Layers: backend (`modules/settings/settings.service.ts`, `settings.schemas.ts`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO (purely additive)
- Rollback: revert the two settings files
- Ops note: pairs with frontend-core 0.1.7 (footer reads these). Address shown = `StoreSettings.sellerAddress`.


## [0.1.11] — 2026-06-22

### Removed
- **Dead `selectBestFitBox`** (volume-only box picker) deleted from `common/shipping/select-box-preset.ts` — superseded by the 3D `cartonize` engine (0.1.9). `parseBoxPresets` + the `BoxPreset` type remain (used by cart/worker/settings). Its volume-only tests were dropped; 3D box selection is covered by `cartonize.test.ts`.

### Changed
- **`shiprocket.adapter.ts`**: clarified the `15×15×10` dimension fallback is a last-resort guard only (the AWB worker always passes cartonized dimensions now).
- **Docs**: integration guide §6.0 documents shipping cartonization (variant dims → box presets / bounding box → volumetric billing; quote == billed).

**Propagation:**
- Severity: LOW (dead-code removal + comments/docs; no behavior change) · Layers: backend (`common/shipping/select-box-preset.ts`, `modules/shipping/adapters/shiprocket.adapter.ts`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO (no remaining callers of `selectBestFitBox`)
- Rollback: restore the function

## [0.1.10] — 2026-06-22

### Added
- **`core-manifest.json`**: `backend/queues/**` added to `backendCore.include`. The BullMQ workers/queues are shared core but were never core-synced — so the 0.1.9 cartonization wiring in `queues/workers/shipping.worker.ts` could not propagate. Now they're in scope (clients verified identical to template before enabling, zero drift). This + the 0.1.9 `components/admin/**` inclusion close the two remaining "core code that wasn't core-synced" gaps.

**Propagation:**
- Severity: NORMAL (manifest scope only) · Layers: `core-manifest.json` + `backend/queues/**` now in scope
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the manifest include line
- Ops note: because `queues/**` and `components/admin/**` were newly added to scope, the 0.1.9→0.1.10 worker + admin-editor files were delivered to existing clients by a one-time deterministic `git checkout <tag> -- <file>` (version-delta sync can't retroactively pull files for a path that wasn't in the client's manifest when the change shipped). Future changes in these paths propagate normally.

## [0.1.9] — 2026-06-22

### Added
- **Multi-item box cartonization** (`src/common/shipping/cartonize.ts`) — computes the ACTUAL shipping box for an order so the dimensions sent to Shiprocket/Delhivery match the parcel couriers bill on (volumetric weight = L×W×H ÷ 5000). A conservative 3D Extreme-Point first-fit-decreasing packer (never undersizes): uses the smallest Ops **catalog box** the items physically fit into, else a **computed bounding box**, then adds +2 cm safety padding. Returns L×W×H + total weight.
- **`core-manifest.json`**: `frontend/components/admin/**` added to `frontendCore.include` so the admin console is now core-synced (it was the only admin path missing — `app/(admin)` pages, `actions/`, `hooks/` were already core). Verified both clients' admin was already identical to template (zero divergence) before enabling.

### Changed
- **AWB worker** (`queues/workers/shipping.worker.ts`) now sends cartonized dimensions on every shipment (was: volume-only best-fit that only set dims when presets existed, else the adapter's `15×15×10` default).
- **`chargeable-weight.ts`** routes through the same `cartonize` engine, so the cart rate quote's volumetric weight equals what the courier later bills (quote == billed).

**Propagation:**
- Severity: NORMAL (shipping accuracy + manifest scope; no breaking API change)
- Layers: backend (`common/shipping/cartonize.ts` [new], `chargeable-weight.ts`, `queues/workers/shipping.worker.ts`), `core-manifest.json`
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the three shipping files + the manifest include line
- Ops note: per-variant box dimensions (length/width/height) drive accuracy — ensure variants have them set (now fully editable in the admin product editor, frontend-core 0.1.5). Optional: configure standard carton sizes as box presets in Ops to switch to catalog cartonization.

## [0.1.8] — 2026-06-22

### Added
- **Client extension layer for frontend components.** `core-manifest.json` now excludes `frontend/components/client/**` — the canonical home for per-client component variants (alongside the existing `frontend/app/(client)/**` for pages and `backend/src/modules/client/**` for backend). Client-only UI that previously had to live in core paths (`components/cart`, `components/layout`, …) now has a non-core home and won't trip the drift gate.

### Changed
- **`check-core-drift.sh` failure message** now spells out the full client extension layer (pages → `app/(client)/**`, components → `components/client/**`, backend → `src/modules/client/**`) so the fix path is obvious when the gate fires.

**Propagation:**
- Severity: NORMAL (manifest/tooling; no runtime/API change)
- Layers: `core-manifest.json` [core], `backend/scripts/check-core-drift.sh` [core]
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the manifest exclude + script message
- Ops note: existing clients that built client-only UI into core paths should move it to `components/client/**` / `app/(client)/**` (URLs unchanged for route-group page moves). See guide §1.1.

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
