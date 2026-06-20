#!/usr/bin/env bash
# check-token-contract.sh — Fail if this client's app/globals.css does not define
# every design token required by the contract. Guarantees that any core component
# referencing a token renders correctly under this client's theme (no broken
# colors because a client forgot to define a token).
#
# Usage: ./backend/scripts/check-token-contract.sh
# Reads: frontend/design-tokens.contract.json + frontend/app/globals.css
# See backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md §5.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CONTRACT="frontend/design-tokens.contract.json"
CSS="frontend/app/globals.css"

command -v jq >/dev/null || { echo "ℹ️  jq not installed — skipping design-token contract check (install jq to enable)."; exit 0; }
[ -f "$CONTRACT" ] || { echo "ERROR: $CONTRACT not found"; exit 2; }
[ -f "$CSS" ]      || { echo "ERROR: $CSS not found"; exit 2; }

missing=0
check_token() {
  local tok="$1"
  # A token is satisfied if it is DEFINED (e.g. `--primary:` ) anywhere in globals.css.
  if ! grep -qE "(^|[^A-Za-z-])${tok}[[:space:]]*:" "$CSS"; then
    echo "  MISSING: $tok"
    missing=1
  fi
}

echo "── Verifying design-token contract ($CONTRACT v$(jq -r .version "$CONTRACT")) ──"
while IFS= read -r tok; do check_token "$tok"; done < <(jq -r '.requiredTokens[]' "$CONTRACT")
while IFS= read -r tok; do check_token "$tok"; done < <(jq -r '.requiredFonts[]'   "$CONTRACT")

if [ "$missing" -ne 0 ]; then
  echo ""
  echo "❌ This client's $CSS is missing required tokens above."
  echo "   Add them to the :root (and .dark) blocks so core components theme correctly."
  exit 1
fi
echo "✅ All required design tokens are defined."
