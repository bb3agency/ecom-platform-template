# Frontend Core — Changelog

Semantic versioning (`MAJOR.MINOR.PATCH`). This file is the **propagation instruction set** for the shared storefront/admin/ops core. Per-client **design** (`app/globals.css` tokens, `lib/fonts.ts`, `lib/constants.ts`, `public/`) is NOT part of core and is never changed by these entries. See `../backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`.

- **PATCH** — bug/a11y/perf fix, no prop/contract change.
- **MINOR** — backward-compatible feature (token-styled so it auto-adopts each client's theme; OFF behind a flag where it adds surface area).
- **MAJOR** — breaking change (component API, route contract, or new required design token).

Each entry MUST carry the **Propagation** block.

---

## [Unreleased]

## [0.1.55] — 2026-07-19

### Fixed
- **Admin session-extend now uses the single-flight refresh guard** (`components/auth/AdminSessionWarning.tsx`, `components/auth/AdminIdleTimeoutModal.tsx`): both "Stay Signed In" / "Extend session" handlers called the raw `refreshAccessToken()`, bypassing `refreshAccessTokenOnce()`. Because refresh tokens are single-use + rotated, clicking Extend exactly when the access token expires (while admin panels burst parallel 401→refresh calls) could consume-race the shared cookie → one call rotates it, the other gets "already consumed" → hard logout. Both now route through `refreshAccessTokenOnce()` (the same guard the API client uses). Surfaced by a security audit; same bug class as the fe-core 0.1.50 / be-core 0.1.73 session-race fixes.
- NOTE: `components/auth/**` is outside the frontend-core sync manifest — these two files are hand-carried to each client repo alongside this release (the sync PR only bumps the version marker + this changelog).

**Propagation:**
- Severity: MEDIUM (mid-session admin logout) · Layers: frontend (`components/auth/AdminSessionWarning.tsx`, `components/auth/AdminIdleTimeoutModal.tsx` — HAND-CARRY per client, sync-excluded)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the files


## [0.1.54] — 2026-07-19

### Changed
- **Admin design system — mobile-viewport pass + fixes across Phases 2–5** (visual/JSX only; no data/API/permission logic changed):
  - **Mobile (375px) hardening** over ~30 admin components: wide tables consistently wrapped so the wrapper scrolls and the page never overflows horizontally; KPI grids 2-per-row at base; recharts wrappers given `min-w-0` + fixed heights; multi-column forms/detail layouts collapse to one column at base; filter bars stack and pills wrap; icon-only buttons bumped to ≥40px touch targets with aria-labels; kanban columns swipeable; notifications dropdown now fits narrow screens (`fixed inset-x-2` on mobile, anchored dropdown at ≥640px); bulk-inventory rows collapse to a 2-column labelled grid; gallery grid 2-col at base.
  - **Orders page — removed redundant date controls**: the inline `From Date / To Date` + `Export From / Export To` input block is gone. The page-header date-range picker is now the single source of truth for the list range (shown as removable filter pills), and CSV export follows that same committed range via the shell Export button. Eliminates the triple set of date pickers.
  - **Gallery page — removed duplicate uploader**: when the gallery is empty, only the friendly empty-state (single Upload CTA) shows; the dashed dropzone becomes an "add more" affordance once images exist (shared hidden file input so both triggers work).
  - **Bug sweep**: fixed a stale short-description char counter (`/160` → `/500`) in the product editor; semantic `bg-destructive`/`text-destructive` in place of raw red utilities; removed non-functional decorative filter controls and dead checkboxes from Shipments; dead-conditional and vestigial export state cleanups.

**Propagation:**
- Severity: NORMAL (UX/responsive only) · Layers: frontend (`components/admin/**`)
- Migration: NO · Flag: none · Design impact: none per-client (tokens; admin is engine) · Breaking: NO
- Rollback: revert the files


## [0.1.53] — 2026-07-19

### Changed
- **Phases 2–5 of the admin design system in one release** — dashboard/analytics, orders cluster, catalog (PIM), and CRM/marketing surfaces all restyled onto the Phase-0 primitives and semantic tokens (per-client theming automatic; zero data/API/permission logic changed):
  - **Phase 2 — Dashboard & analytics**: shared `KpiCard` (`components/admin/ui/kpi-card.tsx`: label / large metric / arrow-trend "vs last N days"); sales chart → gradient AreaChart on `var(--primary)` with tokenized grid/tooltip; category pie on `--chart-1..5` tokens; compact recent-orders feed with initial-avatars + Badge; low-stock feed with severity badges; skeletons instead of spinners and `EmptyState` everywhere; funnel steps/badges tokenized in AdminAnalyticsPanels; coupon analytics + order-alerts panels aligned.
  - **Phase 3 — Orders cluster**: orders list rows (initial-avatar, sticky header, hover, removable filter pills, payment/delivery `Badge`s); kanban board de-branded (neutral columns, status-accent icons, card redesign, board skeleton, EmptyState) with drag & drop untouched; **Cancel Order is now a modal** (reason dropdown: Customer Request / Out of Stock / Duplicate / Pricing Error / Fraud / Other + optional note, red confirm with loading — composed into the existing reason string, no API change); order status/timeline/items panels rebuilt (timeline rail with state-colored icon nodes, totals footer with Grand Total); shipments/payments/returns lists + return detail tokenized with Badge/EmptyState/skeletons.
  - **Phase 4 — Catalog (PIM)**: product editor sectioned into icon-headed cards with anchors, design-system inputs (validation wiring + `data-admin-field` intact), sky info-strip HSN autofill with pill chips, spreadsheet-style variants table, dashed image dropzones; products/categories lists with KPI tiles, Badge statuses, skeleton rows, EmptyStates; inventory list/bulk form/history (+/− delta timeline)/low-stock; gallery manager as an image-card grid with dropzone; product import with numbered steps.
  - **Phase 5 — CRM & marketing**: customers list as a CRM table (avatar + stacked contact info, KPI header cards) and customer detail as a CRM dashboard (header block, dl-grid profile, orders/notes cards, EmptyStates); reviews as a moderation inbox (lucide star ratings, tinted approve/unpublish/delete actions); coupons list with mono code chips, usage progress bars (amber >70% / red >90%), lifecycle actions on lucide icons; coupon form + storefront banner tokenized (removed a hardcoded seed-brand hex).

**Propagation:**
- Severity: NORMAL (UX only, no contract change) · Layers: frontend (32 files: `components/admin/**` incl. new `components/admin/ui/kpi-card.tsx`)
- Migration: NO · Flag: none · Design impact: none per-client (tokens; admin is engine) · Breaking: NO
- Rollback: revert the files


## [0.1.52] — 2026-07-19

### Changed
- **Phase 1 of the admin design system — the application shell** (all tokens, per-client theming automatic):
  - **Sidebar**: active item is now a filled primary pill with a left indicator bar and white icon/text; subtle hover; 20px Lucide icons; section separator between primary nav and System (Settings/Catalog write/Mutations). **Collapsible**: 260px ↔ 72px animated (200ms), state persisted per browser, collapsed rail shows full-label tooltips (never truncates), pending-orders dot on the icon.
  - **Mobile navigation** rebuilt on the design-system `Sheet` (left slide-over, backdrop blur, Esc/outside dismiss, proper focus trap).
  - **Sign-out flow**: profile row opens a confirmation dialog (no more instant logout on a stray click), with loading state and a "Signed out successfully." toast.
  - **Session-expiry warning** restyled to the design system: centered card, amber icon circle, live countdown + progress bar, "Stay Signed In" primary / "Sign Out Now" outline, "Session extended." toast on refresh — and its hardcoded seed-client hex palette replaced with semantic tokens (engine-file cleanup).
  - **Page header**: every page now leads with a proper `h1` title above a muted `Home / Page` breadcrumb; date-range + Export pinned left, page actions pinned right — positions never move between pages.

**Propagation:**
- Severity: NORMAL (UX only) · Layers: frontend (`components/admin/AdminConsoleShell.tsx`, `components/admin/AdminPageHeader.tsx`, `components/auth/AdminIdleTimeoutModal.tsx`)
- Migration: NO · Flag: none · Design impact: none per-client (tokens; admin is engine) · Breaking: NO
- Rollback: revert the files


## [0.1.51] — 2026-07-19

### Added
- **Phase 0 of the admin design system** (Linear/Stripe-dashboard direction; all styling via semantic tokens so each client themes automatically):
  - New Base-UI-backed primitives in `components/ui/`: `dialog` (header/body/sticky-footer layout), `alert-dialog`, `sheet` (right/left/bottom slide-over), `input`, `textarea`, `select`, `switch`, `checkbox`, `tabs` (underline indicator), `tooltip`, `card`, `separator`, unified `badge` (status dot + status/marketing/payment variants), `empty-state` (icon + headline + CTA), and `confirm-dialog` with a promise-based `useConfirm()` hook.
  - `Button` gains a `loading` prop — spinner + disable without layout shift.

### Changed
- **Every native browser popup in the admin console is gone.** All 14 `window.confirm()` and 4 `window.prompt()` calls replaced with design-system modals: product/category deactivate + permanent delete (permanent deletes require typing DELETE), variant delete + orders-conflict deactivate fallback, image remove, coupon delete, review delete, gallery image delete, customer note delete, **customer ban** (modal with required reason field replacing the inline textarea), **queue replay** (proper Dialog with reason + approval-token fields and inline validation), and clipboard-copy fallbacks (legacy textarea copy + toast instead of `window.prompt`). Error `alert()`s in the touched files now surface as toasts.
- `AdminStatusBadge` restyled onto the unified `Badge` (same `label`/`tone` API, now with a status dot).

**Propagation:**
- Severity: NORMAL (UX only, no contract change) · Layers: frontend (`components/ui/**` new primitives, `components/admin/{AdminProductsList,AdminProductEditor,AdminCategoriesList,AdminCategoryEditor,AdminCouponsList,AdminCustomerDetailPanel,AdminGalleryManager,AdminReviewsList,AdminReplayActions,AdminCopyLinkButton,AdminRowActionsMenu,AdminStatusBadge}.tsx`, `components/ui/button.tsx`)
- Migration: NO · Flag: none · Design impact: none per-client (semantic tokens; admin console is engine) · Breaking: NO
- Rollback: revert the files


## [0.1.50] — 2026-07-19

### Fixed
- **Single-flight token refresh in the authenticated API client** (`lib/authenticated-api.ts`, `lib/restore-auth-session.ts`): the 401-retry path called `refreshAccessToken()` raw, so several parallel 401'd requests (typical on any admin page when the access token expires) fired concurrent `/auth/refresh` calls with the SAME single-use cookie — the first rotated it, the rest got "already consumed" → `onAuthFailure()` → hard logout mid-session ("randomly logged out on desktop"). `refreshAccessTokenOnce` (in-flight promise + 3s result cache, previously private to session restore) is now exported and used by the API client, collapsing concurrent refreshes into one network call. Pairs with backend-core 0.1.73's 60s server-side reuse grace (covers multi-tab races the per-tab promise can't).

**Propagation:**
- Severity: HIGH (admin session drops mid-use) · Layers: frontend (`lib/authenticated-api.ts`, `lib/restore-auth-session.ts`) — pairs with backend-core 0.1.73
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the files


## [0.1.49] — 2026-07-14

### Fixed
- **`crypto.randomUUID` crash in insecure contexts** (`lib/idempotency.ts`, `lib/analytics.ts`): `crypto.randomUUID` only exists in a secure context. `localhost` qualifies, but a LAN IP over plain HTTP (e.g. testing the dev server from a phone at `http://192.168.x.x:3102`) does not — so the call threw `crypto.randomUUID is not a function` and crashed the page. `idempotency.ts` now feature-tests with `typeof crypto.randomUUID === "function"`, and `analytics.ts` gained a matching RFC-4122 v4 fallback for its session id. Production (HTTPS) was never affected; this only bit non-secure dev/LAN testing.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`lib/idempotency.ts`, `lib/analytics.ts`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the two files

## [0.1.48] — 2026-07-12

### Fixed
- **Product image upload dead-click at the limit** (`AdminProductEditor`): when a product already held `MAX_PRODUCT_IMAGES` (8), the upload dropzone still rendered a "Browse Files" affordance whose `<input>` was `disabled`, so clicking it silently did nothing (no file dialog, no message — read as a broken upload button). At the limit the dropzone now renders an explicit "Maximum 8 images — remove one to add more" state and the "Add more" tile is hidden, so a disabled input is never presented as clickable. Below the limit, behaviour is unchanged.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`components/admin/AdminProductEditor.tsx`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the file

## [0.1.47] — 2026-07-11

### Added
- **HSN autofill in the product editor** (`AdminProductEditor`): a "Suggest HSN from product name" action under the (now explicitly optional) HSN field queries `GET /admin/products/hsn-suggestions` and renders click-to-fill code+description chips. Typing digits first suggests by code prefix instead.

### Changed
- **FSSAI marked optional** across Admin → Settings → Store (`StoreSettingsPanel`): field label/help text, the missing-fields warning no longer counts FSSAI, and the GST-toggle description reads "Requires GSTIN and full seller details (FSSAI optional)".
- Fulfillment panel invoice tooltip updated — HSN/FSSAI never block generation; the only stall cause left is an incomplete store GST profile (pairs with backend-core 0.1.71's optional-HSN + self-heal fixes).

**Propagation:**
- Severity: NORMAL · Layers: frontend (`components/admin/{AdminProductEditor,StoreSettingsPanel,AdminOrderFulfillmentPanel}.tsx`) — pairs with backend-core 0.1.71
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the files

## [0.1.46] — 2026-07-11

### Added
- **GST invoicing toggle in Admin → Settings → Store** (`StoreSettingsPanel`). A switch (persisted via `PATCH /admin/settings/cod` `gstInvoicingEnabled`) that turns GST invoicing on/off live — no backend restart. When on, the GSTIN/FSSAI compliance fields appear and invoices generate for new orders; when off, they're hidden. Replaces the old read-only "GST invoicing is disabled in backend store config" message (which required editing `.env`). Loads the effective value from the COD-settings endpoint.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`components/admin/StoreSettingsPanel.tsx`) — pairs with backend-core 0.1.70
- Migration: NO · Flag: merchant DB toggle · Design impact: none · Breaking: NO
- Rollback: revert the file

## [0.1.45] — 2026-07-10

### Fixed
- **Admin Orders search no longer refetches (and blanks the table) on every keystroke.** `AdminOrdersList` bound the search box directly to the committed query, so each character triggered a fresh `/admin/orders` fetch + loading skeleton — which read as the whole page refreshing. Now decoupled into `searchInput` (live text) vs `search` (committed): the query runs on Enter or blur, matching the Shipments/Payments pattern. Typing is smooth; no mid-type refetch.
- **"Print invoice" self-enables when the invoice lands.** `AdminOrderFulfillmentPanel` now polls the order (every 5s, up to ~1 min) while the invoice PDF is still generating, so the button enables automatically instead of staying disabled behind "still being generated" until a manual refresh. Tooltip updated to point at the real stall cause (missing product HSN codes / incomplete store GST profile) if it never enables.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`components/admin/AdminOrdersList.tsx`, `components/admin/AdminOrderFulfillmentPanel.tsx`) — pairs with backend-core 0.1.69
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the files
- Client theme note (raghava): the storefront `/gallery` page was made dynamic (`force-dynamic` / `cache: no-store`) so the Admin → Gallery toggle + newly uploaded images reflect immediately instead of being an hour stale (ISR `revalidate 3600`). That page is per-client theme — apply the same to any other client that ships a gallery page.

## [0.1.44] — 2026-07-10

### Added
- **Local Delivery admin + storefront surfaces** (pairs with backend-core 0.1.68):
  - **Admin → Settings → Local Delivery** (`app/(admin)/admin/settings/local-delivery/page.tsx`, `components/admin/LocalDeliverySettingsPanel.tsx`, settings layout nav entry): master toggle, pincode rows each with an optional per-pincode fee (blank = default fee, ₹20 default), default fee, free-above threshold, estimated days. `settings:read/write`.
  - **Fulfillment panel local branch** (`AdminOrderFulfillmentPanel`): LOCAL orders show a "Local delivery" badge, the delivery address + phone prominently, a **Print invoice** primary action (opens the GST PDF print-ready; download fallback when popups are blocked), local COD copy ("captured when you mark DELIVERED"), and hide Ship / Schedule pickup / Print label / Sync / AWB / shipment chips entirely. Status is advanced via the existing "Update order status" dropdown — each change fires customer notifications server-side.
  - **Order detail panels**: Shipment card reads "Local delivery — no courier shipment"; Packing box card reads "no courier dimensions needed" (backend skips cartonization for LOCAL orders).
  - **Orders list + board**: LOCAL badge in the shipment column / "Local delivery — fulfil directly" card chip.
  - **Checkout** (`CheckoutForm`): green "Local delivery — delivered directly by the store" note when the quote provider is LOCAL; provider type unions widened (`DeliveryRates`, order/prepare inputs, `AdminOrderDetail`, `OrderSummary.isLocalDelivery`).
  - **Account order detail (default theme)**: "Delivery" card for local orders explaining no courier tracking number exists.
- **`ShippingProviderEnum` cleanup**: `SELF` (never used) removed from all frontend type unions + labels; `LOCAL` → "Local delivery" label added.

**Propagation:**
- Severity: NORMAL (dormant until the merchant whitelists pincodes) · Layers: frontend (`lib/admin-api.ts`, `lib/orders-api.ts`, `lib/shipping-provider-labels.ts`, `types/{cart,admin-order}.ts`, `components/admin/{LocalDeliverySettingsPanel,AdminOrderFulfillmentPanel,AdminOrderDetailPanel,AdminOrdersList,AdminOrderBoard}.tsx`, `components/checkout/CheckoutForm.tsx`, `app/(admin)/admin/settings/**`) — pairs with backend-core 0.1.68
- Migration: NO · Flag: merchant DB toggle (Admin → Settings → Local Delivery) · Design impact: none (token-styled) · Breaking: NO
- Rollback: revert the files
- Theme note: the account order-detail "Delivery" card lives in the per-client theme (`app/(account)/orders/[id]/page.tsx`) — hand-carry the equivalent edit to each client's theme copy.

## [0.1.43] — 2026-07-09

### Fixed
- **Admin fulfillment panel treats a delivered package as delivered** (`AdminOrderFulfillmentPanel`). Once the order **or the shipment** is DELIVERED: the Ship order / Schedule pickup / Print label step cards are replaced with a "package has been delivered" note, and **Cancel order** is no longer offered (previously a delivered package whose order status lagged at SHIPPED still showed all fulfilment steps + Cancel). The **Sync** action now stays available on a DELIVERED shipment while the order still lags — it is the manual repair path that promotes the order to DELIVERED (pairs with backend-core 0.1.66).

**Propagation:**
- Severity: NORMAL · Layers: frontend (`components/admin/AdminOrderFulfillmentPanel.tsx`) — pairs with backend-core 0.1.66
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the file

## [0.1.42] — 2026-07-08

### Fixed
- **Exclude `app/(storefront)/gallery/**` from core** (`core-manifest.json`). The per-client storefront gallery PAGE (see frontend-core 0.1.41 — the page is theme, not core) was otherwise caught by the broad `app/**/page.tsx` core include, so a client that added its own `/gallery` page tripped `core-drift`. Now excluded like the other storefront theme pages; each client owns its gallery page freely.

**Propagation:**
- Severity: LOW (manifest-only; unblocks per-client gallery pages) · Layers: `core-manifest.json`
- Migration: NO · Flag: none · Breaking: NO
- Rollback: revert the manifest line

## [0.1.41] — 2026-07-08

### Added
- **Gallery admin console + client (pairs with backend-core 0.1.64).** New **Gallery** section in the admin sidebar (`components/admin/AdminGalleryManager.tsx` + `app/(admin)/admin/gallery/page.tsx`, gated by the new `gallery` route key → `settings:` permission): upload images (multipart → Cloudflare R2), edit caption + alt text inline, show/hide, reorder, delete, and a "Show gallery on storefront" toggle (writes `StoreSettings.galleryEnabled`). New `lib/gallery-api.ts` (public `fetchPublicGallery` + admin helpers). `PublicStoreConfig.galleryEnabled` added to `lib/storefront-settings.ts` so the storefront can gate the `/gallery` route + nav link. The storefront `/gallery` PAGE itself is **per-client theme** (each client builds its own layout) — not shipped in core.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`lib/gallery-api.ts`, `lib/storefront-settings.ts`, `lib/permissions.ts`, `components/admin/{admin-nav-config,AdminGalleryManager}`, `app/(admin)/admin/gallery`) — requires backend-core 0.1.64
- Migration: NO · Flag: `StoreSettings.galleryEnabled` (merchant toggle) · Design impact: none new (uses existing tokens) · Breaking: NO
- Rollback: revert the listed files
- Note: the customer-facing `/gallery` page + nav link live in each client's theme; a client opts in by adding the page (see raghava) and the merchant flipping the Admin → Gallery toggle.

## [0.1.40] — 2026-07-08

### Added
- **`formatPrice` unit test** (`lib/format-price.test.ts`) — locks the 0.1.39 whole-rupee behaviour (no `.00` on whole amounts, two decimals on fractional, en-IN lakh grouping, explicit-currency path). Core test → syncs + drift-gated.
- **`--success` registered in the design-token contract** (`design-tokens.contract.json` `requiredTokens`) — `check-token-contract.sh` now fails any client whose `globals.css` omits it, guaranteeing the 0.1.39 checkout/auth confirmation text themes correctly everywhere.

### Changed
- **`design-tokens.contract.json` is now a core-synced path** (added to `core-manifest.json` `frontendCore.include`). Token-contract changes propagate to every client automatically instead of being hand-copied; each client still supplies the token *value* in its own `globals.css`.

### Docs
- CSP references corrected across `CLAUDE.md`, `frontend/docs/CSP_QUICK_REFERENCE.md`, and `frontend/docs/CSP_AND_THIRD_PARTY_INTEGRATION_GUIDE.md` to match the 0.1.39 `next.config.ts`: `'unsafe-eval'` is **dev-only** (Next.js dev runtime / React Refresh) and `upgrade-insecure-requests` is **prod-only**. The "never use `unsafe-eval`" rule now reads "never in production."
- `PLATFORM_VERSIONING_AND_SYNC_GUIDE.md` §5 documents the now-synced contract file and the `--success` token.

**Propagation:**
- Severity: LOW (test + contract + docs; no runtime behaviour change beyond what 0.1.39 shipped) · Layers: frontend (`lib/format-price.test.ts`, `design-tokens.contract.json`, `core-manifest.json`) + docs
- Migration: NO · Flag: none · Breaking: NO
- Design impact: none new — `--success` was already added in 0.1.39; this only enforces it via the contract
- Note: the contract file was NOT previously synced, so the *first* sync that carries the new manifest can't also carry the contract (the delta is computed from the client's pre-sync manifest) — the `--success` contract line is hand-delivered on the 0.1.40 sync branch; from 0.1.41 on, contract changes sync automatically
- Rollback: revert the listed files

## [0.1.39] — 2026-07-08

### Changed
- **De-hardcoded the shared checkout + auth engine to design tokens.** The template was seeded from a produce client and had that client's green palette baked as literal hex (`#23403d`, `#eff5ee`, `#767676`, `#ec6e55`, cream/border greys, `#00aa63`) directly in the shared (synced) checkout and auth surfaces — so a maroon/cream client's checkout/auth rendered green regardless of its theme. All ~190 hardcoded colour classes across `app/(auth)/{layout,login/page,register/page}.tsx`, `app/(storefront)/checkout/{page,payment/page,success/page}.tsx`, `components/checkout/CheckoutForm.tsx`, and `components/cart/CartLineProductDetails.tsx` are now semantic tokens: brand green → `primary`, coral hover → `accent`, greys → `muted-foreground`, panels → `secondary`, field/section fills → `muted`, borders → `border`, white surfaces → `card`, success green → the new `success` token. No logic/markup change — className-only. Each client's checkout/auth now auto-adopts its own theme (raghava stays green; sbgs renders maroon/cream).

### Added
- **New `success` design token.** `--success` / `--color-success` for confirmation text (OTP sent, password reset, order placed) that was previously the literal `#00aa63`. Added to the template default theme; each client sets its own value in `app/globals.css` (design layer).
- **`ProductCategory.parentId`** (`types/product.ts`) — surfaces category hierarchy to the storefront/admin.

### Fixed
- **`formatPrice` renders whole-rupee amounts without `.00`** (`₹450`, not `₹450.00`); fractional amounts keep two decimals.
- **Wishlist frontend contract now matches backend-core 0.1.63.** `WishlistItem.product` is the full card-ready `Product` (so `/wishlist` renders the standard `ProductCard`); add-to-wishlist returns the lighter `WishlistItemSummary` (`lib/wishlist-api.ts`).
- **CSP dev ergonomics** (`next.config.ts`): `'unsafe-eval'` allowed in the script-src **only** in development (Next.js dev runtime / React Refresh); `upgrade-insecure-requests` emitted **only** in production (localhost dev is http). Production CSP is unchanged.

**Propagation:**
- Severity: NORMAL · Layers: frontend (the 8 engine files above + `types/product.ts`, `lib/format-price.ts`, `lib/wishlist-api.ts`, `next.config.ts`)
- Migration: NO · Flag: none · Breaking: NO
- Design impact: YES — adds one token, `--success`. The core-sync writes engine files that use `text-success`; each client must define `--success` in its `app/globals.css` (design layer). Template default + both existing clients (raghava `#00aa63`, sbgs `var(--brand-green)`) already carry it; new clones inherit it from the template default theme.
- Rollback: revert the listed files (and drop the `--success` token if desired)
- Note: the de-hardcode is what lets a non-green client's checkout/auth match its brand. Clients that had accepted the green hardcodes see no change if their `primary`/`accent`/etc. already equal the old hex (raghava does).

## [0.1.38] — 2026-07-08

### Changed
- **Removed the legally-risky "Chemical Free" claim from shared core copy.** The template was seeded from a produce client and carried absolute "Chemical Free" / "100% Chemical Free" claims in core (synced) surfaces — inaccurate/legally-risky and imposed on every client. Neutralised to accurate, premium wording: `app/layout.tsx` (root SEO → "Premium naturally grown, lab-tested products"), `products/page.tsx` (title "Shop Naturally Grown & Natural Products", meta, "100% / Naturally Grown" stat), `categories/[slug]/page.tsx` (title + "Naturally Grown Category"), `search/page.tsx`, `products/[slug]/page.tsx` (trust badge → "Naturally Grown"), `components/cart/CartWorkspace.tsx` (trust badge), `components/shared/SearchInput.tsx` (placeholder), `components/admin/AdminProductEditor.tsx` (name/slug placeholders), `components/admin/AdminProductsList.tsx` (filter label — `value="organic"` enum unchanged), and `lib/cart-line-display.test.ts` (fixtures). Per-client storefront copy (home/about/legal/footer) lives in the design layer and is each client's own — not touched by this core change.

**Propagation:**
- Severity: NORMAL (copy only; removes a risky marketing claim) · Layers: frontend (the core files listed above)
- Migration: NO · Flag: none · Design impact: none (token-styled; wording only) · Breaking: NO
- Rollback: revert the listed files
- Note: existing clients that want brand-specific wording should override in their design layer (`lib/content.ts`); this only changes the shared default. Template seed copy in the design-layer files (home/about/legal) still references the old phrasing and is a separate hygiene item for future clones.

## [0.1.37] — 2026-07-07

### Added
- **Packing weights in the admin (pairs with backend-core 0.1.61).** `BoxPresetsPanel`: each carton preset can now carry an optional **Box weight (g)** — weigh one packed-but-empty carton and enter it; a new **Packaging Weight** section sets the store-level flat override (empty = automatic surface-area estimate). Panel copy explains that couriers weigh the sealed parcel and that this weight is included in every quote/booking. `AdminBoxPresetsSettings`/`BoxPreset` types extended (`boxWeightGrams`, `packagingWeightGrams`).
- **"Packing box" card shows the declared parcel weight split.** Order detail now renders `packagingWeightGrams` ("Incl. packaging: X g") alongside the total sealed-parcel weight, so the merchant sees exactly what was declared to the courier.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`components/admin/BoxPresetsPanel.tsx`, `components/admin/AdminOrderDetailPanel.tsx`, `lib/admin-api.ts`)
- Migration: NO · Flag: none · Design impact: none (token-styled) · Breaking: NO — requires backend-core 0.1.61 for the new fields (older backends simply omit them)
- Rollback: revert the three files

## [0.1.36] — 2026-07-04

### Fixed
- **Deactivated products no longer linger on the storefront during client-side navigation.** Server rendering was already fresh (dynamic pages, no-store fetches, backend cache invalidation on deactivate) — the staleness was Next.js's client-side **Router Cache** replaying visited/prefetched RSC payloads until a hard refresh. `next.config.ts` now sets `experimental.staleTimes = { dynamic: 0, static: 60 }`: every client-side navigation refetches the page from the server, so admin changes (deactivations, price edits, stock) appear on the customer's very next navigation.
- **Auth pages mobile padding** — admin sign-in and reset-password cards used a fixed `p-8`; now `p-5 sm:p-8` + `min-w-0`, matching the customer login/register pages.

### Changed
- **Category image is now upload-only — exactly like product images.** The "Image URL" paste fields are gone from BOTH the category editor page and the quick-create/edit modal (`AdminCategoryForm`). In their place: a file picker (JPEG/PNG/WebP/AVIF), live thumbnail preview, and a Remove button. Edit mode uploads immediately to `POST /admin/categories/:id/image/upload` (replaces + deletes the old CDN object); create mode holds the file and uploads right after the category is created (a failed upload surfaces a toast, never rolls back the category); Remove clears `imageUrl` (PATCH `null`) so the storefront falls back to the neutral placeholder.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`next.config.ts`, auth pages, `AdminCategoryEditor`, `AdminCategoryForm`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the five files
- Note: `staleTimes.dynamic: 0` trades a little navigation snappiness for storefront correctness — server responses are still fast (backend Redis list cache, 60s TTL, invalidated on writes).

## [0.1.35] — 2026-07-04

### Added
- **"Notify me about new orders" panel** (Admin → Settings → Notifications, above the store-wide routing). Personal per-admin opt-in with EMAIL / WHATSAPP / SMS channel checkboxes, wired to `GET/PATCH /admin/me/notification-preferences`. Saves instantly on toggle; WhatsApp/SMS options are disabled with a hint when the admin account has no phone number; enabling with nothing selected defaults to EMAIL; a failed save reloads server truth so the toggles never lie.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`components/admin/AdminMyOrderAlertsPanel.tsx`, notifications settings page)
- Migration: NO · Flag: none (per-admin opt-in, OFF by default) · Design impact: none · Breaking: NO
- Rollback: revert the two files
- Pairs with backend-core 0.1.57 (prefs endpoints + AdminNewOrder fan-out).

## [0.1.34] — 2026-07-04

### Fixed
- **Mobile overflow, closed for good across admin + ops (115 spots in 42 files).** 0.1.32 clamped `AdminSection`, but the same defect lived in every other implicit grid: `grid gap-N` without `grid-cols-1` creates an implicit `auto` track that grows to its content — `min-w-0` on children cannot help because the TRACK itself inflates past the viewport (why the order-detail page still clipped on phones after the child-level fixes). Mechanical sweep: every `className="grid gap-…"` in admin/ops components and pages is now `grid min-w-0 grid-cols-1 gap-…` (`grid-cols-1` = `minmax(0,1fr)`, clamps to container; existing `sm:`/`lg:` column overrides untouched). Covers the order detail page + fulfillment panel (the reported surface) and 40 other files.

**Propagation:**
- Severity: NORMAL · Layers: frontend (admin/ops components + pages, structural classes only)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the sweep commit
- Pairs with backend-core 0.1.55 (shipment-sync 500 fix).


## [0.1.33] — 2026-07-04

### Added
- **Footer social icons are now real, merchant-managed links.** The F/I/T placeholder circles are replaced with official Facebook / Instagram / WhatsApp brand glyphs from `react-icons` (new pinned dependency 5.5.0 — the sanctioned exception to the Lucide-only rule, used ONLY for brand logos; imports are tree-shaken). Facebook/Instagram URLs come from the new Admin → Settings → Store fields (via `GET /store/config`); the WhatsApp icon opens `wa.me/<contactPhone>` using the same number shown in the footer (bare 10-digit numbers get +91). Icons render only when configured — no dead links.
- **Admin → Settings → Store: "Facebook Link" and "Instagram Link" fields** (blank clears the link and hides the icon; helper text explains WhatsApp needs no link).
- **Category image upload in the admin category editor.** Single optional image with instant preview: edit mode uploads immediately to `POST /admin/categories/:id/image/upload` (same CDN pipeline as product images); create mode holds the file and uploads right after the category is created (an upload failure surfaces a toast but never rolls back the category). Storefront category cards now show the merchant image when set and the neutral product placeholder when not — the hardcoded Unsplash stock-photo fallbacks in `lib/categories.ts` are gone.

### Changed
- **"Resend notification" resends the order's CURRENT status** — the button no longer hardcodes `OrderConfirmed`; the backend derives the template from the live order status (backend-core 0.1.51). Tooltip updated accordingly.
- **Admin API client retries idempotent GETs once after a 429** (1.2s delay). Combined with the backend admin rate-limit raise (backend-core 0.1.51), rapidly switching admin sections no longer flashes "Something went wrong" across panels. (The dashboard/analytics panels were always wired to real endpoints — the rate-limit bursts were killing their calls.)

### Fixed
- **Admin coupons page looked completely broken — active coupons (e.g. FREEDELIVERY) missing.** The page's date range (default: last 7 days) was passed into the coupon LIST, the Total/Active/Expired KPI counts, and the CSV export — and the backend's `from/to` filters coupons by `createdAt`, so every coupon created before the window silently vanished while still being active. The list and export now always show ALL coupons; Total/Active/Expired KPIs are point-in-time; only usage analytics (Total Uses / Total Discounts) stay range-scoped.
- **Coupons no longer stick across checkout visits.** The backend keeps `couponId` on the cart until an order is created, so a coupon applied in an abandoned checkout silently carried over to the next visit/order. Checkout now clears any leftover coupon once on mount (idempotent; guests get their reserved usage released), guards against clobbering a coupon applied during the visit, and re-syncs the cart after the reset to close the stale-fetch race.
- **Add to cart / Buy now buttons look right.** `AddToCartButton` wrapped its `<button>` in a stray `grid` div, so `flex-1`/`shrink-0` on the button never reached the flex row (unequal widths), and the default icon rendered with no gap beside the label. The button is now the root element; PDP CTAs got `gap-2 px-6 shadow-sm` + disabled styling, and Buy now uses a lightning icon instead of a second cart icon.
- **Mobile menu no longer pops the keyboard.** Opening the storefront mobile menu auto-focused the search field, which immediately raised the software keyboard over the menu. The autofocus is removed — tap the field to search.
- **Product detail "Additional Information": Origin row removed** (Category / Certification / Storage remain).

**Propagation:**
- Severity: NORMAL · Layers: frontend (storefront + admin components, `lib/storefront-settings.ts`, `lib/admin-api.ts`)
- Migration: NO · Flag: none · Design impact: none (brand glyphs inherit the token palette) · Breaking: NO
- Rollback: revert the listed files
- Pairs with backend-core 0.1.51 (StoreSettings social-link columns + /store/config exposure).

## [0.1.32] — 2026-07-04

### Added
- **Variant selection directly on product cards.** The variant chips ("250gms / 500gms / 1kg") are now buttons: tapping one switches the displayed price/strikethrough/discount badge and the Add button adds that exact variant to the cart — no detail-page detour to buy a specific size. Chips render in the merchant's admin sort order (the backend already orders variants by `sortOrder`, then price); up to 4 chips show, extra variants collapse into a "+N" link to the detail page. Selection logic extracted to `lib/product-card-variants.ts` with unit tests. Mobile-optimized: ≥28px chip tap targets, wrapping price/Add row (50vw cards can't fit both on one line), tighter padding, `min-w-0` guards.

### Fixed
- **Mobile overflow hardening across admin/ops sections (the "broken padding" class of bugs).** Root cause fixed at the source: `AdminSection`'s root was `grid` with an *implicit* auto column — implicit tracks size to content, so any wide child (data table, long AWB/email, unwrapped filter row) inflated the whole section past the mobile viewport; the shell's `overflow-x-hidden` then clipped the right edge, which read as broken padding. Now `grid grid-cols-1 min-w-0` (`grid-cols-1` = `minmax(0,1fr)` — clamps to container). Same hardening on the other implicit-grid card roots (`AdminMutationPanel`, orders filter card, `AdminOrderDetailPanel`, `OpsSessionPanel`, ops-ui card) and `AdminTableScroll` (`min-w-0 max-w-full`). Return-request status stepper scrolls horizontally on narrow phones; shipment drawer `Row` values wrap with `break-words`; coupon Discount-Type cards shrink correctly in their 3-column mobile grid.
- **Sidebar Orders badge + bell are now genuinely live.** Poll tightened 60s → 20s (the count query is `limit=1`, meta.total only), added a `window focus` listener (`visibilitychange` never fires when switching between desktop windows — the tab stays "visible"), refresh on every in-console route change, and the open bell panel itself now refetches on admin data mutations + a 20s poll instead of only on open/manual refresh.

**Propagation:**
- Severity: NORMAL · Layers: frontend (admin/ops components) · Migration: NO · Flag: none
- Design impact: none (structural classes + polling only) · Breaking: NO
- Rollback: revert the 11 component files
- Pairs with backend-core 0.1.50 (BullMQ jobId fix — the backend half of "notifications not arriving").

## [0.1.31] — 2026-07-03

### Changed
- **Admin badge counts are now live.** The sidebar Orders badge + bell count refetch (1) instantly after any in-app order mutation via the `notifyAdminDataChanged` bus, (2) every 60s in the background (skipped while the tab is hidden), and (3) immediately when the tab regains focus — no more page refresh to see new orders.
- **"Request refund" removed from the fulfilment panel** — refunds are issued via "Cancel order" (auto-refunds prepaid); a standalone refund action on a live order invited mistakes. Refund state still shows in the payment chip; the backend refund route remains available to the status-management surface.
- **"Retrigger email" → "Resend notification"** (with a tooltip explaining what it resends).

### Fixed
- Coupon panel on admin order detail now populates (backend-core 0.1.46 stopped stripping the `coupon` object) — FREE_SHIPPING coupons render as "Free Shipping".

**Propagation:**
- Severity: NORMAL · Layers: frontend (`components/admin/{AdminConsoleShell,AdminOrderFulfillmentPanel}.tsx`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the two files
- Pairs with backend-core 0.1.46.

## [0.1.30] — 2026-07-03

### Changed
- **Cart page promo-code box removed** — coupon entry lives at checkout only (`CheckoutForm` keeps apply/remove). The cart summary is a clean recap; an applied coupon still shows as the Discount line. Dead coupon state/handlers/imports stripped from `CartWorkspace`.

### Fixed
- **Admin fulfilment panel hides Ship/Schedule-pickup/Print-label entirely on cancelled/refunded orders** (and cancelled shipments), replaced by a terminal notice — pairs with the backend 409 guards (backend-core 0.1.44). `InfoChip` values now wrap (`min-w-0 break-words`) so long mono AWBs can't inflate the panel.
- **Mobile viewport overflow sweep (admin + storefront):**
  - Admin orders list: date/export filter rows stack in a 2-col grid on phones (was a fixed non-shrinking flex row that pushed the page wider than the screen).
  - Admin order detail + product editor: `min-w-0` on all layout-grid children (grid items default to `min-width:auto`; wide content — tables, mono refs, long slugs — inflated columns past the viewport and got clipped by the shell's `overflow-x-hidden`).
  - Checkout: progress-stepper connectors narrowed on phones (4 steps + labels now fit 375px); `min-w-0` wrappers on the checkout grid children (form + sidebar) and the cart Order Summary column.
- **Generic-500 companion:** the backend's new generic 500 message added to `GENERIC_BACKEND_MESSAGES` so ops/admin panels don't echo it as a redundant "Server: …" detail line.

**Propagation:**
- Severity: NORMAL · Layers: frontend (`components/cart/CartWorkspace.tsx`, `components/admin/{AdminOrderFulfillmentPanel,AdminOrderDetailPageClient,AdminOrdersList,AdminProductEditor}.tsx`, `app/(storefront)/checkout/page.tsx`, `lib/error-messages.ts`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the listed files
- Pairs with backend-core 0.1.44.

## [0.1.29] — 2026-07-03

### Added
- **Header mini-cart dropdown** (`components/cart/CartDropdown.tsx`, new). Clicking the cart icon now opens a small popover anchored directly below the icon — current cart lines (thumbnail, name, variant · qty × unit price, line total), subtotal, empty state, and a **Go to Cart** button — instead of navigating straight to `/cart`. Viewport-aware: fixed 320px panel on desktop, clamped to `calc(100vw-1.5rem)` on mobile so it never overflows; closes on outside tap/click and Escape; count badge and header price label preserved exactly (markup moved from `MainNav` into the trigger).

### Fixed
- **Order-detail invoice totals were horizontally clipped on mobile.** Subtotal/Discount/Shipping/Total lived inside the `overflow-x-auto` line-items table, so on narrow screens they scrolled out of view ("Subt…", "To…"). Totals now render as a static block OUTSIDE the scroll container (always fully visible); the Unit Price column folds into the item cell on mobile (`… each`), letting the table min-width drop 420→340px.
- **PDP overflowed the mobile viewport (content clipped at the right edge, no wrap).** Root cause: the gallery thumbnail strip (`overflow-x-auto`) sits inside a CSS-grid item, and grid items default to `min-width:auto` — the strip's intrinsic width inflated the column past the viewport, and the body's `overflow-x-hidden` clipped everything instead of scrolling. Added `min-w-0` to the PDP grid children (gallery + info panel). Same latent guard applied to the other grid-item scroll/flex containers: `AccountNav` (account grid child with `overflow-x-auto`), the account content column, and the cart items column.

**Propagation:**
- Severity: HIGH (PDP unreadable on phones) · Layers: frontend (`components/cart/CartDropdown.tsx` new, `components/layout/MainNav.tsx`, `components/layout/AccountNav.tsx`, `components/cart/CartWorkspace.tsx`, `app/(storefront)/products/[slug]/page.tsx`, `app/(account)/{layout.tsx,orders/[id]/page.tsx}`)
- Migration: NO · Flag: none · Design impact: uses existing palette tokens/hexes · Breaking: NO
- Rollback: revert the listed files

## [0.1.28] — 2026-07-03

### Added
- **"Return request update" row in Admin → Settings → Notifications per-template routing** — merchants can toggle Email / SMS / WhatsApp for return-decision notifications (backend-core 0.1.42 routes them via `send-primary`). WhatsApp requires the approved `return_request_update` Meta template; the existing provisioned/enabled guards apply as for every other row.

**Propagation:**
- Severity: LOW (one routing row) · Layers: frontend (`components/admin/NotificationsChannelPanel.tsx`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the file

## [0.1.27] — 2026-07-03

### Added
- **Merchant returns toggle + return-status UX** (pairs with backend-core 0.1.41):
  - Admin → Settings → Store Policies: new **"Allow Order Returns"** checkbox (`CodSettingsPanel`) saved via the cod-settings PATCH.
  - `PublicStoreConfig.returnsEnabled` (fail-closed `false`) via `useStoreConfig()`.
  - Customer order detail: **Return Request status card** (chip + filed date + reason + store note); the "Request a Return / Replacement" CTA renders only when returns are enabled, the order is DELIVERED, and no request is in flight — mirroring the server guards. `OrderSummary.returnRequests` typed.
  - Admin return detail: the status pills now offer only **valid next transitions** (mirrors the backend guard: `REQUESTED→APPROVED/REJECTED`, `APPROVED→PICKED_UP/REJECTED`, `PICKED_UP→REFUNDED`; terminals immutable) instead of every status.
- Order numbers are display-only on the frontend — the new random `ORD-XXXX-XXXX` format (backend-core 0.1.41) needs no frontend changes; verified nothing parses the format.

**Propagation:**
- Severity: NORMAL (additive UI; server enforces everything) · Layers: frontend (`components/admin/{CodSettingsPanel,AdminReturnDetailPanel}.tsx`, `app/(account)/orders/[id]/page.tsx`, `lib/{storefront-settings.ts,orders-api.ts}` + tests)
- Migration: NO · Flag: merchant toggle (default ON) · Design impact: none · Breaking: NO
- Rollback: revert the listed files

## [0.1.26] — 2026-07-03

### Changed
- **Order detail page redesigned as a modern SaaS-style document.** Sectioned cards (shared `DetailCard` shell) in the account palette:
  - **Header**: order number + colour-mapped status chip + placed date/payment mode; actions (Invoice PDF, Retry Payment, Cancel) grouped right; back-link to orders.
  - **Items**: each line shows the product image thumbnail (`next/image`, placeholder fallback), name, variant, qty × unit price and line total — and **deep-links to that product & variant on the storefront** (`/products/<slug>?variant=<id>`) when still purchasable (backend-core 0.1.40 enrichment). `ProductVariantSelector` now honours a `?variant=` query param (read from `window.location` on mount — no `useSearchParams`, so the PDP stays statically cacheable with no Suspense requirement).
  - **Invoice**: proper invoice-style `<table>` (Item / Qty / Unit Price / Amount) with Subtotal, Discount (green, coupon code chip), Shipping ("Free" at 0) and accent Total in the footer; shows invoice number + issue date and a Download PDF action when `invoice.hasPdf`. Mobile: horizontal scroll.
  - **Tracking**: timeline list with dot markers (latest highlighted); address card; return-request form restyled. All action feedback (cancel, return submit, invoice download) now uses toasts.
  - Shared status helpers extracted to `lib/order-status-ui.ts` (used by orders list + detail). `OrderLineItem` gains optional `productSlug`/`imageUrl`/`isPurchasable`; `OrderSummary` gains `createdAt`.

**Propagation:**
- Severity: NORMAL (visual; additive types) · Layers: frontend (`app/(account)/orders/[id]/page.tsx`, `app/(account)/orders/page.tsx`, `components/product/ProductVariantSelector.tsx`, `lib/{orders-api.ts,order-status-ui.ts}`)
- Migration: NO · Flag: none · Design impact: account palette tokens/hexes · Breaking: NO
- Rollback: revert the listed files
- Pairs with backend-core 0.1.40 (order item PDP enrichment).

## [0.1.25] — 2026-07-03

### Fixed
- **Order detail page crashed with "useStoreConfig must be used within StoreConfigProvider".** The `(account)` route group's layout didn't mount `StoreConfigProvider` — only the storefront layout did — so `/orders/[id]` (whose `OrderReviewPrompt` reads `useStoreConfig().reviewsEnabled`) threw the error boundary on every visit. The account layout now mirrors the storefront layout: it fetches categories + public store config and wraps everything in `StoreConfigProvider`.
- **Account pages now share the storefront chrome.** The same fix adds the site `Header` (nav, search, cart) and `Footer` to all account pages (`/dashboard`, `/orders`, `/orders/[id]`, `/addresses`, `/settings`), which previously rendered as bare standalone pages. Session bootstrap in the Header and the AccountGuard share the same deduped customer restore, so no double refresh-token consumption.

**Propagation:**
- Severity: HIGH (order detail page was broken for customers) · Layers: frontend (`app/(account)/layout.tsx`)
- Migration: NO · Flag: none · Design impact: none (uses existing chrome) · Breaking: NO
- Rollback: revert the file (restores the crash)
- Follow-up to 0.1.24 (account redesign).

## [0.1.24] — 2026-07-03

### Added
- **Customer account area redesigned as a modern SaaS-style profile** (all in the existing brand palette):
  - **`AccountNav`** (new, `components/layout/AccountNav.tsx`): icon nav with active-route highlight; desktop sidebar gets a profile card (avatar initial, name, contact) and a **Sign out** action; mobile keeps a compact horizontal pill bar.
  - **Addresses** now has its own page (`/addresses`, new): card-grid address book with Default badge, set-default / edit / delete, inline add/edit form (react-hook-form + zod), toast feedback. Moved out of Settings; dashboard quick-link now points at it (was `/settings`).
  - **Settings** rebuilt: sectioned Profile card (name/email) and a **Mobile Number card — add, change, or remove the login phone** (backend-core 0.1.39). Removal shows a confirm explaining OTP sign-in is lost; server refuses removal when the phone is the only sign-in identifier. Addresses shortcut card links to the new page.
  - **Order History** restyled: status chips (colour-mapped per status), order date + payment mode, invoice download + View actions as proper buttons, skeletons/empty states in the account palette.

**Propagation:**
- Severity: NORMAL (visual + additive; API surface unchanged except `phone` on the profile PATCH) · Layers: frontend (`components/layout/AccountNav.tsx` new, `app/(account)/{layout,dashboard/page,orders/page,settings/page}.tsx`, `app/(account)/addresses/page.tsx` new, `lib/users-api.ts`)
- Migration: NO · Flag: none · Design impact: uses the existing storefront palette tokens/hexes · Breaking: NO
- Rollback: revert the listed files
- Pairs with backend-core 0.1.39 (phone add/update/remove on `PATCH /users/me`). NOTE: this tag also delivers 0.1.23 (variant "Deactivate instead?" flow), whose tag was never pushed.

## [0.1.23] — 2026-07-03

### Added
- **"Deactivate instead?" flow on variant delete.** When deleting a variant returns the 409 (it appears in existing orders and must be preserved for invoices/history), the product editor now offers a confirm dialog explaining the trade-off and — on confirm — PATCHes `isActive: false`. The variant disappears from the storefront and (per backend-core 0.1.38) from live customer carts; already-placed orders keep flowing untouched. Success toast: "Variant deactivated — removed from storefront and customer carts."

**Propagation:**
- Severity: NORMAL (UX for the 409 path) · Layers: frontend (`components/admin/AdminProductEditor.tsx`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the file
- Pairs with backend-core 0.1.38 (deactivation cart purge + checkout inactive-item guard).

## [0.1.22] — 2026-07-03

### Fixed
- **Specific 409/400 backend explanations are no longer swallowed by generic copy.** `getApiErrorMessage` mapped every `CONFLICT` to "This action conflicts with the current state…" and every `VALIDATION_ERROR` to "Please check the highlighted fields…" — so the variant-delete 409's clear "Cannot delete a variant that appears in existing orders. **Deactivate it instead.**" never reached the user, and fieldless `VALIDATION_ERROR`s (e.g. "Cannot delete the last variant of a product") showed "check the highlighted fields" with **nothing highlighted**. The mapper now surfaces specific crafted `CONFLICT`/`VALIDATION_ERROR` server messages (same rule `getApiErrorMessageWithHint` already used); schema-level "Request validation failed" keeps the generic copy, and when the backend DOES send field details the existing `useAdminFormValidation` highlighting/scroll behaviour is unchanged. One central fix — every call site (admin + storefront) benefits. Regression tests added.

### Changed
- **Toaster moved to the TOP-RIGHT and enlarged on desktop.** Mobile: spans the top with safe-area insets, compact sizing. Desktop: fixed ~440px column anchored top-right with larger text/padding so it's clearly visible on big screens. Slide-in now comes from the right.
- **Toast rollout across the remaining admin mutation panels.** Converted `AdminCategoryEditor`, `AdminCategoryForm`, `AdminOrderFulfillmentPanel`, `AdminOrderItemsPanel`, `AdminOrderStatusPanel`, `BoxPresetsPanel`, `CodSettingsPanel`, `InventorySettingsPanel`, `ShippingSettingsPanel` — error/success state now mirrors into global toasts and the in-panel/inline banners are removed. Combined with 0.1.20's conversions, every admin mutation surface (settings saves, product/category editing, order ship/cancel/status/items, box presets) now reports via the top-right toast. List/dashboard **load-failure** states intentionally remain inline (a 3s toast vanishing would leave a blank table with no explanation).

**Propagation:**
- Severity: HIGH (users couldn't see why deletes/saves were being refused) · Layers: frontend (`lib/error-messages.ts` + test, `components/ui/Toaster.tsx`, 9 × `components/admin/*.tsx`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the listed files
- Pairs with backend-core 0.1.37 (variant-delete 409) — the 409's "Deactivate it instead" now actually shows in the toast.

## [0.1.21] — 2026-07-03

### Fixed
- **VPS frontend build broke: `Module not found: Can't resolve '@/components/shared/Toaster'`.** 0.1.20 put the new `Toaster` in `components/shared/`, but that directory is **not** in the core sync manifest (only `components/{ui,layout,admin,product,cart,checkout}/**` are) — so `Toaster.tsx` never synced to client repos, while the core `app/layout.tsx` that imports it did. `next build` (run on deploy) failed on the dangling import. (Client `reliability-gates` doesn't run a full `next build`, so it slipped through.) Moved `Toaster.tsx` → `components/ui/Toaster.tsx` (a core-synced directory; a Toaster is a UI primitive) and updated the import. No behaviour change.

**Propagation:**
- Severity: HIGH (breaks the frontend production build on deploy) · Layers: frontend (`components/ui/Toaster.tsx` moved from `components/shared/`, `app/layout.tsx`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: n/a (roll up with 0.1.20). Note: `components/shared/**` remains outside the core manifest — new files there won't sync; keep shared core components under a manifested directory (`components/ui`, `components/layout`, …).

## [0.1.20] — 2026-07-03

### Added
- **Global toast/popup notification system** to replace the large top-of-page inline banners with a small, viewport-aware popup on the LEFT that auto-dismisses in ~3s. New: `stores/toast.ts` (store — auto-dismiss, duplicate-collapse, max-4 cap), `lib/toast.ts` (`toast.success/error/info/warning(...)` helper usable from any event handler), and `components/shared/Toaster.tsx` (framer-motion renderer, mounted once in the root layout). Responsive by viewport: on mobile it spans the bottom with insets and compact sizing; on desktop it's a fixed ~380px column anchored bottom-left. Brand-independent status colours, `aria-live` announcements, honours `prefers-reduced-motion`, click-to-dismiss.

### Changed
- **Converted the highest-traffic surfaces to toasts** (pattern for the rest): admin `AdminProductEditor` (the save/variant error+success banners → toasts, incl. the variant-delete failure), admin `StoreSettingsPanel` and `NotificationsChannelPanel` (in-panel error/success banners → toasts), and storefront `AddToCartButton` (success "Added to cart" + error toast, inline error removed). Inline **field-validation highlighting** is unchanged (still driven by `useAdminFormValidation`); only the big status banners moved to toasts.

**Propagation:**
- Severity: NORMAL (additive UX system; converted surfaces are backward-compatible) · Layers: frontend (`stores/toast.ts`, `lib/toast.ts` + test, `components/shared/Toaster.tsx`, `app/layout.tsx`, `components/admin/{AdminProductEditor,StoreSettingsPanel,NotificationsChannelPanel}.tsx`, `components/cart/AddToCartButton.tsx`)
- Migration: NO · Flag: none · Design impact: none (status colours are brand-independent; layout-neutral overlay) · Breaking: NO
- Rollback: revert the listed files (unmounting `<Toaster/>` disables it; other panels still use their inline banners)
- Pairs with backend-core 0.1.37 (variant-delete 409 fix — its clean error now shows as a toast in the product editor). Remaining admin panels still use inline banners and can be migrated incrementally by mirroring `error`/`success` state into `toast.*` and removing the banner JSX.

## [0.1.19] — 2026-07-03

### Fixed
- **Storefront header support phone is now merchant-managed, not hardcoded.** `components/layout/Header.tsx` hard-coded one client's "Call Us 24/7" number (and would ship it to every client via core sync). It now reads `contactPhone` from the public store config (`useStoreConfig()`) — the same source the Footer already uses — and hides the whole phone block (and its divider) when no number is set. Merchants edit it in **Admin → Settings → Store Profile**, alongside the store address.

### Changed
- **Re-added Contact Phone + Contact Email to the admin Store Profile panel.** `StoreSettingsPanel` previously showed a note saying these were "removed to simplify configuration"; they're now editable fields (loaded from `GET /admin/settings/store`, saved via the existing PATCH — backend already accepted `contactPhone`/`contactEmail`). This makes the header/footer contact details self-service for merchants, no backend seeding needed.

**Propagation:**
- Severity: NORMAL (removes a cross-client branding leak; adds merchant self-service) · Layers: frontend (`components/layout/Header.tsx`, `components/admin/StoreSettingsPanel.tsx`)
- Migration: NO · Flag: none · Design impact: none (header phone now data-driven; hidden when unset) · Breaking: NO
- Rollback: revert the two files
- No backend change: `StoreSettings.contactPhone`/`contactEmail` were already read/written by `/admin/settings/store` and exposed in `/store/config`. After sync, each merchant should set their number in Admin → Settings → Store Profile (until then the header phone block is simply hidden).

## [0.1.18] — 2026-07-02

### Fixed
- **Session-restore no longer spuriously logs out valid sessions on slow mobile networks.** `useAuthSessionRestore` raced the cookie-restore round-trip (refresh + profile fetch) against an **8s** deadline; on 3G/weak links the request eventually succeeds but the race already resolved `unauthorised`, so the hook cleared the session and **permanently blocked** any retry for that load — the "works on desktop, drops on mobile" report. Fixes: (1) deadline 8s → **15s** (a genuinely dead request still fails fast on its own, so this only helps slow-but-working connections); (2) the timeout now resolves a distinct `"timeout"` reason that the handler treats as a **soft, retryable** failure — it does not set `blocked` and does not clear a possibly-valid session, so a remount/navigation/nonce bump can try again. Only a definitive `unauthorised`/`invalid_token` still hard-clears + blocks.

**Propagation:**
- Severity: HIGH (valid sessions dropped on mobile) · Layers: frontend (`hooks/use-auth-session-restore.ts`, `lib/restore-auth-session.ts`)
- Migration: NO · Flag: none · Design impact: none · Breaking: NO
- Rollback: revert the two files
- Pairs with backend-core 0.1.36 (refresh cookie `SameSite=Lax`). Together they address the "logged out on refresh / after idle / only on mobile" reports.

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
