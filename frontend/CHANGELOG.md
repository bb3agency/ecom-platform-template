# Frontend Core — Changelog

Semantic versioning (`MAJOR.MINOR.PATCH`). This file is the **propagation instruction set** for the shared storefront/admin/ops core. Per-client **design** (`app/globals.css` tokens, `lib/fonts.ts`, `lib/constants.ts`, `public/`) is NOT part of core and is never changed by these entries. See `../backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`.

- **PATCH** — bug/a11y/perf fix, no prop/contract change.
- **MINOR** — backward-compatible feature (token-styled so it auto-adopts each client's theme; OFF behind a flag where it adds surface area).
- **MAJOR** — breaking change (component API, route contract, or new required design token).

Each entry MUST carry the **Propagation** block.

---

## [Unreleased]

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
