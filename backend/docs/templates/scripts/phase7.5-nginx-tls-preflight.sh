#!/usr/bin/env bash
# Phase 7.5 — Multi-client VPS preflight before Nginx + Certbot (per client)
# Copy to docs/clients/<client-id>/scripts/ and set CLIENT_ID, DOMAIN, ports.
# Does NOT modify other clients' Nginx configs.
set -euo pipefail

CLIENT_ID="${CLIENT_ID:-<client-id>}"
PRODUCTION_DOMAIN="${PRODUCTION_DOMAIN:-<domain.com>}"
BACKEND_PORT="${BACKEND_PORT:-3001}"
STOREFRONT_PORT="${STOREFRONT_PORT:-3101}"
BACKEND_PATH="${BACKEND_PATH:-/var/www/${CLIENT_ID}/backend}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-${PRODUCTION_DOMAIN}}"

log() { echo "[phase7.5] $*"; }
warn() { echo "[phase7.5] WARN: $*" >&2; }
fail() { log "ERROR: $*"; exit 1; }

log "Multi-client VPS preflight for CLIENT_ID=${CLIENT_ID} DOMAIN=${PRODUCTION_DOMAIN}"

log "Other Nginx sites on this host (do not edit these files):"
ls -la /etc/nginx/sites-enabled/ 2>/dev/null || warn "Cannot list sites-enabled"

if grep -q 'sites-enabled/default' /etc/nginx/sites-enabled/* 2>/dev/null; then
  warn "sites-enabled/default exists — do NOT remove unless no other client relies on it"
else
  log "No default site symlink (OK on multi-client hosts)"
fi

if ! grep -q 'snippets/rate-zones.conf' /etc/nginx/nginx.conf 2>/dev/null; then
  warn "Rate zones not included in nginx.conf http {} — add once per VPS:"
  warn "  sudo cp <repo>/backend/nginx/rate-zones.conf.template /etc/nginx/snippets/rate-zones.conf"
  warn "  include /etc/nginx/snippets/rate-zones.conf;  # inside http {}"
else
  log "Rate zones include present in nginx.conf"
fi

if grep -q 'limit_req_zone.*zone=api_auth' /etc/nginx/nginx.conf 2>/dev/null \
  && grep -q 'limit_req_zone.*zone=api_auth' /etc/nginx/snippets/rate-zones.conf 2>/dev/null; then
  fail "Duplicate limit_req_zone definitions — rate zones must live ONLY in snippets/rate-zones.conf"
fi

check_port() {
  local port="$1"
  local label="$2"
  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    if ss -tlnp 2>/dev/null | grep ":${port} " | grep -qE "${CLIENT_ID}|${CLIENT_ID}-frontend"; then
      log "Port ${port} (${label}) in use by this client — OK"
    else
      fail "Port ${port} (${label}) already in use by another process — pick another slot (see CLIENT_VPS_SETUP_GUIDE §3)"
    fi
  else
    log "Port ${port} (${label}) is free"
  fi
}

check_port "$BACKEND_PORT" "backend"
check_port "$STOREFRONT_PORT" "storefront"

if ss -tlnp 2>/dev/null | grep -q '0.0.0.0:6379'; then
  if docker port "${CLIENT_ID}-redis" 6379/tcp 2>/dev/null | grep -q .; then
    fail "This client's Redis publishes host :6379 — comment redis 'ports:' in ${BACKEND_PATH}/docker-compose.yml"
  else
    warn "Host :6379 is bound by another client's Redis — ensure this client's redis has NO ports: mapping"
  fi
else
  log "Host :6379 not publicly bound (good for multi-client)"
fi

if [ -f "${BACKEND_PATH}/docker-compose.yml" ] \
  && grep -A12 '^  redis:' "${BACKEND_PATH}/docker-compose.yml" | grep -qE '^[[:space:]]+ports:'; then
  if ! grep -A12 '^  redis:' "${BACKEND_PATH}/docker-compose.yml" | grep -qE '^[[:space:]]+#.*ports:'; then
    fail "Uncommented redis 'ports:' in docker-compose.yml — remove host publish before prod"
  fi
fi

SITE_AVAILABLE="/etc/nginx/sites-available/${NGINX_SITE_NAME}"
SITE_ENABLED="/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"

log "Use domain-based site file (additive — other clients keep their own files):"
log "  ${SITE_AVAILABLE}"
log "  sudo ln -sf ${SITE_AVAILABLE} ${SITE_ENABLED}"
log "  sudo nginx -t && sudo systemctl reload nginx"
log "  sudo certbot --nginx -d ${PRODUCTION_DOMAIN} -d www.${PRODUCTION_DOMAIN}"
log "After certs: deploy full backend/nginx/client.conf.template with proxy_pass 127.0.0.1:${BACKEND_PORT} and 127.0.0.1:${STOREFRONT_PORT}"

log "Phase 7.5 preflight OK"
