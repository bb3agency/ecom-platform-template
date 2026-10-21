# Refund Lifecycle (Razorpay / prepaid orders)

> Canonical reference for how a prepaid refund moves from "order cancelled" to "money back with the customer", how failures are retried, and what the merchant sees. **Since backend-core / frontend-core 0.4.0 (2026-10-21).** Earlier behaviour is described under [History](#history-why-this-exists) so old order timelines make sense.

## 1. The money problem this solves

Razorpay pays refunds out of the merchant's **Razorpay balance** (captured money that has not yet been settled to the bank). It does **not** pull money back from the bank account.

Razorpay settles captured payments to the bank on a T+N schedule (typically ~2 working days). An order cancelled **after** settlement (courier cancels, customer cancels a slow order, admin cancels) can therefore hit a balance that is too low, and Razorpay **refuses** the refund (4xx, e.g. *"Your account does not have enough balance to carry out the refund operation."*).

That is a business answer, not an outage. The balance recovers when:
- new payments are captured, or
- the owner adds funds in the Razorpay Dashboard.

The customer is still owed the money in every case. The platform's job is to **never drop it silently**: keep retrying, show the merchant it is owed and why, and let them retry once they have topped up.

## 2. Flow

```
cancel (admin / customer / courier webhook / manual courier sync)
  └─ enqueue  refunds:initiate-razorpay-refund   (outbox → BullMQ)
       └─ refunds worker
            ├─ CAS gate: reserve amount  (payment.refundPendingAmountPaise += amount)
            │     only if payment CAPTURED/PARTIALLY_REFUNDED and refundable balance > 0
            ├─ POST Razorpay /payments/:id/refund
            │     ├─ accepted → history "Refund sent to provider (N paise) — ref rfnd_…"
            │     │              … later webhook refund.processed → payment REFUNDED, order REFUNDED,
            │     │                                                  credit note queued
            │     │              … or webhook refund.failed → release reservation, note,
            │     │                                          re-queue (back to the top)
            │     └─ failed   → release reservation (amount is refundable again)
            │                    ├─ transient (timeout / 5xx / breaker open) and fast attempts left
            │                    │      → rethrow; BullMQ retries in seconds (3 attempts total)
            │                    └─ refusal (4xx) or fast attempts exhausted
            │                           → slow automatic retry (see §3)
            └─ gate finds nothing refundable (already refunded / already with Razorpay) → job ends quietly
```

### Key files
| Concern | File |
|---|---|
| Worker (gate, provider call, retry schedule, notes, alerts) | `backend/queues/workers/refunds.worker.ts` |
| Retry schedule + note vocabulary + customer-hidden notes | `backend/src/common/payments/refund-retry-policy.ts` |
| Provider error type (code + description, `rejected` = 4xx) | `backend/src/common/errors/payment-provider-error.ts` |
| Razorpay adapter (parses error body) | `backend/src/modules/payments/adapters/razorpay.adapter.ts` |
| Circuit breaker (refusals do **not** trip it) | `backend/src/modules/payments/payment-provider.ts` |
| Webhook intake (refund entity id/amount, per-refund dedupe) | `OrdersService.processPaymentWebhook` in `backend/src/modules/orders/orders.service.ts` |
| `refund.processed` / `refund.failed` handling | `backend/queues/workers/order-processing.worker.ts` (`payment-webhook` job) |
| "Refund still owed" rule (detail + Prisma where) | `backend/src/modules/orders/refund-owed.ts` |
| Admin retry action | `OrdersService.adminRetryRefund`, route `POST /api/v1/admin/orders/:id/refund/retry` |
| Admin UI | `frontend/components/admin/AdminOrderRefundOwedNotice.tsx`, `AdminOrderTimelinePanel.tsx`, `AdminOrdersList.tsx` (Refund filter), `AdminDashboardPanels.tsx` (Needs attention) |
| History labels | `frontend/lib/order-history-event.ts` |

## 3. Automatic retry schedule

After a provider refusal, or once the 3 fast attempts are used up, the **same BullMQ job** is moved to delayed (`job.moveToDelayed` + `DelayedError`, `autoRetryRound` in job data):

| Round | Delay |
|---|---|
| 0 | 15 min |
| 1 | 1 h |
| 2 | 3 h |
| 3–13 | every 6 h |

That is ~70 h in total (labelled "3 days"). Change it only in `REFUND_AUTO_RETRY_DELAYS_MS`.

- **First failure (round 0):** one history note, `Refund failed (N paise): <provider reason>. Retrying automatically for up to 3 days.`, plus one non-terminal technical alert email to Ops + Admin, telling the owner to top up or wait for sales.
- **Later rounds:** silent. No note and no alert.
- **After the last round:** `Refund still owed (N paise) — automatic retries stopped after 3 days. Last error: <reason>. Retry from the order page.` plus a **terminal** alert. The job completes; nothing else retries it.
- **Success at any point:** `Refund sent to provider …`. The `refund.processed` webhook finalises it.

**Double-refund safety:** every run goes through the CAS gate. If an admin retry, a `refund.failed` re-queue and a delayed automatic retry all exist at once, only the run that wins the reservation calls Razorpay. The others find a refundable balance of 0 and end.

## 4. "Refund still owed"

A **derived** state with no extra column, so it cannot drift:

```
order.status = CANCELLED
payment.providerPaymentId IS NOT NULL                     (provider-paid; excludes COD)
payment.status IN (CAPTURED, PARTIALLY_REFUNDED)           (not fully refunded)
payment.refundPendingAmountPaise = 0                       (nothing currently with Razorpay)
```

Plus a 10-minute grace period after the cancel, so the normal refund job (which runs within seconds) never appears as owed.

Where it surfaces:
- **Admin order detail:** `refundOwed: { amountPaise, autoRetrying, lastError, lastFailedAt } | null`. `autoRetrying` and `lastError` come from the latest refund failure note.
- **`GET /api/v1/admin/orders?refund=owed`:** the same predicate (`refundOwedWhere()`).
- **`GET /api/v1/admin/dashboard/action-queue` → `refundsOwed`:** the same predicate, so the count always equals the list it links to.
- **Admin UI:**
  - a banner on the order page, amber while retrying and red once retries have stopped, with **Retry refund**;
  - "refunds still owed" under Needs attention;
  - a *Refund* filter on the orders list;
  - cancelled-but-paid orders labelled "Not refunded yet" in the list.

Known approximation: if an admin cancels with a **partial** refund and it fails completely, the order shows the **full** remaining amount as owed. Retry refunds the remaining balance; the confirm dialog shows the amount first.

## 5. Admin retry

`POST /api/v1/admin/orders/:id/refund/retry`:
- requires `orders:refund` and an idempotency key;
- returns 409 `CONFLICT` when nothing is owed and 404 for an unknown order;
- writes `Refund retry requested (N paise) [admin:<id>]` and queues a job with a unique id (`…:admin-retry:<uuid>`).

If that attempt fails it starts a fresh 3-day automatic schedule.

## 6. History rows

Refund rows are **events, not status changes**: `fromStatus = toStatus = the order's status at the time` (normally `CANCELLED`). The admin History panel labels them by what happened to the money:

| Note prefix | Label |
|---|---|
| `Refund sent to provider` | Refund started |
| `Refund failed` / `Refund failed at provider` | Refund failed |
| `Refund still owed` | Refund still owed |
| `Refund retry requested` | Refund retried |
| `Partial refund processed` | Partial refund |
| `Refund initiated` (pre-0.4.0) | Refund attempted (it does **not** prove the money moved) |
| `Refund processed` (status change → REFUNDED) | Refunded |

`buildOrderJourney` ignores rows where `from === to`, so a refund note never re-dates a passed stage.

**Customers never see merchant-side notes** (failures, retries, still-owed, legacy "Refund initiated"); see `isMerchantOnlyRefundNote`. They see the cancellation, then the refund once Razorpay confirms it.

## 7. Webhooks (required Razorpay subscriptions)

Required: `payment.captured`, `payment.failed`, `refund.processed`, **`refund.failed`**. Optional: `payment.authorized` (no-op).

- `refund.*` payloads carry `payload.refund.entity`; its `id` and `amount` are forwarded to the worker.
- Redis/inbox dedupe for `refund.*` is keyed by **event + refund id**, so a failed refund followed by a retried one on the same payment are both processed.

## 8. Operating it

- **"Refunds still owed" is non-zero:**
  1. Open each order; the banner shows the reason.
  2. For a low balance, add funds in Razorpay → *Account & Settings / Balances* (or wait for new sales).
  3. Click **Retry refund**.
- **Alert email "Refund for order … failed":** nothing to do if you are happy to wait. It retries for 3 days on its own.
- **Alert email "still owed after 3 days":** a person must act, as above.
- **To prove a refund went through:** the Razorpay Dashboard → Refunds, or the order turning **Refunded** (from `refund.processed`).
- **Local/dev:** `PAYMENT_PROVIDER=noop` refuses every refund with a 503. That exercises the failure path end to end: 3 fast attempts, then the slow schedule.

## History (why this exists)

Before 0.4.0 (found 2026-10-21 on a courier-cancelled Raghava order):
- The worker wrote `Refund initiated (N paise) by <actor>` **before** calling Razorpay, under the caller's `sourceStatus`. For courier cancels that was the pre-cancel status, so the timeline showed **"Shipped" after "Cancelled"**.
- Each failed attempt left another row. BullMQ's 3 attempts × 2 s/4 s backoff gave up within seconds. **Three "Refund initiated" rows = three failures, and no refund.**
- The order-processing worker's duplicate-capture guard (`providerPaymentId matches && status CAPTURED → return`) also swallowed every `refund.processed`. Even successful refunds never set the payment or order to REFUNDED.
- `refund.failed` was not handled, and refund webhook dedupe was per payment, so a second refund event on the same payment was dropped.
- A Razorpay refusal counted as a provider failure in the circuit breaker, which also guards checkout order creation.

Orders affected before the fix show up under **refunds still owed** after deploy, if they match the rule in §4. Check them in the Razorpay Dashboard before retrying.
