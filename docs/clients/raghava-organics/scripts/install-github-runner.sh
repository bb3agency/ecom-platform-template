#!/usr/bin/env bash
# One-time GitHub Actions self-hosted runner for raghava-organics-site (run as d_user on VPS)
#
# BEFORE running:
#   1. GitHub → bb3agency/raghava-organics-site → Settings → Actions → Runners
#   2. Click "New self-hosted runner" → Linux → x64
#   3. Copy the download URL and registration token (token expires in ~1 hour)
#
# Usage:
#   export RUNNER_TOKEN='xxxxxxxx'
#   export RUNNER_DOWNLOAD_URL='https://github.com/actions/runner/releases/download/vX.Y.Z/actions-runner-linux-x64-X.Y.Z.tar.gz'
#   bash install-github-runner.sh
#
# Or interactive (prompts for token + URL):
#   bash install-github-runner.sh
set -euo pipefail

slugify_client_id() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g'
}

CLIENT_ID_INPUT="${CLIENT_ID:-raghava-organics}"
CLIENT_ID="$(slugify_client_id "$CLIENT_ID_INPUT")"
if [ -z "$CLIENT_ID" ]; then
  die "CLIENT_ID '$CLIENT_ID_INPUT' is invalid after normalization. Use letters/numbers/spaces/hyphens only."
fi
if [ "$CLIENT_ID" != "$CLIENT_ID_INPUT" ]; then
  log "Normalized CLIENT_ID: '$CLIENT_ID_INPUT' -> '$CLIENT_ID'"
fi

GITHUB_REPO_URL="${GITHUB_REPO_URL:-https://github.com/bb3agency/raghava-organics-site}"
RUNNER_NAME="${RUNNER_NAME:-${CLIENT_ID}-vps}"
RUNNER_LABEL="${RUNNER_LABEL:-${CLIENT_ID}-vps}"
# Per-client folder on multi-tenant VPS (e.g. ~/actions-runner-raghava-organics)
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner-${CLIENT_ID}}"

log() { echo "[install-runner] $*"; }
die() { log "ERROR: $*"; exit 1; }

if [ "$(id -un)" != "d_user" ] && [ -z "${ALLOW_NON_D_USER:-}" ]; then
  log "WARNING: expected deploy user d_user; current=$(id -un)"
fi

if [ -d "$RUNNER_DIR" ] && [ -f "$RUNNER_DIR/.runner" ]; then
  die "Runner already configured at $RUNNER_DIR. Remove first only if re-registering: cd $RUNNER_DIR && sudo ./svc.sh stop && ./config.sh remove"
fi

if [ -z "${RUNNER_TOKEN:-}" ]; then
  echo ""
  echo "Paste the registration token from GitHub (New self-hosted runner):"
  read -r RUNNER_TOKEN
fi

if [ -z "${RUNNER_DOWNLOAD_URL:-}" ]; then
  echo ""
  echo "Paste the curl download URL from GitHub (actions-runner-linux-x64-....tar.gz):"
  read -r RUNNER_DOWNLOAD_URL
fi

[ -n "$RUNNER_TOKEN" ] || die "RUNNER_TOKEN is required"
[ -n "$RUNNER_DOWNLOAD_URL" ] || die "RUNNER_DOWNLOAD_URL is required"

log "Installing runner to $RUNNER_DIR"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -f ./config.sh ]; then
  log "Downloading runner package..."
  curl -fSL -o actions-runner-linux-x64.tar.gz "$RUNNER_DOWNLOAD_URL"
  tar xzf ./actions-runner-linux-x64.tar.gz
fi

log "Configuring runner: name=$RUNNER_NAME labels=self-hosted,$RUNNER_LABEL"
./config.sh \
  --url "$GITHUB_REPO_URL" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "self-hosted,$RUNNER_LABEL" \
  --unattended \
  --replace

log "Installing systemd service (requires sudo password)..."
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status || true

log ""
log "Done. Verify in GitHub → Settings → Actions → Runners:"
log "  Runner '$RUNNER_NAME' should show Idle (green)."
log ""
log "Test CD:"
log "  1. GitHub → Actions → Deploy to VPS → Run workflow"
log "  OR"
log "  2. git push origin main (after Reliability CI passes)"
log ""
log "Re-run verify:"
log "  bash /var/www/raghava-organics/docs/clients/raghava-organics/scripts/verify-cd-status.sh"
