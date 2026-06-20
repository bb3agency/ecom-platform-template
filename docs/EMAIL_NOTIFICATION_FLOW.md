# Email Notification Flow — Verification Checklist

**Status:** ✅ Verified & Complete (2026-06-12)

> This document traces the complete email notification flow from order creation through delivery, including all trigger points, enqueue mechanisms, worker processing, and failure handling.

---

## 1. Notification Triggers & Enqueue Points

### A. Order Confirmation (`OrderConfirmed`)
- **Trigger:** Order created via `POST /api/v1/orders`
- **Worker:** `order-processing.worker.ts` (handles confirmation logic)
- **Enqueue Point:** Line 782-791 in `order-processing.worker.ts`
- **Condition:** `if (sideEffectsTarget.user.email || sideEffectsTarget.user.phone)`
- **Data Passed:** `orderId`, `orderNumber`, `providerOrderId`
- **Queue Name:** `notifications` / Job: `send-primary`
- **Dedup Key:** `notifications:primary:{orderId}:OrderConfirmed`
- **Status:** ✅ Active

### B. Payment Failed (`PaymentFailed`)
- **Trigger:** Payment capture fails for prepaid orders
- **Worker:** `order-processing.worker.ts` (payment reconciliation)
- **Enqueue Point:** Line 478-484 in `order-processing.worker.ts`
- **Condition:** Enqueued when payment fails, customer has email/phone
- **Data Passed:** `orderId`, `orderNumber`, `providerOrderId`
- **Queue Name:** `notifications` / Job: `send-primary`
- **Dedup Key:** `notifications:primary:{orderId}:PaymentFailed`
- **Status:** ✅ Active

### C. Order Shipped (`OrderShipped`)
- **Trigger:** Shiprocket webhook `BOOKED` status → shipment created
- **Worker:** `shipping.worker.ts` (webhook handler)
- **Enqueue Point:** Line 502-517 & 685-695 in `shipping.worker.ts`
- **Condition:** `if (userEmail || userPhone)` (from order.user)
- **Data Passed:** `orderId`, `orderNumber`, `awb`, `trackingUrl`, `estimatedDeliveryText`
- **Queue Name:** `notifications` / Job: `send-primary`
- **Dedup Key:** `shipping:primary:{orderId}:shipped`
- **Status:** ✅ Active

### D. Out for Delivery (`OutForDelivery`)
- **Trigger:** Shiprocket webhook `OUT_FOR_DELIVERY` status
- **Worker:** `shipping.worker.ts`
- **Enqueue Point:** Line 697-706 in `shipping.worker.ts`
- **Condition:** `if (nextShipmentStatus === 'OUT_FOR_DELIVERY' && (phone || email))`
- **Data Passed:** `orderId`, `awb`, `trackingUrl`, `estimatedDeliveryText`
- **Queue Name:** `notifications` / Job: `send-primary`
- **Dedup Key:** `shipping:primary:{orderId}:out-for-delivery`
- **Status:** ✅ Active

### E. Order Delivered (`OrderDelivered`)
- **Trigger:** Shiprocket webhook `DELIVERED` status
- **Worker:** `shipping.worker.ts`
- **Enqueue Point:** Line 755-765 in `shipping.worker.ts`
- **Condition:** `if (email || phone)` after COD payment capture (if applicable)
- **Data Passed:** `orderId`, `awb`
- **Queue Name:** `notifications` / Job: `send-primary`
- **Dedup Key:** `shipping:primary:{orderId}:delivered`
- **Status:** ✅ Active

### F. Order Cancelled (`OrderCancelled`)
- **Trigger:** Admin calls `DELETE /api/v1/admin/orders/{id}/cancel` OR system cancels order
- **Service:** `orders.service.ts` → `private enqueueOrderCancelledNotifications()`
- **Enqueue Point:** Line 3055-3065 in `orders.service.ts`
- **Condition:** `if (!email && !phone) return;` (graceful skip if no contact)
- **Data Passed:** `orderId`
- **Queue Name:** `notifications` / Job: `send-primary`
- **Dedup Key:** `notifications:primary:{orderId}:OrderCancelled`
- **Status:** ✅ Active

---

## 2. Queue & Worker Processing

### Outbox Pattern
All notifications use the **outbox pattern** for durability:
1. Message written to `OutboxMessage` table as `PENDING`
2. Worker processes from outbox, forwards to BullMQ `notifications` queue
3. Notification worker picks up job from queue
4. After processing, outbox record marked `PROCESSED`

**Files:**
- `queues/workers/outbox-dispatch.worker.ts` — dispatches outbox → queue
- `queues/workers/notifications.worker.ts` — final delivery

### Notification Worker (`send-primary` Handler)
**Location:** `queues/workers/notifications.worker.ts:476-604`

**Flow:**
```
send-primary job arrives
  ↓
1. Resolve runtime config (FEATURE flags, Resend API key, SMS provider)
2. Determine primary channel (EMAIL, SMS, or WHATSAPP) from flags
3. If EMAIL:
   a. Validate customer email exists (graceful skip if missing)
   b. Check email enabled & Resend credentials available
   c. Send via ResendAdapter.sendEmail()
   d. Log to NotificationLog table (SENT or FAILED)
   e. Fire technical alert if failure
4. Return or throw UnrecoverableError
```

**Key Checkpoints:**
- ✅ Email address validation: Line 513-524 (graceful skip if missing)
- ✅ Provider credentials check: Line 527-555 (throws UnrecoverableError if missing)
- ✅ ResendAdapter initialization: Line 558-561
- ✅ Email sending: Line 562-566
- ✅ Notification logging: Line 568-577 or 581-589
- ✅ Failure alerts: Line 591-601

---

## 3. Customer Data Requirements

### Must Have
For email to be sent, the customer record **must have**:
- `user.email` field populated (not null, not empty)

### Already Verified in Code
- ✅ OrderConfirmed: Checks `if (sideEffectsTarget.user.email || sideEffectsTarget.user.phone)`
- ✅ OrderShipped: Checks `if (userEmail || userPhone)`
- ✅ OutForDelivery: Checks `if (nextShipmentStatus === 'OUT_FOR_DELIVERY' && (phone || email))`
- ✅ OrderDelivered: Checks `if (email || phone)`

**Graceful Fallback:**
If customer has phone but no email:
- Notification worker will log as `FAILED` with message: `"No email address for customer — notification skipped"`
- **No error alert is fired** (intentional — not a configuration problem)
- SMS fallback can be used if SMS is the primary channel

---

## 4. Configuration Requirements (Ops Level)

### Required Environment Variables (`.env` Bootstrap)
```bash
# Email notifications
NOTIFY_EMAIL_ENABLED=true          # Feature flag (boolean)
RESEND_API_KEY=re_xxxx...          # Resend API key
RESEND_FROM=noreply@yourdomain.com # From address
```

### Storage: Ops DB Config (Encrypted)
- `RESEND_API_KEY` and `RESEND_FROM` are stored in `OpsConfigSecret` table
- Encrypted at rest with `OPS_DB_ENCRYPTION_KEY`
- Loaded at runtime via `resolveRuntimeConfig()` in notification worker

### Verification Steps
1. **Check backend `.env`:**
   ```bash
   grep NOTIFY_EMAIL_ENABLED .env
   grep RESEND_API_KEY .env  # Should NOT be here (DB-backed)
   ```

2. **Check Ops config:**
   - Login to `/ops` console
   - Navigate to **Config** → **Stored**
   - Verify `RESEND_API_KEY` and `RESEND_FROM` are present (shown as masked `••••••`)

3. **Health check:**
   ```bash
   curl http://localhost:3000/api/v1/health
   # Should show "status": "ok", "db": "connected", "redis": "connected"
   ```

---

## 5. Failure Handling & Alerts

### Notification Worker Failures

| Failure Type | Handler | Alert Fired? | Recoverable? |
|--------------|---------|--------------|--------------|
| Missing email (phone-only customer) | Graceful skip | ❌ No | N/A (by design) |
| Email disabled via feature flag | Throws UnrecoverableError | ✅ Yes | ❌ Requires config fix |
| Resend API key missing/invalid | Throws UnrecoverableError | ✅ Yes | ❌ Requires config fix |
| Resend API returns error | Logs failure + fires alert | ✅ Yes | ✅ Retries (BullMQ) |
| Outbox dispatch fails | Worker logs & retries | ✅ Yes | ✅ Retries (outbox pattern) |

### Alert Mechanism
**File:** `src/modules/notifications/notification-failure-alert.ts`

When email fails:
1. **Technical alert** sent to all active Ops + Admin users via email
2. Email subject: `[ALERT] Notification delivery failed`
3. Details: Template, recipient, error message, failure stage
4. Rate-limited: 1 alert per (channel, provider, error) combo per 15 minutes (dedup)

**Requirement:** At least one active Ops or Admin user must exist in DB for alerts to be sent.

---

## 6. Testing the Flow Locally

### Prerequisites
```bash
# 1. Start backend
npm run dev:e2e &
npm run dev:e2e:workers &

# 2. Verify health
curl http://localhost:3000/api/v1/health

# 3. Create test customer with email
POST /api/v1/auth/register
{
  "phone": "+91XXXXXXXXXX",
  "email": "test@example.com",  // REQUIRED for email notifications
  "password": "TestPass123!",
  "name": "Test User"
}

# 4. Get auth token
POST /api/v1/auth/verify-otp
→ accessToken

# 5. Add product & create order
POST /api/v1/cart/items
POST /api/v1/checkout/pincode-check
POST /api/v1/orders (paymentMode: "COD" for simplicity)
```

### Verification
1. **Check notification was queued:**
   ```sql
   SELECT * FROM "OutboxMessage" 
   WHERE "queueName" = 'notifications' 
   AND "payload"->>'template' = 'OrderConfirmed'
   ORDER BY "createdAt" DESC LIMIT 1;
   ```

2. **Check notification was dispatched:**
   ```sql
   SELECT * FROM "NotificationLog" 
   WHERE "template" = 'OrderConfirmed'
   ORDER BY "createdAt" DESC LIMIT 1;
   ```
   - Should show `"status": "SENT"` or `"status": "FAILED"`
   - If FAILED, check `"errorMessage"` field

3. **Check Resend logs (if using real API):**
   - Login to Resend dashboard
   - Verify email appears in **Emails** or **Logs** section
   - Check delivery status (Delivered, Bounce, Spam, etc.)

---

## 7. Known Limitations & Workarounds

### Phone-Only Customers
- **Issue:** Customers who registered via phone OTP have no email on file
- **Behavior:** OrderConfirmed will be enqueued but marked as FAILED (graceful)
- **Workaround:** Collect email via customer profile update, then retrigger notification
  ```bash
  PATCH /api/v1/users/profile { "email": "customer@example.com" }
  POST /api/v1/admin/orders/:id/notifications/retrigger
  ```

### Resend Rate Limits
- **Limit:** 100 emails/second per account
- **Backoff:** BullMQ auto-retries with exponential backoff
- **Alert:** If hitting limits, will fire technical alert every 15 min

### Cold Outbox Dispatch
- If worker crashes, outbox messages persist in DB
- When worker restarts, it processes all PENDING messages
- No email is lost, but may be delayed

---

## 8. Production Checklist

Before going live, verify:

- [ ] **Ops config set:**
  - [ ] `RESEND_API_KEY` populated (production key, not test)
  - [ ] `RESEND_FROM` set to valid from-address (e.g., `noreply@raghava-organics.com`)
  - [ ] `NOTIFY_EMAIL_ENABLED = true`

- [ ] **Database health:**
  - [ ] At least 1 active Ops user exists (for failure alerts)
  - [ ] At least 1 active Admin user exists (for failure alerts)

- [ ] **Customer data:**
  - [ ] Email is captured during checkout or registration
  - [ ] Email field is non-null before order placement

- [ ] **Test flow end-to-end:**
  - [ ] Place test order with valid email
  - [ ] Verify OrderConfirmed email received
  - [ ] Admin ships order (or simulate Shiprocket webhook)
  - [ ] Verify OrderShipped email received

- [ ] **Failure alerts working:**
  - [ ] Temporarily disable Resend API key
  - [ ] Place order → should fire alert email to Ops/Admin users
  - [ ] Re-enable key

- [ ] **Monitoring:**
  - [ ] Grafana: Check notification delivery metrics
  - [ ] BullMQ Board: Verify no jobs stuck in `failed` queue
  - [ ] Database: Periodic check of `NotificationLog` for FAILED status spikes

---

## 9. Quick Reference: Notification Table

| Template | Trigger | Email Sent When | Contains |
|----------|---------|-----------------|----------|
| **OrderConfirmed** | Order placed | Order created in DB | Order #, Items, Total, Tracking link (if applicable) |
| **PaymentFailed** | Razorpay fails | Payment capture fails | Order #, Error reason, Retry link |
| **OrderShipped** | Webhook BOOKED | Shipment confirmed with AWB | Order #, AWB, Tracking URL, Est. Delivery |
| **OutForDelivery** | Webhook OUT_FOR_DELIVERY | Shipment left courier hub | Order #, AWB, Tracking URL, Est. Delivery |
| **OrderDelivered** | Webhook DELIVERED | Delivered per Shiprocket | Order #, AWB, Invoice link (if hasPdf) |
| **OrderCancelled** | Admin cancel / auto-cancel | Order cancelled | Order #, Cancellation reason |

---

## 10. Support & Debugging

### Email Not Received?

1. **Check NotificationLog:**
   ```sql
   SELECT * FROM "NotificationLog" 
   WHERE "recipient" = 'customer@example.com' 
   ORDER BY "createdAt" DESC LIMIT 5;
   ```
   - If status is `FAILED`, see errorMessage

2. **Check customer email:**
   ```sql
   SELECT "email" FROM "User" WHERE "id" = '<userId>';
   ```
   - Must be non-null and valid format

3. **Check feature flags & config:**
   - Admin console → **Settings** → **Notifications**
   - Verify `NOTIFY_EMAIL_ENABLED = true`
   - Check `/ops` config for `RESEND_API_KEY` (masked display)

4. **Check BullMQ queue:**
   - Visit `http://localhost:3000/admin/queues/notifications` (Bull Board)
   - Look for stuck jobs in `active`, `waiting`, or `failed` queues

5. **Check Resend dashboard:**
   - Login to Resend.com account
   - Verify emails appear in **Emails** or **Bounces** section
   - Check bounce/spam reason if delivery failed

### Getting Help
- **Backend logs:** `npm run dev:e2e` console — watch for `send-primary` job logs
- **Notification worker logs:** `npm run dev:e2e:workers` console
- **Technical alerts:** Check email inbox for alerts to Ops/Admin users
- **Database:** `NotificationLog` table has complete audit trail per email

---

**Last Updated:** 2026-06-12  
**Status:** ✅ Production Ready  
**Verified By:** Development & CI gates  
**Next Review:** After first live orders
