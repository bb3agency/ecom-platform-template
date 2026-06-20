#!/usr/bin/env bash
# =============================================================================
# install-maintenance-page.sh — install (or repair) the static maintenance.html
# that nginx's `error_page 502 503 /maintenance.html;` directive expects.
#
# Symptom this script fixes: the storefront returns the BARE nginx 503 page
# ("503 Service Temporarily Unavailable" with `nginx/1.x (Ubuntu)` footer)
# during maintenance instead of the branded "We'll be back shortly" page.
# Root cause: `/etc/nginx/maintenance/maintenance.html` is missing on disk.
#
# Run on the VPS from the backend directory:
#
#   sudo bash scripts/install-maintenance-page.sh
#
# Idempotent: the script compares source vs destination and only writes when
# they differ. Safe to run on every deploy or whenever you've updated the
# branded page in `nginx/maintenance.html`.
#
# As of the 2026-05-26 hardening, the nginx template ALSO includes an inline
# fallback (`@maintenance_inline` in client.conf.template) that serves a
# minimal branded page even when this file is missing. This script is what
# upgrades that minimal fallback to the full styled experience.
# =============================================================================

set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$BACKEND_DIR/nginx/maintenance.html"
DST_DIR="/etc/nginx/maintenance"
DST="$DST_DIR/maintenance.html"

log() {
  echo "[install-maintenance-page] $*"
}

if [ "$(id -u)" -ne 0 ]; then
  log "ERROR: must be run as root (use 'sudo bash scripts/install-maintenance-page.sh')."
  log "  The destination ($DST) is owned by root and requires elevated permissions."
  exit 1
fi

if [ ! -f "$SRC" ]; then
  log "ERROR: source file not found: $SRC"
  log "  Expected layout: <backend repo root>/nginx/maintenance.html"
  log "  If you cloned the backend repo elsewhere, run this script from there."
  exit 1
fi

mkdir -p "$DST_DIR"

if [ -f "$DST" ] && cmp -s "$SRC" "$DST"; then
  log "Already in sync: $DST matches $SRC. Nothing to do."
  exit 0
fi

cp "$SRC" "$DST"
chmod 644 "$DST"

# Sanity check: nginx must be able to read the file. /etc/nginx/* is normally
# world-readable but a tightened umask on the runner could land 600.
if ! [ -r "$DST" ]; then
  log "WARNING: $DST is not readable (permissions changed). Forcing 644."
  chmod 644 "$DST"
fi

log "Installed: $DST"

# Verify the live nginx config references /maintenance.html and the maintenance
# gate single-hop mapping. If a stale config doesn't have these directives,
# copying the file alone won't fix the symptom — the operator still needs to
# re-render and reload client.conf.template.
if command -v nginx >/dev/null 2>&1; then
  CLIENT_ID="${CLIENT_ID:-}"
  STOREFRONT_DOMAIN=""
  if [ -z "$CLIENT_ID" ] && [ -f "$BACKEND_DIR/.env" ]; then
    CLIENT_ID="$(grep -E '^CLIENT_ID=' "$BACKEND_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true)"
  fi
  if [ -f "$BACKEND_DIR/.env" ]; then
    STOREFRONT_DOMAIN="$(grep -E '^STOREFRONT_URL=' "$BACKEND_DIR/.env" | head -1 | cut -d= -f2- | sed -E 's,^https?://,,' | sed -E 's,/.*$,,' | tr -d '[:space:]' || true)"
  fi

  CONF=""
  for candidate in \
    "/etc/nginx/sites-enabled/${CLIENT_ID}.conf" \
    "/etc/nginx/sites-available/${CLIENT_ID}.conf" \
    "/etc/nginx/sites-enabled/${STOREFRONT_DOMAIN}.conf" \
    "/etc/nginx/sites-available/${STOREFRONT_DOMAIN}.conf"; do
    if [ -n "$candidate" ] && [ -f "$candidate" ]; then
      CONF="$candidate"
      break
    fi
  done
  if [ -z "$CONF" ] && [ -n "$STOREFRONT_DOMAIN" ]; then
    CONF="$(grep -lE "server_name[[:space:]].*\\b${STOREFRONT_DOMAIN}\\b" /etc/nginx/sites-enabled/*.conf 2>/dev/null | head -1 || true)"
  fi
  if [ -z "$CONF" ] && [ -n "$STOREFRONT_DOMAIN" ]; then
    CONF="$(grep -lE "server_name[[:space:]].*\\b${STOREFRONT_DOMAIN}\\b" /etc/nginx/sites-available/*.conf 2>/dev/null | head -1 || true)"
  fi

  if [ -n "$CONF" ] && [ -f "$CONF" ]; then
    HAS_MAINTENANCE_ERROR_PAGE=0
    HAS_SINGLE_HOP_GATE=0
    grep -qE 'error_page[[:space:]]+502[[:space:]]+503[[:space:]]+/maintenance\.html' "$CONF" && HAS_MAINTENANCE_ERROR_PAGE=1
    grep -qE 'error_page[[:space:]]+401[[:space:]]+=503[[:space:]]+/maintenance\.html' "$CONF" && HAS_SINGLE_HOP_GATE=1

    if [ "$HAS_MAINTENANCE_ERROR_PAGE" -eq 1 ] && [ "$HAS_SINGLE_HOP_GATE" -eq 1 ]; then
      log "Live nginx config ($CONF) has maintenance mapping + single-hop gate directives — good."
    else
      log "WARNING: live nginx config ($CONF) is stale/incomplete for maintenance gating."
      [ "$HAS_MAINTENANCE_ERROR_PAGE" -eq 0 ] && log "  Missing: error_page 502 503 /maintenance.html;"
      [ "$HAS_SINGLE_HOP_GATE" -eq 0 ] && log "  Missing: error_page 401 =503 /maintenance.html;"
      log "  Even with the file installed, users may still see bare nginx 503."
      log "  Re-render and reload from backend/nginx/client.conf.template."
    fi
  else
    log "WARNING: Could not locate active nginx vhost config file to validate directives."
    log "  Checked client-id and domain naming conventions plus server_name lookup."
  fi
fi

log "Done. Trigger a 503 (e.g. set maintenance mode) and curl https://<domain>/ — you should see the branded page."
