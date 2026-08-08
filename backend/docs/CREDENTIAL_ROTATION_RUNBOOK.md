# Credential Rotation Runbook — GitHub tokens & VPS git auth

> **When to use this:** a GitHub token expired or was revoked and deploys / CI /
> core-sync started failing. Derived from a real 2026-08-08 outage in which **four
> independent credentials** were involved and **two of them failed silently**.
>
> **Audience:** whoever operates a client VPS + its GitHub repo.
> **Per-client values** (VPS IP, deploy user, paths) live in that client's
> `docs/clients/<client-id>/VPS_INPUTS.md` (git-ignored). This guide contains **no secrets**.

---

## 1. Symptom → which credential is dead

The credentials below fail **independently** — fixing one does not fix the others.
Two of the four produce **no red build anywhere**.

| Symptom | Dead credential | Where it lives | Silent? |
|---|---|---|---|
| Deploy to VPS fails at "Sync monorepo root via git pull" with `remote: Invalid username or token` / `Authentication failed` | **VPS git auth** | on the VPS (`~/.ssh` or `~/.git-credentials`) | No — deploy goes red |
| `core-drift` fails at "Wire template remote (read-only)" with `Authentication failed for .../<template-repo>.git` | **`TEMPLATE_READ_PAT`** | client repo → Settings → Secrets → Actions | No — workflow goes red |
| core-sync PR opens but **the client's CI never runs on it**; log contains `::warning::CORE_SYNC_PAT not set` | **`CORE_SYNC_PAT`** | client repo → Settings → Secrets → Actions | ⚠️ **Yes** — workflow still "succeeds" |
| You tag a core release in the template and **no client repo receives a sync PR** | **`CROSS_REPO_PAT`** | **template** repo → Settings → Secrets → Actions | ⚠️ **Yes** — nothing errors anywhere |

> The silent pair is the dangerous one: an unvalidated core PR can be merged, or a
> core release can reach zero clients, with nothing going red.
> **After any rotation, run §5 and verify all four.**

---

## 2. Create the replacement PAT (one token can cover all three secrets)

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new.

| Setting | Value |
|---|---|
| Owner | the org/account owning the template + client repos |
| Repository access | **every client repo _and_ the template repo** |
| Contents | **Read and write** |
| Pull requests | **Read and write** |
| Actions | **Read and write** |
| Expiration | as long as policy allows — **put the expiry date in a calendar reminder** |

Why: Contents+PR write lets `CORE_SYNC_PAT` push the sync branch and open the PR;
Actions write lets `CROSS_REPO_PAT` dispatch core-sync into client repos.
Repository access **must include the client repos** even for the token stored in
the *template* repo — it acts *on* the clients.

Verify before pasting it anywhere (every repo must return `200`):

```bash
T='<new-pat>'; ORG='<org>'
for r in <client-repo-1> <client-repo-2> <template-repo>; do
  printf '%s: ' "$r"
  curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $T" \
    "https://api.github.com/repos/$ORG/$r"
done
```

---

## 3. Set the Actions secrets

Paste the **same** token into each. Settings → Secrets and variables → Actions.

| Secret | Repo | Used by |
|---|---|---|
| `TEMPLATE_READ_PAT` | every client repo | `core-drift.yml`, `core-sync.yml` |
| `CORE_SYNC_PAT` | every client repo | `core-sync.yml` (push branch + open PR) |
| `CROSS_REPO_PAT` | the template repo | `release-train.yml` (dispatch into clients) |

> A fine-grained PAT **cannot** manage repo secrets unless explicitly granted the
> `Secrets` permission — so this step is manual in the UI. `gh secret set` returns
> `403 Resource not accessible by personal access token`. Do not expect an agent/CLI
> to do it for you.

Also confirm the repo **variable** `TEMPLATE_REPO` = `<org>/<template-repo>` exists in
each client repo — `core-drift` hard-fails without it.

---

## 4. VPS git auth — prefer SSH (no expiry)

**Recommended: an account-level SSH key.** It never expires and works for **every**
client repo on a shared VPS.

| Item | Value |
|---|---|
| Private key | `~/.ssh/id_ed25519_github` (deploy user) |
| Registered at | GitHub → **account** → Settings → SSH and GPG keys |
| Remote format | `git@github.com:<org>/<client-repo>.git` |

Health check — **must** name the account, not a repo:

```bash
ssh -T git@github.com     # expect: "Hi <account>!"
```

If it answers `Hi <org>/<repo>!` the key is a **repo-scoped deploy key**: it works for
that one repo and every other client on the VPS will fail with
`ERROR: Repository not found`.

### Deploy key vs account key (choose deliberately)

| | Account key | Deploy key (per repo) |
|---|---|---|
| Repos covered | all the account can see | exactly one (GitHub hard limit) |
| Access level | account's full read **+ write** | read-only if you leave write unchecked |
| Multi-client VPS | one key, plain `github.com` remotes | one key **per repo** + a `Host` alias each |

Deploy keys are the more defensive choice (read-only, tightly scoped) but need
`~/.ssh/config` aliases on a shared VPS:

```
Host github-<client-id>
  HostName github.com
  User git
  IdentityFile ~/.ssh/<client-id>_deploy
  IdentitiesOnly yes
```
…with the remote set to `git@github-<client-id>:<org>/<client-repo>.git`.

### Creating a key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_github -N '' -C '<vps-name>'
cat ~/.ssh/id_ed25519_github.pub
```

Register the printed line at the **account** level (or as a repo Deploy key if you
chose that model), then verify with §5.

> A public key can be registered **once** across GitHub. To convert a deploy key into
> an account key, delete it from the repo's Deploy keys **first**, or the account-level
> add is rejected with "Key is already in use".

### Emergency fallback: HTTPS + PAT (temporary)

```bash
git -C /var/www/<client-id> remote set-url origin \
  https://<user>:<PAT>@github.com/<org>/<client-repo>.git
```

⚠️ **Embed the credential in the remote URL.** Rewriting `~/.git-credentials` has been
observed **not to take effect** even with `credential.helper store` configured globally —
git keeps rejecting with `Invalid username or token`. Hours were lost to this. Git
redacts the password in error output, so it does not leak into deploy logs. Move back to
SSH as soon as possible.

---

## 5. Verify after ANY rotation

```bash
# A. VPS git auth — expect the account greeting, then a clean fetch per client
ssh -T git@github.com
git -C /var/www/<client-id> fetch origin && echo GIT-OK
```

```bash
# B. TEMPLATE_READ_PAT — re-run core-drift, expect success
gh run list -R <org>/<client-repo> --workflow core-drift.yml --limit 1
gh run rerun <run-id> --failed -R <org>/<client-repo>
```

```bash
# C. CORE_SYNC_PAT — no-op sync against the tag the repo is ALREADY on
#    (read PLATFORM_VERSION for the current version).
gh workflow run core-sync.yml -R <org>/<client-repo> -f tag=frontend-core-v<current>
```

Healthy output from C — and **no** `CORE_SYNC_PAT not set` warning in the log:

```
ℹ️  frontend-core is already at X.Y.Z (>= requested X.Y.Z). Nothing to do — sync never downgrades a marker.
```

> When grepping the log for that warning, exclude the runner's echoed script source
> (lines carrying the `[36;1m` colour code) — the workflow prints its own `echo
> "::warning::…"` line as part of the command group, which looks like a real warning.

```bash
# D. Full deploy — proves the runner (not just your shell) can authenticate
gh workflow run deploy.yml -R <org>/<client-repo>
```

**`CROSS_REPO_PAT` has no safe no-op test** — it only fires when a core release is
tagged. Treat the next release-train run as its verification: if a client receives no
sync PR, suspect this token first.

---

## 6. Related trap: `npm ci --prefer-offline` and a stale VPS cache

`backend/scripts/vps-frontend-deploy.sh` runs `npm ci --prefer-offline`, which trusts
cached registry metadata indefinitely. If a lockfile regeneration pulls in a **newly
published** package version, the VPS reports `No matching version found for <pkg>@<ver>`
even though the version exists publicly.

```bash
npm cache clean --force   # on the VPS, then re-run the deploy
```

Confirm the version really is public before assuming a supply-chain problem:

```bash
curl -s https://registry.npmjs.org/<pkg>/<version> | head -c 100
```

---

## 7. Related trap: verifying a regenerated lockfile

Verify against the **committed blob**, never the working copy — a working copy can be
mangled or clobbered between generation and commit. This shipped a broken lockfile to
production once, failing the deploy at `npm ci` with
`Invalid: lock file's <pkg>@X does not satisfy <pkg>@Y`.

```bash
T=$(mktemp -d)
git show HEAD:frontend/package-lock.json > "$T/package-lock.json"
git show HEAD:frontend/package.json      > "$T/package.json"
cd "$T" && npm ci --dry-run; echo "EXIT=$?"   # must be 0
```

npm-native lockfiles are **2-space indented**. A 4-space indent means something
re-serialized the file (a PowerShell `ConvertTo-Json` round-trip did exactly this) and
silently dropped nested `node_modules/*/node_modules/*` entries.

---

## 8. New-client checklist

When onboarding a client, copy this runbook's client-specific companion into
`docs/clients/<client-id>/CREDENTIAL_ROTATION_RUNBOOK.md` (fill in VPS IP, deploy user,
paths, repo names) and record the live credential values in that client's git-ignored
`VPS_INPUTS.md`. Link it from the client's `README.md` index and `GITHUB_CD_SETUP.md`.
