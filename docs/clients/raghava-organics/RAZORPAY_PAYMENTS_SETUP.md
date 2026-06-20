# Razorpay — Raghava Organics production setup

> **Secrets:** `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` live only in gitignored [VPS_INPUTS.md](./VPS_INPUTS.md) and Ops UI — never commit or paste in PRs/chat after go-live.

## Architecture

- Storefront checkout uses Razorpay Checkout (public `NEXT_PUBLIC_RAZORPAY_KEY_ID` on frontend).
- Server creates orders, verifies signatures, and confirms payment via **webhook** (`payment.captured`).
- API keys and webhook secret are stored encrypted in **Ops UI → Config → Payments** (not `backend/.env`).

## Razorpay Dashboard — API keys

Live keys for this client are recorded in gitignored [VPS_INPUTS.md](./VPS_INPUTS.md) (Key ID `rzp_live_Szr9LAUchr3Sk3`, 2026-05-23). **Never** commit the Key Secret to tracked docs.

1. Razorpay Dashboard → **API Keys** → **Live** mode (already generated for this client).
2. Copy **Key ID** and **Key Secret** from [VPS_INPUTS.md](./VPS_INPUTS.md) vault (or Razorpay dashboard if rotating).
3. Save in Ops UI:
   - `PAYMENT_PROVIDER` = `razorpay`
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
4. Copy **Key ID** only to VPS `frontend/.env.production.local` as `NEXT_PUBLIC_RAZORPAY_KEY_ID`.
5. Rebuild frontend after changing the public key (`phase10-frontend-deploy.sh`).

## Razorpay Dashboard — Webhook

| Setting | Value |
|---------|--------|
| **URL** | `https://raghavaorganics.com/api/v1/payments/webhook` |
| **Secret** | Use `RAZORPAY_WEBHOOK_SECRET` from [VPS_INPUTS.md](./VPS_INPUTS.md) (generated 2026-05-23) |
| **Alert email** | `raghavaorganics@gmail.com` |

### Events to enable (only these three)

| Event | Required | Backend behavior |
|-------|----------|------------------|
| `payment.captured` | Yes | Confirms prepaid order, inventory, invoice, notifications |
| `payment.failed` | Yes | Order → `PAYMENT_FAILED` |
| `refund.processed` | Yes | Admin refund finalization → `REFUNDED` |

Do **not** enable disputes, subscriptions, invoices, `order.paid`, payment links, or other events — the backend ignores them.

**Audit note (2026-06-11):** If `payment.authorized` or `refund.failed` were enabled during initial setup, disable them in the webhook edit view. Only the three events above should remain active.

### Ops UI (must match dashboard secret)

After creating the webhook in Razorpay, save the **same** secret string as `RAZORPAY_WEBHOOK_SECRET` in Ops UI, then restart API + workers.

Also configure in Ops (production-like profiles):

- `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR` — Razorpay outbound IP ranges
- `RAZORPAY_WEBHOOK_MAX_SKEW_SECONDS` — default `300` is fine

## Verification

```bash
# On VPS, from backend directory
node scripts/verify-integration-readiness.mjs
curl -s https://raghavaorganics.com/api/v1/health/ready | jq '.data.runtimeConfigMissingKeys'
```

Place a test prepaid order; confirm order moves to `CONFIRMED` after webhook (workers must be running).

## Rotation

1. Generate a new webhook secret in Razorpay dashboard.
2. Set old secret as `RAZORPAY_WEBHOOK_SECRET_OLD` in Ops UI (overlap window).
3. Set new secret as `RAZORPAY_WEBHOOK_SECRET`.
4. Restart API + workers; remove `_OLD` after Razorpay stops using the old secret.
5. Update [VPS_INPUTS.md](./VPS_INPUTS.md) vault.
