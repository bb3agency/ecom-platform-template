# Frontend Core — Changelog

Semantic versioning (`MAJOR.MINOR.PATCH`). This file is the **propagation instruction set** for the shared storefront/admin/ops core. Per-client **design** (`app/globals.css` tokens, `lib/fonts.ts`, `lib/constants.ts`, `public/`) is NOT part of core and is never changed by these entries. See `../backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`.

- **PATCH** — bug/a11y/perf fix, no prop/contract change.
- **MINOR** — backward-compatible feature (token-styled so it auto-adopts each client's theme; OFF behind a flag where it adds surface area).
- **MAJOR** — breaking change (component API, route contract, or new required design token).

Each entry MUST carry the **Propagation** block.

---

## [Unreleased]

## [0.1.17] — 2026-07-02

### Changed
- **Notifications panel is now MULTI-select (on/off per channel), not single-primary.** `NotificationsChannelPanel` renders independent Email / SMS / WhatsApp toggles per notification — a notification is sent to EVERY enabled channel. `primaryChannels` is now `Record<string, Channel[]>` (was a single value); the panel seeds from arrays (accepting legacy single-string values) and PATCHes arrays. Only provisioned channels are enableable; OTP rows show an amber hint when WhatsApp is selected but the ops `OTP_WHATSAPP_ENABLED` gate is off. `providerAvailability.otpWhatsappEnabled` added to the settings type.

**Propagation:**
- Severity: NORMAL (feature) · Layers: frontend (`lib/admin-api.ts`, `components/admin/NotificationsChannelPanel.tsx`)
- Migration: NO · Flag: n/a · Design impact: none (token-styled) · Breaking: NO (reads legacy single-string values)
- Rollback: revert the two files
- Pairs with backend-core 0.1.30 (multi-channel routing + fan-out).

## [0.1.16] — 2026-07-02

### Fixed
- **`OTP_WHATSAPP_ENABLED` now renders as a true/false dropdown in the Ops → Config editor** (added to `BOOLEAN_KEYS` in `lib/ops-config-fields.ts`). Previously it appeared as a plain text box. All notification toggles (`NOTIFY_*`, `OTP_WHATSAPP_ENABLED`) are now consistent boolean selects, saved to the DB overlay via the OTP-protected config-save. `WHATSAPP_OTP_COST_PAISE` stays a text input (numeric value).

**Propagation:**
- Severity: LOW (UX polish) · Layers: frontend (`lib/ops-config-fields.ts`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the one line
- Pairs with backend-core 0.1.26 (which defines the key).

## [0.1.15] — 2026-07-02

### Added
- **WhatsApp OTP cost card on Ops → Config.** `OpsConfigPagePanel` now fetches `GET /ops/notifications/whatsapp-otp-cost` (new `getWhatsappOtpCostClient` + `WhatsappOtpCostEstimate` type in `lib/ops-client-api.ts`) and renders a small read-only card showing estimated WhatsApp-OTP spend for the current billing cycle and all-time, plus the per-message rate. Best-effort — if the endpoint fails the card is hidden and the config page is unaffected. Shown regardless of whether OTP-over-WhatsApp is enabled (it reports historical sends).

**Propagation:**
- Severity: NORMAL (feature) · Layers: frontend (`lib/ops-client-api.ts`, `components/ops/OpsConfigPagePanel.tsx`)
- Migration: NO · Flag: n/a (read-only display) · Design impact: none (token-styled `OpsCard`/`OpsBadge`) · Breaking: NO
- Rollback: revert the two files
- Pairs with backend-core 0.1.26 (the endpoint + `OTP_WHATSAPP_ENABLED`/`WHATSAPP_OTP_COST_PAISE` keys).

## [0.1.14] — 2026-07-01

### Added
- **"Enable Customer Reviews" toggle in the admin settings panel.** `CodSettingsPanel` (Admin → Settings → COD & Sign-up) gains a Storefront Features card with a reviews on/off switch, wired to `GET`/`PATCH /admin/settings/cod` (`reviewsEnabled`). Replaces the build-time `FEATURE_REVIEWS_ENABLED` env flag — merchants turn reviews on/off themselves; the storefront (`reviewsEnabled` from `/store/config`) reflects it without a redeploy.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`components/admin/CodSettingsPanel.tsx`)
- Migration: NO · Flag: n/a (this IS the toggle UI) · Design impact: none (existing tokens) · Breaking: NO
- Rollback: revert the file
- Requires backend-core 0.1.23 (`StoreSettings.reviewsEnabled` + `/admin/settings/cod` field).

## [0.1.13] — 2026-07-01

### Added
- **Reviews visible on product cards + customer write-review UI.** `ProductCard` now renders the star `Rating` (avg + count) under the product name when `reviewsEnabled` and the product has approved reviews (the PDP header + `ProductReviewsSection` already showed reviews). New `OrderReviewPrompt` on the account order-detail page: for a **DELIVERED** order it fetches the reviewable products (`GET /reviews/eligible`) and renders a per-product star input + optional comment that submits via `POST /reviews`, with already-reviewed and pending-approval states. `reviews-api.ts` gains `getReviewableProducts` + `ReviewableProduct`. Consumes the new `rating`/`reviewCount` fields on the product list/detail responses.

**Propagation:**
- Severity: NORMAL (new feature) · Layers: frontend (`components/product/ProductCard.tsx`, `components/product/OrderReviewPrompt.tsx` [new], `lib/reviews-api.ts`, `app/(account)/orders/[id]/page.tsx`)
- Migration: NO · Flag: gated on `reviewsEnabled` from `GET /store/config` (driven by backend `FEATURE_REVIEWS_ENABLED`) · Design impact: none (uses existing `Rating` + tokens) · Breaking: NO
- Rollback: revert the listed files
- Requires backend-core 0.1.22 (rating aggregates + `/reviews/eligible`).

## [0.1.12] — 2026-06-30

### Added
- **Drag-and-drop variant ordering in the admin product editor.** The "Manage All Product Variants" table has a grip handle per row; dragging reorders variants (native HTML5 DnD, no new dependency), persists via `PATCH /admin/products/:id/variants/reorder` (optimistic, reverts on failure), and that order is what the storefront shows on the product page and product cards. `AdminProductVariant` carries `sortOrder`.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`lib/admin-api.ts`, `components/admin/AdminProductEditor.tsx`)
- Migration: NO · Flag: n/a · Design impact: none (uses existing tokens + Lucide `GripVertical`) · Breaking: NO
- Rollback: revert the two files · Requires backend-core 0.1.17.
- Note: storefront needed no change — adapters/selector already render variants in API order, which is now `sortOrder`.

## [0.1.11] — 2026-06-30

### Fixed
- **Compare-at price field no longer shows/sends a stale `0`.** `formatVariantCompareAtPriceInput` and the variant-table draft seeding now treat `compareAtPrice <= 0` as empty (legacy `0` data from the old backend bug), and `buildPrimaryVariantPricePatch` sends `null` for a blank/`0` field. Combined with backend-core 0.1.15 this stops the spurious "Compare-at price must be greater than the price" error on save and cleans the bad value.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`lib/admin-product-pricing.ts`, `components/admin/AdminProductEditor.tsx`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the two files · Requires backend-core 0.1.15.

## [0.1.10] — 2026-06-30

### Fixed
- **Admin product editor — "Manage All Product Variants" table no longer cramped on desktop.** The 11-column variant edit table was constrained to `min-w-[600px]` (~54px/column), squishing every input to an unusable box with truncated values. Widened the table to `min-w-[1180px]` and gave each editable cell a sensible min-width (SKU 110, Name 140, Price/Compare 104, Weight 84, L/W/H 68px), so fields are fully readable; the table continues to scroll horizontally within `AdminTableScroll`.

**Propagation:**
- Severity: LOW (admin CSS/layout only) · Layers: frontend (`components/admin/AdminProductEditor.tsx`)
- Migration: NO · Flag: n/a · Design impact: none (Tailwind width utilities only) · Breaking: NO
- Rollback: revert the component

## [0.1.9] — 2026-06-29

### Fixed
- **Admin product editor — add-variant `weight` bug + Compare-at-Price clarity.** `addVariant` sent `weightGrams` (rejected by the backend schema's `additionalProperties:false`, so adding a variant *with a weight* failed); now sends `weight`. Compare-at-Price is labelled **(optional)** with a clearer tooltip, and the description character counter shows the correct `/5000` limit. The inline add/edit variant handlers now surface backend `VALIDATION_ERROR` field details (via `handleSubmitError`) instead of a generic message, so the admin sees exactly which field was wrong.
- **Store address is now always editable in Admin → Settings → Store (was hidden unless GST invoicing was on).** `StoreSettingsPanel` was rendering the entire seller section — including the storefront-footer **Store Address** — only when `gstInvoicingEnabled`. The Store Details card (legal name, address, operating state) is now always shown/saved; only GSTIN/FSSAI remain gated behind GST invoicing. Save button/labels reworded to "Store Settings".

**Propagation:**
- Severity: NORMAL (admin UX bug fixes) · Layers: frontend (`components/admin/AdminProductEditor.tsx`, `components/admin/StoreSettingsPanel.tsx`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the two components
- Note: requires backend-core 0.1.14 (`compareAtPrice` null handling). Address persistence already supported by `updateStoreProfile` (no backend change needed for the address itself).

## [0.1.8] — 2026-06-28

### Added
- **"Keep upright" packing flag in the admin product editor.** `AdminProductVariant` carries `keepUpright`; the variant edit row (new "Upright" column), the add-variant form, and the create-product primary-variant card each expose a checkbox. It is sent on variant create/update so fragile / this-side-up / liquid items are only rotated about their vertical axis during shipping cartonization. `BoxPresetsPanel` copy now notes the +1 cm padding and the keep-upright behavior.
- **"Packing box" card on the admin order detail.** `AdminOrderDetailPanel` renders the `packingBox` returned by `GET /admin/orders/:id` (dimensions, weight, source/box name) so the merchant sees the exact carton used to rate the order and can pack into it. `AdminOrderDetailFull` carries the optional `packingBox`.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`lib/admin-api.ts`, `components/admin/AdminProductEditor.tsx`, `components/admin/BoxPresetsPanel.tsx`, `components/admin/AdminOrderDetailPanel.tsx`)
- Migration: NO · Flag: n/a · Design impact: none (uses existing admin form controls) · Breaking: NO
- Rollback: revert the three files
- Note: requires backend-core 0.1.13 (the `keepUpright` field + cartonization refinement).


## [0.1.7] — 2026-06-22

### Added
- **Merchant-managed store address/contact in the storefront footer.** `PublicStoreConfig` (`lib/storefront-settings.ts`) now carries `storeName`/`storeAddress`/`storeState`/`contactEmail`/`contactPhone` from `GET /store/config`; the storefront `Footer` reads them via `useStoreConfig()` (now a client component) with safe fallbacks, so the address/phone/email update from Admin → Settings → Store without a code change. `StoreSettingsPanel` clarifies the address is shown on the storefront.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`lib/storefront-settings.ts`, `components/admin/StoreSettingsPanel.tsx`); `components/layout/Footer.tsx` is per-client (design layer) — wire each client's footer to `useStoreConfig()` as desired.
- Migration: NO · Flag: n/a · Design impact: none (footer markup unchanged, values now dynamic) · Breaking: NO
- Rollback: revert the lib + panel
- Note: requires backend-core 0.1.12 (public config exposes the fields).


## [0.1.6] — 2026-06-22

### Changed
- **`BoxPresetsPanel`** (admin → Settings → Shipping) now explains cartonization: presets are the real cartons the order's items are 3D-packed into (smallest fitting box wins; bounding-box fallback; +2cm padding; volumetric billing), and that accuracy depends on per-variant box dimensions set in the product editor.

**Propagation:**
- Severity: LOW (admin copy only) · Layers: frontend (`components/admin/BoxPresetsPanel.tsx`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the component

## [0.1.5] — 2026-06-22

> Note: tags `0.1.2`–`0.1.4` were cut without CHANGELOG/`package.json` bumps on main; this entry realigns frontend-core to 0.1.5.

### Fixed
- **Admin product editor — variant box dimensions now editable on existing variants.** The variant edit row only exposed a Weight input; Length/Width/Height (cm) were missing, so per-variant box dimensions couldn't be changed after creation (the save handler already sent them). Added L/W/H columns + inputs to the edit row, matching the add-variant form. These dimensions feed backend shipping cartonization (backend-core 0.1.9), so accurate per-variant box sizes reach Shiprocket/Delhivery.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`components/admin/AdminProductEditor.tsx`)
- Migration: NO · Flag: n/a · Design impact: none · Breaking: NO
- Rollback: revert the component
- Note: the admin console (`components/admin/**`) is core-synced as of this release (added to `core-manifest.json` in backend-core 0.1.9) — admin fixes now propagate to all clients automatically.

## [0.1.1] — 2026-06-20

### Added
- Admin product editor shows an ephemeral green-tick success toast (`role="status"`, auto-dismisses after 2s) after a successful product image upload, in addition to the persistent success banner.

**Propagation:**
- Severity: NORMAL
- Layers: frontend (`components/admin/AdminProductEditor.tsx`)
- Requires backend-core: >= 0.1.0
- Flag: n/a
- Design impact: none (uses existing admin success-color utilities)
- Breaking: NO
- Rollback: revert the AdminProductEditor change

---

## [0.1.0] — 2026-06-19
Baseline. First versioned frontend core. Standard shadcn token set; module visibility via `useStoreConfig()` / `GET /store/config`.

**Propagation:**
- Severity: NORMAL
- Layers: frontend (full baseline)
- Requires backend-core: >= 0.1.0
- Flag: n/a
- Design impact: none (token contract = `design-tokens.contract.json` v1)
- Breaking: n/a
- Rollback: n/a

<!--
TEMPLATE — copy for each new entry:

## [X.Y.Z] — YYYY-MM-DD
### Added | Changed | Fixed | Removed
- <one-line summary>

**Propagation:**
- Severity: NORMAL | SECURITY | CRITICAL
- Layers: frontend(lib/<x>.ts · components/<area>/* · app/<route>)
- Requires backend-core: >= A.B.C
- Flag: <FLAG via useStoreConfig()> | n/a
- Design impact: none | NEW TOKEN(S) <--token-name> → add to design-tokens.contract.json + every client's globals.css before merge
- Breaking: NO | YES (<component/route API change>)
- Rollback: revert to tag frontend-core vX.Y.Z
-->
