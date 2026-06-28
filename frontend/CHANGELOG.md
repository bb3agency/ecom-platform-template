# Frontend Core — Changelog

Semantic versioning (`MAJOR.MINOR.PATCH`). This file is the **propagation instruction set** for the shared storefront/admin/ops core. Per-client **design** (`app/globals.css` tokens, `lib/fonts.ts`, `lib/constants.ts`, `public/`) is NOT part of core and is never changed by these entries. See `../backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`.

- **PATCH** — bug/a11y/perf fix, no prop/contract change.
- **MINOR** — backward-compatible feature (token-styled so it auto-adopts each client's theme; OFF behind a flag where it adds surface area).
- **MAJOR** — breaking change (component API, route contract, or new required design token).

Each entry MUST carry the **Propagation** block.

---

## [Unreleased]

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
