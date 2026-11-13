# Shipment Booking Lifecycle (Delhivery / Shiprocket)

> Canonical reference for how an admin "Ship" becomes a courier booking (AWB), and how a booking that was **in flight when a worker crashed or stalled** is recovered without double-booking. Follows on from be-rel-02 (AWB persisted before Phase 3).

## 1. The problem this solves

The courier call is an external HTTP request. If the shipping worker crashes, is killed (deploy, OOM) or stalls **after the courier accepted the booking but before we stored the AWB**, the courier holds a live shipment and our database holds nothing. Before this change a retry booked again: the merchant paid for two AWBs (or one orphaned label), and Shiprocket could hold two orders for one of ours.

be-rel-02 already closed the gap *after* the AWB is stored (a retry resumes Phase 3 from the stored booking). This document covers the gap *during* the courier call.

## 2. The client reference

Every booking carries **our order number** (`Order.orderNumber`, unique, deterministic) as the courier-side reference:

| Courier | Field we send | How we look it up |
|---|---|---|
| Shiprocket | `order_id` (channel order id) on `/orders/create/adhoc` | `GET /orders?search=<orderNumber>`; only exact `channel_order_id` matches count (search is fuzzy) |
| Delhivery | `order` on `/api/cmu/create.json` | `GET /api/v1/packages/json/?ref_ids=<orderNumber>` |

Lookups are `findShipmentByReference(clientReference)` on the adapters (optional interface method, passed through the circuit breaker). They answer `found` (with or without an AWB), `cancelled`, or `not_found`, and **throw** whenever the answer is not definite (auth error, timeout, unexpected shape). Callers never book on a thrown lookup.

## 3. The booking intent

No schema change. The intent reuses the existing `Shipment` row:

| Column | Intent value |
|---|---|
| `status` | `PENDING` |
| `awbNumber` | `null` |
| `provider` | the locked provider (or the env-default provider for legacy unlocked orders) |
| `updatedAt` | heartbeat, bumped by every create-shipment attempt |
| `webhookPayload.bookingIntent` | `{ clientReference, startedAt, sweepRequeues }` |

The successful booking write (Phase 2b) turns the same row into `BOOKED` with the AWB and overwrites `webhookPayload` with the provider payload.

Helpers: `backend/src/common/shipping/booking-intent.ts`.

## 4. create-shipment flow

```
create-shipment job
  ├─ Phase 1  validate order (shippable status, not LOCAL, address, weights, payment)
  ├─ shipment has AWB + BOOKED      → resume Phase 3 only (be-rel-02), no courier call
  ├─ shipment is a booking intent   → findShipmentByReference(orderNumber)
  │     ├─ found with AWB           → ADOPT: persist as BOOKED, Phase 3, no courier call
  │     ├─ found without AWB        → Shiprocket order exists, AWB never assigned:
  │     │                               book with existingProviderOrder → assign AWB only
  │     ├─ cancelled                → throw (sweep releases the intent)
  │     ├─ not_found                → continue and book
  │     └─ lookup throws            → throw; BullMQ retries; NOTHING is booked
  ├─ Phase 2a write/refresh intent  (CAS on awbNumber = null, so a stored booking is never demoted)
  ├─ Phase 2  courier call          (Shiprocket order_id / Delhivery order = orderNumber)
  ├─ Phase 2b persist booking       (intent row → BOOKED + AWB, Shiprocket order id on Order)
  └─ Phase 3  CAS order → SHIPPED + notify, or compensating cancel if cancelled meanwhile
```

A fresh first attempt does not look anything up (no intent exists yet), so courier lookup availability never blocks a normal booking.

## 5. Stale-intent sweep (`reconcile-booking-intents`)

A repeatable shipping job, every **10 min**, registered by `queues/workers/index.ts` whenever Shiprocket **or** Delhivery credentials are present. It examines up to 25 intents untouched for **15 min** (well beyond the 3-attempt create-shipment retry window), oldest first:

| Courier lookup | Order still CONFIRMED/PROCESSING | Order no longer shippable |
|---|---|---|
| found with AWB | adopt, persist BOOKED, Phase 3 (ships + notifies) | adopt, then compensating cancel at the courier |
| found without AWB (Shiprocket) | re-enqueue create-shipment (resumes AWB assignment) | cancel the Shiprocket order, release the intent |
| not_found | re-enqueue create-shipment via the outbox (jobId `create-shipment-<orderId>-intent-sweep-<n>`) | release the intent |
| cancelled | release the intent + alert | release the intent + alert |
| lookup throws | alert; nothing booked or released; retried next sweep | same |

Re-enqueues are capped at **3** per intent (`sweepRequeues`). After that, with nothing at the courier, the intent is released and an alert (`ShipmentBookingIntent`) tells the merchant to re-ship from admin. A Shiprocket order without an AWB is never released automatically after the cap (re-shipping would create a duplicate Shiprocket order): it alerts for manual action.

"Release" deletes the PENDING, AWB-less row with a compare-and-set, so the admin **Ship** action becomes available again.

## 6. What the merchant sees

- While an intent exists the admin order shows *"Shipment booking is in progress."* and **Ship** is disabled (`resolveShipActionState`), so a second click cannot start a parallel booking.
- Adopted bookings look like any other booking: AWB, tracking link, `SHIPPED`, customer "shipped" notification.
- Alerts (technical-failure email to Ops/Admin) fire for lookup failures, cancelled-at-courier releases, exhausted requeues and bookings that need manual action at the courier.

## 7. Limits

- Two create-shipment jobs for the same order running **at the same moment** can still both see "not found" before either booking lands. The disabled Ship action and the 15-minute stale window make this unlikely; it is not fully excluded.
- Courier lookup endpoints are read-only and cheap, but their response shapes are parsed defensively: any unrecognised answer is treated as a failed lookup (no booking), never as "not found".
- Legacy orders with no locked provider and no `SHIPPING_PROVIDER` env value book without an intent (previous behaviour).

## Key files
| Concern | File |
|---|---|
| Worker phases, adoption, sweep | `backend/queues/workers/shipping.worker.ts` |
| Intent helpers + timings | `backend/src/common/shipping/booking-intent.ts` |
| Adapter lookup contract | `backend/src/common/interfaces/shipping-provider.interface.ts` (`findShipmentByReference`, `existingProviderOrder`) |
| Shiprocket lookup + AWB-only resume | `backend/src/modules/shipping/adapters/shiprocket.adapter.ts` |
| Delhivery lookup | `backend/src/modules/shipping/adapters/delhivery.adapter.ts` |
| Sweep schedule | `backend/queues/workers/index.ts` |
| Ship button state | `backend/src/modules/orders/orders.service.ts` (`resolveShipActionState`) |
