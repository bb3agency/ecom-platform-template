# WhatsApp Template Registry

> Full per-client Meta setup (Business Suite, app, phone, webhook, App Review, where the keys go):
> [`META_WHATSAPP_SETUP_GUIDE.md`](./META_WHATSAPP_SETUP_GUIDE.md).


Canonical definitions for the Meta WhatsApp Cloud API message templates the backend
sends. The code mapping lives in
`src/modules/notifications/whatsapp-template-registry.ts`; this doc is the human +
operator source of truth and **must be kept in sync** with it.

## Why this exists

WhatsApp business-initiated messages must use a **pre-approved template**. Two rules:

1. **Template name** — lowercase + underscores. The backend's internal names are
   PascalCase (`OrderShipped`), so the registry translates them to the Meta name
   (`order_shipped`). A mismatch returns Meta error **132001** ("template does not exist").
2. **Body parameters are positional** — `{{1}}`, `{{2}}`, … The backend sends parameter
   values in a fixed order; the approved template's placeholders must appear in that same
   order and **same count**, or Meta returns error **132000** ("number of parameters does
   not match").

Template bodies are deliberately **store-name-agnostic** — the store name is passed as
`{{1}}`, so the identical templates work for every client. `{{2}}` is always the order id.

## Operator setup (per client that enables WhatsApp)

In **WhatsApp Manager → Account tools → Message templates → Create template**, create each
template below with:

- **Category:** Utility
- **Language:** English (`en`)
- **Header / Footer / Buttons:** none (body only)
- **Body:** copy exactly, including the `{{n}}` placeholders
- **Sample values:** use the samples column (Meta requires an example for every parameter)

Then submit for review. Approval is usually minutes but can take up to 24h. Only after a
template shows **Approved** can the backend send it. To route a notification over WhatsApp,
set its entry in the notifications `primaryChannels` config to `WHATSAPP`.

## The templates

| Internal name (code) | Meta template name | Params (in order) |
|----------------------|--------------------|-------------------|
| `CustomerOtpVerification` | `otp_verify` | `{{1}}` otp code (AUTHENTICATION template — single param) |
| `OrderConfirmed`     | `order_confirmed`  | `{{1}}` storeName, `{{2}}` orderId |
| `OrderShipped`       | `order_shipped`    | `{{1}}` storeName, `{{2}}` orderId, `{{3}}` trackingInfo |
| `OutForDelivery`     | `out_for_delivery` | `{{1}}` storeName, `{{2}}` orderId |
| `OrderDelivered`     | `order_delivered`  | `{{1}}` storeName, `{{2}}` orderId |
| `OrderCancelled`     | `order_cancelled`  | `{{1}}` storeName, `{{2}}` orderId |
| `PaymentFailed`      | `payment_failed`   | `{{1}}` storeName, `{{2}}` orderId |
| `ReturnRequestUpdate` | `return_request_update` | `{{1}}` storeName, `{{2}}` orderId, `{{3}}` returnStatusLine |
| `AdminNewOrder`      | `admin_new_order`  | `{{1}}` storeName, `{{2}}` orderId, `{{3}}` customerName, `{{4}}` orderAmountLine ("Rs 450.00 - PREPAID") |
| `AdminLocalOrder`    | `admin_local_order` | `{{1}}` storeName, `{{2}}` orderId, `{{3}}` customerName, `{{4}}` orderAmountLine, `{{5}}` deliveryAddressLine ("addr — Ph: phone") |

### `admin_new_order`
**Merchant-facing alert (2026-07-04):** sent ONLY to admin users who opted in via
Admin → Settings → Notifications → "Notify me about new orders" — never to customers.
Fired at order confirmation (order-processing worker) once per opted-in admin per
selected channel. `{{4}}` is a composed "amount - payment mode" line (never empty —
falls back to "see admin panel"). Category: Utility. The old store-contact
"order shipped" alert (`enqueueMerchantShipmentNotifications`) was removed in the
same change.

### `admin_local_order`
**Merchant-facing alert (2026-07-10):** the LOCAL-DELIVERY variant of `admin_new_order`,
sent instead of it when the order's pincode is on the merchant's local-delivery whitelist
(Admin → Settings → Local Delivery). The merchant delivers these orders himself, so `{{5}}`
carries the full delivery address + customer phone. Same audience rules as
`admin_new_order` (opted-in admins only, per-admin channels). Category: Utility.
**Body:**
```
{{1}} admin: local delivery order {{2}} from {{3}} for {{4}}. You deliver this one yourself — deliver to: {{5}}. No courier will be booked; update the order status from the admin panel.
```
**Sample values:** `{{1}}` = `Raghava Organics`, `{{2}}` = `ORD-10234`, `{{3}}` = `Sita Devi`, `{{4}}` = `Rs 850.00 - COD`, `{{5}}` = `12-3-45 Main Rd, Warangal, Telangana, 506001 — Ph: 9876543210`

### `otp_verify`
**Category:** **Authentication** (Meta REJECTS verification-code content in Utility — the
"Category does not match / will be rejected" dialog forces Authentication). Authentication
templates have a Meta-fixed body and a **single** parameter — the code. The store name is
NOT in the body (Authentication forbids custom copy); it appears as the message **sender**.
Create it in WhatsApp Manager with category Authentication, button **Copy code**, optionally
"Add security recommendation" + "Add expiry time", name `otp_verify`, language English.

**Body (Meta-generated, do not hand-type):**
```
{{1}} is your verification code.
```
(plus, if enabled, "For your security, do not share this code." and an expiry line.)
**Sample value:** `{{1}}` = `123456`

> **Send payload is special:** the adapter sends the code in BOTH a `body` component param
> AND a `button` component (`sub_type: 'url'`, `index: 0`) that echoes the same code —
> required for Authentication templates. Driven by `authentication: true` on the registry
> descriptor; ordinary templates keep the plain body-params path.

### `order_confirmed`
**Body:**
```
Thank you for shopping with {{1}}! Your order {{2}} is confirmed and is now being prepared for dispatch. We'll notify you as soon as it ships.
```
**Sample values:** `{{1}}` = `Raghava Organics`, `{{2}}` = `ORD-10234`

> **Meta rule:** a template body may not **start or end** with a `{{n}}` variable. The
> bodies below reflect the actually-approved wording (a `Hi! ` prefix / restructure was
> applied to satisfy this). This is dashboard text only — the backend sends positional
> parameter *values*, never the body, so wording changes that keep the param count/order
> do not require a code change.

### `order_shipped`
**Body:**
```
Good news from {{1}} — your order {{2}} has been shipped! Track your delivery here: {{3}} Happy shopping!
```
**Sample values:** `{{1}}` = `Raghava Organics`, `{{2}}` = `ORD-10234`, `{{3}}` = `https://track.example.com/ORD-10234`

### `out_for_delivery`
**Body:**
```
Hi! {{1}}: Your order {{2}} is out for delivery today! Please keep your phone reachable so our courier can reach you.
```
**Sample values:** `{{1}}` = `Raghava Organics`, `{{2}}` = `ORD-10234`

### `order_delivered`
**Body:**
```
Hi! {{1}}: Your order {{2}} has been delivered. We hope you love it! Thank you for shopping with us.
```
**Sample values:** `{{1}}` = `Raghava Organics`, `{{2}}` = `ORD-10234`

### `order_cancelled`
**Body:**
```
Hi! {{1}}: Your order {{2}} has been cancelled. If you paid online, your refund will be processed within 5-7 business days. Reach out to support if you need any help.
```
**Sample values:** `{{1}}` = `Raghava Organics`, `{{2}}` = `ORD-10234`

### `payment_failed`
**Body:**
```
Hi! {{1}}: We couldn't process the payment for your order {{2}}. Please retry the payment from your order page to avoid cancellation.
```
**Sample values:** `{{1}}` = `Raghava Organics`, `{{2}}` = `ORD-10234`

### `return_request_update`
**Category:** Utility. Covers every return lifecycle stage — the stage-specific wording
travels in `{{3}}` (composed by the backend from the return status), so ONE approved
template serves approved / declined / picked-up / refunded.
**Body:**
```
Hi! {{1}}: Update on your return request for order {{2}}: {{3}}. You can see the full details on your account orders page.
```
**Sample values:** `{{1}}` = `Raghava Organics`, `{{2}}` = `ORD-K4MQ-2F9X`, `{{3}}` = `approved — our team will arrange the pickup of your items`

## Changing a template

If you change the wording **without** changing the number/order of `{{n}}` placeholders,
just edit the template in WhatsApp Manager and re-submit — no code change. If you add,
remove, or reorder a parameter, you **must** update both the body here, the
`params` array in `whatsapp-template-registry.ts`, and the approved template together, or
sends will fail with error 132000.
