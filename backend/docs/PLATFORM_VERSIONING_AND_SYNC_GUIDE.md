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
- **Differences stay out of core code:** design lives in the token layer (`merge=ours`), feature differences live in `FEATURE_*` flags (default OFF), one-offs live in the client extension layer: `backend/src/modules/client/**`, `frontend/app/(client)/**` (pages), `frontend/components/client/**` (components).
- **CI enforces it:** `check-core-drift.sh` (no silent fork) + `check-token-contract.sh` (no broken theme) + compatibility check (no mismatched core pair).
- **Conflict-free propagation is implemented (Phase 1, `backend-core` 0.1.6–0.1.8):** a 3-way merge sync engine + a hard drift gate + a client extension layer. The phased roadmap (Phase 1 done; Phase 2/3 = package the core) is **§14**.

---

## 1. The three-bucket model

| Bucket | Examples | Lives in | Versioned how |
| --- | --- | --- | --- |
| **Common** (all clients) | API client, cart/checkout/order logic, all backend modules | **Core** (`core-manifest.json` → include) | `backend-core` / `frontend-core` semver |
| **Configurable** (per client) | palette/fonts (`app/globals.css`, `lib/fonts.ts`), brand identity (`lib/constants.ts`), **copy/content** (`lib/content.ts`), assets (`public/`), legal/marketing/Footer/email content, `FEATURE_*` flags | Design layer + Ops/store config | Not core-versioned (orthogonal) |
| **Custom** (one client only) | a bespoke module only client X wants | `backend/src/modules/client/**`, `frontend/app/(client)/**`, `frontend/components/client/**` | Tracked per client, excluded from core diff |

**Why this makes one version number meaningful:** because divergence is forced into config/flags/extension folders, the *core* stays byte-identical across clients — so "raghava is on backend-core 2.3.1" is a true, enforceable statement.

### 1.1 Industry alignment — customization is configuration (data), not forked code

The two rules the white-label/multi-client industry converges on, and that this platform now enforces:

> **"The right answer is a configuration-driven architecture where customization is *data, not code*."** · **"The most common architectural mistake is *forking code for customization*."**
> — multi-tenant / white-label SaaS architecture guidance (clockwise.software, HiringThing, developex)

We run **separately-deployed** client sites (per-client repo + VPS), not one shared deployment — so we keep per-client repos. But the same rule governs *what may differ*:

- **All client identity AND copy are DATA in the design layer**, never hardcoded in core. Two per-client config files (both excluded from sync): **`lib/constants.ts`** = brand IDENTITY (name, logo, `STORAGE_PREFIX`, domains, contact); **`lib/content.ts`** = client COPY (taglines, blurbs, product-attribute defaults, homepage SEO). Palette → `globals.css` tokens; assets → `public/`; legal/marketing/Footer/email/homepage → excluded content files; behaviour → `FEATURE_*` flags + Ops/env config. Core components import identity + copy from these and hardcode neither. **Rule: if a string in core reads like a brand name, location, or marketing line, it belongs in `constants.ts`/`content.ts`, not inline.**
- **Core is byte-identical across clients — enforced, not hoped:** `check-core-purity` (CI) fails on any client identifier in core; `core-manifest.json` declares core vs client; the design layer is `merge=ours`-protected.
- **The governance config must itself propagate.** Incident lesson (2026-06-21): a sync re-contaminated a client because `core-manifest.json` wasn't synced, so it used stale excludes. Fix: `core-manifest.json` + `core-purity-denylist.txt` are now in the core include — every client enforces the *same* rules. **Rule: anything that governs the sync must itself be synced.**
- **Sync model mirrors the .NET VMR** ([devblogs.microsoft.com](https://devblogs.microsoft.com/dotnet/how-we-synchronize-dotnets-virtual-monorepo/)): clean upstream (template) → automated downstream sync, with per-client divergence confined to **declared, time-boxed** `approved-divergence` patches — never silent forks. Per-client **content** (legal/marketing/Footer/email) is excluded from core because it is *content/data*, not shared logic. **Core TEST files and the committed `.env.example` ARE core (since `backend-core 0.1.29`)** — they sync with the source they cover so a core change that alters a test expectation or adds an env key propagates to every client automatically (no manual hand-delivery). Only *client-specific* tests are excluded, via the client-extension paths (`src/modules/client/**/*.test.ts`, `frontend/{components/client,app/(client)}/**/*.test.*`). Real secret env files (`.env`, `.env.*.local`) are gitignored/untracked and are never synced regardless.

If you're ever tempted to branch a core file for one client, that's the anti-pattern: parameterize it via config, gate it behind a flag, or move it to the client extension layer — `backend/src/modules/client/**`, `frontend/app/(client)/**` (pages; route groups keep URLs unchanged, add a `(client)/layout.tsx` for chrome), `frontend/components/client/**` (components).

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

> The end-to-end, copy-paste runbook for the standard "develop in a client → promote → fan out" loop is **§12**. This section is the underlying contract.

1. Get the change into the template. Either **develop it here directly**, or **develop it in a client and cherry-pick it in** (the team's default — see §12). Classify per `backend/CO_DEVELOPMENT_SYNC_GUIDE.md` (template-worthy vs client-specific); design/flags/one-offs never enter core.
2. Add a `CHANGELOG.md` entry with the full **Propagation** block (severity · layers · migration · flag · design impact · breaking · rollback).
3. Bump the **single source of truth — `backend/package.json` `version` (and/or `frontend/package.json`)** — mirror the same value into `PLATFORM_VERSION`, then tag: `git tag backend-core-vX.Y.Z` (and/or `frontend-core-vX.Y.Z`). The package.json `version` is what `/health` reports at runtime, so these three (package.json · PLATFORM_VERSION · tag) must always match.
4. Push the tag → the release-train fans out to every client (§9). Nothing reaches a client before the tag exists — the tag is the "ship it everywhere" switch.

> **One source of truth:** `backend/package.json` and `frontend/package.json` `version` fields are authoritative (they drive `/health` + tracing). `PLATFORM_VERSION` is the fleet-sync ledger that mirrors them; a tag pins the release. The drift check and a simple equality assertion keep all three aligned.

The Propagation block is the heart of the practice: it is the AI-summarised "what changed + how to apply" that lets the same fundamental change land in every client without re-investigation.

---

## 4. The update flow (in each client repo)

How a client receives a release depends on how it was created:

**A. Clients with their own history (raghava, sbgs — NOT cloned from the template).**
A `git merge` of a template tag fails (`unrelated histories`). These clients are updated **automatically by the release-train** (§9): the tag dispatches their `core-sync` workflow, which runs `sync-core.mjs` (3-way delta apply over the core paths, design excluded) and opens a review PR. You merge → CD deploys. Manual equivalent if needed: `npm run sync:core -- --tag backend-core-vX.Y.Z`.

**B. Clients cloned FROM the template (future clients — shared history).**
These can use native git merge. One-time wiring:
```bash
git remote add template https://github.com/bb3agency/<core-template>.git
git config merge.ours.driver true            # activates .gitattributes design protection
```
Per release:
```bash
git fetch template --tags
git merge backend-core-vX.Y.Z                # design files protected by merge=ours
cd backend && npx prisma migrate deploy      # only if the entry says Migration: YES
bash backend/scripts/check-core-drift.sh
bash backend/scripts/check-token-contract.sh
cd frontend && npm run typecheck && npm run build
# record the new version in PLATFORM_VERSION
```

Either way: new flags stay **OFF** (enable per client via Ops), and typecheck + build + drift/token checks are the backstop — if a layer was left behind or a token is missing, the client's PR/build fails before deploy.

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
- **The gate runs in CI via `.github/workflows/core-drift.yml`** (since `0.1.6`), which wires the template remote + jq and runs the check in **strict mode** (`CORE_DRIFT_STRICT=true`) on every PR/push — so a missing prerequisite is a build FAILURE, never a silent skip. Locally the same script skips cleanly when run without the template remote. This is what makes "core is read-only in clients" actually enforced (and is the prerequisite for ever extracting core into packages — Phase 2/3). Opt-out per repo with Variable `CORE_DRIFT_ENABLED=false`.
- Rare, legitimate one-offs go in `PLATFORM_VERSION` → `approved-divergence` as a **time-boxed** entry (`path — justification — owner — expires`). Those paths are excluded from the gate (honored since `0.1.6`) until you remove them.
- Add `CODEOWNERS` on core paths so edits to shared files require platform-team review (nudges changes upstream).

### 7.1 Core purity — no client identity in core files (the anti-contamination guard)

Because `sync-core.mjs` checks out the **entire** core pathspec, any client-specific value baked into a core file gets copied to every client on the next sync — overwriting their brand/keys with another client's (this bit us: a sync turned `sbgs-cart` into `raghava-cart`). To make that impossible:

- **Client identity AND copy never live in core code.** Brand name → `APP_NAME`; logo → `BRAND_LOGO_SRC`; storage keys → `STORAGE_PREFIX`; provider/contact → env or Ops config — all in **`lib/constants.ts`** (excluded). Marketing **copy** (taglines, blurbs, product-attribute defaults, homepage SEO) → **`lib/content.ts`** (excluded). Larger per-client **content** (legal/about pages, homepage `page.tsx`, `Footer`, marketing-home sections, email templates) is excluded from core in `core-manifest.json`. **Core TEST files and `backend/.env.example` are core (synced) since `0.1.29`** — a core change that touches a test or adds an env key reaches every client automatically; only client-extension tests (`src/modules/client/**/*.test.ts`, `frontend/{components/client,app/(client)}/**/*.test.*`) are excluded. (Secret env files stay untracked, never synced.)
- **`check-core-purity.mjs` (`npm run check:core-purity`)** greps every core file (per `core-manifest.json`, **skipping tests and its own config files**) for `core-purity-denylist.txt` patterns and **fails the build** on any hit. Each client also has a **`core-purity-allow.txt`** listing its OWN identifiers — only *another* client's brand in core is contamination, so a client's own brand in its (rare) core mentions is allowed. Wired into `ci:reliability-gates`. A hardcoded "Raghava Organics" in shared core can no longer reach CI green.
- **`core-manifest.json` + `core-purity-denylist.txt` are themselves synced** (in the core include) — the governance config must propagate, or a client drifts onto stale rules (this is exactly how a re-contamination happened: a client synced with an out-of-date manifest).
- **Onboarding a new client:** add their brand/domain/slug to `core-purity-denylist.txt`, create their `core-purity-allow.txt` (their own identifiers), and author their `lib/constants.ts` + `lib/content.ts`.
- **Fixing a violation:** move the value to the design layer — identity → `constants.ts` (`APP_NAME`/`STORAGE_PREFIX`); copy → `content.ts`; or, if the file is genuinely per-client content, exclude it in `core-manifest.json`.

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
| `backend/scripts/sync-core.mjs` | **template + each client** | The engine (3-way, since `0.1.6`): applies the **delta** between the client's currently-pinned core tag and the requested tag via `git apply --3way` over the core pathspec (excludes design/client/approved-divergence), refreshes the layer CHANGELOG, advances `PLATFORM_VERSION` (downgrade-guarded). Client-local edits to unrelated lines survive; real overlaps become conflict markers; deletions/renames apply. First-ever sync (no baseline tag) falls back to wholesale checkout. Leaves changes uncommitted. |
| `.github/workflows/core-drift.yml` | **each client** | HARD GATE: on every PR/push, runs `check-core-drift.sh` in strict mode (fails the build if any core file diverges from the pinned tag). Self-guards to clients; opt-out via `CORE_DRIFT_ENABLED=false`. |

`sync-core.mjs` is core (`backend/scripts/**`) so it self-propagates. The two workflows are **infra, not core** — they are NOT in `core-manifest.json`, so they are bootstrapped once per client (present automatically in repos cloned from the template; copied by hand into pre-existing clients).

### 9.2 One-time setup

**Template repo** — Settings → Secrets and variables → Actions:
- Variable `RELEASE_TRAIN_ENABLED = true`
- Variable `CLIENT_REPOS = bb3agency/raghava-organics-site bb3agency/sbgs-site` (space-separated)
- Secret `CROSS_REPO_PAT` = a PAT with **`actions: write` + `contents: read` on every client repo** (lets it dispatch their `core-sync`).
- ⚠️ **GitHub Actions MUST stay ENABLED in the template repo** (Settings → Actions → General → "Allow all actions"). `release-train` runs *here* — if Actions is off, a pushed tag is silently dropped and nothing fans out. To quiet template-side noise, **disable the individual workflows that don't belong in the template** instead of repo-wide Actions: `gh workflow disable "Reliability CI" -R <template>`, same for `"Deploy to VPS"` and `"Diagnostic Logs"`. Leave `release-train` (and `core-sync`) enabled. `release-train` only fires on `*-core-v*` tags, so normal template pushes stay silent anyway.

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

- **Actions disabled in the template → nothing fires (we hit this).** If GitHub Actions is turned OFF for the template repo, a pushed `*-core-v*` tag is silently dropped — `release-train` never runs, no PRs appear, and `gh run list` shows "no runs found." → Keep Actions ENABLED in the template; quiet noise by disabling individual workflows (`gh workflow disable "Reliability CI"` etc.), never repo-wide Actions. Verify with `gh api repos/<org>/<template>/actions/permissions` → `{"enabled":true}`.
- **Tagging in a CLIENT repo does nothing.** The fan-out trigger is a tag pushed to the **template** (where `release-train` lives). A tag on raghava/sbgs is inert. → Always tag in the template; never tag the client. A pushed tag whose event happened while Actions was off must be re-fired via `gh workflow run release-train.yml -R <template> -f tag=<tag>` (re-pushing the same tag name does not re-emit the event).
- **Core file DELETIONS / renames** — since `0.1.6` the 3-way engine applies the old→new tag delta, so deletions and renames between versions **do** propagate. (Pre-`0.1.6` wholesale-checkout engine could not — if a client is still on the old engine, the first sync that upgrades it will install the new engine, and subsequent syncs handle deletions.)
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
| `backend/scripts/sync-core.mjs` | Engine: 3-way-merges a tag's delta into a client (`npm run sync:core`) — §9.1, §14.1 |
| `backend/scripts/check-core-purity.mjs` | Fails on client identity baked into core files (§7.1) |
| `.github/workflows/release-train.yml` | Template: on a core tag, fans out to clients |
| `.github/workflows/core-sync.yml` | Client: receives the dispatch, runs the engine, opens the sync PR |
| `.github/workflows/core-drift.yml` | Client: hard drift gate — fails PR/push if core diverges from the pinned tag (§7, §14.1) |
| `core-purity-denylist.txt` / `core-purity-allow.txt` | Brand/slug patterns the purity guard forbids in core / this client's own allowed identifiers |

> Client extension layer (never core-synced): `frontend/app/(client)/**` (pages), `frontend/components/client/**` (components), `backend/src/modules/client/**` (backend).
> `chmod +x backend/scripts/check-core-drift.sh backend/scripts/check-token-contract.sh` once, and wire the gates into CI alongside `typecheck`/`lint`/`build`.

---

## 11. Client registry (fleet view — keep current)

| Client | backend-core | frontend-core | Enabled flags (non-default) | Design notes |
| --- | --- | --- | --- | --- |
| raghava-organics | 0.1.8 | 0.1.4 | _baseline_ | Tasty-Daily palette (forest green / peach), Inter; customizes via design layer only |
| sbgs (srisaibabasweets) | 0.1.8 | 0.1.4 | _baseline_ | own palette; bespoke pages/components in the client extension layer (`app/(client)`, `components/client`) |

Update this table on every client sync — it is the at-a-glance "who is up to date."

---

## 12. Canonical change flow (develop-in-client → promote → fan out)

The team's default: develop in any client, promote the finished change to the template, let the train ship it everywhere. Propagation is triggered by the **tag**, never by your client pushes — so nothing reaches other clients until the feature is done and tagged.

```
PHASE A — develop (in a client, e.g. raghava)            ← normal dev
  commit/push ×N  (feature behind FEATURE_X, default OFF)
  ➜ deploys only that client; NO other client is touched (no tag yet)

PHASE B — promote to template (after it's done)          ← ~4 commands
  cherry-pick the commits into the template → CHANGELOG + version bump + tag

PHASE C — fan out                                        ← automated
  tag push → release-train → core-sync PR in EVERY client → you merge
```

**Phase A — develop in the client**
```bash
# in the client repo: build the feature behind FEATURE_X (default OFF), commit + push as usual.
# Keep core changes and design changes in SEPARATE commits (clean cherry-pick later).
```

**Phase B — promote to the template** (one-time per client: add a remote NAMED EXACTLY like the repo, e.g. `git remote add raghava-organics-site https://github.com/bb3agency/raghava-organics-site.git`)
```bash
cd <template>
git fetch raghava-organics-site             # the remote name == the GitHub repo name
git cherry-pick <firstSha>^..<lastSha>      # bring the feature's commits in (design hunks are kept-ours)
#   NOTE: the commits must already be PUSHED to the client's GitHub (a local-only commit can't be fetched).
# edit CHANGELOG.md  (Propagation block: note FEATURE_X + any NEW design token)
# bump version: feature = MINOR (0.1.1 → 0.2.0) in backend/package.json + PLATFORM_VERSION (+ frontend if touched)
git add -A && git commit -m "feat: <feature> behind FEATURE_X (core 0.2.0)"
git tag backend-core-v0.2.0                  # + frontend-core-v0.2.0 if frontend core changed
git push origin main --tags
```

**Phase C — automated.** The tag fires `release-train` → a `core-sync: …-v0.2.0` PR opens in every client. Review + merge each → CD deploys. Each client gets ONE clean sync commit (not your N commits); design untouched; feature dormant until its flag is switched on in Ops.

**Manual vs automated:** manual = the release decision (cherry-pick + changelog + bump + tag) and the per-client merge click. Automated = pulling core into every client, bumping each ledger, opening each PR.

---

## 13. Onboarding a NEW client (one-time per client)

A new client is **cloned from the template**, so it already contains `sync-core.mjs`, `core-sync.yml`, `core-manifest.json`, `.gitattributes`, the design-token contract, and the guard scripts. You only wire identity + tokens.

**1. Create the repo from the template**
```bash
git clone https://github.com/bb3agency/ecom-platform-template.git <new-client>-site
cd <new-client>-site
git remote rename origin template            # template stays as the upstream for merges
gh repo create bb3agency/<new-client>-site --private --source=. --remote=origin
git push -u origin main
```

**2. Apply the client's design + identity + copy** (the per-client layer — never touches core):
`frontend/app/globals.css` (palette tokens), `frontend/lib/fonts.ts`, `frontend/lib/constants.ts` (brand identity: name/logo/`STORAGE_PREFIX`), **`frontend/lib/content.ts`** (taglines/blurbs/product defaults/homepage copy), `frontend/public/` (logo/images), the content pages (`about`/`privacy`/`terms`/`returns`/`shipping`/homepage `page.tsx`/`Footer`/marketing-home/email templates), `CLIENT_ID`/domains in `.env*.example`, plus `core-purity-allow.txt` (this client's own identifiers). Run `bash backend/scripts/check-token-contract.sh` and `node backend/scripts/check-core-purity.mjs` — both must pass.

**3. Pin the version** in `PLATFORM_VERSION` (`backend-core` / `frontend-core` = current template version) and add a row to §11.

**4. Register it for automation:**
- Add `bb3agency/<new-client>-site` to the template repo's `CLIENT_REPOS` variable.
- Configure the per-client secrets/variables (table in §13.1).
- Add it as a remote in the template for cherry-pick promotes, naming the remote exactly like the repo: `git remote add <new-client>-site https://github.com/bb3agency/<new-client>-site.git`.

**5. Set up CD** (self-hosted runner + `VPS_RUNNER_LABEL`, per `GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md`) so a merged sync PR deploys.

### 13.1 All keys & settings — the complete configuration map

**Template repo** (`ecom-platform-template`) — Settings → Secrets and variables → Actions:
| Name | Kind | Value / scope | Purpose |
| --- | --- | --- | --- |
| `RELEASE_TRAIN_ENABLED` | Variable | `true` | Master switch for the fan-out automation. |
| `CLIENT_REPOS` | Variable | space-separated `owner/repo` of ALL clients | Who receives sync PRs. Append each new client. |
| `CROSS_REPO_PAT` | Secret | PAT — **Actions: write + Metadata: read** on every client repo | Lets the train dispatch each client's `core-sync`. |
| _Actions enabled_ | Setting | Settings → Actions → General → **Allow all actions** | **Required** — `release-train` runs here. Disable noisy *individual* workflows (Reliability CI / Deploy / Diagnostic), not repo-wide Actions. |

Plus, in the template's local checkout, one git remote per client (for cherry-pick promotes):
`git remote add <client>-site https://github.com/bb3agency/<client>-site.git` (remote name == repo name; current: `raghava-organics-site`, `sbgs-site`)

**Each client repo** — Settings → Secrets and variables → Actions:
| Name | Kind | Value / scope | Purpose |
| --- | --- | --- | --- |
| `TEMPLATE_REPO` | Variable | `bb3agency/ecom-platform-template` | Which template to pull core from. |
| `TEMPLATE_READ_PAT` | Secret | PAT — **Contents: read** on the template repo | Lets the client `git fetch` the private template. |
| `CORE_SYNC_PAT` | Secret | PAT — **Contents: write + Pull requests: write** on this client (must also **read the template** — the checkout token authenticates the core-drift template fetch) | Pushes the sync branch + opens the PR; makes the client's CI run on that PR. |
| `CORE_DRIFT_ENABLED` | Variable | `true` (omit/`false` to disable) | Master switch for the `core-drift.yml` hard gate. Set `false` only while a client still has un-sanctioned drift to clean up. |
| `VPS_RUNNER_LABEL` | Variable | e.g. `<client>-vps` | Routes deploy to this client's self-hosted runner. |

> Client repos also carry two **infra workflows** (not core-synced — copy/update per repo): `.github/workflows/core-sync.yml` (receives sync dispatches → opens the PR) and `.github/workflows/core-drift.yml` (the hard gate). A fine-grained PAT used for `TEMPLATE_READ_PAT`/`CORE_SYNC_PAT` must include **Contents: Read on the template repo** or the drift fetch 404s.

**Each client repo** — Settings → Actions → General:
- Enable **"Allow GitHub Actions to create and approve pull requests."**

**Each client repo** — local one-time git wiring (dev machines):
```bash
git remote add template https://github.com/bb3agency/ecom-platform-template.git
git config merge.ours.driver true
git fetch template --tags
```

**Self-hosted runner (VPS):** install `jq` (`sudo apt-get install -y jq`) so the drift/token gates enforce instead of skip.

> **Token custody:** prefer **fine-grained PATs on a dedicated bot account** that's an org member. Set expiry reminders — an expired PAT is the most common silent failure (dispatch/fetch fails loudly in the Actions log, but only if you look). See §9.4 for the full silent-failure list.

---

## 14. Conflict-free propagation — phased roadmap

The goal of this whole architecture is **two guarantees**: a core change reaches every client (a) **without merge conflicts** and (b) **without core drift**. There are only two ways to *guarantee* (not merely "usually avoid") this:

| Guarantee | Mechanism | Status |
| --- | --- | --- |
| **Enforced** | Clients hold core *source*, but a hard CI gate blocks any divergence | ✅ **Phase 1 — DONE** |
| **Structural** | Clients consume core as a *package* — they can't edit what they don't own | ⏳ **Phase 2 & 3 — planned** |

Phase 1 is the prerequisite for 2 & 3 (you can't extract clean packages from drifted clients), and it pays for itself immediately. We migrate in ROI order; nothing below is all-or-nothing.

### 14.1 Phase 1 — Hardened copy-sync + hard gate (DONE, 2026-06-22)

Shipped in `backend-core` `0.1.6`→`0.1.8`. The copy-sync model kept, but made conflict- and drift-proof:

1. **3-way merge sync engine** (`backend/scripts/sync-core.mjs`, §9.1). Applies the **delta** between the client's pinned tag and the new tag via `git apply --3way` instead of a wholesale `git checkout` overwrite. → client-local edits to unrelated lines survive; only true overlaps produce conflict markers (which fail CI → resolved in the PR); deletions & renames propagate; `PLATFORM_VERSION` only advances (downgrade guard); first-ever sync falls back to wholesale checkout.
2. **Hard drift gate** (`backend/scripts/check-core-drift.sh` strict mode + `.github/workflows/core-drift.yml`, §7). Runs on every PR/push in client repos; **fails** the build if any core file diverges from the pinned tag. Diffs **per layer** (backendCore vs backend tag, frontendCore vs frontend tag — tags are full-repo snapshots, so a combined diff cross-checks layers and false-positives). Honors `approved-divergence`. This is what makes "core is read-only in clients" actually enforced.
3. **Hardened `core-sync.yml`** (§9.1). Open-PR-only gating (a closed/merged PR no longer shadows a fresh one), regenerate-from-current-main (strictly-ahead → clean FF, never a stale merge), never-reopen (avoids head-desync → permanent `UNKNOWN`), `delete_branch_on_merge`, and `core-sync`/`has-conflicts` PR labels.
4. **Client extension layer** (§1, §1.1, §7). Per-client code lives where core sync never touches it: pages → `frontend/app/(client)/**` (+ a `(client)/layout.tsx`; route groups keep URLs unchanged), components → `frontend/components/client/**`, backend → `backend/src/modules/client/**`.

**Net effect:** the four root-causes of the old churn (closed-PR shadowing, stale-branch shadowing, reopen head-desync, `PLATFORM_VERSION` regression from stale merges) are gone, and a client can no longer silently fork core. Cost still scales linearly with client count (N sync PRs per release) — acceptable to ~3 clients; the reason to go structural beyond that is below.

> **Known limitations carried into 2/3:** (a) `check-core-drift.sh` is unreliable on **Windows-local** (CRLF + git `**`-glob quirks) — trust the Ubuntu CI gate, or run the manual `git diff --name-only <tag> -- <bare dirs> :(exclude)…` form locally. (b) The 3-way auto-sync can occasionally no-op for a given repo's state — deterministic fallback for pure-core files with no client divergence: `git checkout <tag> -- <files>` + bump `PLATFORM_VERSION`, commit, push.

### 14.2 Phase 2 — Package the BACKEND core (planned; trigger ≈ 4–5 clients)

**Why:** copy-sync cost is linear; the package model is **flat** (publish once → Renovate opens a one-line bump PR in every client, auto-merged on green CI). A one-line version bump can't merge-conflict, and a client can't edit a dependency it doesn't hold → conflicts AND drift become **structurally impossible** for everything packaged. Backend is the cleanest first win (Fastify modules/services package cleanly; most core logic + risk lives here).

**Target:** publish `@bb3/backend-core` to **GitHub Packages** (private npm registry under the `bb3agency` org); clients `npm install` it instead of holding the source.

**Implementation outline (do later):**
1. **Carve the package.** Move shared backend (the `backendCore.include` set: `src/common`, shared `src/modules/*` business logic, etc.) into a publishable package with an explicit **public API** (a barrel `index.ts` exporting exactly what clients consume). Keep client-only code in `src/modules/client/**`.
2. **Decide the boundary** for the awkward bits: Prisma client + schema (ship schema + a generate step, or a `@bb3/db` sub-package), env/config loading, and DI/plugin registration (export a `registerCore(fastify, opts)` so each client app wires its own server). This boundary design IS the bulk of Phase 2.
3. **Registry + publish CI.** `.npmrc` → `@bb3:registry=https://npm.pkg.github.com`; publish job triggered on `backend-core-v*` tag (reuse the tag scheme; `package.json version` stays the source of truth, already surfaced at `/health`).
4. **Client consumption.** Each client's `backend/package.json` depends on `@bb3/backend-core@X.Y.Z`; a thin `src/main.ts` calls `registerCore(...)` + mounts `src/modules/client/**`.
5. **Renovate** (`renovate.json` per client) grouping `@bb3/*`, auto-merge patch/minor on green CI — replaces the release-train fan-out for the backend.
6. **Retire** backend copy-sync (drop `backendCore.include` from the manifest as files move into the package; the drift gate then only guards whatever thin backend bits remain in-repo).

**Risks/notes:** package boundary + Prisma generation are the hard parts; keep the Phase-1 drift gate active until the package fully owns the backend; ship behind the same `FEATURE_*` discipline (propagation ≠ activation).

### 14.3 Phase 3 — Package the FRONTEND logic (planned; after frontend stabilizes)

**Why:** same flat-cost, zero-conflict guarantee for the ~90% of the frontend that is shareable logic/components. The remaining ~10% (Next.js app shell) **cannot** be packaged and stays template-synced under the Phase-1 gate → the end state is a **hybrid**.

**Target:** publish `@bb3/frontend-core` (the `frontendCore.include` logic: `lib/`, `hooks/`, `stores/`, `types/`, `actions/`, and `components/{ui,product,cart,checkout,layout}`). Clients import from it.

**Stays in each repo (NOT packageable — Next.js requires it under `app/`):** `app/**/page.tsx`, `app/**/layout.tsx`, `next.config.ts`, `middleware.ts`. These are thin (mostly composition) and keep using template-sync + the drift gate. **Design layer stays local too:** `globals.css`, `lib/fonts.ts`, `lib/constants.ts`, `lib/content.ts`, `public/`, plus the `(client)`/`components/client` extension layer.

**Implementation outline (do later):**
1. Extract `@bb3/frontend-core` with a clean export surface; client design/content (`constants.ts`/`content.ts`) injected via props/context or a config import so the package stays brand-agnostic (the §1.1 rule already enforces this).
2. **Next.js integration:** `transpilePackages: ['@bb3/frontend-core']` in `next.config.ts`; Tailwind `content` globs must include the package path under `node_modules`; preserve RSC/`"use client"` boundaries across the package edge; verify tree-shaking.
3. Publish on `frontend-core-v*` tag; Renovate bump PRs (auto-merge on green CI).
4. App-shell pages/layouts continue via template-sync + drift gate (Phase-1 mechanism remains for these ~10%).

**End state (hybrid):** backend + frontend logic = packaged (structural zero-conflict/zero-drift, flat cost); app-shell = template-synced + hard-gated. This is the standard architecture for a Next.js + Fastify platform across many client repos and scales cleanly to 10+ clients.

---

> **Propagation:** This guide, the changelog/version/manifest/contract files, and the scripts/workflows are **template-worthy** — they belong in the core template and should be synced to every client repo. Per the co-development rules, propose the push/PR and get explicit approval before any remote mutation.
