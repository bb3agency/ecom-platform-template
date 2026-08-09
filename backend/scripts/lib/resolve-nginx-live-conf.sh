#!/usr/bin/env bash
# =============================================================================
# resolve_nginx_live_conf — locate the nginx vhost file that actually serves a domain.
#
# Extracted from vps-deploy.sh so it can be unit-tested against real directory
# fixtures (see src/common/plugins/nginx-conf-resolver.test.ts).
#
# WHY THIS IS DELICATE (2026-08-10 incident): the original implementation only ever
# considered filenames ending in `.conf`, both in its candidate list and in its
# `server_name` fallback greps. Debian/Ubuntu's nginx convention — which both live
# client VPSes use — has NO extension:
#     /etc/nginx/sites-available/raghavaorganics.com
# So resolution always fell through to the "first deploy" default
# (`<domain>.conf`, a path that does not exist), which meant:
#   * drift detection silently never fired — every deploy logged "first deploy?",
#     so nginx edge fixes appeared to deploy but were never applied, and
#   * with NGINX_AUTO_RELOAD=1 the script would have CREATED `<domain>.conf` and
#     symlinked it into sites-enabled, leaving TWO server blocks for the same
#     server_name alongside the real file.
# Matching must therefore be extension-agnostic, and the default for a genuine
# first deploy must follow whatever convention the box already uses.
#
# Usage:  resolve_nginx_live_conf <domain> <project-name>
# Honours NGINX_ROOT (default /etc/nginx) so tests can point at a fixture tree.
# =============================================================================

resolve_nginx_live_conf() {
  local domain="$1"
  local project="$2"
  local root="${NGINX_ROOT:-/etc/nginx}"
  local file=""

  # Fast path: explicit expected filenames, WITH and WITHOUT the .conf suffix.
  # sites-enabled first (that is what nginx actually loads), then sites-available.
  for candidate in \
    "$root/sites-enabled/${project}.conf" \
    "$root/sites-enabled/${project}" \
    "$root/sites-available/${project}.conf" \
    "$root/sites-available/${project}" \
    "$root/sites-enabled/${domain}.conf" \
    "$root/sites-enabled/${domain}" \
    "$root/sites-available/${domain}.conf" \
    "$root/sites-available/${domain}"; do
    if [ -f "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  # Fallback: discover by server_name across ALL files (no extension filter),
  # enabled first (authoritative). `-s` keeps unreadable/missing dirs quiet.
  for dir in "$root/sites-enabled" "$root/sites-available"; do
    [ -d "$dir" ] || continue
    file="$(grep -lsE "server_name[[:space:]][^;]*\\b${domain}\\b" "$dir"/* 2>/dev/null | head -1 || true)"
    if [ -n "$file" ] && [ -f "$file" ]; then
      echo "$file"
      return 0
    fi
  done

  # Genuine first deploy: follow the convention the box already uses, so we do not
  # introduce a second naming style next to the existing vhosts.
  if ls "$root"/sites-available/*.conf >/dev/null 2>&1; then
    echo "$root/sites-available/${domain}.conf"
  else
    echo "$root/sites-available/${domain}"
  fi
}
