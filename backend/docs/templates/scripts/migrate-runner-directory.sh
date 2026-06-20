#!/usr/bin/env bash
# One-time migration: ~/actions-runner -> ~/actions-runner-<client-id>
# Keeps runner registration and reinstalls systemd service from new path.
set -euo pipefail

log() { echo "[migrate-runner] $*"; }
die() { log "ERROR: $*"; exit 1; }

slugify_client_id() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g'
}

CLIENT_ID_INPUT="${CLIENT_ID:-<client-id>}"
CLIENT_ID="$(slugify_client_id "$CLIENT_ID_INPUT")"
if [ -z "$CLIENT_ID" ] || [ "$CLIENT_ID" = "<client-id>" ]; then
  die "Set CLIENT_ID first (example: CLIENT_ID=raghava-organics)."
fi
if [ "$CLIENT_ID" != "$CLIENT_ID_INPUT" ]; then
  log "Normalized CLIENT_ID: '$CLIENT_ID_INPUT' -> '$CLIENT_ID'"
fi

LEGACY="${LEGACY_RUNNER_DIR:-$HOME/actions-runner}"
TARGET="${RUNNER_DIR:-$HOME/actions-runner-${CLIENT_ID}}"

if [ -d "$TARGET" ] && [ -f "$TARGET/.runner" ]; then
  log "Already migrated: $TARGET"
  exit 0
fi

[ -d "$LEGACY" ] && [ -f "$LEGACY/.runner" ] || die "No configured legacy runner at $LEGACY"
[ ! -d "$TARGET" ] || die "$TARGET exists but is not configured - resolve manually first."

cd "$LEGACY"
sudo ./svc.sh stop 2>/dev/null || true
sudo ./svc.sh uninstall 2>/dev/null || true

mv "$LEGACY" "$TARGET"

cd "$TARGET"
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status || true

log "Migration complete: $TARGET"
