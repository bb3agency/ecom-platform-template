#!/usr/bin/env bash
# Rename legacy ~/actions-runner → ~/actions-runner-<client-id> (keeps registration; reinstalls systemd).
# Safe to run once on VPS after upgrading verify/install scripts.
#
# Usage (on VPS as d_user):
#   bash /var/www/raghava-organics/docs/clients/raghava-organics/scripts/migrate-runner-directory.sh
set -euo pipefail

slugify_client_id() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g'
}

CLIENT_ID_INPUT="${CLIENT_ID:-raghava-organics}"
CLIENT_ID="$(slugify_client_id "$CLIENT_ID_INPUT")"
if [ -z "$CLIENT_ID" ]; then
  die "CLIENT_ID '$CLIENT_ID_INPUT' is invalid after normalization."
fi
if [ "$CLIENT_ID" != "$CLIENT_ID_INPUT" ]; then
  log "Normalized CLIENT_ID: '$CLIENT_ID_INPUT' -> '$CLIENT_ID'"
fi

LEGACY="${LEGACY_RUNNER_DIR:-$HOME/actions-runner}"
TARGET="${RUNNER_DIR:-$HOME/actions-runner-${CLIENT_ID}}"

log() { echo "[migrate-runner] $*"; }
die() { log "ERROR: $*"; exit 1; }

if [ -d "$TARGET" ] && [ -f "$TARGET/.runner" ]; then
  log "Already migrated: $TARGET"
  if [ -f "$TARGET/svc.sh" ]; then
    (cd "$TARGET" && sudo ./svc.sh status) || true
  fi
  exit 0
fi

[ -d "$LEGACY" ] && [ -f "$LEGACY/.runner" ] || die "No configured legacy runner at $LEGACY"

if [ -d "$TARGET" ]; then
  die "$TARGET exists but is not configured — remove or merge manually before migrating"
fi

log "Stopping systemd service in $LEGACY ..."
cd "$LEGACY"
sudo ./svc.sh stop 2>/dev/null || true
sudo ./svc.sh uninstall 2>/dev/null || true

log "Moving $LEGACY → $TARGET"
mv "$LEGACY" "$TARGET"

log "Reinstalling systemd service from $TARGET ..."
cd "$TARGET"
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status || true

log ""
log "Done. Verify:"
log "  bash /var/www/${CLIENT_ID}/docs/clients/${CLIENT_ID}/scripts/verify-cd-status.sh"
log "  GitHub → Settings → Actions → Runners → ${CLIENT_ID}-vps (Idle)"
