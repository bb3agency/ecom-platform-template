# Platform Versioning & Multi-Client Sync Guide

> **Status:** Client-Main (Post-Development) + template engineering practice.
> **Pairs with:** `backend/CO_DEVELOPMENT_SYNC_GUIDE.md` (the git mechanics of upstreaming backend changes — this guide adds the *versioning, changelog, design-isolation, and drift-enforcement* layer on top, and extends it to the frontend).
> **Goal:** Keep every client site (raghava-organics, sbgs, future clients) on an up-to-date, **versioned shared core** while each keeps its **own design** and its **own enabled feature set** — with no silent drift and nothing left behind.

---

## 0. TL;DR

- **Version the core, not the site.** Two semver'd cores: `backend-core` and `frontend-core` (tags `backend-core-vX.Y.Z`, `frontend-core-vX.Y.Z`) + a `CHANGELOG.md` each.
- **The changelog entry is the apply-everywhere recipe** — it states layers, migration, flag, design impact, severity, breaking, rollback.
- **Three buckets:** *common* → core (synced to all) · *configurable* (design + flags) → per client · *custom* → an extension folder the core ignores.
- **Each client pins `PLATFORM_VERSION`**; updating = replaying changelog entries to the latest tag.
- **Differences stay out of core code:** design lives in the token layer (`merge=ours`), feature differences live in `FEATURE_*` flags (default OFF), one-offs live in `src/modules/client/**` / `app/(client)/**`.
- **CI enforces it:** `check-core-drift.sh` (no silent fork) + `check-token-contract.sh` (no broken theme) + compatibility check (no mismatched core pair).

---

## 1. The three-bucket model

| Bucket | Examples | Lives in | Versioned how |
| --- | --- | --- | --- |
| **Common** (all clients) | API client, cart/checkout/order logic, all backend modules | **Core** (`core-manifest.json` → include) | `backend-core` / `frontend-core` semver |
| **Configurable** (per client) | palette/fonts (`app/globals.css`, `lib/fonts.ts`), brand strings (`lib/constants.ts`), assets (`public/`), `FEATURE_*` flags | Design layer + Ops/store config | Not core-versioned (orthogonal) |
| **Custom** (one client only) | a bespoke module only client X wants | `backend/src/modules/client/**`, `frontend/app/(client)/**` | Tracked per client, excluded from core diff |

**Why this makes one version number meaningful:** because divergence is forced into config/flags/extension folders, the *core* stays byte-identical across clients — so "raghava is on backend-core 2.3.1" is a true, enforceable statement.

---

## 2. Semver policy

| Bump | Meaning | Client action |
| --- | --- | --- |
| **PATCH** (`x.y.Z`) | Bug / security / perf fix, no contract change | Auto-mergeable into all clients |
| **MINOR** (`x.Y.0`) | Backward-compatible feature; new surface ships **OFF** behind a flag | Merge; leave new flags OFF; enable per client deliberately |
| **MAJOR** (`X.0.0`) | Breaking change / migration / new required design token | Deliberate per-client upgrade (same caution as a Dependabot major) |

Migrations must be **expand-contract / additive-first** so a MINOR never breaks a client that hasn't upgraded yet.

---

## 3. The release flow (in the template/core repo)

1. Build the change (dogfood it in a reference client first — see §8).
2. Classify per `backend/CO_DEVELOPMENT_SYNC_GUIDE.md` (template-worthy vs client-specific).
3. Add a `CHANGELOG.md` entry with the full **Propagation** block (severity · layers · migration · flag · design impact · breaking · rollback).
4. Bump the **single source of truth — `backend/package.json` `version` (and/or `frontend/package.json`)** — mirror the same value into `PLATFORM_VERSION`, then tag: `git tag backend-core-vX.Y.Z` (and/or `frontend-core-vX.Y.Z`). The package.json `version` is what `/health` reports at runtime, so these three (package.json · PLATFORM_VERSION · tag) must always match.
5. Propagate to clients (§4).

> **One source of truth:** `backend/package.json` and `frontend/package.json` `version` fields are authoritative (they drive `/health` + tracing). `PLATFORM_VERSION` is the fleet-sync ledger that mirrors them; a tag pins the release. The drift check and a simple equality assertion keep all three aligned.

The Propagation block is the heart of the practice: it is the AI-summarised "what changed + how to apply" that lets the same fundamental change land in every client without re-investigation.

---

## 4. The update flow (in each client repo)

One-time wiring per client:
```bash
git remote add template https://github.com/bb3agency/<core-template>.git
git config merge.ours.driver true            # activates .gitattributes design protection
```

Per release:
```bash
git fetch template --tags
# 1. See what's between you and latest in the relevant CHANGELOG.md
# 2. Merge the core (design files are protected by .gitattributes merge=ours)
git merge backend-core-vX.Y.Z      # and/or frontend-core-vX.Y.Z
# 3. Apply migrations if the entry says so (expand-contract)
cd backend && npx prisma migrate deploy
# 4. Leave new flags OFF (enable per client via Ops when desired)
# 5. Gate checks
bash backend/scripts/check-core-drift.sh
bash backend/scripts/check-token-contract.sh
cd frontend && npm run typecheck && npm run build
# 6. Record the new version
#    edit PLATFORM_VERSION -> backend-core / frontend-core / requires-backend-core
```
Typecheck + build are the backstop: if a layer was left behind, the client build fails.

---

## 5. Design-token contract (auto-reskin guarantee)

A core component only auto-adopts a client's look if that client defines every token the component uses. `frontend/design-tokens.contract.json` lists the **required token set**; `check-token-contract.sh` fails a client whose `globals.css` is missing any. When a core change introduces a **new** token, add it to the contract in the same release and call it out in the entry's *Design impact* field — every client adds it before merging. Result: "feature applied but looks broken in client X" cannot happen silently.

---

## 6. Feature flags & graduation (no flag debt)

- New optional features ship in core to **all** clients but **default OFF** (`FEATURE_*` + `GET /store/config` + Ops config). The code is version-aligned; only the flag differs per client.
- **Graduation:** once a flag is ON for *all* clients and stable for ≥2 releases, fold it into core-default and **remove the flag** in a MINOR. Keeps the flag set small and truthful.

---

## 7. Drift enforcement & sanctioned exceptions

- `core-manifest.json` declares core-owned vs client paths. `check-core-drift.sh` diffs the client's core files against the pinned template tag and **fails on any unsanctioned divergence** — forcing the change upstream (becomes core) or into the extension folder.
- Rare, legitimate one-offs go in `PLATFORM_VERSION` → `approved-divergence` as a **time-boxed** entry (`path — justification — owner — expires`). The check warns (doesn't fail) until expiry, then it must be resolved.
- Add `CODEOWNERS` on core paths so edits to shared files require platform-team review (nudges changes upstream).

---

## 8. Reliability add-ons

- **Compatibility contract:** `frontend-core` declares `requires-backend-core` in `PLATFORM_VERSION`; CI (and a boot check) fail on a mismatched pair so frontend never calls a route the deployed backend lacks.
- **Runtime version exposure (already live):** `GET /api/v1/health` returns `version`, sourced from `backend/package.json` (`health.service.ts`) and also used by tracing (`process.env.npm_package_version`). **That `version` field IS the deployed `backend-core` version** — no extra code needed. The frontend equivalent is `frontend/package.json` `version` (embed as `NEXT_PUBLIC_FRONTEND_CORE_VERSION` if you want it client-readable). Aggregate both across clients into a **fleet dashboard** ("who's behind / mismatched"): repo `PLATFORM_VERSION` says what's *committed*, `/health` says what's *running*.
- **Security fast-path:** entries tagged `Severity: SECURITY` trigger the release-train (§9) with auto-merge + auto-deploy + Ops/Admin alert, so a patched auth bug reaches every site in minutes.
- **Reference client + smoke suite:** keep one canonical storefront on latest core with default design; run full e2e there on every core change before propagation.
- **Rollback:** every entry records its rollback (down-migration availability + previous tag). Roll back a client by pinning the prior tag and reversing the migration.

---

## 9. Release-train automation (Level 3 — opt-in, PR-gated)

Automates propagation end-to-end: **tag a core release in the template → every client repo opens a review PR with the core files updated.** You review + merge each PR (which triggers that client's CD). No manual file copying.

### 9.1 The three moving parts

| Piece | Lives in | Role |
| --- | --- | --- |
| `.github/workflows/release-train.yml` | **template** | On a `*-core-v*` tag push, dispatches each client's `core-sync` workflow with the tag. |
| `.github/workflows/core-sync.yml` | **each client** | Receives the dispatch, wires the template remote, runs the sync engine, opens a PR. |
| `backend/scripts/sync-core.mjs` | **template + each client** | The engine: `git checkout <tag> -- <core pathspec from core-manifest.json>` (excludes design/client/approved-divergence), refreshes the layer CHANGELOG, bumps `PLATFORM_VERSION`. Leaves changes uncommitted. |

`sync-core.mjs` is core (`backend/scripts/**`) so it self-propagates. The two workflows are **infra, not core** — they are NOT in `core-manifest.json`, so they are bootstrapped once per client (present automatically in repos cloned from the template; copied by hand into pre-existing clients).

### 9.2 One-time setup

**Template repo** — Settings → Secrets and variables → Actions:
- Variable `RELEASE_TRAIN_ENABLED = true`
- Variable `CLIENT_REPOS = bb3agency/raghava-organics-site bb3agency/sbgs-site` (space-separated)
- Secret `CROSS_REPO_PAT` = a PAT with **`actions: write` + `contents: read` on every client repo** (lets it dispatch their `core-sync`).

**Each client repo** — Settings → Secrets and variables → Actions:
- Variable `TEMPLATE_REPO = bb3agency/ecom-platform-template`
- Secret `TEMPLATE_READ_PAT` = a PAT with **`contents: read` on the template repo** (lets the client `git fetch` the private template).
- Secret `CORE_SYNC_PAT` = a PAT with **`contents: write` + `pull-requests: write` on this client repo** (used to push the branch + open the PR). **Strongly recommended** — see 9.4.
- Settings → Actions → General → enable **"Allow GitHub Actions to create and approve pull requests."**

> Fine-grained PATs are preferable (scope to exactly these repos). One bot account holding all three tokens is the cleanest custody model.

### 9.3 The flow per release
1. In the template: make the core change → CHANGELOG entry → bump `package.json` + `PLATFORM_VERSION` → `git tag backend-core-vX.Y.Z` → `git push --tags`.
2. `release-train` fires → dispatches `core-sync` in each client.
3. Each client's `core-sync` opens PR `core-sync/<tag>` containing only core changes (design untouched).
4. You review each PR, merge → client CD deploys.

Manual fallback (no automation, or a client without the workflow): `node backend/scripts/sync-core.mjs --tag backend-core-vX.Y.Z` locally, then commit + push.

### 9.4 Silent-failure modes (READ THIS)
The system is PR-gated, so the worst case is "a sync silently doesn't happen," not "a bad change auto-deploys." Known traps:

- **Core file DELETIONS / renames don't propagate.** `git checkout <tag> -- <paths>` only adds/updates files present in the tag; a file you *removed* in core stays in the client. → For releases that delete/rename core files, note it in the CHANGELOG and remove them by hand in each client.
- **PRs opened with `GITHUB_TOKEN` don't trigger the client's CI.** If `CORE_SYNC_PAT` is unset, the PR opens but the client's `reliability-ci` won't run on it → a broken sync can look mergeable. → Always set `CORE_SYNC_PAT`. The workflow prints a `::warning::` when it's missing.
- **A client missing `core-sync.yml` is skipped with only a warning.** `release-train` logs `::warning::` and continues; that client just never gets a PR. → Confirm every `CLIENT_REPOS` entry actually has the workflow on its default branch.
- **`approved-divergence` paths are never overwritten** (by design) — a client pinning an old fork of a core file won't receive the update silently. → Keep `approved-divergence` entries time-boxed and review them.
- **`core-manifest.json` drift.** The engine trusts the *client's* manifest for the pathspec. If a client's manifest is stale, the wrong files sync. → The manifest is core; the drift check keeps it aligned.
- **Token scope/expiry.** An expired/under-scoped PAT fails the dispatch or the fetch. These fail loudly in the Actions log but are easy to miss if you don't watch the run. → After tagging, glance at the template's release-train run and each client's core-sync run.
- **A non-fast-forward client branch.** The workflow pushes `--force-with-lease` to `core-sync/<tag>`; if that branch exists with unrelated commits it won't clobber blindly — it errors. → Delete a stale `core-sync/*` branch before re-running.

Net rule: **after every release, watch the template's release-train run and each client's core-sync PR appear.** Green PR + your review is the gate; an absent PR means a skip you must chase.

---

## 10. Files in this architecture

| File | Purpose |
| --- | --- |
| `PLATFORM_VERSION` | Per-client ledger: pinned core versions + compatibility + approved divergences |
| `core-manifest.json` | Core-owned vs client paths (drives drift check) |
| `.gitattributes` | `merge=ours` protection for the design layer |
| `frontend/design-tokens.contract.json` | Required design-token set (drives token check) |
| `backend/CHANGELOG.md`, `frontend/CHANGELOG.md` | Versioned propagation instruction sets |
| `backend/scripts/check-core-drift.sh` | Fails on unsanctioned core divergence |
| `backend/scripts/check-token-contract.sh` | Fails on missing design tokens |
| `.github/workflows/release-train.yml` | Opt-in fan-out PR automation |

> `chmod +x backend/scripts/check-core-drift.sh backend/scripts/check-token-contract.sh` once, and wire both into CI alongside the existing `typecheck`/`lint`/`build` gates.

---

## 11. Client registry (fleet view — keep current)

| Client | backend-core | frontend-core | Enabled flags (non-default) | Design notes |
| --- | --- | --- | --- | --- |
| raghava-organics | 0.1.1 | 0.1.1 | _baseline_ | Tasty-Daily palette (forest green / peach), Inter |
| sbgs (srisaibabasweets) | 0.1.1 | 0.1.1 | _baseline_ | own palette |

Update this table on every client sync — it is the at-a-glance "who is up to date."

---

> **Propagation:** This guide, the changelog/version/manifest/contract files, and the two scripts are **template-worthy** — they belong in the core template and should be synced to every client repo. Per the co-development rules, propose the push/PR and get explicit approval before any remote mutation.
