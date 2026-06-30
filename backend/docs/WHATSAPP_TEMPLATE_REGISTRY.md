# WhatsApp Template Registry

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
| `OrderConfirmed`     | `order_confirmed`  | `{{1}}` storeName, `{{2}}` orderId |
| `OrderShipped`       | `order_shipped`    | `{{1}}` storeName, `{{2}}` orderId, `{{3}}` trackingInfo |
| `OutForDelivery`     | `out_for_delivery` | `{{1}}` storeName, `{{2}}` orderId |
| `OrderDelivered`     | `order_delivered`  | `{{1}}` storeName, `{{2}}` orderId |
| `OrderCancelled`     | `order_cancelled`  | `{{1}}` storeName, `{{2}}` orderId |
| `PaymentFailed`      | `payment_failed`   | `{{1}}` storeName, `{{2}}` orderId |

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

## Changing a template

If you change the wording **without** changing the number/order of `{{n}}` placeholders,
just edit the template in WhatsApp Manager and re-submit — no code change. If you add,
remove, or reorder a parameter, you **must** update both the body here, the
`params` array in `whatsapp-template-registry.ts`, and the approved template together, or
sends will fail with error 132000.
