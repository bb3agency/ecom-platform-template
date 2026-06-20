# Production First Deploy Checklist

Step-by-step guide for deploying this backend for a new client. Covers the two-phase setup model: bootstrap (Phase 1) and Ops UI config (Phase 2).

---

## Overview: Two-Phase Model

| Phase | What | How |
|-------|------|-----|
| **Phase 1** | Bootstrap keys the app needs to start | Set in `.env` before first deploy |
| **Phase 2** | Provider credentials & runtime config | Set via Ops UI → Config after first login |

---

## Phase 1 — Before First Deploy

### Step 1: Copy and fill `.env`

```bash
cp .env.example .env
```

Edit `.env` and set **all Phase 1 keys**:

| Key | Notes |
|-----|-------|
| `NODE_ENV` | Set to `production` |
| `DATABASE_URL` | Your production Postgres URL (URL-encode special chars: `@` → `%40`) |
| `REDIS_URL` | Your production Redis URL |
| `OPS_DB_ENCRYPTION_KEY` | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `OPS_DB_ENCRYPTION_KEY_VERSION` | Leave as `1` |
| `OPS_COOKIE_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_REFRESH_SECRET` | Same as above — use a **different** value |
| `CLIENT_ID` | Short identifier for this client, e.g. `myclient` |
| `STOREFRONT_URL` | e.g. `https://shop.myclient.com` — **required**; API refuses to start in production-like profiles if missing (password-reset email safety) |
| `ADMIN_URL` | e.g. `https://admin.myclient.com` |
| `ADMIN_ALERT_EMAIL` | Where system alerts go |
| `AUDIT_ANCHOR_SECRET` | Generate same as JWT_SECRET |
| `RESEND_API_KEY` | **Required for Step 4** — your Resend API key |
| `RESEND_FROM` | e.g. `My Store <noreply@myclient.com>` (must be a verified Resend domain) |

> All other keys (`RAZORPAY_*`, `DELHIVERY_*`, `MSG91_*`, etc.) can remain as placeholders — set via Ops UI in Phase 2.

---

### Step 1b: Domain + Email Setup (Required for Resend)

Before `ops-newuser.mjs` can send the first invite email, you need a **verified domain** in Resend. This step explains the complete free email infrastructure setup.

---

#### **Part 1: Buy a Domain (Namecheap Recommended)**

Purchase your domain from Namecheap (~$8-12/year for common TLDs like `.com`, `.in`, `.co`). This is your **only required payment** — everything else in this guide is free.

**Tips:**
- Search for your store name + coupon codes (often 10-30% off first purchase)
- Enable **WhoisGuard privacy protection** (usually free with Namecheap) to hide your contact info from public domain lookups
- After purchase, the domain is immediately yours but DNS changes take a few minutes to propagate globally

---

#### **Part 2: Set Up Free Email Forwarding in Namecheap**

This lets you receive emails sent to `support@yourdomain.com` directly in your personal Gmail inbox — without paying for a mailbox.

**Exact steps:**

1. Log into [Namecheap](https://www.namecheap.com) → **Domain List**
2. Click **Manage** next to your domain
3. Navigate to the **Redirect Email** tab (in the horizontal menu)
4. Click **Add Forwarder**
5. Fill the form:
   - **Alias:** `support` (this creates `support@yourdomain.com`)
   - **Forward to:** `yourpersonal@gmail.com` (your existing Gmail)
6. Click the ✓ (checkmark) icon to save
7. Optional but recommended: Click **Add catch all** to forward ALL emails (`*@yourdomain.com`) to your Gmail, so misspelled addresses like `supprt@` or `hellp@` still reach you

**What happens:**
- Someone sends to `support@yourdomain.com`
- Namecheap's mail servers receive it and forward to your Gmail
- You see it in Gmail with original sender intact
- **Limitation:** You cannot reply FROM `support@yourdomain.com` yet (that's Part 4)

**Verification:** Send a test email from another account (not your Gmail) to `support@yourdomain.com` — it should appear in your Gmail within 1-2 minutes.

---

#### **Part 3: Verify Domain in Resend (Critical for Sending)**

Resend requires domain verification before you can send emails to arbitrary recipients (not just your own email). This prevents email spoofing and ensures deliverability.

**What you'll do:** Add DNS records that prove you own the domain.

**Step-by-step:**

**In Resend Dashboard:**
1. Go to [resend.com/domains](https://resend.com/domains)
2. Click **Add Domain** button
3. Enter your domain (e.g., `raghavaorganics.com`) — **without** `www` or `https://`
4. Click **Add**
5. You'll see a screen with **2 DNS records** to add:
   - **SPF Record** (TXT): Authorizes Resend to send email on your behalf
   - **DKIM Record** (TXT): Cryptographic signature for email authentication
   - Optional: **Custom Return Path** (CNAME): Improves deliverability (recommended)

**In Namecheap DNS:**
1. Stay on the Resend page (don't close it)
2. Open a new tab → Namecheap → **Domain List** → **Manage** → **Advanced DNS**
3. You're now in the DNS records section. Look for the **Host Records** area
4. For each record Resend provided, add it:

| Record Type | Host | Value | TTL |
|-------------|------|-------|-----|
| `TXT Record` | `@` | (copy SPF value from Resend) | Automatic |
| `TXT Record` | `resend._domainkey` | (copy DKIM value from Resend) | Automatic |
| `CNAME Record` | `resend` | `feedback-smtp.us-east-1.amazonses.com` | Automatic |

**To add each record in Namecheap:**
- Click **Add New Record**
- Select type from dropdown (TXT or CNAME)
- Paste the Host and Value exactly as Resend shows
- Leave TTL as default/automatic
- Save all changes

**Back in Resend:**
1. Click **Verify Domain** button
2. Status changes to **"Pending"** with a yellow badge
3. Resend now queries DNS globally to confirm your records exist
4. Wait for status to change to **"Verified"** with green badge (typically 5 minutes to 2 hours, occasionally longer)

**What the statuses mean:**
- **Pending** (yellow): DNS propagation in progress — normal, just wait
- **Verified** (green): ✅ Ready to send emails
- **Failed** (red): DNS records incorrect — double-check copy-paste, especially the DKIM long value

**Troubleshooting:**
- If stuck on "Pending" for hours: Use [MXToolbox TXT Lookup](https://mxtoolbox.com/TXTLookup.aspx) to verify your records are publicly visible
- DKIM values are very long — ensure you copied the entire string (no truncation)
- SPF record should start with `v=spf1` — if not, you copied wrong field

---

#### **Part 4: Set Up "Send Mail As" in Gmail (Professional Replies)**

Without this step, when you reply to customer emails in Gmail, your reply comes from `yourpersonal@gmail.com` instead of `support@yourdomain.com` — looking unprofessional.

This setup lets Gmail send emails **through Resend's SMTP** using your verified domain.

**In Gmail:**

1. Click the **gear icon** (⚙️) → **See all settings**
2. Go to the **Accounts and Import** tab
3. In section **"Send mail as"**, click **"Add another email address"**
4. A popup opens. Enter:
   - **Name:** Your store name (e.g., `Raghava Organics`)
   - **Email address:** `support@yourdomain.com` (or `noreply@`, `hello@`, etc.)
   - **Treat as an alias:** ✅ Checked (recommended)
5. Click **Next Step**
6. **SMTP Server settings** — this is where you connect to Resend:
   - **SMTP Server:** `smtp.resend.com`
   - **Port:** `587` (TLS)
   - **Username:** `resend` (this exact string, not your email)
   - **Password:** Your Resend API key (starts with `re_` — copy from Resend Dashboard → API Keys)
7. Click **Add Account**
8. Gmail sends a **verification code** to `support@yourdomain.com`
9. Since you set up forwarding in Part 2, this code arrives in your Gmail inbox within 30 seconds
10. Copy the 6-digit code and paste it into the Gmail verification popup
11. Click **Verify**

**Result:** Now when composing emails in Gmail, you have a **dropdown next to the From field** where you can choose:
- `yourpersonal@gmail.com` (personal)
- `support@yourdomain.com` (professional business)

Select your business address when replying to customer inquiries.

**Testing the setup:**
1. In Gmail, click **Compose**
2. Click the **From** dropdown → select `support@yourdomain.com`
3. Send a test email to another account you own
4. Verify the recipient sees: `From: Raghava Organics <support@yourdomain.com>`
5. Check that SPF and DKIM pass (in Gmail, click "Show original" on the received email)

---

#### **Summary: What You Now Have (All Free Except Domain)**

| Function | How It Works | Cost |
|----------|--------------|------|
| **Domain ownership** | Your brand identity | ~$10/year |
| **Receiving emails** | `support@yourdomain.com` → Namecheap → your Gmail | Free |
| **Sending transactional** | Order confirmations, OTPs via Resend API | Free (3,000/day) |
| **Replying professionally** | Gmail "Send as" via Resend SMTP | Free |
| **Email authentication** | SPF + DKIM verified = no "via resend.io" header | Free |

---

#### **⚠️ Critical: Before Running `ops-newuser.mjs`**

**DO NOT proceed** until Resend Dashboard shows your domain status as **"Verified"** (green badge). If you run the script while status is **"Pending"** (yellow), Resend will reject the email with this error:

> *"You can only send testing emails to your own email address (youremail@domain.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the from address to an email using this domain."*

If this happens, wait for verification to complete, then retry the script — no harm done.

---

### Step 3: Run database migrations

```bash
npm ci
npx prisma generate --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
```

> **VPS (host PostgreSQL + `host.docker.internal` in `.env`):** Do **not** run bare `npx prisma migrate deploy` on the host shell — Prisma uses `.env` unchanged and fails with `P1001` at `host.docker.internal`. Override for migrate only:
> ```bash
> MIGRATE_DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/host\.docker\.internal/127.0.0.1/')"
> DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma
> ```
> Or use `scripts/vps-deploy.sh` / client `phase7-backend-deploy.sh`. See `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` §C.

---

### Step 4: Start the server

```bash
node dist/src/main.js
# or with tsx for first-time setup:
npx tsx src/main.ts
```

Verify it's up:
```bash
curl http://localhost:3000/api/v1/health/live
# → {"status":"ok"}
```

---

### Step 5: Create the first Ops user

```bash
node scripts/ops-newuser.mjs \
  --email=ops@myclient.com \
  --name="Ops Admin" \
  --setup-base-url="https://admin.myclient.com" \
  --yes
```

This sends a setup invite email via Resend. The ops user clicks the link, sets their password, and can log in.

> **Requires:** `RESEND_API_KEY` and `RESEND_FROM` set in `.env` (Phase 1), and domain "Verified" in Resend (Step 1b).

---

### Step 6: Ops user activates account

The invited ops user:
1. Opens the setup link from their email (`/ops/setup?token=...` — public page, no console nav)
2. Completes invite setup via email OTP on the ops setup page
3. Logs in at `/ops/login` using email → OTP → `ops_session` cookie; only then do console routes (`/ops`, `/ops/config`, etc.) show navigation

---

## Phase 2 — After First Ops Login (Ops UI)

All provider credentials and runtime config are set via **Ops UI → Config**. No `.env` changes needed.

### Payment (Razorpay)
- `PAYMENT_PROVIDER` = `razorpay`
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

### Shipping
- Set credentials for whichever provider(s) are active: `DELHIVERY_API_KEY` (Delhivery) and/or `SHIPROCKET_EMAIL`+`SHIPROCKET_PASSWORD` (Shiprocket). Both can coexist. `SHIPPING_PROVIDER` is not a valid key — provider detection is credential-based.
- Webhook tokens and pickup pincodes for each active provider

### Notifications
- `RESEND_API_KEY`, `RESEND_FROM` — can now be rotated here (replaces Phase 1 env values)
- `MSG91_AUTH_KEY`, `MSG91_SENDER_ID` (if SMS enabled)
- `META_WHATSAPP_ACCESS_TOKEN` (if WhatsApp enabled)
- Enable/disable channels: `NOTIFY_EMAIL_ENABLED`, `NOTIFY_SMS_ENABLED`, `NOTIFY_WHATSAPP_ENABLED`

### Security hardening
- `OPS_METRICS_TOKEN` — protect Prometheus scrape endpoint
- `REPLAY_APPROVAL_TOKEN` — required for analytics replay
- Webhook IP allowlists (`RAZORPAY_WEBHOOK_ALLOWLIST_CIDR`, etc.)

### Feature flags
- `FEATURE_COUPONS_ENABLED`, `FEATURE_REVIEWS_ENABLED`, `FEATURE_WISHLIST_ENABLED`
- `FEATURE_GST_INVOICING_ENABLED`
- `FEATURE_RESPONSE_ENVELOPE_ENABLED` — set to `true` if frontend expects `{ success, data }` wrapper

---

## Post-Deploy Verification

```bash
# Health check
curl https://your-domain.com/api/v1/health/live

# Runtime readiness (must be empty before go-live)
curl https://your-domain.com/api/v1/health/ready

# Admin login step 1 (valid credentials → 200 + OTP enqueued; wrong password for known admin → 401)
curl -X POST https://your-domain.com/api/v1/auth/admin/login/request-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin@12345"}'
```

---

## Key Invariants

- `OPS_DB_ENCRYPTION_KEY` — **never rotate without a migration plan** — all ops secrets are encrypted with this key
- `NODE_ENV=production` — must be set in production; disables dev-only behaviours (plaintext OTP in Redis, verbose errors)
- After Phase 2, `RESEND_API_KEY` in `.env` becomes a fallback only — Ops UI value takes precedence
- Backend can boot with DB-overlay runtime keys missing, but go-live is blocked until `/api/v1/health/ready` shows `runtimeConfigMissingKeys: []`.

---

## Local Dev / CI Contract-Check Setup

When running `npm run ci:reliability-gates` or `npm run contract:admin` locally:

1. **`NODE_ENV=development`** must be set in `.env` — the server writes a Redis ci-plaintext OTP key only in non-production mode. With `NODE_ENV=production` the script cannot auto-read the OTP.
2. **`ADMIN_EMAIL` / `ADMIN_PASSWORD`** must match a real seeded admin account in your local DB. Defaults are `admin@example.com` / `Admin@12345` — override in `.env` if your seed uses different credentials.
3. **`npm run dev` / `npm start`** now auto-loads `.env` (via `tsx --env-file` and bootstrap file dotenv loader) — no need to pre-export env vars in the shell.
4. The server must be running before executing the contract check.

---

## Related Docs

- `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` — full VPS + Docker setup
- `docs/CLIENT_VPS_SETUP_GUIDE.md` — server provisioning
- `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` — live incident-derived Phase 7 troubleshooting map (env, networking, compose overlay)
- `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` — credential register & rotation
- `.env.example` — canonical env reference with Phase 1/2 annotations
