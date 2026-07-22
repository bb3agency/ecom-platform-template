# Backend Core — Changelog

Semantic versioning (`MAJOR.MINOR.PATCH`). This file is the **propagation instruction set**: each entry tells every client repo exactly what to apply when syncing this core version. See `docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`.

- **PATCH** — bug/security fix, no contract change. Safe to merge into all clients.
- **MINOR** — backward-compatible feature. Ships **OFF** behind a flag where it adds surface area.
- **MAJOR** — breaking change / migration required. Deliberate per-client upgrade.

Each entry MUST carry the **Propagation** block (layers · migration · flag · design impact · severity · breaking · rollback).

---

## [Unreleased]

## [0.1.76] — 2026-07-22

### Fixed
- **VPS deploy job no longer goes RED on every release that carries a migration.** `vps-deploy.sh` polled `/api/v1/health` 30 times at 2s intervals — a 60-second window. Backend boot does considerably more than start a server: it decrypts and applies the Ops DB config overlay, warms the Prisma engine, and on a migration release also waits behind migrate-on-boot. On a shared VPS that regularly exceeds 60s, so the script exited 1 and the deploy job failed **while the container became healthy moments later** — observed three times during the 0.1.75 rollout, on both clients, with production verified healthy and serving the new build each time. The real damage is not the red X: it is that a routinely-failing deploy trains operators to ignore deploy failures, and `Deploy to VPS` is `workflow_run`-gated elsewhere. Raised to 90 attempts (3 minutes). A genuinely broken deploy still fails, just two minutes later.

**Propagation:**
- Severity: MEDIUM (no production impact — deploys were succeeding; the signal was wrong, which is its own hazard) · Layers: backend (`scripts/vps-deploy.sh`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the file
- Operator: none. Takes effect on the next deploy, which runs the updated script it just pulled.

## [0.1.75] — 2026-07-22

### Added
- **Product-level local delivery with cart splitting.** New `Product.isLocalDeliveryOnly` flag: a flagged product is fulfilled by the merchant directly and is NEVER handed to Delhivery/Shiprocket, so it can only reach pincodes on the local-delivery whitelist. A cart is now classified into one of four shapes at checkout (`common/shipping/local-delivery-split.ts`, pure + unit-tested): `ALL_COURIER` (one courier order), `ALL_LOCAL` (one LOCAL order), `SPLIT` (TWO sibling orders — the local items and the courier items), `BLOCKED` (checkout refused; `error.details.products` names exactly what the customer must remove). Split siblings are linked by the new `Order.orderGroupId` and funded by ONE Razorpay payment: each sibling holds its own `Payment` row with its apportioned share, all sharing the same `providerOrderId` (refunds stay per-order; Razorpay accepts multiple partial refunds on one payment). The coupon is finalized once for the whole checkout, so a split never consumes two uses. Discount is apportioned pro-rata by subtotal using largest-remainder, so the combined total is paise-identical to the unsplit total; free-shipping-above, coupon minimums and store minimum-order are all evaluated on the WHOLE cart so a customer never loses a benefit because their cart divided. The courier leg is rated on the courier items ONLY and cached under a distinct quote scope, so a split can never be charged a whole-cart rate that included the locally-delivered items' weight.

### Fixed
- **Blocked-item details were silently stripped from API responses.** `errorDetailsSchema` is `additionalProperties: false`, so the `pincode`/`products` fields the error handler spreads were dropped at serialization — the storefront's blocking modal would have rendered an empty list. Both fields are now declared, with a route-level regression test (verified failing before the fix) and a schema-contract test pinning every field this feature depends on.
- **Legacy prepaid flow could strand an unpaid order.** `POST /orders` + `POST /payments/initiate` funds a single `orderId`, so a split cart there created two `PENDING_PAYMENT` orders and only ever paid for one. That path now rejects prepaid splits and directs to prepare-checkout (which funds both at once). COD is unaffected — each COD order carries its own payment.
- **`estimatedDays` is floored at 1** (the response-schema minimum) so a 0-day provider quote cannot turn a valid split into a 500.

**BEHAVIOUR CHANGE:** an unflagged product now ALWAYS ships by courier, even to a whitelisted pincode. Previously a whitelisted pincode routed the entire order LOCAL. The whitelist now gates only what local-delivery-only products can reach.

**Propagation:**
- Severity: MEDIUM (new capability; contains one deliberate behaviour change to existing local delivery) · Layers: backend (`common/shipping/local-delivery-split.ts` + tests, `common/errors/{error-codes,error-response.schema}.ts` + test, `modules/cart/{cart.service,cart.schemas}.ts`, `modules/orders/{orders.service,orders.schemas}.ts` + tests, `modules/products/{products.service,products.schemas,products.types}.ts`, `prisma/schema.prisma`) — pairs with frontend-core 0.1.56
- Migration: **YES** — `20260722090000_add_local_delivery_product_flag` adds `Product.isLocalDeliveryOnly` (default false) + `Order.orderGroupId` + its index. Additive and backfill-free; every existing product keeps its current courier behaviour.
- Flag: none (inert by default — `isLocalDeliveryOnly` defaults false on every product, so with no merchant action behaviour is unchanged EXCEPT the whitelist change below) · Design impact: none (engine only) · Breaking: NO
- Rollback: revert the files; the migration is additive and safe to leave applied.
- **Operator (REQUIRED before deploying to a store with `localDeliveryEnabled = true`):** verify with `SELECT "localDeliveryEnabled" FROM "StoreSettings";`. If true, flag the products that must stay local (Admin → Products → Local delivery only) BEFORE deploy — otherwise orders to whitelisted pincodes will start going to a courier. Stores with local delivery disabled need no action.

## [0.1.74] — 2026-07-19

### Fixed
- **Partial-refund cap now validates against the REMAINING refundable balance, not the full captured amount** (`modules/orders/orders.service.ts`, all 3 admin refund/cancel validation sites). Previously a `PARTIALLY_REFUNDED` payment could accept a `refundAmountPaise` up to the full `payment.amount` on each call, so cumulative partial refunds could in principle exceed 100% at the request layer. The refunds worker already atomically clamps to `amount − refunded − pending` (and Razorpay rejects over-refunds), so no over-refund was actually reachable — this is the earlier, clearer rejection (defense-in-depth), surfaced by a security audit.

**Propagation:**
- Severity: LOW (defense-in-depth; no reachable over-refund — worker + provider already cap) · Layers: backend (`modules/orders/orders.service.ts`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the file


## [0.1.73] — 2026-07-19

### Fixed
- **Shiprocket dashboard cancellations are now detected and fully propagated.** Shiprocket has NO trackable status for a cancelled AWB — its track endpoint fails with HTTP 500 "Ohh! This AWB has been cancelled." Our adapter threw on that error, the 3-min poll's per-shipment catch swallowed it, and the admin Sync button surfaced it as a raw INTERNAL_ERROR — so a cancellation made in the Shiprocket dashboard NEVER reached the site (the reported ORD-QA62-TCCU symptom). `trackShipment` now translates any /cancel/i track error into a `CANCELLED` tracking result, which flows through the existing poll/sync/webhook pipeline (order flip + customer notification + prepaid refund + inventory restore). `cancelShipment` is now idempotent too: cancelling an already-cancelled order returns success instead of dead-lettering compensating cancels.
- **Manual "Sync" now runs the same side-effects as the webhook/poll paths.** `adminSyncShipmentStatus` flipped the order status but skipped ALL side-effects. It now: runs cancellation side-effects (inventory restore + coupon release + captured-prepaid refund enqueue) when sync detects a courier cancel; captures COD payment on sync-detected delivery; and enqueues the delivered/cancelled customer notification. Outbox jobIds match the shipping worker's exactly, so whichever path runs first wins and the other dedups — no double notification/refund.
- **Mid-session "randomly logged out" on desktop (refresh-token race).** Refresh tokens are single-use + rotated, and all tabs/requests share one httpOnly cookie. When the access token expired, an admin page burst several parallel 401'd GETs → each called /auth/refresh with the SAME cookie → the first consumed+rotated it and every other call got "already consumed" → hard logout. Backend now has a **60s reuse grace** (industry-standard rotation reuse-interval, e.g. Auth0): a token consumed <60s ago — same device binding, bcrypt hash verified — can still mint tokens without re-consuming; replay beyond the window still 401s, so stolen-cookie protection is intact. A lost CAS race re-checks and falls into the grace path instead of failing.

**Propagation:**
- Severity: HIGH (courier cancellations invisible to the site; customers un-refunded; admins randomly logged out) · Layers: backend (`modules/shipping/adapters/shiprocket.adapter.ts` + test, `modules/orders/orders.service.ts`, `modules/auth/auth.service.ts` + mfa-refresh tests) — pairs with frontend-core 0.1.50 (single-flight refresh)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the files
- Operator: nothing required. Already-cancelled-at-courier orders self-heal on the next poll tick (≤3 min) or the admin Sync button.


## [0.1.72] — 2026-07-11

### Fixed
- **Shipment status changes now fire notifications AND run cancellation side-effects from EVERY path — webhook or background poll.** Two production incidents root-caused:
  1. **Missing "Delivered" notification.** The `poll-shipment-statuses` job updated order/shipment status silently with **no customer notification**, so whenever the background poll (not a webhook) detected a terminal status, the shopper never got the "delivered" message even though confirm/shipped went out. Fixed by routing both the webhook and poll paths through one shared `emitShipmentStatusNotification`, plus a "repair lane" that emits the missed notification when the order lagged behind an already-DELIVERED shipment.
  2. **Courier-dashboard cancellation didn't refund or notify.** When a courier (e.g. Shiprocket) cancelled a shipment, the order flipped to CANCELLED but the customer refund + inventory restore + coupon release were skipped (only the admin-cancel path ran them). New shared `runShipmentCancellationSideEffects` — wired into both webhook and poll paths — restores inventory, releases coupon usage, and enqueues a customer refund for captured prepaid payments (idempotent outbox jobId; refunds worker's atomic balance reservation prevents any double-refund). COD delivery capture also now fires from the poll/repair lanes.
  - **No-repetition dedup**: notifications only fire when the `Shipment.status` column actually transitions in that transaction, so webhook + poll never double-send (durable DB guard, not a fragile job-retention window).
- **Poll cadence 30 min → 3 min** so a courier-dashboard change (or a webhook that never arrived) propagates to the site, notifies the customer, and triggers refunds almost immediately. The stale 30-min repeatable is removed on boot so schedules don't overlap.
- **"Resend notification" always delivers now.** It already derived the template from the order's CURRENT status, but the status-scoped outbox jobId meant BullMQ deduped it against the earlier automatic send and silently no-op'd. It now appends a per-invocation token so every resend fires (accidental double-clicks still absorbed by the route's idempotency-key preHandler).
- **Admin/customer session no longer drops on network change ("logged out on reload", worst on mobile).** Refresh tokens were bound to `User-Agent | client IP` and any mismatch revoked the WHOLE session; mobile carrier NAT / Wi-Fi↔cellular handoff rotates the egress IP, so a reload hard-logged-out the user. Binding is now **User-Agent only** — IP stays a soft abuse signal, and the httpOnly single-use rotated token (with reuse-triggered revocation) remains the primary stolen-cookie defense.

**Propagation:**
- Severity: HIGH (delivered notifications silently missed; courier cancellations left customers un-refunded and un-notified; mobile users randomly logged out) · Layers: backend (`queues/workers/shipping.worker.ts` + test, `queues/workers/index.ts`, `modules/auth/auth.service.ts` + tests, `modules/orders/orders.service.ts` + retrigger test) — backend-only, no frontend-core bump (pairs with frontend-core 0.1.47)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the files. One-time effect on deploy: existing refresh sessions (hashed with the old UA|IP binding) are invalidated once, so users log in again after the first deploy — expected, not a regression.
- Operator: nothing required. The 3-min poll uses the existing shipping queue + provider credentials.

## [0.1.71] — 2026-07-11

### Fixed
- **Invoices no longer get stuck at "still being generated".** Root cause: `generateInvoiceForOrder` hard-threw when ANY order item lacked an explicit HSN code, so the generate-invoice job retried into dead-letter and the order stayed invoice-less forever (the reported ORD-TDY7-BF28 symptom). Three-part fix:
  1. **HSN is now OPTIONAL per product** — invoice lines render `N/A` when missing (the merchant remains responsible for codes where GST rules require them); courier shipment booking also no longer rejects missing HSN (carrier payloads already fall back to `DEFAULT_SHIPPING_HSN`, generic food preparation 2106).
  2. **FSSAI is now OPTIONAL** — the invoice/credit-note PDF omits the FSSAI segment instead of printing `FSSAI_NOT_CONFIGURED`; `STORE_REQUIRES_FSSAI` env still hard-enforces for clients that need it.
  3. **Self-heal re-enqueue**: `adminGetOrder` re-enqueues invoice generation for eligible orders with no invoice (Redis NX-throttled 5 min, no fixed BullMQ jobId so failed-job dedup can't swallow it). Combined with the admin panel's 5s poll, previously-stuck orders regenerate the moment the admin opens them.
  - Shipping worker's seller-GSTIN booking gate now uses the live `resolveGstInvoicingEnabled` (merchant toggle) instead of the boot-time env flag.

### Added
- **HSN autofill suggestions** — `GET /admin/products/hsn-suggestions?q=` (`products:read`, registry now 138 mappings): in-memory keyword search over a vendored WCO Harmonized System dataset (6,842 heading/subheading entries, openly licensed ODC-PDDL, github.com/datasets/harmonized-system) with an Indian-trade-terms alias layer (ghee→0405, jaggery→1701, kaaram/chilli→0904, namkeen/mithai→2106, …) and pack-size/generic-word stripping, so real product names ("Dried Whole Red Chilli 250gms") resolve to the right codes. No external API — works offline for every client. Tests: `hsn-suggest.test.ts`.

**Propagation:**
- Severity: HIGH (invoice generation broken for any order containing an HSN-less product) · Layers: backend (`queues/workers/{order-processing,shipping}.worker.ts`, `modules/orders/orders.service.ts`, `modules/invoices/invoice-pdf.ts`, `modules/products/{hsn-dataset,hsn-suggest}.ts` + routes/schemas, `common/auth/admin-endpoint-policy-registry.ts`) — pairs with frontend-core 0.1.47
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the files
- Note: stuck orders self-heal on the next admin order-detail view (self-heal enqueue + idempotent worker).

## [0.1.70] — 2026-07-11

### Added
- **GST invoicing is now a merchant Admin toggle** (no longer .env-only / restart-only). New nullable `StoreSettings.gstInvoicingEnabled` (migration `20260711090000_add_gst_invoicing_toggle`). New resolver `resolveGstInvoicingEnabled(prisma)` = **stored value wins once set, else inherit `FEATURE_GST_INVOICING_ENABLED` env default** — so a merchant can turn invoicing ON from the UI even when the env flag is off (or off when it's on), effective immediately with no backend restart. Wired into every gate: invoice generation + credit-note generation + side-effect enqueue (order-processing worker), customer/admin invoice-PDF download (`getMyInvoicePdf`/`adminGetInvoicePdf`), `GET /store/config.gstInvoicingEnabled`, and the admin `GET/PATCH /admin/settings/cod` (now carries `gstInvoicingEnabled`, returning the effective value). `serializeOrder`'s invoice CTA now gates on the invoice RECORD existing (created only when invoicing was enabled) rather than the env flag, so existing invoices stay downloadable even if invoicing is later turned off. Tests: `common/invoicing/gst-invoicing-flag.test.ts`.

**Propagation:**
- Severity: NORMAL · Layers: backend (`prisma`, `common/invoicing/gst-invoicing-flag.ts`, `queues/workers/order-processing.worker.ts`, `modules/orders/orders.service.ts`, `modules/settings/settings.{service,schemas}.ts`) — pairs with frontend-core 0.1.46
- Migration: YES (`20260711090000_add_gst_invoicing_toggle`, additive nullable column) · Flag: `StoreSettings.gstInvoicingEnabled` (null = inherit env `FEATURE_GST_INVOICING_ENABLED`) · Design impact: none · Breaking: NO
- Rollback: revert the files + drop the column; behaviour reverts to the env flag
- Operator: nothing required — existing deployments keep their current env-flag behaviour until a merchant flips the new toggle. Merchants enable it in Admin → Settings → Store.

## [0.1.69] — 2026-07-10

### Fixed
- **Analytics "Inventory alerts" now reflects CURRENT stock, not the historical alert log.** `getInventoryAlerts()` read `lowStockAlertEvent` (a log of past alerts, showing the quantity captured *at alert time*), so a variant restocked back to 100 still showed as a qty-0 alert forever — directly contradicting the live Inventory list. It now computes from live `Inventory` (on-hand minus active cart reservations) and filters `available <= lowStockThreshold`, exactly like `inventory.listLowStock()`, so alerts appear/clear in lockstep with real stock. Reported `quantity` is now AVAILABLE stock (matches the storefront out-of-stock gate). This also resolves the "inventory quantity looks wrong" confusion — the DB decrement (atomic guarded `updateMany`) and admin adjust were already correct; only this panel was stale.

### Added
- **`LocalOrderOutForDelivery` notification template** (email + SMS + WhatsApp `local_out_for_delivery`) — the courier-free variant of OutForDelivery for merchant-fulfilled local orders (no "courier"/"track your shipment" wording). `adminUpdateOrderStatus` routes a LOCAL order's SHIPPED **and** OUT_FOR_DELIVERY changes to it; `adminRetriggerNotification` swaps OrderShipped/OutForDelivery → LocalOrderOutForDelivery for LOCAL orders. Registered in `AdminRetriggerNotificationInput` + retrigger schema enum.
- **Neat multi-line WhatsApp bodies** for `admin_new_order`, `admin_local_order`, `local_out_for_delivery` (emoji + bold + line breaks, matching the merchant's requested format) — documented in `docs/WHATSAPP_TEMPLATE_REGISTRY.md`. Parameter count/order unchanged, so **no code change** — the operator just re-edits the body in WhatsApp Manager and re-submits.

**Propagation:**
- Severity: NORMAL · Layers: backend (`modules/analytics/analytics.service.ts` + test, `modules/orders/orders.service.ts` + `orders.types.ts` + `orders.schemas.ts`, `modules/notifications/sms-template-registry.ts` + `whatsapp-template-registry.ts`, `modules/notifications/templates/**` [per-client — hand-carry], `docs/WHATSAPP_TEMPLATE_REGISTRY.md`) — pairs with frontend-core 0.1.45
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the files
- Operator: to use WhatsApp for the new local out-for-delivery message, create + approve `local_out_for_delivery` in WhatsApp Manager (body in the registry doc). Email/SMS work immediately. The neat `admin_new_order`/`admin_local_order` bodies are optional re-edits of already-approved/new templates.
- Note: `notifications/templates/**` is per-client (excluded from sync) — the `LocalOrderOutForDeliveryEmail` component must be hand-carried to each client (verbatim for raghava; re-apply env-branding for sbgs).

## [0.1.68] — 2026-07-10

### Added
- **Merchant-fulfilled Local Delivery (opt-in per client, data-driven — no flag needed).** When the checkout pincode is on the merchant's whitelist, **Delhivery/Shiprocket are never invoked** (no serviceability calls, no quotes, no booking, no webhooks) and the merchant delivers the order himself:
  - **Schema** (migration `20260710090000_add_local_delivery`): `ShippingProvider` enum is **recreated** as `('DELHIVERY','SHIPROCKET','LOCAL')` — adds `LOCAL` and drops the never-used `SELF` in one step (Postgres has no `DROP VALUE`; both enum columns `Order.selectedShippingProvider` + `Shipment.provider` are re-typed with `USING` casts; `SELF` was never written by any code path, so the casts are safe on every existing row). `StoreSettings` gains `localDeliveryEnabled` (default off), `localDeliveryPincodes` (JSON `[{pincode, feePaise?}]`), `localDeliveryDefaultFeePaise` (default 2000 = ₹20), `localDeliveryFreeAbovePaise` (nullable), `localDeliveryEstimatedDays` (default 1).
  - **Settings**: new `GET/PATCH /admin/settings/local-delivery` (`settings:read/write`; endpoint-policy registry now 139 mappings). Per-pincode fee; empty fee falls back to the default fee; one global free-above-subtotal threshold. No weight/box/packaging computation is involved — the fee is purely pincode-based (`common/shipping/local-delivery.ts`).
  - **Quote/checkout**: `checkPincodeServiceability` + `getDeliveryRates` short-circuit before any courier resolution (quote persisted with `provider: LOCAL` so shown == charged); `createOrder` + `prepareCheckout` consume the local quote first (works even with zero couriers configured) and store `selectedShippingProvider = LOCAL`; stale cached LOCAL quotes are discarded when the pincode is de-whitelisted mid-checkout.
  - **Fulfilment**: `canShipNow` is always false for LOCAL orders ("Local delivery order — fulfil directly…"); `POST /admin/orders/:id/ship` hard-rejects with 422; no Shipment row is ever created. Order state machine now allows `CONFIRMED/PROCESSING → OUT_FOR_DELIVERY` (local orders skip the courier SHIPPED hop; harmless for courier orders — transitions remain webhook/admin-driven).
  - **Manual-status notifications**: `adminUpdateOrderStatus` on a LOCAL order fires the matching customer notification via `send-primary` (SHIPPED→OrderShipped, OUT_FOR_DELIVERY→OutForDelivery, DELIVERED→OrderDelivered, CANCELLED→OrderCancelled) — manual changes are the only status driver since no webhooks exist. Marking a local COD order DELIVERED **captures the payment** (cash collected at the doorstep) with an audit history row.
  - **Admin alerts**: new `AdminLocalOrder` template (email + SMS + WhatsApp `admin_local_order`, 5 params incl. the delivery address + phone line) replaces `AdminNewOrder` for LOCAL orders in the order-processing worker — the admin IS the courier. Body in `docs/WHATSAPP_TEMPLATE_REGISTRY.md` (needs Meta approval per client).
  - **Serialization**: `isLocalDelivery` on admin order detail/list/board + customer order detail (schemas updated); create-order schemas accept `selectedShippingProvider: LOCAL` (echoed quote — never trusted).
- **Invoice PDF redesigned (modern/clean).** `invoice-pdf.ts` rebuilt: brand header (store display name + optional logo — fetched best-effort outside the DB transaction, PNG/JPG only), right-aligned invoice meta, billed-to/place-of-supply cards, striped items table, right-aligned totals with CGST/SGST vs IGST shown contextually, grand-total emphasis, amount-in-words, fixed footer with GSTIN + computer-generated note. Credit note restyled to match. `SellerProfile` now carries `storeName` + `logoUrl`.

### Tests
- `common/shipping/local-delivery.test.ts` (parser, quote resolution, free-above, coupon, fail-safe settings load) and `modules/cart/cart.service.local-delivery.test.ts` (serviceability + rate short-circuit proving the courier API is NEVER called, quote persistence with `provider: LOCAL`, default-fee fallback, checkout quote parity).

**Propagation:**
- Severity: NORMAL (dormant until the merchant whitelists pincodes — empty whitelist = exact current behaviour) · Layers: backend (`prisma`, `common/shipping/local-delivery.ts`, `common/orders/order-state-machine.ts`, `modules/cart`, `modules/orders`, `modules/settings`, `modules/notifications`, `modules/invoices/invoice-pdf.ts`, `queues/workers/order-processing.worker.ts`, `common/auth/admin-endpoint-policy-registry.ts`) — pairs with frontend-core 0.1.44
- Migration: YES (`20260710090000_add_local_delivery`; enum recreate `DELHIVERY|SHIPROCKET|LOCAL` — drops unused `SELF` — plus additive StoreSettings columns) · Flag: `StoreSettings.localDeliveryEnabled` (DB, default off) · Design impact: none · Breaking: NO (`SELF` had zero rows and zero code references; pre-deploy check: `SELECT COUNT(*) FROM "Shipment" WHERE "provider"::text = 'SELF'` → 0)
- Rollback: revert the module edits; new columns are additive and harmless if unused (enum rollback would need another recreate)
- Operator: to use WhatsApp admin alerts for local orders, create + approve the `admin_local_order` template in WhatsApp Manager (body in `docs/WHATSAPP_TEMPLATE_REGISTRY.md`). Email/SMS work without any Meta step.

## [0.1.67] — 2026-07-09

### Fixed
- **`gallery.routes.test.ts` typecheck under client-strict settings** — the upload mock had no declared argument, so `mock.calls[0]` typed as an empty tuple and failed `tsc` on client repos (TS2493/TS2352). Test-only; no runtime change.

**Propagation:**
- Severity: LOW (test-only) · Layers: backend (`src/modules/gallery/gallery.routes.test.ts`)
- Migration: NO · Flag: none · Breaking: NO · Rollback: revert the file

## [0.1.66] — 2026-07-09

### Fixed
- **Orders no longer get stuck at SHIPPED after the courier delivers.** Three compounding bugs:
  1. The order state machine disallowed `SHIPPED → DELIVERED` — couriers frequently report delivery without an out-for-delivery scan ever reaching us (missed/skipped OFD webhook), so the DELIVERED webhook updated the **shipment** but `canTransitionOrder('SHIPPED','DELIVERED')` silently blocked the **order**, leaving admin + storefront showing SHIPPED forever. Now allowed (`order-state-machine.ts`).
  2. **Manual "Sync" couldn't repair it**: `adminSyncShipment` early-returned "already up to date" whenever the shipment status was unchanged — even when the order lagged behind. It now repairs a lagging order (promotes it per `mapShipmentStatusToOrderStatus`) even with no shipment change, and reports "Order status repaired: X → Y".
  3. **The 30-min auto-poll couldn't repair it either**: the poll query excluded terminal (DELIVERED) shipments entirely, and its loop skipped unchanged statuses. Added a repair lane — DELIVERED shipments whose order is not yet DELIVERED/CANCELLED/REFUNDED are selected and the order is promoted from local state (no provider call), with an `orderStatusHistory` entry (`Auto-poll repair`). Existing stuck orders in production self-heal within one poll cycle after deploy.

- **Category + gallery image uploads no longer die at the nginx edge.** The dedicated streaming upload `location` (skips the maintenance `auth_request` which forces full body buffering — nginx returned a raw 500 for larger bodies and the POST never reached the backend) only matched `.../images/upload` (products). Category upload lives at `.../image/upload` (singular) and gallery upload at `POST /admin/gallery` — both fell into the generic admin location and failed for any image big enough to matter, which is why "nothing uploads". The location regex is now `^/api/v1/admin/(.+/images?/upload|gallery)$` (`nginx/client.conf.template`). Verified against production: 3 MB body → products path 401 (reaches backend), category/gallery paths → raw nginx 500. Added `gallery.routes.test.ts` (real multipart injection through the actual multipart plugin + routes).

**Propagation:**
- Severity: HIGH (customer-visible wrong order status; blocks delivery notifications/returns eligibility; admin image uploads broken) · Layers: backend (`common/orders/order-state-machine.ts`, `modules/orders/orders.service.ts`, `queues/workers/shipping.worker.ts`, `nginx/client.conf.template`) — pairs with frontend-core 0.1.43
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the files
- Note: stuck orders self-heal via the next `poll-shipment-statuses` run (≤30 min after workers restart) or a manual admin "Sync" click. **Operator action per VPS:** the deployed nginx conf is rendered at setup — re-render/patch the upload `location` regex from the updated template and `nginx -t && systemctl reload nginx`, or category/gallery uploads keep failing at the edge regardless of this code deploy.
- Analytics note: no analytics code change needed — "Completed Orders" and revenue KPIs are status-driven (count DELIVERED), so they correct themselves as stuck orders are repaired.

## [0.1.65] — 2026-07-08

### Fixed
- **`core-manifest.json` excludes `frontend/app/(storefront)/gallery/**` from core** (carries the manifest change for frontend-core 0.1.42 — the manifest is a `backendCore` path, so it propagates on the backend layer). The per-client storefront gallery PAGE was otherwise caught by the broad `app/**/page.tsx` frontend-core include, tripping `core-drift` for any client that adds its own `/gallery` page.

**Propagation:**
- Severity: LOW (manifest-only) · Layers: `core-manifest.json`
- Migration: NO · Flag: none · Breaking: NO
- Rollback: revert the manifest line

## [0.1.64] — 2026-07-08

### Added
- **Store-wide Gallery feature (opt-in per client).** New `GalleryImage` model + `StoreSettings.galleryEnabled` flag (migration `20260708120000_add_gallery`, additive, default off). New `modules/gallery`: public `GET /gallery` (returns `{ enabled, items }` — active images ordered, empty when disabled) and admin CRUD under **`settings:write`** (`GET /admin/gallery`, `POST /admin/gallery` multipart upload, `PATCH /admin/gallery/:id`, `PATCH /admin/gallery/reorder`, `DELETE /admin/gallery/:id`). Images upload to the existing product-media storage (**Cloudflare R2** in prod, local disk in dev) via a new `saveGalleryImage` on the storage interface + both providers, keyed `‹client›/gallery/‹imageId›`; delete/serve paths recognise the gallery prefix. `galleryEnabled` is exposed on `GET /store/config` and editable via the COD settings endpoint. Endpoint-policy registry + admin-layer-drift updated (135 mappings). Tests: `gallery.service.test.ts`.

**Propagation:**
- Severity: NORMAL · Layers: backend (`prisma`, `modules/gallery`, `modules/media`, `modules/settings`, `common/auth/admin-endpoint-policy-registry`) — pairs with frontend-core 0.1.41
- Migration: YES (`20260708120000_add_gallery`, additive) · Flag: `StoreSettings.galleryEnabled` (default off) · Design impact: none · Breaking: NO
- Rollback: revert the module + `DROP TABLE "GalleryImage"` + drop the `galleryEnabled` column
- Operator: gallery images need R2 configured (same keys as product media). Merchant enables it from Admin → Gallery.

## [0.1.63] — 2026-07-08

### Changed
- **`GET /api/v1/wishlist` now returns card-ready products (MINOR).** The list response previously exposed only `id/name/slug/description/isFeatured` per product — not enough to render a product card, so a real wishlist page was impossible without an extra fetch per item. Each wishlist item's `product` is now the **same storefront product-list-item shape** used by `/products` (ordered `images`, active `variants` with price/compareAtPrice, `category`, derived `inStock`, and approved-review `rating`/`reviewCount` gated by the merchant reviews toggle). Per-variant inventory is stripped in the serializer so stock counts never leak. `POST /wishlist/items` is unchanged (still returns the minimal shape — the client only needs the id to toggle local state). Implemented by exporting the shared `productListItemSchema` from `products.schemas.ts` and reusing it as the wishlist list-item product schema.

**Propagation:**
- Severity: NORMAL · Layers: backend (`modules/wishlist/{wishlist.service.ts,wishlist.schemas.ts,wishlist.service.test.ts}`, `modules/products/products.schemas.ts` — `productListItemSchema` is now `export`ed) — the client-side `/wishlist` page + nav live in each client's theme layer (post-0.1.62 engine/theme split), so no frontend-core change is required
- Migration: NO · Flag: none (gated by the existing `wishlistEnabled` StoreSettings toggle) · Design impact: none
- Breaking: NO (additive to the response; existing `id/name/slug/description/isFeatured` fields remain) · Rollback: revert the three wishlist files and the `export` on `productListItemSchema`
- Tests: `wishlist.service.test.ts` extended — asserts card-ready shape (image, priced variant, derived `inStock`, review aggregate), that inventory never leaks, and that no review query runs when reviews are disabled.

## [0.1.62] — 2026-07-08

### Changed
- **Storefront + account moved OUT of core into the per-client theme (frontend engine/theme split — Phase 1: boundary).** The customer-facing storefront and account pages and their presentation are now each client's own, so a produce shop and a sweets shop can have entirely different layouts/copy — while the shared engine (behaviour) keeps syncing. `core-manifest.json` `frontendCore` now excludes: all storefront pages except checkout (`(storefront)/products|categories|search|cart|layout.tsx` + the already-excluded home/about/legal), all of `app/(account)/**`, and the presentation components `components/{product,layout,storefront,marketing}/**` + the cart-page components (`CartWorkspace`, `AddToCartButton`, `CartDropdown`). **Stays core (the engine):** `lib/stores/hooks/actions/types`, `components/ui`, **checkout + payment**, admin & ops consoles, auth, root `layout.tsx`/`middleware`/`next.config`, and the one shared cart display primitive the engine needs (`components/cart/CartLineProductDetails.tsx` — pure, used by checkout). No files move and no code changes — excluded paths simply stop syncing; each client already holds identical copies and now owns them.
- **New boundary guard** (`frontend/scripts/check-theme-boundary.mjs`, wired into `ci:reliability-gates` as `check:theme-boundary`): manifest-driven check that fails if any engine file imports a per-client theme file (design-layer config imports like `lib/constants`/`content` are allowed). Verified clean across 372 files. Template-CI tool (package.json isn't synced, and clients can't edit engine files anyway).

**Propagation:**
- Severity: NORMAL (governance/boundary; zero runtime code change) · Layers: `core-manifest.json` (syncs to clients) + template-only tooling (`frontend/scripts/check-theme-boundary.mjs`, `backend/package.json`, `frontend/package.json`)
- Migration: NO · Flag: none · Design impact: none yet (files unchanged) · Breaking: NO
- Rollback: revert the manifest change
- Operator note: after this syncs, each client fully owns its storefront + account theme (edits there no longer drift or get overwritten). Phase 2 will give raghava its produce theme and sbgs its sweets theme, and reset the template default to neutral. Pre-existing gap flagged separately: `components/ops` (both clients) and `components/auth` (sbgs) have drifted because they were never in the manifest — to be reconciled + added to core in a follow-up.

## [0.1.61] — 2026-07-07

### Fixed
- **Delhivery manifest declared every parcel at ~0 gm (weight-unit bug, direct merchant loss).** `cmu/create.json` reads `weight` in **grams** (the same unit as the rate API's `cgm`), but the adapter sent **kilograms** — a 2 kg parcel was declared as "2 gm", Delhivery billed the manifest on flyer volumetric, then re-weighed at the hub and re-billed the captured weight as a "weight mismatch" adjustment on every single shipment. The manifest now sends grams. Shiprocket verified unaffected (its API takes kg and receives kg).

### Added
- **Packaging (tare) weight in every quote and booking.** Couriers weigh the SEALED parcel; quoting/booking item weight alone under-declared by the carton + tape + void fill (~140 g observed), pushing slab-edge parcels into a higher 0.5 kg slab at re-weigh (production incident: 2000 g quoted ₹131.88, 2140 g captured ₹174.49). `cartonize()` now returns full parcel weight (`weightGrams` = items + `packagingWeightGrams`) with resolution: per-preset `boxWeightGrams` (merchant weighs the carton) → store-level flat override (new `StoreSettings.packagingWeightGrams`, additive migration `20260707100000`) → automatic surface-area estimate (`2(LW+LH+WH) × 0.055 g/cm² + 40 g`; calibrates to the observed 140 g for a 24×21×9 carton). Flows to cart quotes (`computeChargeableWeightGrams`), the AWB worker (books `carton.weightGrams` — both providers), and admin `packingBox` (new `packagingWeightGrams` field, schema updated). `GET/PATCH /admin/settings/box-presets` now carries optional per-preset `boxWeightGrams` + top-level `packagingWeightGrams` (omit = unchanged, null = clear to automatic).
- **Slab-edge guard on quotes.** Delhivery and Shiprocket both bill in 0.5 kg slabs. When the computed chargeable weight is within 50 g below — or exactly on — a 500 g boundary, the QUOTE weight is bumped just past it (`applySlabEdgeGuard`), so a hub re-weigh can no longer bill a higher slab than was quoted. Manifests still declare the true computed weight.

**Propagation:**
- Severity: HIGH (direct merchant money loss on every Delhivery shipment) · Layers: backend (`modules/shipping/adapters/delhivery.adapter.ts`, `common/shipping/{cartonize,chargeable-weight,select-box-preset}.ts`, `modules/cart/cart.service.ts`, `modules/settings/*`, `modules/orders/orders.{service,schemas}.ts`, `queues/workers/shipping.worker.ts`, `prisma/schema.prisma`) — pairs with frontend-core 0.1.37 (Box Presets panel weights UI + packing-box card)
- Migration: YES (additive — `StoreSettings.packagingWeightGrams INTEGER NULL`, `prisma migrate deploy`, no backfill) · Flag: none (accuracy fix; packaging estimate applies automatically) · Design impact: none · Breaking: NO
- Rollback: revert files + drop the column
- Operator note: no config required — the surface-area estimate applies immediately. For maximum accuracy, weigh one packed-but-empty carton per box preset and enter it in Admin → Settings → Shipping → Packing Box Presets (or set the flat packaging-weight override there). Expect customer-facing shipping quotes to rise slightly (they now reflect the real billed weight instead of the merchant eating the difference).

## [0.1.60] — 2026-07-07

### Fixed
- **Shiprocket "Schedule pickup" was not persisting.** The adapter read `status`/`pickup_scheduled_date` from the top level, but Shiprocket's `/courier/generate/pickup` nests them under `response` and signals success with top-level `pickup_status`. The result was `scheduled:false` with no date, so `adminSchedulePickup` never wrote `pickupScheduledDate` — the admin UI re-showed the "Schedule pickup" button on every refresh (Delhivery always returns a date, so it appeared to work). The adapter now reads both the nested and top-level shapes, IST-normalizes the returned slot time, and treats a returned token/date as success. `adminSchedulePickup` now persists `pickupScheduledDate` whenever the provider confirms the shipment is covered — including the "Already in Pickup Queue" case with no slot time (falls back to the action timestamp), which also resolves the "Scheduled (date not returned)" display.
- **Shiprocket "AWB Assigned" (and the rest of the pre-collection status master) was unmapped.** `mapShipmentWebhookStatus` returned `null` for `AWB Assigned`, `Label Generated`, `Pickup Scheduled/Generated/Queued`, `Out For Pickup`, `Pickup Rescheduled/Exception` — so those webhook scans produced no status update. All now map to `BOOKED` (booked, not yet collected). `Pickup Scheduled/Generated/Queued` were previously mis-mapped to `PICKED_UP`, overstating fulfilment on fresh shipments — corrected to `BOOKED`; only a real `Picked Up` scan (Shiprocket status 42) is `PICKED_UP`. Added `Misrouted`/`Delayed` → `IN_TRANSIT`, `Partial Delivered` → `DELIVERED`, `Lost`/`Damaged`/`Destroyed`/`Disposed Off` → `FAILED_DELIVERY`, `RTO NDR`/`RTO OFD` → `RTO_INITIATED`, `RTO Acknowledged` → `RTO_DELIVERED`, `Cancelled Before Dispatched` → `CANCELLED`. Numeric `current_status_id` codes are intentionally NOT hardcoded (public docs conflict — e.g. `20` is documented as both "In Transit" and "Pickup Exception"); Shiprocket webhooks always include the `current_status` text, which is authoritative.
- **Pincode serviceability no longer lets one provider's outage falsely block a deliverable pincode.** The dual-provider check (`checkPincodeServiceability` and `getDeliveryRatesMultiProvider`) already reported "not deliverable" only when every provider failed — but a provider that *errored* (timeout/5xx) was counted the same as one that explicitly said "no". Now an error is treated as "unknown": "not deliverable" (and `PINCODE_NOT_SERVICEABLE`) fires ONLY when every provider that could answer *explicitly* returned not-serviceable. Transient errors keep the pincode deliverable (and the rate path still attempts the errored provider's quote); a `CONFIG_NOT_READY` failure means that provider is unavailable and is excluded from the decision entirely (so it can't grant serviceability either). When no provider can answer at all, the check surfaces a 503 rather than silently reporting the pincode as undeliverable.

**Propagation:**
- Severity: NORMAL · Layers: backend (`modules/shipping/adapters/shiprocket.adapter.ts`, `modules/orders/orders.service.ts`, `common/orders/webhook-status-mappers.ts`, `modules/cart/cart.service.ts` + their tests)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the four source files + their test files
- Operator note: no dashboard/webhook config change required — the Shiprocket tracking webhook already posts `current_status`; this only corrects how those values are parsed and persisted. The pincode change is a no-config behaviour improvement; to actually widen coverage, ensure BOTH Delhivery and Shiprocket credentials are set in Ops config so both providers participate in the serviceability decision.

## [0.1.59] — 2026-07-04

### Docs
- **Documentation sweep for the 0.1.55–0.1.58 batch.** `API_ENDPOINT_INDEX.md`: added `GET/PATCH /admin/me/notification-preferences`, `POST /admin/categories/:id/image/upload`, noted optional `template` on the notification retrigger and the social-link fields on the store profile. `ROUTE_SURFACE_COMPLETE_REFERENCE.md`: new "Admin self-service" section (prefs routes + route-discipline exemption rationale + removal of the store-contact shipped alert), category image upload row, status-derived resend behaviour. `NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §4.3.1: per-admin new-order alerts (UI, API, dispatch, templates). `META_WHATSAPP_SETUP_GUIDE.md`: `admin_new_order` row + 2026-07-04 template readability overhaul note.

**Propagation:**
- Severity: LOW · Layers: backend (docs only) · Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: n/a

## [0.1.58] — 2026-07-04

### Fixed
- **0.1.57 failed the route-discipline gate** — the self-service prefs routes intentionally use only jwt+role guards (an adminPermissionGuard grant would wrongly gate personal opt-in); added them to the documented exemption list. Supersedes the 0.1.57 sync PRs.

**Propagation:**
- Severity: LOW · Layers: backend (scripts/route-discipline-check.js)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: n/a

## [0.1.57] — 2026-07-04

### Added
- **Per-admin opt-in new-order notifications.** New `User` columns `orderNotificationsEnabled` + `orderNotificationChannels` (additive migration `20260704150000_add_admin_order_notification_prefs`). Self-service endpoints `GET/PATCH /api/v1/admin/me/notification-preferences` (any active admin, no extra permission; validates a phone exists before enabling WhatsApp/SMS and an email before EMAIL). On every order confirmation (PREPAID capture + COD — both flow through `process-order-update`), the order-processing worker fans out an `AdminNewOrder` notification to each opted-in admin on exactly their selected channels (per-admin channels — deliberately NOT the store-wide `send-primary` routing). New `AdminNewOrder` template across email (React Email component), SMS registry, and WhatsApp registry (`admin_new_order`, params: store, order ref, customer, "amount - payment mode" line).

### Changed
- **Removed the store-contact "order shipped" alert** (`enqueueMerchantShipmentNotifications`) — admins were getting an OrderShipped message for shipments they had just created themselves. Replaced by the opt-in new-order alerts above.

### Fixed
- **Delhivery "Not Picked" tracking status now maps to BOOKED** (it is the manifested-awaiting-pickup state) — Sync no longer reports "has no mapped internal status" for freshly-booked AWBs.

**Propagation:**
- Severity: NORMAL · Layers: backend (`prisma` + migration, `modules/users/*`, `modules/notifications/*`, `queues/workers/order-processing.worker.ts`, `common/orders/webhook-status-mappers.ts`, `modules/orders/orders.service.ts`)
- Migration: YES (additive — two columns on "User", `prisma migrate deploy`, no backfill) · Flag: none (feature is per-admin opt-in, OFF by default) · Design impact: none · Breaking: NO
- Rollback: revert files + drop the two columns
- Operator note: the `admin_new_order` WhatsApp template must be created + approved in Meta WhatsApp Manager before the WHATSAPP channel delivers (EMAIL/SMS work immediately). See `docs/WHATSAPP_TEMPLATE_REGISTRY.md`.
- Pairs with frontend-core 0.1.35 (opt-in UI).

## [0.1.56] — 2026-07-04

### Fixed
- **0.1.55 failed client CI** — the admin-routes integration test mocked the OLD (wrong) sync response shape, so the corrected schema serialized it to a 500 in the gate. Mock now mirrors the real service return. Supersedes the 0.1.55 sync PRs.

**Propagation:**
- Severity: LOW · Layers: backend (test only)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: n/a (test fix)

## [0.1.55] — 2026-07-04

### Fixed
- **`POST /admin/shipments/:id/sync` 500'd on EVERY call** — the response schema declared `{ id, status, updatedAt }` but `adminSyncShipmentStatus` returns `{ synced, message, shipmentStatus, orderStatus }`; fast-json-stringify failed the required check AFTER the sync had committed, so the UI showed "Something went wrong" while the DB had actually updated. Schema now mirrors the real shape (which the frontend already consumed) + a serialization regression test (`orders.sync-schema.test.ts`).

**Propagation:**
- Severity: NORMAL · Layers: backend (`modules/orders/orders.schemas.ts`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the schema block


## [0.1.54] — 2026-07-04

### Fixed
- **Completed the admin rate-limit raise across every mirror the guardrails check:** `backend/nginx/rate-zones.conf.template` (api_admin 60r/m → 180r/m) and `client.conf.template` (api_admin burst 15 → 40, all three locations) now match `edge-policy.ts`; `backend/nginx/**` added to the core-sync manifest (it was unsynced — same trap as TRD.md in 0.1.53, so clients received the parity check but not the nginx templates it validates).

**Propagation:**
- Severity: LOW · Layers: backend (`backend/nginx/*`, `core-manifest.json`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Ops note: redeploy regenerates the live Nginx conf from the templates; if a client VPS has a hand-edited copy, update api_admin to 180r/m burst 40.
- Rollback: revert the two nginx templates + manifest line


## [0.1.53] — 2026-07-04

### Fixed
- **0.1.52 still failed the docs-runtime drift gate in client CI** — `backend/TRD.md` was never part of the core-sync manifest, so clients received the updated drift-check script but not the TRD it validates. Added `backend/TRD.md` to `core-manifest.json` backendCore includes; the sync now carries the doc with the script. Supersedes the 0.1.52 sync PRs.

**Propagation:**
- Severity: LOW · Layers: platform (`core-manifest.json`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: remove the manifest line


## [0.1.51] — 2026-07-04

### Added
- **Merchant-managed social links** (`StoreSettings.facebookUrl` / `instagramUrl`, additive migration `20260704120000_add_store_settings_social_links`). Editable in Admin → Settings → Store (`GET/PATCH /admin/settings/store` — profile schema + update body accept the new nullable fields; `null` clears), exposed on public `GET /store/config` for the storefront footer icons. WhatsApp intentionally has NO column — its footer link derives from the existing `contactPhone`.
- **Category image direct upload:** `POST /api/v1/admin/categories/:id/image/upload` (multipart, `categories:write`, idempotent, registered in the admin endpoint policy registry). Single optional image, validated and stored via the same provider as product images (local disk or Cloudflare R2 through `saveCategoryImage`); replacing deletes the previously hosted image. The existing URL-based `imageUrl` create/update path is unchanged.

### Fixed
- **Delhivery cancel finally lands in Delhivery's dashboard: the edit call was posted to `/api/p/edit/` (trailing slash).** The slashed path can 301-redirect, and `fetch` converts a redirected POST into a body-less GET — Delhivery received no cancellation payload at all, so packages stayed "Ready To Ship" while Shiprocket cancels (different endpoint) worked. Now posts to `/api/p/edit` (no slash), matching Delhivery's docs and every verified working integration.
- **Fresh Delhivery AWBs no longer show `FAILED_DELIVERY`.** Two compounding mistakes: (1) the status mapper treated Delhivery's `StatusType "UD"` as "Undelivered" — it is actually the bucket for the ENTIRE forward journey (Delhivery's own webhook sample pairs `Status:"Manifested"` with `StatusType:"UD"`); now maps to `IN_TRANSIT`. (2) `trackShipment` preferred the coarse `StatusType` over the precise human `Status` — order flipped, so Manifested→BOOKED, Undelivered→FAILED_DELIVERY, Cancelled→CANCELLED map exactly. Real NDRs still surface via `NDR`/`CC` codes and "Undelivered"/"Failed Delivery" text.
- **`POST /admin/shipments/:id/sync` 500:** provider scan timestamps that `new Date()` can't parse produced an Invalid Date that made Prisma throw mid-transaction. Unparseable timestamps now fall back to "now" instead of failing the whole sync.
- **"Resend notification" now sends the order's CURRENT status.** `POST /admin/orders/:id/notifications/retrigger` `template` is now optional — when omitted, the backend derives it from the live order status (CONFIRMED→OrderConfirmed, SHIPPED→OrderShipped, OUT_FOR_DELIVERY→OutForDelivery, DELIVERED→OrderDelivered, CANCELLED/REFUNDED→OrderCancelled, PAYMENT_FAILED→PaymentFailed) and enriches the payload with AWB + tracking URL when a shipment exists. Explicit `template` still works.
- **Admin console starved by the 60/min admin rate limit.** Analytics/dashboard pages fire 8–12 API calls each, so switching sections quickly tripped 429s that rendered "Something went wrong" on every panel (the dashboard/analytics panels were always correctly wired — the bursts were killing the calls). Admin edge class raised to 180/min (edge 180, burst 40); derived tiers scale with it (adminWrite 120, opsRead 90, opsCritical 54 — all permission/OTP-gated).

**Propagation:**
- Severity: NORMAL · Layers: backend (`prisma/schema.prisma` + migration, `modules/settings/*`, `modules/products/*`, `common/auth/admin-endpoint-policy-registry.ts`, `common/security/edge-policy.ts`)
- Migration: YES (additive, two nullable TEXT columns — `prisma migrate deploy`, no backfill) · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert files + drop the two columns
- Ops note: if Nginx/Cloudflare mirror the edge rate numbers, update the admin class there to 180/min too.
- Pairs with frontend-core 0.1.33 (footer icons + admin fields + category upload UI + 429 retry).

## [0.1.50] — 2026-07-04

### Fixed
- **BullMQ silently rejected our colon-separated custom jobIds — the root cause of "Delhivery cancel never reaches the provider" AND "no OrderShipped notification".** BullMQ 5.x throws `Custom Id cannot contain :` for any custom jobId whose colon-split length ≠ 3 (a legacy repeatable-job compat quirk). Ids like `cancel-shipment:<orderId>` (2 segments) and `shipping:primary:<orderId>:shipped` (4 segments) therefore failed EVERY `queue.add`, dead-lettering the outbox rows: cancel-shipment jobs never ran (order cancelled in our DB, still live at the courier) and OrderShipped mails never sent — while 3-segment ids (`analytics:x:y`) passed, which is why other notifications kept working. Fixes: (1) the outbox dispatcher sanitizes `:` → `-` before every `queue.add` (also heals existing stuck rows and dead-letter replays), (2) the shipping + order-processing worker enqueue helpers sanitize both branches, (3) auth/ops invite + OTP + maintenance-activation jobIds normalized to hyphens at construction.
- **Delhivery cancel verification now accepts "Returned"/RT tracking statuses.** Per Delhivery's Cancel Order API docs, a successful cancellation moves a *pickup* package to "Cancelled" but a forward *Prepaid/COD* package to **"Returned"** — the 0.1.47 verification only matched "Cancelled"/CN and would have false-failed legitimate prepaid/COD cancellations.

**Propagation:**
- Severity: HIGH · Layers: backend (`queues/workers/{outbox-dispatch,shipping,order-processing}.worker.ts`, `modules/auth/admin-invites.service.ts`, `modules/ops/ops.service.ts`, `shipping/adapters/delhivery.adapter.ts`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the six files (returns the silent-drop behavior)
- Ops note: previously dead-lettered `cancel-shipment` / `send-primary` outbox rows can now be replayed successfully from the ops dead-letter surface.

## [0.1.49] — 2026-07-03

### Fixed
- **0.1.48 failed the ops-config-contract drift gate in client CI** — `SHIPPING_NOTIFICATION_SURCHARGE_PAISE` was added to the ops contract but not to `scripts/env-runtime-contract.js` (requiredEnv + envExampleRequired + compose-parity lists). Added to all three; drift, parity, and guardrail script tests green. Supersedes the 0.1.48 sync PRs.

**Propagation:**
- Severity: LOW · Layers: backend (`scripts/env-runtime-contract.js`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert with the 0.1.48 contract entry

## [0.1.48] — 2026-07-03

### Added
- **`SHIPPING_NOTIFICATION_SURCHARGE_PAISE` is now operator-tunable via the Ops config panel** (shipping domain, `mutableViaOps: true`, `requiresRestart: true`, DB-overlay eligible). The Ops UI derives its fields from the backend contract, so the key appears automatically as an editable text field with the explanatory note — no frontend change required. Documented in `docs/ENV_VS_DB_CONFIG_REFERENCE.md` §Shipping.

**Propagation:**
- Severity: LOW · Layers: backend (`modules/ops/ops-config-contract.ts`, docs)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the contract entry (env var keeps working)

## [0.1.47] — 2026-07-03

### Fixed
- **Delhivery cancellations could silently no-op while we reported success.** Two guards added to `DelhiveryAdapter.cancelShipment`: (1) a bare waybill echo in the `/api/p/edit/` response no longer counts as a positive signal — Delhivery echoes the waybill even when it ignores the cancellation (e.g. package already picked up), which left orders "cancelled" in our DB but live in Delhivery's dashboard; (2) after a positive edit response, the adapter verifies via the track API that the package actually moved to Cancelled (one retry after 3 s). A definitive live status fails loudly (422, retried by the outbox job + ops alert, with dashboard/support remediation in the message); a track-API hiccup is inconclusive and keeps the positive edit result. Shiprocket cancels (by Shiprocket order id) were unaffected.

### Added
- **₹5 WhatsApp-notification surcharge folded into the customer-facing shipping charge** (`src/common/shipping/notification-surcharge.ts`, applied in `cart.service.ts` at both quote choke points — multi-provider winner + single-provider/noop compute — so quotes, checkout totals, payment capture, and invoices all carry it as plain "shipping cost" with no separate line). Applied AFTER cheapest-provider selection (never skews the comparison), never applied on ₹0/free-shipping charges. Override/disable via `SHIPPING_NOTIFICATION_SURCHARGE_PAISE` (documented in `.env.example`).

**Propagation:**
- Severity: NORMAL · Layers: backend (`shipping/adapters/delhivery.adapter.ts`, `common/shipping/notification-surcharge.ts`, `cart/cart.service.ts`, `.env.example`)
- Migration: NO · Flag: env-tunable (`SHIPPING_NOTIFICATION_SURCHARGE_PAISE`, default 500) · Design impact: none · Breaking: NO (shipping totals rise ₹5 on paid-shipping orders by design)
- Rollback: revert the three source files, or set `SHIPPING_NOTIFICATION_SURCHARGE_PAISE=0` to disable the surcharge without a code rollback

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
