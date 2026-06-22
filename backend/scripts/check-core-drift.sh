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
if [ "${#ALLOW[@]}" -gt 0 ]; then
  echo "Honoring approved-divergence (excluded from gate): ${ALLOW[*]}"
fi

BE_TAG="backend-core-v${be_ver}"
FE_TAG="frontend-core-v${fe_ver}"

# Diff EACH layer's paths against ITS OWN tag. Tags are full-repo snapshots, so a
# combined pathspec diffed against both tags cross-checks frontend files against
# the backend tag (and vice-versa) → false positives whenever the two layers are
# pinned to different commits. Per-layer diffing is the correct comparison.
fail=0
check_layer() {
  local layer_key="$1" tag="$2"
  if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1 && \
     ! git rev-parse -q --verify "$TEMPLATE_REMOTE/$tag" >/dev/null 2>&1; then
    skip_or_fail "pinned tag $tag not found on $TEMPLATE_REMOTE (is the template tagged & pushed?)"
  fi

  local pathspec=()
  mapfile -t inc < <(jq -r ".${layer_key}.include[]" "$MANIFEST")
  mapfile -t exc < <(jq -r ".${layer_key}.exclude[]" "$MANIFEST")
  pathspec=("${inc[@]}")
  for e in "${exc[@]}"; do pathspec+=(":(exclude)$e"); done
  for a in "${ALLOW[@]}"; do [ -n "$a" ] && pathspec+=(":(exclude)$a"); done

  echo "── Diffing ${layer_key} files against $tag ──"
  local drift
  drift="$(git diff --name-only "$tag" -- "${pathspec[@]}" 2>/dev/null || true)"
  if [ -n "$drift" ]; then
    echo "DRIFT detected in ${layer_key} files (must match $tag):"
    echo "$drift" | sed 's/^/  /'
    fail=1
  fi
}

check_layer backendCore  "$BE_TAG"
check_layer frontendCore "$FE_TAG"

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "❌ Core drift found. Fix by ONE of:"
  echo "   • Upstream the change to the template (it becomes core for everyone), or"
  echo "   • Move it into the client extension layer (src/modules/client/** or app/(client)/**), or"
  echo "   • Record a time-boxed exception in PLATFORM_VERSION 'approved-divergence'."
  exit 1
fi
echo "✅ No unsanctioned core drift."
