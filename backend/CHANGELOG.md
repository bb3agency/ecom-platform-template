# Backend Core — Changelog

Semantic versioning (`MAJOR.MINOR.PATCH`). This file is the **propagation instruction set**: each entry tells every client repo exactly what to apply when syncing this core version. See `docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`.

- **PATCH** — bug/security fix, no contract change. Safe to merge into all clients.
- **MINOR** — backward-compatible feature. Ships **OFF** behind a flag where it adds surface area.
- **MAJOR** — breaking change / migration required. Deliberate per-client upgrade.

Each entry MUST carry the **Propagation** block (layers · migration · flag · design impact · severity · breaking · rollback).

---

## [Unreleased]

## [0.1.46] — 2026-07-03

### Fixed
- **Applied coupon never showed on the admin order detail ("No coupon applied" even when one was used).** The serializer emits a `coupon` object, but the admin/customer order-detail schema only declared `couponCode` — `additionalProperties: false` stripped `coupon` entirely, and nothing ever set `couponCode`. Fixed both: the schema now declares the nullable `coupon` object (code-only on customer reads, full fields on admin reads), and the serializer also emits a flat `couponCode` for chip-style surfaces. FREE_SHIPPING coupons (₹0 discount) were already finalized into `CouponUsage` on every payment path — display-only bug.
- **`POST /admin/orders/:id/notifications/retrigger` sent the internal UUID as the order reference** on all three channels — now selects + passes `orderNumber` (completes the 0.1.44 orderNumber sweep).

**Propagation:**
- Severity: NORMAL · Layers: backend (`modules/orders/{orders.service.ts,orders.schemas.ts}`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO (additive schema property)
- Rollback: revert the two files
- Pairs with frontend-core 0.1.31. NOTE: cartonization was evaluated for further tightening (pairwise-sum footprints find mathematically smaller boxes) but intentionally NOT changed — the suite pins merchant-verified realistic packs (stacked-on-base over flat-spread), and the candidate change regressed those expectations.

## [0.1.45] — 2026-07-03

### Security
- **Closed the residual 5xx leak gaps around 0.1.44's generic-500 fix.** (1) **502/504** AppErrors still spread the throw-site `details` object (and `kind`/`hintKey`) into responses — now every >500 status EXCEPT 503 keeps its crafted in-house message but sends only `retryable`/`remediation`, with the full detail logged server-side. **503 is deliberately exempt**: all hintKey-bearing 5xx contracts (`ops_audit_chain_lock_timeout`, `ops_restart_*`, OTP-deliverability guidance) are 503s that ops/admin UIs consume — verified and covered by a regression test. (2) **Shiprocket adapter no longer embeds raw provider response bodies in error messages** (the "Shiprocket API HTTP 400: {json…}" strings — thrown as 422, so the 5xx sanitizer never saw them). It now extracts only Shiprocket's human-readable `message` field ("Order is already canceled"), or a bare `HTTP <status>` when the body isn't parseable. Delhivery's messages were audited — already curated (specific `remarks`/key names only).

**Propagation:**
- Severity: HIGH (information disclosure follow-up) · Layers: backend (`common/errors/error-handler.ts` + tests, `modules/shipping/adapters/shiprocket.adapter.ts`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO (503 contract byte-identical; 502 messages unchanged)
- Rollback: revert the two files
- Completes 0.1.44's generic-500 hardening.

## [0.1.44] — 2026-07-03

### Security
- **500 responses no longer leak internal fields to callers.** The global error handler previously (a) sent `details.kind`/`details.hintKey` on every 500 and (b) — worse — spread a 500-class `AppError`'s entire throw-site `details` object AND its message into the response (e.g. `Server: Shiprocket API HTTP 400: {...}` reached unauthenticated browsers). Now every 500 returns a generic body — `code: INTERNAL_ERROR`, message `"Something went wrong. Please try again later."`, details limited to `retryable`/`remediation` — while the full error (code, message, details) is logged server-side only. 4xx/503 contracts unchanged (`kind`/`hintKey` still sent; storefront OTP-hint logic is 4xx-only). Schema: `errorDetailsSchema` now requires only `retryable`/`remediation`. Regression tests: unexpected-error 500, AppError-500 with fake secrets (nothing leaks, hintKey IS in the server log), 409 keeps kind/hintKey.

### Fixed
- **Notifications rendered the internal order UUID instead of the order number.** WhatsApp/SMS templates fill `{{orderId}}`; enqueue sites pass both `orderId` (uuid) and `orderNumber`, but the registries forwarded the uuid. Both `composeTemplateData()`s now prefer `orderNumber` — customers see `ORD-G343-TRCN`, never `947f0937-…`. Also added the missing `orderNumber` to the merchant OrderShipped alert and the customer OrderCancelled enqueue. Registry regression test added.
- **Admin order search now matches shipment AWB / tracking numbers** (both admin order-list queries) in addition to order number, customer name/email/phone.
- **Fulfilment actions blocked on terminal orders.** `adminSchedulePickup` / `adminPrintLabel` now 409 (`INVALID_STATUS_TRANSITION`) when the order is CANCELLED/REFUNDED or the shipment is CANCELLED — previously they'd call the courier API and surface provider errors (e.g. Shiprocket "Order is already canceled").

**Propagation:**
- Severity: HIGH (500 detail leak = information disclosure) · Layers: backend (`common/errors/{error-handler.ts,error-response.schema.ts}`, `modules/notifications/{whatsapp,sms}-template-registry.ts`, `modules/orders/orders.service.ts` + tests)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO (4xx contract unchanged; 500 consumers must not rely on kind/hintKey — none did)
- Rollback: revert the listed files
- Pairs with frontend-core 0.1.30 (generic-500 message suppression, fulfilment button gating, viewport fixes).

## [0.1.43] — 2026-07-03

### Fixed (docs-only — brings every WhatsApp/notification/pointer doc up to date with 0.1.30–0.1.42)
- **`META_WHATSAPP_SETUP_GUIDE.md`**: added `return_request_update` to the Utility template table (+ note that `{{3}}` carries the stage wording so one template covers the whole return lifecycle); time-budget count 6→7 utility templates.
- **`THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`**: rewrote the per-template channel section — it still described the OLD single-primary model ("13 templates", "no fallback", "merchant UI removed"). Now documents the multi-channel SET model, the deliverable-filter + email fallback, phone-required skip, the `OTP_WHATSAPP_ENABLED` gate, and the re-added Admin → Settings → Notifications panel.
- **`ENV_VS_DB_CONFIG_REFERENCE.md`**: `OTP_WHATSAPP_ENABLED` note claimed "Admin login OTP is unaffected (email-based)" — stale since 0.1.33; now covers customer + admin login + admin invite setup with the email security floor.
- **`MASTER_DEPLOYMENT_PLAYBOOK.md`**: staging notification-routing test updated to array values + fan-out/fallback semantics ("13 templates"/"no fallback" removed); sample order shape now shows the random `ORD-XXXX-XXXX` reference.
- **`CLIENT_HANDOFF_INDEX.md`**: WhatsApp pointer now says 7 utility templates incl. `return_request_update`.
- **`API_ENDPOINT_INDEX.md`**: annotated `PATCH /users/me` (phone add/update/remove + last-identifier guard), return-request create (toggle gate + open-request 409), admin return PATCH (enforced transitions + customer notification), and `GET /store/config` (merchant toggles incl. `returnsEnabled`).
- **`NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`**: store-config field table — `reviewsEnabled` corrected to DB merchant toggle (was "Backend FEATURE_REVIEWS_ENABLED") and `returnsEnabled` row added.
- **Root `docs/clients/raghava-organics/VPS_INPUTS.template.md`**: new "Meta WhatsApp (Ops UI)" section — all 9 Ops keys with go-live guidance, webhook URL/fields, and the 8-template approval checklist.

**Propagation:**
- Severity: LOW (documentation) · Layers: backend docs only
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the doc files

## [0.1.42] — 2026-07-03

### Changed
- **Return-request updates now route through the merchant's multi-channel toggles (`send-primary`) instead of a hard-coded email.** `adminUpdateReturnRequest` enqueues `send-primary` with BOTH the customer's email and phone plus a composed `returnStatusLine` — so the decision can fan out to Email + WhatsApp + SMS per `primaryNotificationChannels['ReturnRequestUpdate']` (defaults to `['EMAIL']` for merchants whose stored routing predates the template; worker default-seeding verified).
- **WhatsApp:** registry maps `ReturnRequestUpdate` → Meta Utility template **`return_request_update`** (`{{1}}` storeName, `{{2}}` orderId, `{{3}}` returnStatusLine — one approved template covers approved/declined/picked-up/refunded). ⚠️ **Operator action:** the template must be created + approved in WhatsApp Manager (canonical body in `docs/WHATSAPP_TEMPLATE_REGISTRY.md`) before enabling the WhatsApp toggle for this row; until then keep it Email-only.
- **SMS:** default `ReturnRequestUpdate` text added to the SMS template registry.

**Propagation:**
- Severity: NORMAL (channel routing for an existing notification) · Layers: backend (`modules/orders/orders.service.ts`, `modules/notifications/{whatsapp-template-registry.ts,sms-template-registry.ts}` + tests, `docs/WHATSAPP_TEMPLATE_REGISTRY.md`)
- Migration: NO · Flag: merchant per-template channel toggles (Email default) · Design impact: none · Breaking: NO
- Rollback: revert the listed files
- Pairs with frontend-core 0.1.28 (routing row in the notifications panel).

## [0.1.41] — 2026-07-03

### Changed
- **Order numbers are now random and unguessable (`ORD-XXXX-XXXX`), not sequential.** `ORD-2026-00039`-style sequential numbers leaked business volume (two orders reveal the sales rate) and made references enumerable. New format follows large-marketplace practice: `crypto.randomInt` over an unambiguous 31-char alphabet (no I/L/O/0/1 — phone-readable), grouped `ORD-XXXX-XXXX`, ~8.5e11 space; pre-insert uniqueness check (5 attempts, fails loudly) on top of the DB `@unique` constraint. New `modules/orders/order-number.ts` + tests; both checkout paths (COD `createOrder` + prepaid `confirmPrepaid`) migrated off the Postgres `order_number_seq` (sequence left in place, unused; existing orders keep their old numbers — both formats coexist under the same unique column). **Audited every consumer:** nothing parses the format — Razorpay `receipt` (≤40 chars ✓), Shiprocket `order_id`/fallback `sku`, Delhivery order ref, webhooks (resolve via `providerOrderId`/AWB, never the order number), emails/WhatsApp (display-only), admin search (substring). **GST invoice numbers (`INV-YYYY-#####`) intentionally remain SEQUENTIAL** — CGST Rule 46(b) requires consecutive invoice serials; only the customer-facing order reference is randomized.

### Added
- **Merchant returns toggle + hardened return flow** (see also frontend-core 0.1.27):
  - `StoreSettings.returnsEnabled` (migration `20260703120000`, default **true**) — editable in Admin → Settings; exposed in `GET /store/config`; enforced server-side in `createReturnRequest` (400 when off).
  - **One open return per order:** new request → 409 `CONFLICT` while an earlier one is `REQUESTED`/`APPROVED`/`PICKED_UP` (a `REJECTED` request may be retried).
  - **Status transition guard:** `REQUESTED→APPROVED/REJECTED`, `APPROVED→PICKED_UP/REJECTED`, `PICKED_UP→REFUNDED`; `REJECTED`/`REFUNDED` terminal — otherwise 409 `INVALID_STATUS_TRANSITION`.
  - **Customer decision emails:** new `ReturnRequestUpdate` template (per-status copy for approved/declined/picked-up/refunded + store note with `[admin:…]` markers stripped) enqueued best-effort on every real transition.
  - **Customer visibility:** `GET /orders/:id` now returns `returnRequests` (sanitized notes) so the storefront shows return status and suppresses duplicate filing.

**Propagation:**
- Severity: HIGH (security posture of order references + complete returns control) · Layers: backend (`modules/orders/{order-number.ts,orders.service.ts,orders.schemas.ts}`, `modules/settings/**`, `modules/notifications/templates/**`, `prisma/schema.prisma` + migration, tests, `docs/ROUTE_SURFACE_COMPLETE_REFERENCE.md`)
- Migration: YES — `20260703120000_add_store_settings_returns_enabled` (additive column, default true; auto-applied by deploy) · Flag: `StoreSettings.returnsEnabled` (DB-backed merchant toggle, default ON = behaviour unchanged) · Design impact: none · Breaking: NO
- Rollback: revert the listed files (existing random order numbers remain valid strings)
- Pairs with frontend-core 0.1.27.

## [0.1.40] — 2026-07-03

### Added
- **Customer order detail items are enriched for the storefront UI.** `GET /api/v1/orders/:id` items now carry `productSlug`, `imageUrl` (first product image, `null` when none) and `isPurchasable` (variant AND product still active) — loaded via the variant→product relation on the customer path only. Admin order paths keep the exact legacy item shape (`orderItemSchema` gains the three fields as optional). The raw Prisma `variant` relation is explicitly mapped away so it can never leak into the payload (regression-tested).

**Propagation:**
- Severity: NORMAL (additive response fields) · Layers: backend (`modules/orders/{orders.service.ts,orders.schemas.ts}` + security test)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the listed files
- Pairs with frontend-core 0.1.26 (order detail redesign: item thumbnails deep-linking to `/products/<slug>?variant=<id>` + invoice-style table).

## [0.1.39] — 2026-07-03

### Added
- **Customers can add / update / remove their mobile number** via `PATCH /api/v1/users/me` (`phone: string | null`; format `^\+?[0-9]{10,15}$`). Guards: a number already linked to another account → **409** ("This mobile number is already linked to another account."); removal is refused with a clear **400** when the account has no email — the phone would be the customer's ONLY OTP sign-in identifier. Pairs with the redesigned account Settings page (frontend-core 0.1.24). Unit tests for set/conflict/remove/last-identifier.

**Propagation:**
- Severity: NORMAL (additive profile capability) · Layers: backend (`modules/users/{users.schemas.ts,users.types.ts,users.service.ts}` + `users.service.profile.test.ts`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the listed files
- Note: the new number is accepted without OTP-verifying it first (the session itself is already authenticated). OTP-verify-the-new-number is a possible hardening follow-up.

## [0.1.38] — 2026-07-03

### Fixed
- **A deactivated product/variant could still be PURCHASED through a stale cart.** Checkout (`createOrder` AND `prepareCheckout`) validated only stock — never `isActive`. A merchant-pulled product sitting in a customer's cart from before deactivation sailed straight through to a paid order. Both paths now reject inactive lines with a clear, actionable message (`"<product>" is no longer available. Remove it from your cart to continue.`). Found during the cross-surface security/logic audit.
- **Deactivation now removes the item from live carts immediately.** `PATCH …/variants/:variantId` with `isActive: false` and `DELETE /admin/products/:id` (product deactivate) purge the affected variants' `CartItem` rows AND `CartReservation` stock holds, so shoppers neither see nor carry a pulled item. Existing ORDERS are untouched — they snapshot the variant and keep flowing through packing/delivery. (Checkout guard above remains as defense-in-depth for race windows.)

### Security audit (cross-surface, this release)
Verified clean, no changes needed: customer order/invoice/cancel routes are scoped `{ id, userId }` (no IDOR); local media serving sanitizes segments, rejects `..`, and enforces root containment + extension allowlist; Razorpay + Meta webhook signatures use HMAC-SHA256 with `timingSafeEqual`; cart quantities are schema-bounded (1–1000); cart session tokens are `crypto.randomUUID`; no `dangerouslySetInnerHTML` anywhere in the frontend. The two findings above were the real gaps.

**Propagation:**
- Severity: HIGH (deactivated items purchasable; merchant pull not reflected in carts) · Layers: backend (`modules/products/products.service.ts`, `modules/orders/orders.service.ts`, + tests incl. new `orders.service.create-order.inactive-item.test.ts`), docs (`ROUTE_SURFACE_COMPLETE_REFERENCE.md`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO (new 400 replaces silently-wrong success)
- Rollback: revert the listed files
- Pairs with frontend-core 0.1.23 ("Deactivate instead?" flow on the variant-delete 409).

## [0.1.37] — 2026-07-03

### Fixed
- **Deleting a product variant 500'd instead of succeeding (or returning a clean error).** `adminDeleteProductVariant` did a bare `prisma.productVariant.delete()`. `CartItem.variant` and `OrderItem.variant` are both `onDelete: Restrict`, so any variant that was sitting in a cart or an order made the delete throw an unhandled Prisma P2003 foreign-key error → `500 INTERNAL_ERROR` (seen in the admin product editor). Now: (1) if the variant appears in any **order**, return a clean **409 CONFLICT** ("Cannot delete a variant that appears in existing orders. Deactivate it instead.") — its order history/invoices must be preserved; (2) otherwise clear the transient **cart lines** in the same transaction before deleting (Inventory, InventoryAdjustment and CartReservation already cascade). Added regression tests for the 409 path and the cart-cleanup path.

**Propagation:**
- Severity: HIGH (variant delete unusable whenever the variant was ever carted/ordered) · Layers: backend (`modules/products/products.service.ts` + `products.service.variant-delete.test.ts`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO (adds a 409 for the order-history case that previously 500'd)
- Rollback: revert the two files

## [0.1.36] — 2026-07-02

### Fixed
- **Refresh-token cookie `SameSite=Strict` → `Lax` (session dropped on mobile / after arriving from an external link).** With `Strict`, the browser withholds the refresh cookie on a top-level navigation that arrives from **another site** — which is how most mobile users open the store (a link in Google results, a WhatsApp/Instagram in-app browser, an email). On that first cross-site arrival the session-restore call had no cookie, so the user looked logged out; desktop users who type the URL or use a bookmark (same-site) kept their session — exactly the "fine on desktop, drops on mobile" report. `Lax` sends the cookie on top-level navigations while still withholding it on cross-site sub-requests (fetch/XHR/POST), so the POST-only, HttpOnly, rotated `/auth/refresh` keeps its CSRF protection. This also makes the refresh cookie consistent with the guest-cart cookie, which was already `Lax` for the same "survive navigations" reason. Updated both the set- and clear-cookie headers (clear must mirror attributes to match) + tests. Ops session cookie stays `Strict` (single-origin admin tool, never entered cross-site).

**Propagation:**
- Severity: HIGH (customers/admins silently logged out on mobile & external-referral entry) · Layers: backend (`modules/auth/auth-cookies.ts` + test)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO (existing `Strict` cookies keep working until they next rotate to `Lax`)
- Rollback: revert `auth-cookies.ts`
- Pairs with frontend-core 0.1.18 (restore-deadline + retryable-timeout so slow mobile networks don't spuriously clear a valid session).

## [0.1.35] — 2026-07-02

### Fixed
- **WhatsApp sends silently used Graph API v21.0 instead of v25.0.** Both `MetaWhatsAppAdapter` instantiations in `notifications.worker.ts` (OTP path + order-notification path) passed `META_WHATSAPP_API_VERSION ?? 'v21.0'` — a stale fallback missed in the v25.0 upgrade. Because the version was passed **explicitly**, it overrode the adapter's own `v25.0` default, so every WhatsApp message hit `/v21.0/` whenever ops hadn't set `META_WHATSAPP_API_VERSION`. Changed both fallbacks to `'v25.0'`. Added an adapter regression test asserting the constructor default is v25.0 when no version is supplied.
- **Docs: WhatsApp OTP cost default was documented as 12 paise but the code default is 14.** Corrected the `WHATSAPP_OTP_COST_PAISE` note in `ops-config-contract.ts` and the header comment in `whatsapp-otp-cost.ts` to `14 (~₹0.115 + 18% GST)`, matching `DEFAULT_WHATSAPP_OTP_COST_PAISE` and `.env.example`.

**Propagation:**
- Severity: NORMAL (WhatsApp delivery used an older API version; no outage, but drifting from the pinned v25.0 and any v25-only template behaviour) · Layers: backend (`queues/workers/notifications.worker.ts`, `modules/notifications/adapters/meta-whatsapp.adapter.test.ts`, `common/notifications/whatsapp-otp-cost.ts`, `modules/ops/ops-config-contract.ts`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the listed files
- Follow-up to the v25.0 upgrade (0.1.x) and multi-channel work (0.1.30–0.1.34). Operator: optionally set `META_WHATSAPP_API_VERSION` in Ops → Config to pin explicitly; otherwise the default is now v25.0.

## [0.1.34] — 2026-07-02

### Fixed
- **Type error in the 0.1.33 admin-setup OTP fan-out test.** The new test indexed `mock.calls.map((c) => c[0])` on a `vi.fn()` whose args aren't typed, so `tsc` (which includes `*.test.ts`) failed with `TS2493: Tuple type '[]' … has no element at index '0'` — caught by client `reliability-gates` Typecheck. Replaced with `toHaveBeenCalledWith('send-email' | 'send-whatsapp', …)` assertions like the sibling tests. No runtime/behaviour change; supersedes 0.1.33's sync PRs.

**Propagation:**
- Severity: LOW (test-only typecheck fix) · Layers: backend (`modules/auth/admin-invites.service.test.ts`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: n/a (roll up with 0.1.33). Merge this sync PR instead of the 0.1.33 one.

## [0.1.33] — 2026-07-02

### Fixed
- **Multi-channel notification save was silently rejected with 400 (`VALIDATION_ERROR`).** The 0.1.30 multi-channel change updated the `GET /admin/settings/notifications` *response* schema to accept array-valued `primaryChannels` (`{ OrderConfirmed: ['EMAIL','WHATSAPP'] }`), but the `PATCH` *body* schema was missed — it still only allowed a single string per template. So the Admin → Settings → Notifications panel (which always PATCHes arrays) failed every save with "Please check the highlighted fields and try again", including when merely enabling WhatsApp. Fixed the update body schema to accept string OR array (`anyOf`), matching the response schema. Added route-level regression tests (array save persists as array; legacy single-string still accepted).
- **Admin setup/signup OTP was never migrated to multi-channel (overseen in 0.1.30).** `AdminInvitesService.sendSetupOtp` still resolved a single channel via the old `resolvePrimaryOtpChannel` path, so an admin completing signup only ever got their OTP on ONE channel — inconsistent with admin *login* OTP, which fans the same OTP to email **and** WhatsApp. Rewrote it to mirror `requestAdminLoginOtp`: `resolveOtpDeliveryChannels({ preferEmail: true })` (email is always a delivery floor), WhatsApp/SMS only when `OTP_WHATSAPP_ENABLED` is on AND the invitee supplied a phone, hard error only if the primary channel needs a phone the invitee lacks. Same OTP, one hash, verified identically. Added a fan-out test.

**Propagation:**
- Severity: HIGH (multi-channel notification settings were unsaveable end-to-end) · Layers: backend (`modules/settings/settings.schemas.ts`, `modules/auth/admin-invites.service.ts`, `+` tests)
- Migration: NO · Flag: `OTP_WHATSAPP_ENABLED` still gates OTP-over-WhatsApp · Design impact: none · Breaking: NO (single-string bodies still accepted)
- Rollback: revert the two source files
- Follow-up to 0.1.30 (multi-channel routing). No operator action — merchants can now save channel toggles; admin signup OTP now fans out like admin login.

## [0.1.32] — 2026-07-02

### Fixed
- **Build-cache cap was silently ineffective — `docker buildx prune` → `docker builder prune`.** `docker compose build` fills the dockerd-integrated BuildKit cache; the deploy + daily-cron cleanups were trimming it with `docker buildx prune`, which can target a different builder and leave the real cache uncapped. Result: ~18 GB of build cache accumulated on the shared host despite a "keep 3–5 GB" step, eventually filling the disk (100%). Switched both `scripts/vps-deploy.sh` (pre- and post-build) and `scripts/vps-cleanup-template.sh` (daily cron) to `docker builder prune --keep-storage`, so the cache is actually capped every deploy and every night.
- **Deploy now fails LOUDLY on low disk instead of a cryptic mid-build error.** After the pre-build reclaim, if free space on the Docker root is still under `PREBUILD_HARD_FLOOR_GB` (default 3), `vps-deploy.sh` aborts with a clear "insufficient disk / free it and re-run" message before building — no more half-written images or opaque "no space left on device" layer-extract failures.

**Propagation:**
- Severity: NORMAL (deploy reliability) · Layers: backend (`scripts/vps-deploy.sh`, `scripts/vps-cleanup-template.sh`)
- Migration: NO · Flag: `PREBUILD_MIN_FREE_GB` (default 8) + `PREBUILD_HARD_FLOOR_GB` (default 3) env · Design impact: none · Breaking: NO
- Rollback: revert the two scripts
- **Operator: (1) ensure the daily cron cleanup is installed per client — `sudo bash backend/scripts/install-vps-cleanup.sh` (writes `/etc/cron.daily/vps-cleanup-<client>`); (2) after this syncs, the next deploy's pre-build prune keeps the cache capped automatically.** Follow-up to 0.1.31 (pre-build reclaim).

## [0.1.31] — 2026-07-02

### Fixed
- **VPS deploy no longer wedges on "no space left on device".** On small/shared multi-client hosts the Docker layer extract could fail with a full disk mid-build; because the existing image/BuildKit prune only ran AFTER a successful build, a near-full disk deadlocked every subsequent deploy (build dies → cleanup never runs). Added a **pre-build reclaim** step to `scripts/vps-deploy.sh`: always prune stopped containers + dangling images + cap the BuildKit cache (keep 3 GB), trim GitHub Actions runner `_diag/*.log` (which grow unbounded on the same volume), and — when free space on the Docker root is under `PREBUILD_MIN_FREE_GB` (default 8) — hard-purge all unused images + the entire build cache. Never touches running containers, in-use images, or named volumes (Redis/Postgres data safe).

**Propagation:**
- Severity: NORMAL (deploy reliability) · Layers: backend (`scripts/vps-deploy.sh`)
- Migration: NO · Flag: `PREBUILD_MIN_FREE_GB` env (optional, default 8) · Design impact: none · Breaking: NO
- Rollback: revert the pre-build block
- **Operator (one-time, if a host is already wedged):** manually reclaim first — `docker container prune -f && docker image prune -af && docker buildx prune -af`, delete old `~/actions-runner/_diag/*.log`, then re-run the deploy; the new pre-build step keeps it clean afterward. Consider adding host swap on very small boxes.

## [0.1.30] — 2026-07-02

### Changed
- **Per-template notification routing is now MULTI-channel.** `StoreSettings.primaryNotificationChannels[template]` changed from a single channel (`'EMAIL'`) to a **set** (`['EMAIL','WHATSAPP']`) — a notification fans out to EVERY selected channel. No migration: it's a `Json` column; the service/worker normalize legacy single-string values to `[value]`, and the API accepts string OR array (`anyOf`).
  - **Order notifications:** the `send-primary` worker handler wraps its existing per-channel delivery in a `deliverOne(channel)` loop over the configured array. Single channel keeps the original retry/unrecoverable semantics; multi-channel is best-effort per channel (each already logs + alerts) so one failing channel neither blocks the others nor triggers a whole-job retry that would duplicate the ones that already sent.
  - **OTP (customer + admin):** `resolveOtpDeliveryChannels` now reads the configured channel set (∩ deliverable). **WhatsApp for OTP keeps the ops `OTP_WHATSAPP_ENABLED` kill-switch** — a merchant can select WhatsApp for OTP, but it only actually sends when ops has that flag on (paid-feature gate). Admin login OTP (`preferEmail`) always includes email when deliverable (security floor) plus any configured extras — so the same OTP goes to email **and** WhatsApp when configured + gated on. Registry now also maps **`OtpVerification` → `otp_verify`** (admin OTP over WhatsApp).
  - **Email fallback ("if WhatsApp isn't set up / is off, send to email anyway"):** the order worker filters the configured set to currently-deliverable channels and falls back to `['EMAIL']` when none can deliver, so a WhatsApp-only mapping still notifies via email when WhatsApp is off. OTP falls back to the first deliverable channel (email-first would strand phone-only signups that have no email address).
  - **WhatsApp/SMS require a phone on file:** deliverOne skips WhatsApp/SMS for any recipient without a phone number (order recipients, and admin/merchant users — admin login OTP only fans to WhatsApp when the admin has `user.phone`).
- `providerAvailability.otpWhatsappEnabled` added to `GET /admin/settings/notifications` so the panel can flag "WhatsApp OTP won't send until ops enables it".

**Propagation:**
- Severity: NORMAL (feature; multi-channel is opt-in per template, defaults unchanged = email) · Layers: backend (`queues/workers/notifications.worker.ts`, `common/notifications/otp-deliverability.ts`, `modules/auth/{otp-channel.ts,auth.service.ts}`, `modules/notifications/whatsapp-template-registry.ts`, `modules/settings/**`)
- Migration: NO (`Json` column; values normalized on read/write) · Flag: `OTP_WHATSAPP_ENABLED` still gates OTP-over-WhatsApp · Design impact: none · Breaking: NO (single-string configs still work)
- Rollback: revert the listed files (stored arrays still read fine as sets)
- Pairs with frontend-core 0.1.17 (per-template on/off channel toggles). Merchant enables channels in Admin → Settings → Notifications; each notification sends to all enabled+provisioned channels.

## [0.1.29] — 2026-07-02

### Changed
- **Core TEST files and the committed `.env.example` now sync automatically (manifest change) — no more manual hand-delivery to each client.** Root cause of the recurring "deliver the changed test file / add the env key to every client by hand" toil: `core-manifest.json` excluded `**/*.test.ts`/`*.spec.ts` and `backend/.env.*` from sync, so a core change that altered test expectations or added an env key shipped source-only and each client's CI went red until patched by hand — unworkable at 10+ clients. Now: core test files live inside the already-core paths and are no longer excluded (so `sync-core.mjs` delivers them with their source AND `check-core-drift.sh` keeps them in lockstep); `backend/.env.example` is an explicit core include. Real secret env files (`.env`, `.env.local`, `.env.*.local`) are gitignored/untracked and are never synced regardless. Client-specific tests are excluded via the client-extension paths (`src/modules/client/**/*.test.ts`, `frontend/{components/client,app/(client)}/**/*.test.*`). `check-core-purity` already skips `*.test.*`/`*.spec.*`, so template test sample data doesn't trip the brand guard. **First sync per client wholesale-aligns all test files** to bring drift green in one shot; deltas after that.
- **OTP WhatsApp template renamed `otp_verification` → `otp_verify`.** Meta enforces a 30-day cooldown on reusing a deleted template name and blocks re-registering `otp_verification` under a different category during that window, so the original name is unusable now. `otp_verify` is a fresh name that registers as Authentication immediately. Files: `whatsapp-template-registry.ts` (+ test), `adapters/meta-whatsapp.adapter.test.ts`, `docs/WHATSAPP_TEMPLATE_REGISTRY.md`.

**Propagation:**
- Severity: NORMAL (infra: sync-completeness) · Layers: backend (`core-manifest.json`, `modules/notifications/whatsapp-template-registry.ts`)
- Migration: NO · Flag: n/a (manifest) / `OTP_WHATSAPP_ENABLED` (rename, unchanged) · Design impact: none · Breaking: NO
- Rollback: restore the manifest excludes + revert the rename
- **From this release on, core test + `.env.example` changes propagate through core-sync with zero manual delivery.** Operator: create the `otp_verify` Authentication template (Copy-code button, English, sample 123456) and approve before enabling `OTP_WHATSAPP_ENABLED`.

## [0.1.28] — 2026-07-02

### Changed
- **Customer OTP WhatsApp template switched from Utility to AUTHENTICATION** (Meta rejects verification-code content in Utility — the "Category does not match" dialog forces Authentication). `CustomerOtpVerification` now resolves with `authentication: true` and a **single** param (the code); the store name is no longer a body param (Authentication templates forbid custom copy — the store name shows as the message sender). The adapter (`meta-whatsapp.adapter.ts`) now builds the Authentication send payload: the code in BOTH a `body` component param AND a `button` component (`sub_type: 'url'`, `index: 0`) that echoes it (required by Meta for auth templates). `WhatsappTemplateDescriptor`/`ResolvedWhatsappTemplate` gained an `authentication` flag; ordinary templates keep the plain body-params path. Supersedes 0.1.27's utility-template mapping. Files: `whatsapp-template-registry.ts` (+ test), `adapters/meta-whatsapp.adapter.ts` (+ test), `docs/WHATSAPP_TEMPLATE_REGISTRY.md`.

**Propagation:**
- Severity: NORMAL (feature correction, still gated by `OTP_WHATSAPP_ENABLED` OFF) · Layers: backend (`modules/notifications/whatsapp-template-registry.ts`, `modules/notifications/adapters/meta-whatsapp.adapter.ts`)
- Migration: NO · Flag: `OTP_WHATSAPP_ENABLED` (unchanged) · Design impact: none · Breaking: NO
- Rollback: revert to 0.1.27 (utility mapping) — but that template will not get approved by Meta
- **Operator: create the `otp_verification` template with category AUTHENTICATION (Copy-code button, English, sample code 123456) and wait for Approved before enabling `OTP_WHATSAPP_ENABLED`.** Deliver the changed `whatsapp-template-registry.test.ts` + `meta-whatsapp.adapter.test.ts` to clients (excluded from core sync).

## [0.1.27] — 2026-07-02

### Added
- **WhatsApp OTP template wired into the registry** — `CustomerOtpVerification` now maps to the Meta **Utility** template `otp_verification` with positional params `[otp, storeName]` (`{{1}}` = code, `{{2}}` = store name, bolded via `*{{2}}*` in the body). This is the piece that makes `OTP_WHATSAPP_ENABLED=true` actually deliver: before this the customer OTP template was unmapped and fell through to the legacy raw-name path (Meta 132001). No special authentication-template payload needed — it's an ordinary body-params utility template, so the existing adapter path handles it. Approved body: *"Your verification code is {{1}}. Use this code to log in or sign up with \*{{2}}\*. For your security, do not share this code."* (reworded from a variable-leading form because Meta forbids a body starting/ending with a variable). Files: `whatsapp-template-registry.ts` (+ test), `docs/WHATSAPP_TEMPLATE_REGISTRY.md`.

**Propagation:**
- Severity: NORMAL (feature completion, still gated by `OTP_WHATSAPP_ENABLED` OFF) · Layers: backend (`modules/notifications/whatsapp-template-registry.ts`)
- Migration: NO · Flag: `OTP_WHATSAPP_ENABLED` (unchanged) · Design impact: none · Breaking: NO
- Rollback: revert the registry entry (customer OTP falls back to unmapped)
- **Operator: create the `otp_verification` Utility template in WhatsApp Manager (exact name + body + `{{1}}`/`{{2}}` samples) and wait for Approved BEFORE enabling `OTP_WHATSAPP_ENABLED`.** Deliver the changed `whatsapp-template-registry.test.ts` to clients alongside the source (excluded from core sync).

## [0.1.26] — 2026-07-02

### Added
- **OTP-over-WhatsApp (opt-in) + Ops cost meter.** Two new DB-overlay Ops config keys in the `notifications` domain: `OTP_WHATSAPP_ENABLED` (default `false`) and `WHATSAPP_OTP_COST_PAISE` (default `14`). When `OTP_WHATSAPP_ENABLED=true` **and** WhatsApp is deliverable, customer signup/login OTP (`CustomerOtpVerification`) is now sent to WhatsApp **in addition to** the primary channel (usually email) — same OTP, one hash, verified unchanged. New `resolveOtpDeliveryChannels()` (`common/notifications/otp-deliverability.ts`) returns the de-duplicated channel set; `auth.service.sendOtp()` loops over it. Admin login OTP is intentionally unchanged (email-based). New read-only Ops endpoint `GET /api/v1/ops/notifications/whatsapp-otp-cost` (`ops:read`) returns a cost estimate (all-time + current calendar-month cycle) computed from `NotificationLog` WhatsApp OTP sends × the configured per-message rate — surfaced as a small card on the Ops → Config page (frontend-core).
- Meta Graph API default bumped `v21.0` → **`v25.0`** (`meta-whatsapp.adapter.ts` default + `META_WHATSAPP_API_VERSION` fallback in `notification-provider.ts`).

### Notes
- **Not yet wired:** actual WhatsApp OTP delivery needs an approved Meta **AUTHENTICATION** template mapped as `CustomerOtpVerification` in `whatsapp-template-registry.ts` (a utility template cannot carry an OTP). Until that lands, turning the toggle on will enqueue a WhatsApp job that Meta rejects (email still sends). Auth-template support + forgot-password-over-WhatsApp are a follow-up.

**Propagation:**
- Severity: NORMAL (feature, OFF by default) · Layers: backend (`common/notifications/otp-deliverability.ts`, `common/notifications/notification-runtime-config.ts`, `common/notifications/whatsapp-otp-cost.ts` [new], `modules/auth/auth.service.ts`, `modules/ops/{ops-config-contract.ts,ops.routes.ts}`, `common/auth/admin-endpoint-policy-registry.ts`, `scripts/env-runtime-contract.js`, `.env.example`, adapters) + frontend (`lib/ops-client-api.ts`, `components/ops/OpsConfigPagePanel.tsx`)
- Migration: NO · Flag: `OTP_WHATSAPP_ENABLED` (DB-overlay, default off) · Design impact: none · Breaking: NO
- Rollback: revert the listed files; the two Ops keys become inert
- Pairs with frontend-core (Ops cost card). **Operator: create a WhatsApp AUTHENTICATION template before enabling the toggle; set `WHATSAPP_OTP_COST_PAISE` to your BSP's per-message rate for an accurate estimate.**

## [0.1.25] — 2026-07-02

### Fixed
- **Serial VPS build: list the buildable services explicitly (`backend workers`) instead of `docker compose config --services`.** Refines 0.1.24. `config --services` also returns image-only services (`redis`; `postgres` is profiled out), and `docker compose build redis` on an image-only service could abort the deploy under `set -e`. The two `build:` services are backend + workers, so name them directly — matches exactly what the original parallel `docker compose build` produced, with zero chance of an image-only service failing the loop.

**Propagation:**
- Severity: NORMAL (deploy reliability) · Layers: backend (`scripts/vps-deploy.sh`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the hunk (returns to 0.1.24 behavior)

## [0.1.24] — 2026-07-02

### Fixed
- **VPS deploy OOM-killed the Docker build on small/shared hosts (`npm run build` exit 255 ~2-3 min in).** `vps-deploy.sh` ran `docker compose build` with no service arg, which builds every service **in parallel** — so the backend and workers images each ran a memory-heavy `tsc`/esbuild compile at the same time and exhausted RAM (fatal on the shared Hetzner box where two clients also co-build). Now builds services **one at a time** (loop over `docker compose config --services`), roughly halving peak build memory; shared base layers stay cached so the second build is still fast. Image-only services (postgres/redis) are skipped automatically. Same commit built fine in CI and on the uncontended client — this is purely a build-time memory fix.

**Propagation:**
- Severity: NORMAL (deploy reliability) · Layers: backend (`scripts/vps-deploy.sh`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the one hunk
- Also recommended (VPS-side, not code): add swap on the host to absorb cross-client build spikes.

## [0.1.23] — 2026-07-01

### Changed
- **Storefront reviews are now a merchant toggle in the admin UI, not the `FEATURE_REVIEWS_ENABLED` env flag.** New `StoreSettings.reviewsEnabled` column (migration `20260701140000_add_store_settings_reviews_enabled`, additive, default `false`) + `isStorefrontReviewsEnabled(prisma)` helper (`common/reviews/reviews-feature.ts`, mirrors `isStorefrontCouponsEnabled`). All storefront review gating — product rating aggregates, PDP reviews include, `POST /reviews`, `/reviews/product`, `/reviews/recent`, `/reviews/eligible` — now reads the DB toggle instead of `featureFlags.reviews`. Exposed + writable via the existing `GET`/`PATCH /admin/settings/cod` (added `reviewsEnabled`), surfaced in the store config `reviewsEnabled`. Admin moderation endpoints are intentionally NOT gated (moderators work even when the storefront toggle is off). Merchants flip reviews on/off from Admin → Settings with no redeploy.

**Propagation:**
- Severity: NORMAL · Layers: backend (`prisma/schema.prisma` + migration, `common/reviews/reviews-feature.ts` [new], `modules/products/products.service.ts`, `modules/reviews/reviews.service.ts`, `modules/settings/settings.{service,schemas}.ts`)
- Migration: **YES** — `prisma migrate deploy` adds `StoreSettings.reviewsEnabled BOOLEAN NOT NULL DEFAULT false`. Run `prisma generate` after. · Flag: replaced by DB toggle (env `FEATURE_REVIEWS_ENABLED` no longer gates storefront reviews) · Design impact: none · Breaking: NO (default off preserves current behavior)
- Rollback: revert the listed files + drop the column
- Pairs with frontend-core 0.1.14 (admin toggle). **Operator: enable reviews in Admin → Settings (COD & Sign-up) → "Enable Customer Reviews" — no env change / redeploy needed.**

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
