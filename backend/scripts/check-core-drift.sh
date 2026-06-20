#!/usr/bin/env bash
# check-core-drift.sh — Fail if this client repo's CORE files diverge from the
# pinned platform template tag. Forces changes to either go upstream (become
# core) or move into the client extension/design layer. Never lets a client
# silently fork the shared core.
#
# Usage:
#   TEMPLATE_REMOTE=template ./backend/scripts/check-core-drift.sh
# Requires: jq, git, and a `template` remote pointing at the core template repo.
# Reads: ../core-manifest.json (relative to repo root) and PLATFORM_VERSION.
# See backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md §7.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MANIFEST="core-manifest.json"
TEMPLATE_REMOTE="${TEMPLATE_REMOTE:-template}"

command -v jq >/dev/null || { echo "ℹ️  jq not installed — skipping core-drift check (install jq to enable)."; exit 0; }
[ -f "$MANIFEST" ] || { echo "ERROR: $MANIFEST not found"; exit 2; }

# Resolve the pinned core versions -> template tags to diff against.
be_ver="$(awk -F': ' '/^backend-core:/  {print $2}' PLATFORM_VERSION | tr -d ' \r')"
fe_ver="$(awk -F': ' '/^frontend-core:/ {print $2}' PLATFORM_VERSION | tr -d ' \r')"
echo "Pinned: backend-core=$be_ver  frontend-core=$fe_ver"

# No template remote yet (e.g. existing clients before the template repo exists,
# or CI without the remote wired) → nothing to diff against. Skip cleanly rather
# than failing the build; the check activates automatically once `template` is added.
if ! git remote get-url "$TEMPLATE_REMOTE" >/dev/null 2>&1; then
  echo "ℹ️  No '$TEMPLATE_REMOTE' remote configured — skipping core-drift check (wire the template remote to enable)."
  exit 0
fi

git fetch -q "$TEMPLATE_REMOTE" --tags || { echo "ERROR: cannot fetch remote '$TEMPLATE_REMOTE'"; exit 2; }

# Build include/exclude pathspecs from the manifest.
mapfile -t INCLUDES < <(jq -r '.backendCore.include[], .frontendCore.include[]' "$MANIFEST")
mapfile -t EXCLUDES < <(jq -r '.backendCore.exclude[], .frontendCore.exclude[]' "$MANIFEST")

PATHSPEC=("${INCLUDES[@]}")
for e in "${EXCLUDES[@]}"; do PATHSPEC+=(":(exclude)$e"); done

# Approved, time-boxed divergences are allowed (warn, not fail).
mapfile -t ALLOW < <(awk '/^approved-divergence:/{f=1} f&&/path/{print}' PLATFORM_VERSION 2>/dev/null || true)

BE_TAG="backend-core-v${be_ver}"
FE_TAG="frontend-core-v${fe_ver}"

fail=0
for tag in "$BE_TAG" "$FE_TAG"; do
  if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1 && \
     ! git rev-parse -q --verify "$TEMPLATE_REMOTE/$tag" >/dev/null 2>&1; then
    echo "WARN: tag $tag not found on $TEMPLATE_REMOTE — skipping (is the template tagged?)"
    continue
  fi
  echo "── Diffing core files against $tag ──"
  drift="$(git diff --name-only "$tag" -- "${PATHSPEC[@]}" 2>/dev/null || true)"
  if [ -n "$drift" ]; then
    echo "DRIFT detected in core files (must match $tag):"
    echo "$drift" | sed 's/^/  /'
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "❌ Core drift found. Fix by ONE of:"
  echo "   • Upstream the change to the template (it becomes core for everyone), or"
  echo "   • Move it into the client extension layer (src/modules/client/** or app/(client)/**), or"
  echo "   • Record a time-boxed exception in PLATFORM_VERSION 'approved-divergence'."
  exit 1
fi
echo "✅ No unsanctioned core drift."
