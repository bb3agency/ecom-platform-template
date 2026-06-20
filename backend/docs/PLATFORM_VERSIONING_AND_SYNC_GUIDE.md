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
A `git merge` of a template tag fails (`unrelated histories`). These clients are updated **automatically by the release-train** (§9): the tag dispatches their `core-sync` workflow, which runs `sync-core.mjs` (`git checkout <tag> -- <core paths>`, design excluded) and opens a review PR. You merge → CD deploys. Manual equivalent if needed: `npm run sync:core -- --tag backend-core-vX.Y.Z`.

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
| `backend/scripts/sync-core.mjs` | Engine: pulls core files for a tag into a client (`npm run sync:core`) |
| `.github/workflows/release-train.yml` | Template: on a core tag, fans out to clients |
| `.github/workflows/core-sync.yml` | Client: receives the dispatch, runs the engine, opens the sync PR |

> `chmod +x backend/scripts/check-core-drift.sh backend/scripts/check-token-contract.sh` once, and wire both into CI alongside the existing `typecheck`/`lint`/`build` gates.

---

## 11. Client registry (fleet view — keep current)

| Client | backend-core | frontend-core | Enabled flags (non-default) | Design notes |
| --- | --- | --- | --- | --- |
| raghava-organics | 0.1.1 | 0.1.1 | _baseline_ | Tasty-Daily palette (forest green / peach), Inter |
| sbgs (srisaibabasweets) | 0.1.1 | 0.1.1 | _baseline_ | own palette |

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

**Phase B — promote to the template** (one-time: `git remote add raghava <url>` / `git remote add sbgs <url>` in the template)
```bash
cd <template>
git fetch raghava
git cherry-pick <firstSha>^..<lastSha>      # bring the feature's commits in (design hunks are kept-ours)
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

**2. Apply the client's design + identity** (the per-client layer — never touches core):
`frontend/app/globals.css` (palette tokens), `frontend/lib/fonts.ts`, `frontend/lib/constants.ts` (brand strings), `frontend/public/` (logo/images), `CLIENT_ID`/domains in `.env*.example`. Run `bash backend/scripts/check-token-contract.sh` — every required token must be defined.

**3. Pin the version** in `PLATFORM_VERSION` (`backend-core` / `frontend-core` = current template version) and add a row to §11.

**4. Register it for automation:**
- Add `bb3agency/<new-client>-site` to the template repo's `CLIENT_REPOS` variable.
- Configure the per-client secrets/variables (table in §13.1).
- Add it as a remote in the template for cherry-pick promotes: `git remote add <new-client> https://github.com/bb3agency/<new-client>-site.git`.

**5. Set up CD** (self-hosted runner + `VPS_RUNNER_LABEL`, per `GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md`) so a merged sync PR deploys.

### 13.1 All keys & settings — the complete configuration map

**Template repo** (`ecom-platform-template`) — Settings → Secrets and variables → Actions:
| Name | Kind | Value / scope | Purpose |
| --- | --- | --- | --- |
| `RELEASE_TRAIN_ENABLED` | Variable | `true` | Master switch for the fan-out automation. |
| `CLIENT_REPOS` | Variable | space-separated `owner/repo` of ALL clients | Who receives sync PRs. Append each new client. |
| `CROSS_REPO_PAT` | Secret | PAT — **Actions: write + Metadata: read** on every client repo | Lets the train dispatch each client's `core-sync`. |

Plus, in the template's local checkout, one git remote per client (for cherry-pick promotes):
`git remote add <client> https://github.com/bb3agency/<client>-site.git`

**Each client repo** — Settings → Secrets and variables → Actions:
| Name | Kind | Value / scope | Purpose |
| --- | --- | --- | --- |
| `TEMPLATE_REPO` | Variable | `bb3agency/ecom-platform-template` | Which template to pull core from. |
| `TEMPLATE_READ_PAT` | Secret | PAT — **Contents: read** on the template repo | Lets the client `git fetch` the private template. |
| `CORE_SYNC_PAT` | Secret | PAT — **Contents: write + Pull requests: write** on this client | Pushes the sync branch + opens the PR; makes the client's CI run on that PR. |
| `VPS_RUNNER_LABEL` | Variable | e.g. `<client>-vps` | Routes deploy to this client's self-hosted runner. |

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

> **Propagation:** This guide, the changelog/version/manifest/contract files, and the two scripts are **template-worthy** — they belong in the core template and should be synced to every client repo. Per the co-development rules, propose the push/PR and get explicit approval before any remote mutation.
