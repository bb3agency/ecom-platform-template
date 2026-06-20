#!/usr/bin/env bash
# =============================================================================
# diagnose-ops-otp.sh — pinpoint why ops OTP emails aren't arriving
#
# Run on the VPS from the backend directory:
#   bash scripts/diagnose-ops-otp.sh
#
# Prints, in order:
#   1. Worker container status (must be Up, not Restarting/Exited)
#   2. NOTIFY_EMAIL_ENABLED env value inside the worker container
#   3. StoreSettings.notifyEmailEnabled (DB row)
#   4. OpsConfigSecret presence for RESEND_API_KEY + RESEND_FROM (masked)
#   5. Last 5 OpsOtpChallenge rows (newest first) — confirms the OTP request landed
#   6. Last 5 NotificationLog rows for template='OpsActionOtp' — the actual send outcome
#   7. Last 80 lines of worker logs filtered for resend/email/otp/notification keywords
#
# After running, the FAILED row in step 6 will tell you exactly what to fix:
#   "Email notifications disabled or RESEND_API_KEY missing"
#       → save RESEND_API_KEY + RESEND_FROM via Ops UI, or check NOTIFY_EMAIL_ENABLED
#   "Resend request failed: 401" / "403" / "422"
#       → invalid API key / unverified sending domain / recipient not allowed
#       (Resend test mode only delivers to the email on your Resend account; for
#        any other recipient you must verify the sending domain at resend.com/domains)
#   "Resend request failed: 5xx" / "fetch failed"
#       → transient network/Resend outage; retry; check status.resend.com
#
# No rows at all in step 6 = the worker never processed the job
#   → check step 1 (container status) and step 7 (worker logs) for crash details
# =============================================================================

set -uo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BACKEND_DIR"

if [ ! -f .env ]; then
  echo "ERROR: $BACKEND_DIR/.env not found. Run from the backend directory on the VPS." >&2
  exit 1
fi

CLIENT_ID=$(grep -E '^CLIENT_ID=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true)
[ -z "$CLIENT_ID" ] && CLIENT_ID="ecom"

# Use host loopback DATABASE_URL (host.docker.internal won't resolve on the host).
HOST_DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed 's/host\.docker\.internal/127.0.0.1/')
if [ -z "$HOST_DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not found in .env" >&2
  exit 1
fi

# Detect compose flags. Honor COMPOSE_FILE / COMPOSE_PROJECT_NAME from .env if set;
# otherwise fall back to the explicit pair the deploy script uses.
COMPOSE_ARGS=()
if ! grep -qE '^COMPOSE_FILE=' .env; then
  COMPOSE_ARGS+=(-f docker-compose.yml -f docker-compose.prod.yml)
fi
if ! grep -qE '^COMPOSE_PROJECT_NAME=' .env; then
  COMPOSE_ARGS+=(-p "$CLIENT_ID")
fi

PSQL() {
  local query="$1"
  if command -v psql >/dev/null 2>&1; then
    psql "$HOST_DATABASE_URL" -A -t -c "$query" 2>&1
  else
    docker run --rm --network host -e PGPASSWORD postgres:16-alpine \
      psql "$HOST_DATABASE_URL" -A -t -c "$query" 2>&1
  fi
}

section() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════════"
  echo "  $*"
  echo "═══════════════════════════════════════════════════════════════════"
}

section "1. Worker container status (expected: Up + not Restarting)"
docker compose "${COMPOSE_ARGS[@]}" ps workers 2>&1 || true

section "2. NOTIFY_EMAIL_ENABLED inside the worker container"
docker compose "${COMPOSE_ARGS[@]}" exec -T workers \
  printenv NOTIFY_EMAIL_ENABLED 2>&1 \
  || echo "(not set — defaults to true)"

section "3. StoreSettings.notifyEmailEnabled (DB row)"
PSQL "SELECT \"notifyEmailEnabled\", \"notifySmsEnabled\", \"storeName\", \"websiteUrl\" FROM \"StoreSettings\" WHERE \"singletonKey\" = 'default';"

section "4. OpsConfigSecret rows for RESEND_API_KEY + RESEND_FROM (presence only, never plaintext)"
PSQL "SELECT \"secretKey\", \"isActive\", \"updatedAt\", CASE WHEN length(\"encryptedValue\") > 0 THEN '••• present (encrypted, ' || length(\"encryptedValue\") || ' bytes)' ELSE '✗ MISSING' END AS value FROM \"OpsConfigSecret\" WHERE \"secretKey\" IN ('RESEND_API_KEY', 'RESEND_FROM', 'EMAIL_PROVIDER') ORDER BY \"secretKey\";"

section "5. Last 5 OpsOtpChallenge rows (did the OTP request hit the API?)"
PSQL "SELECT id, action, status, \"createdAt\", \"expiresAt\" FROM \"OpsOtpChallenge\" ORDER BY \"createdAt\" DESC LIMIT 5;"

section "6. Last 5 NotificationLog rows for template='OpsActionOtp' (the actual send outcome)"
PSQL "SELECT id, status, provider, recipient, \"errorMessage\", \"createdAt\" FROM \"NotificationLog\" WHERE template = 'OpsActionOtp' ORDER BY \"createdAt\" DESC LIMIT 5;"

section "7. Worker logs — last 80 lines filtered for email/otp/notification/resend"
docker compose "${COMPOSE_ARGS[@]}" logs workers --tail 200 2>&1 \
  | grep -iE "(otp|resend|email|notification|RESEND)" | tail -n 80 \
  || echo "(no matching log lines in the last 200 entries)"

section "Diagnostic complete"
cat <<'EOF'

How to interpret the output above:

• Step 1 says "Up" but step 5 has no recent challenge row → the OTP request
  didn't reach the API. Check frontend network tab + the API container logs.

• Step 5 has a fresh row but step 6 has nothing → the job is stuck in the queue
  or the worker isn't processing. Check step 1 (container status) and step 7
  (worker logs) for a stack trace.

• Step 6 row shows status=FAILED with errorMessage="Email notifications disabled
  or RESEND_API_KEY missing" → step 4 will show the missing key. Save it via
  Ops → Config and restart the workers container.

• Step 6 row shows status=FAILED with errorMessage="Resend request failed: 403"
  AND the error text mentions "verify a domain" → you're in Resend test mode.
  Either change RESEND_FROM to onboarding@resend.dev AND set the recipient to
  your Resend account email, OR verify your sending domain at resend.com/domains.

• Step 6 row shows status=FAILED with errorMessage="Resend request failed: 401"
  → the RESEND_API_KEY value is wrong. Regenerate at resend.com/api-keys and
  save the new value via Ops → Config.

• Step 6 row shows status=SENT but no email arrives → check your spam folder
  and the Resend dashboard (resend.com/emails) for delivery status.

EOF
