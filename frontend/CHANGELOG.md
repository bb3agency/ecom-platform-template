# Frontend Core — Changelog

Semantic versioning (`MAJOR.MINOR.PATCH`). This file is the **propagation instruction set** for the shared storefront/admin/ops core. Per-client **design** (`app/globals.css` tokens, `lib/fonts.ts`, `lib/constants.ts`, `public/`) is NOT part of core and is never changed by these entries. See `../backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`.

- **PATCH** — bug/a11y/perf fix, no prop/contract change.
- **MINOR** — backward-compatible feature (token-styled so it auto-adopts each client's theme; OFF behind a flag where it adds surface area).
- **MAJOR** — breaking change (component API, route contract, or new required design token).

Each entry MUST carry the **Propagation** block.

---

## [Unreleased]

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
