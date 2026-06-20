#!/usr/bin/env bash
# One-time GitHub Actions self-hosted runner installer (template).
# Copy to docs/clients/<client-id>/scripts/ and run on VPS as deploy user.
#
# Usage:
#   export CLIENT_ID='<client-id>'
#   export GITHUB_REPO_URL='https://github.com/<org>/<repo>'
#   export RUNNER_TOKEN='xxxxxxxx'
#   export RUNNER_DOWNLOAD_URL='https://github.com/actions/runner/releases/download/vX.Y.Z/actions-runner-linux-x64-X.Y.Z.tar.gz'
#   bash install-github-runner.sh
#
# Or interactive (prompts for token + URL):
#   bash install-github-runner.sh
set -euo pipefail

log() { echo "[install-runner] $*"; }
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

GITHUB_REPO_URL="${GITHUB_REPO_URL:-https://github.com/<org>/<repo>}"
RUNNER_NAME="${RUNNER_NAME:-${CLIENT_ID}-vps}"
RUNNER_LABEL="${RUNNER_LABEL:-${CLIENT_ID}-vps}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner-${CLIENT_ID}}"

if [ -d "$RUNNER_DIR" ] && [ -f "$RUNNER_DIR/.runner" ]; then
  die "Runner already configured at $RUNNER_DIR. Stop/remove only if re-registering."
fi

if [ -z "${RUNNER_TOKEN:-}" ]; then
  echo ""
  echo "Paste registration token from GitHub (Settings -> Actions -> Runners -> New):"
  read -r RUNNER_TOKEN
fi

if [ -z "${RUNNER_DOWNLOAD_URL:-}" ]; then
  echo ""
  echo "Paste curl download URL from GitHub (actions-runner-linux-x64-....tar.gz):"
  read -r RUNNER_DOWNLOAD_URL
fi

[ -n "$RUNNER_TOKEN" ] || die "RUNNER_TOKEN is required"
[ -n "$RUNNER_DOWNLOAD_URL" ] || die "RUNNER_DOWNLOAD_URL is required"

log "Installing runner to $RUNNER_DIR"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -f ./config.sh ]; then
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

sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status || true

log "Runner install complete."
log "Next: run verify-cd-status.sh and check GitHub runner is Idle."
