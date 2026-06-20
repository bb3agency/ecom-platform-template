# Shiprocket — Raghava Organics production setup

> **Secrets:** `SHIPROCKET_PASSWORD` and `SHIPROCKET_WEBHOOK_TOKEN` live only in gitignored [VPS_INPUTS.md](./VPS_INPUTS.md) and Ops UI.

## Architecture

- **REST API only** — do not use Shiprocket “Connect My Store” (Shopify/WooCommerce). This site uses a CUSTOM channel + headless API.
- Admin **Ship** action creates Shiprocket orders and AWB via `POST /api/v1/admin/orders/:id/ship`.
- Tracking updates arrive at `POST /api/v1/shipping/webhook` (validated via `SHIPROCKET_WEBHOOK_TOKEN`).
- Credentials and pickup config are stored in **Ops UI → Config → Shipping** (not `backend/.env`).

## Shiprocket Dashboard

### API user

1. Settings → Additional Settings → **API Users**
2. Active user email (this client: `raghavaraoj76@gmail.com`)
3. Password stored in Ops as `SHIPROCKET_PASSWORD`

### Pickup address (critical)

1. Settings → Company Setup → **Pick Up Addresses**
2. This client: nickname **`Home`**, pincode **`522007`**, Guntur AP
3. Address must be **ACTIVE** (toggle ON) — inactive addresses block courier assignment
4. Ops `SHIPROCKET_PICKUP_LOCATION` must match nickname **exactly** (case-sensitive). Default backend fallback `Primary` is wrong for this account.

### Webhook

| Setting | Value |
|---------|--------|
| URL | `https://raghavaorganics.com/api/v1/shipping/webhook` |
| Token | Same as Ops `SHIPROCKET_WEBHOOK_TOKEN` (see vault) |
| Status | Enabled |

Shiprocket uses a single webhook endpoint (no per-event checkboxes in UI).

### Wallet

Prepaid wallet balance required before AWB/courier assignment.

## Ops UI

| Key | Value (this client) |
|-----|---------------------|
| `SHIPPING_PROVIDER` | `shiprocket` |
| `SHIPROCKET_EMAIL` | `raghavaraoj76@gmail.com` |
| `SHIPROCKET_PASSWORD` | vault |
| `SHIPROCKET_PICKUP_PINCODE` | `522007` |
| `SHIPROCKET_PICKUP_LOCATION` | `Home` |
| `SHIPROCKET_WEBHOOK_TOKEN` | vault |

OTP save → restart API + workers.

## Verification

```bash
curl -s https://raghavaorganics.com/api/v1/health/ready | jq '.data.runtimeConfigMissingKeys'
```

After pickup location is saved, missing keys should not include any `SHIPROCKET_*` required fields.

Admin: ship a CONFIRMED order → expect AWB + `SHIPPED` status.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Invalid pickup location | `SHIPROCKET_PICKUP_LOCATION` empty or wrong nickname |
| No courier / AWB | Pickup address inactive or wallet ₹0 |
| Webhook 401 | Token mismatch between Shiprocket and Ops |
| API 401 on ship | Wrong `SHIPROCKET_EMAIL` / password in Ops |

See [INTEGRATION_AUDIT_FIX_CHECKLIST.md](./INTEGRATION_AUDIT_FIX_CHECKLIST.md) for post-audit fix steps.
