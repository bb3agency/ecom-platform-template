# Integration audit — discrepancy resolution (Raghava Organics)

> **Source:** Comet browser audits 2026-06-11 (Razorpay, Shiprocket, Ops config).  
> **Vault:** gitignored [VPS_INPUTS.md](./VPS_INPUTS.md)

## Status summary

| Area | Code/docs fixed | You must do manually |
|------|-----------------|----------------------|
| Razorpay Ops + checkout | Documented complete | Trim 2 extra webhook events |
| Razorpay webhook secret | Ops matches vault | Optional rotate if first webhook fails |
| Shiprocket webhook token | Vault synced to production token | Nothing (Ops + Shiprocket already match) |
| Shiprocket pickup location | Backend now requires key for readiness | Save `Home` in Ops + restart |
| Shiprocket pickup active | Documented | Toggle **Home** address ON in dashboard |
| Shiprocket wallet | Documented | Recharge wallet |

---

## Already correct (no change needed)

- Razorpay Live mode, Key ID `rzp_live_Szr9LAUchr3Sk3`, KYC approved
- Razorpay webhook URL, enabled, alert email
- Ops Payments: all four Razorpay keys saved, runtime present
- Ops Shipping: provider, email, password, pincode, webhook token
- Shiprocket ↔ Ops webhook token: both use `8f3a9b2c…d2e`
- Storefront checkout shows Razorpay (no config error)
- `/health/ready` = `ready` (will show `SHIPROCKET_PICKUP_LOCATION` missing after backend deploy until Ops save)

---

## Manual fixes (do in order)

### 1. Razorpay — remove extra webhook events (~2 min)

1. [Razorpay Dashboard → Webhooks](https://dashboard.razorpay.com/app/website-app-settings/webhooks) (Live mode)
2. Open webhook `https://raghavaorganics.com/api/v1/payments/webhook`
3. **Edit** → Active events: keep **only**:
   - `payment.captured`
   - `payment.failed`
   - `refund.processed`
4. **Uncheck:** `payment.authorized`, `refund.failed`
5. Save

Backend ignores unknown events today; this removes noise and matches the contract.

### 2. Shiprocket — activate pickup address (~1 min)

1. [Shiprocket → Settings → Pick Up Addresses](https://app.shiprocket.in/seller/settings/company-setup/pickup-addresses)
2. Find address nickname **`Home`** (pincode `522007`)
3. Turn **Status toggle ON** (must show active/enabled)

### 3. Shiprocket — recharge wallet (~5 min)

1. Shiprocket dashboard → **Wallet / Recharge**
2. Add sufficient balance for courier assignment (minimum per your plan)

### 4. Ops — set pickup location (~3 min)

1. [https://raghavaorganics.com/ops/config](https://raghavaorganics.com/ops/config)
2. **Shipping** section → `SHIPROCKET_PICKUP_LOCATION` = `Home` (exact case)
3. **Send OTP to email** → verify → **Save**
4. On VPS restart API + workers:

```bash
cd /var/www/raghava-organics/backend
docker compose -f docker-compose.prod.yml up -d backend workers
```

### 5. Deploy backend contract fix (pickup location in readiness)

After you pull/deploy the template change that requires `SHIPROCKET_PICKUP_LOCATION` when `SHIPPING_PROVIDER=shiprocket`:

- `/health/ready` will return `503` + `runtimeConfigMissingKeys: ["SHIPROCKET_PICKUP_LOCATION"]` until step 4 is done
- After step 4 + restart, readiness should return `ready` again

---

## Optional: Razorpay webhook secret confirmation

Razorpay does not show the secret after creation. Ops audit confirmed vault value (`…hf5w`) is stored.

**Only if** the first live `payment.captured` webhook returns non-200:

1. Razorpay webhook → **Change Secret** → paste vault `RAZORPAY_WEBHOOK_SECRET`
2. Ops → Payments → same value → OTP save → restart workers

---

## Verification after fixes

```bash
# On VPS
curl -s https://raghavaorganics.com/api/v1/health/ready | jq '.data.status, .data.runtimeConfigMissingKeys'
```

Expected: `"ready"` and `[]`

**Prepaid:** small live order → order `CONFIRMED` → Razorpay webhook log HTTP 200.

**Shipping:** admin ship on CONFIRMED order → AWB created → order `SHIPPED`.

**API login (optional):**

```bash
curl -s -X POST https://apiv2.shiprocket.in/v1/external/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"raghavaraoj76@gmail.com","password":"<from VPS_INPUTS>"}' | jq .token
```

---

## Comet re-audit prompt (paste after manual steps)

```
Re-audit Raghava Organics integration fixes only. Report OK/NO table.

Razorpay Live webhook: only 3 events enabled (payment.captured, payment.failed, refund.processed) — payment.authorized and refund.failed must be OFF.

Shiprocket: pickup "Home" pincode 522007 — status toggle ACTIVE. Wallet balance > ₹0.

Ops /ops/config: SHIPROCKET_PICKUP_LOCATION = "Home", badge Runtime present (DB overlay).

GET https://raghavaorganics.com/api/v1/health/ready → status ready, runtimeConfigMissingKeys [].
```
