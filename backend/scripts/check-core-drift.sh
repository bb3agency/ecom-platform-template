#!/usr/bin/env bash
# check-core-drift.sh — Fail if this client repo's CORE files diverge from the
# pinned platform template tag. Forces changes to either go upstream (become
# core) or move into the client extension/design layer. Never lets a client
# silently fork the shared core.
#
# Modes:
#   • default (local dev): if prerequisites are missing (no jq / no template
#     remote / tag not pushed yet) it SKIPS cleanly so it never blocks a laptop.
#   • strict (CI): set CORE_DRIFT_STRICT=true and a missing prerequisite becomes
#     a hard FAILURE — this is what makes the gate real in CI (it can't silently
#     no-op). The client CI workflow wires the template remote + jq, then runs
#     this in strict mode.
#
# Usage:
#   TEMPLATE_REMOTE=template ./backend/scripts/check-core-drift.sh
#   CORE_DRIFT_STRICT=true TEMPLATE_REMOTE=template ./backend/scripts/check-core-drift.sh
# Requires: jq, git, and a `template` remote pointing at the core template repo.
# Reads: ../core-manifest.json (relative to repo root) and PLATFORM_VERSION.
# See backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md §7.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MANIFEST="core-manifest.json"
TEMPLATE_REMOTE="${TEMPLATE_REMOTE:-template}"
STRICT="${CORE_DRIFT_STRICT:-false}"

# In strict mode a missing prerequisite is a build failure; otherwise it's a
# clean skip so local laptops without the template remote aren't blocked.
skip_or_fail() {
  local msg="$1"
  if [ "$STRICT" = "true" ]; then
    echo "❌ $msg (strict mode: this is a CI failure — wire the prerequisite)."
    exit 1
  fi
  echo "ℹ️  $msg — skipping core-drift check."
  exit 0
}

command -v jq >/dev/null || skip_or_fail "jq not installed"
[ -f "$MANIFEST" ] || { echo "ERROR: $MANIFEST not found"; exit 2; }

# Resolve the pinned core versions -> template tags to diff against.
be_ver="$(awk -F': ' '/^backend-core:/  {print $2}' PLATFORM_VERSION | tr -d ' \r')"
fe_ver="$(awk -F': ' '/^frontend-core:/ {print $2}' PLATFORM_VERSION | tr -d ' \r')"
echo "Pinned: backend-core=$be_ver  frontend-core=$fe_ver  (strict=$STRICT)"

if ! git remote get-url "$TEMPLATE_REMOTE" >/dev/null 2>&1; then
  skip_or_fail "no '$TEMPLATE_REMOTE' remote configured"
fi

git fetch -q "$TEMPLATE_REMOTE" --tags || skip_or_fail "cannot fetch remote '$TEMPLATE_REMOTE'"

# Build include/exclude pathspecs from the manifest.
mapfile -t INCLUDES < <(jq -r '.backendCore.include[], .frontendCore.include[]' "$MANIFEST")
mapfile -t EXCLUDES < <(jq -r '.backendCore.exclude[], .frontendCore.exclude[]' "$MANIFEST")

PATHSPEC=("${INCLUDES[@]}")
for e in "${EXCLUDES[@]}"; do PATHSPEC+=(":(exclude)$e"); done

# Approved, time-boxed divergences are sanctioned — exclude them from the diff so
# they don't trip the gate. Entry format in PLATFORM_VERSION:
#   approved-divergence:
#     - path/to/file — justification — owner — YYYY-MM-DD
mapfile -t ALLOW < <(
  awk '
    /^approved-divergence:/ { if ($0 ~ /\[[[:space:]]*\]/) next; f=1; next }
    f && /^[^[:space:]]/ { f=0 }
    f && /-[[:space:]]/ { sub(/^[[:space:]]*-[[:space:]]*/, ""); sub(/[[:space:]]*—.*$/, ""); gsub(/[[:space:]]/, ""); if ($0 != "") print }
  ' PLATFORM_VERSION 2>/dev/null || true
)
for a in "${ALLOW[@]}"; do
  [ -n "$a" ] && PATHSPEC+=(":(exclude)$a")
done
if [ "${#ALLOW[@]}" -gt 0 ]; then
  echo "Honoring approved-divergence (excluded from gate): ${ALLOW[*]}"
fi

BE_TAG="backend-core-v${be_ver}"
FE_TAG="frontend-core-v${fe_ver}"

fail=0
for tag in "$BE_TAG" "$FE_TAG"; do
  if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1 && \
     ! git rev-parse -q --verify "$TEMPLATE_REMOTE/$tag" >/dev/null 2>&1; then
    skip_or_fail "pinned tag $tag not found on $TEMPLATE_REMOTE (is the template tagged & pushed?)"
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
