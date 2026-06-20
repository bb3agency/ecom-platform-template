#!/usr/bin/env bash
# Phase 6 — VPS host baseline for raghava-organics
# Run on Ubuntu 22.04 VPS as deploy user (with sudo).
set -euo pipefail

CLIENT_ID="${CLIENT_ID:-raghava-organics}"
WWW_ROOT="/var/www/${CLIENT_ID}"

log() { echo "[phase6] $*"; }

log "Checking tooling..."
command -v docker >/dev/null
docker compose version >/dev/null
command -v nginx >/dev/null
command -v psql >/dev/null
command -v node >/dev/null
node -v | grep -q '^v22'

log "Checking time sync..."
timedatectl status | grep -i 'synchronized: yes' || { echo "NTP not synchronized"; exit 1; }

log "Creating directories..."
sudo mkdir -p "${WWW_ROOT}/backend" "${WWW_ROOT}/frontend"
sudo chown -R "$(whoami):$(whoami)" "/var/www/${CLIENT_ID}"

log "UFW reminder: allow 22,80,443 only; do NOT expose 3001/3101 publicly."
sudo ufw status || true

log "Multi-client VPS: list existing Nginx sites (add new client configs — do not replace others):"
ls -la /etc/nginx/sites-enabled/ 2>/dev/null || true

log "Multi-client VPS: confirm this client's loopback ports are free (slot 1 = 3001/3101):"
ss -tlnp 2>/dev/null | grep -E ':3001|:3101' || log "Ports 3001/3101 appear free"

log "Phase 6 baseline checks complete. Install missing packages per backend/docs/CLIENT_VPS_SETUP_GUIDE.md if any command failed."
