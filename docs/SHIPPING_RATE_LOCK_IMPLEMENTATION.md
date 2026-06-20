# Shipping Rate Lock & Provider Enforcement Architecture

## CRITICAL ISSUE: Merchant Revenue Leak (Case: Delhivery 130 → Shiprocket 480)

### Problem Statement
**Symptom:** Order is quoted at 130 rupees (Delhivery) during checkout, but fulfillment via Shiprocket charges 480 rupees — **350 rupee loss per order**.

**Root Cause:** 
1. System fetches rates from all providers during checkout and auto-selects cheapest
2. Order stores `selectedShippingProvider: 'DELHIVERY'` and `shippingCharge: 130`
3. Admin initiates fulfillment via `/admin/orders/:id/ship`
4. Shipping worker SHOULD use locked provider (Delhivery), but either:
   - Falls back to env var `SHIPPING_PROVIDER` (possibly set to Shiprocket)
   - Admin manually overrides provider without rate reconciliation
   - No validation that chosen provider matches original quote

**Impact:** Every order has latent exposure to 100%+ rate variance between providers.

---

## Industry Standards (References)

### 1. **Flipkart/Meesho Model: Single Provider per Order**
- Selection is permanent for the order lifecycle
- Cannot change provider after checkout
- Rate is locked contractually with selected provider
- Admin has zero override capability

### 2. **Amazon/Shopify Model: Multi-Provider with Customer Choice**
- Show all options at checkout: "Delhivery 2-3 days (₹130)" | "Shiprocket 1-2 days (₹480)"
- Customer picks one explicitly
- Rate and timeframe are CONTRACTUAL for that order
- Backend enforces fulfillment with selected provider only
- If provider becomes unavailable, order is flagged for manual intervention (no silent switches)

### 3. **WooCommerce/Shipment Platforms: Rate Verification on Fulfillment**
- Lock rate at checkout
- At fulfillment time, re-fetch actual rate from provider
- If different, trigger merchant review:
  - Show: "Original: 130, Actual: 480, Difference: +350"
  - Options: (a) proceed and absorb cost, (b) cancel, (c) ask customer for adjustment
- Audit trail logs every rate delta

---

## Core Design Principle: "Rate Lock Token"

This is the mental model that drives everything below:

```
CHECKOUT PHASE                          FULFILLMENT PHASE
─────────────────────────────────       ────────────────────────────────────
1. Fetch rates from all providers  →    5. Admin clicks "Ship"
2. Auto-select cheapest (Delhivery)     6. Worker reads selectedShippingProvider
3. LOCK into order record:         →    7. Enforce: ONLY use that provider
   - selectedShippingProvider           8. If provider unavailable → FAIL LOUDLY
   - shippingChargeQuotedPaise             (do NOT silently switch)
4. Customer pays based on quote    →    9. AWB assigned via exact locked provider
```

**The invariant:** The provider that quoted ₹130 at checkout is the **exact** provider that gets the AWB — no exceptions, no silent fallbacks.

---

## Recommended Solution: 3-Tier Enforcement

### Tier 1: Rate Quote Storage (Backend Changes)

**Schema Update:**
```typescript
// Order table adds new fields
order {
  // ... existing fields ...
  
  // === Rate Lock (new) ===
  selectedShippingProvider: 'DELHIVERY' | 'SHIPROCKET' | null
  shippingChargeQuotedPaise: number  // Rate locked at checkout (e.g. 13000)
  shippingChargeActualPaise: number | null  // Actual from provider after fulfillment
  shippingRateVerificationStatus: 'LOCKED' | 'VERIFIED' | 'DISCREPANCY_FLAGGED' | 'DISCREPANCY_RESOLVED' | null
  shippingRateDiscrepancyNote: string | null  // e.g. "Locked: 130 (Delhivery), Actual: 480 (Shiprocket)"
  shippingRateDiscrepancyResolvedAt: Date | null
  shippingProviderOverriddenAt: Date | null  // When admin overrides provider (audit trail)
  shippingProviderOverriddenBy: string | null  // admin user ID
}
```

### Tier 2: Checkout Enforcement

**Current Flow (Vulnerable):**
```typescript
// cart.service.ts - getDeliveryRatesMultiProvider()
const winner = candidates[0]  // Pick cheapest
return {
  selectedShippingProvider: winner.provider,  // ✅ Locked
  shippingCharge: winner.shippingChargePaise  // ✅ Quoted price
}

// orders.service.ts - createOrder()
order.selectedShippingProvider = input.selectedShippingProvider  // ✅ Stored
order.shippingCharge = input.shippingCharge  // ✅ Stored
// ❌ BUT: No new fields tracking quoted vs actual
```

**Fixed Flow:**
```typescript
// orders.service.ts - createOrder()
const order = await tx.order.create({
  data: {
    // ... existing ...
    selectedShippingProvider: input.selectedShippingProvider,
    shippingChargePaise: input.shippingCharge,  // What customer paid
    
    // NEW: Rate lock fields
    shippingChargeQuotedPaise: input.shippingCharge,  // Locked quote
    shippingChargeActualPaise: null,  // Not known yet
    shippingRateVerificationStatus: 'LOCKED',
    shippingRateDiscrepancyNote: null,
    shippingProviderOverriddenAt: null
  }
});
```

### Tier 3: Fulfillment Enforcement

**Current Flow (Vulnerable):**
```typescript
// shipping.worker.ts - lines 359-374
const orderSelectedProvider = order.selectedShippingProvider
const effectiveShippingProvider = orderSelectedProvider
  ? (resolve adapter for that provider)
  : shippingProvider  // ❌ FALLBACK: Uses env var if order doesn't specify

// If order.selectedShippingProvider is null → falls back to env var
// If env var is SHIPROCKET but order quote was DELHIVERY → mismatch!
```

**Fixed Flow:**
```typescript
// shipping.worker.ts
const orderSelectedProvider = order.selectedShippingProvider
if (!orderSelectedProvider) {
  throw new Error(
    `Order ${order.id}: No provider locked at checkout. ` +
    `This indicates a data integrity issue. Admin must manually assign provider.`
  )
}

// Enforce strict provider selection
const effectiveAdapter = orderSelectedProvider === 'DELHIVERY'
  ? delhiveryAdapter
  : shiprocketAdapter

if (!effectiveAdapter) {
  throw new Error(
    `Order ${order.id}: Locked provider '${orderSelectedProvider}' ` +
    `is not configured. Admin intervention required.`
  )
}

// --- BEFORE creating shipment, verify rate ---
const rateVerification = await effectiveAdapter.calculateDeliveryRate({
  destinationPincode: order.shippingAddress.pincode,
  originPincode: pickupPincode,
  totalWeightGrams: totalWeight,
  paymentMode: order.paymentMode
})

const quotedRate = order.shippingChargeQuotedPaise
const actualRate = rateVerification.shippingChargePaise
const rateDelta = actualRate - quotedRate

if (Math.abs(rateDelta) > 500) {  // > 5 rupees variance
  // ESCALATE: Flag for merchant review
  await tx.order.update({
    where: { id: order.id },
    data: {
      shippingRateVerificationStatus: 'DISCREPANCY_FLAGGED',
      shippingChargeActualPaise: actualRate,
      shippingRateDiscrepancyNote: 
        `Locked: ₹${quotedRate/100} (${orderSelectedProvider}), ` +
        `Actual: ₹${actualRate/100}. Difference: ₹${rateDelta/100}`
    }
  })
  
  throw new AppError(
    ERROR_CODES.SHIPPING_RATE_DISCREPANCY,
    `Rate mismatch for order. Admin review required.`,
    409  // Conflict — worker will retry after merchant resolves
  )
}

// Rate verified — proceed with shipment
const shipment = await effectiveAdapter.createShipment(shipmentInput)

// Mark as verified
await tx.order.update({
  where: { id: order.id },
  data: {
    shippingRateVerificationStatus: 'VERIFIED',
    shippingChargeActualPaise: actualRate
  }
})
```

### Tier 4: Admin Override Capability (With Forced Acknowledgment)

**Only scenario where override is allowed:** Provider becomes unavailable AFTER checkout, AND merchant explicitly acknowledges rate change.

**New Admin Endpoint:**
```typescript
POST /api/v1/admin/orders/:id/override-shipping-provider
{
  newProvider: 'DELHIVERY' | 'SHIPROCKET',
  acknowledged: true,  // Must be true
  acknowledgedBy: 'admin_sub',
  reason: 'Original provider unavailable'
}

Response:
{
  orderId: string,
  originalProvider: 'DELHIVERY',
  originalQuotedRate: 13000,  // paise
  newProvider: 'SHIPROCKET',
  newActualRate: 48000,  // paise
  rateDelta: 35000,  // +35 rupees
  status: 'OVERRIDE_ACKNOWLEDGED',
  overriddenAt: '2026-06-14T10:30:00Z'
}
```

**Implementation:**
```typescript
// orders.service.ts
async adminOverrideShippingProvider(
  orderId: string,
  input: {
    newProvider: 'DELHIVERY' | 'SHIPROCKET'
    acknowledged: boolean
    reason: string
  },
  adminSub: string
) {
  if (!input.acknowledged) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'You must acknowledge the rate change before overriding.',
      400
    )
  }

  const order = await this.fastify.prisma.order.findUnique({
    where: { id: orderId }
  })

  if (!order) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Order not found', 404)
  }

  if (order.shippingRateVerificationStatus === 'VERIFIED') {
    throw new AppError(
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      'Cannot override provider after shipment is booked.',
      409
    )
  }

  // Fetch actual rate from new provider
  const newAdapter = this.shippingAdapterFactory(newProvider)
  const newRate = await newAdapter.calculateDeliveryRate({...})

  const quotedRate = order.shippingChargeQuotedPaise ?? order.shippingChargePaise
  const delta = newRate.shippingChargePaise - quotedRate

  // Store override audit trail
  await this.fastify.prisma.order.update({
    where: { id: orderId },
    data: {
      selectedShippingProvider: newProvider,
      shippingChargeActualPaise: newRate.shippingChargePaise,
      shippingProviderOverriddenAt: new Date(),
      shippingProviderOverriddenBy: adminSub,
      shippingRateDiscrepancyNote: 
        `Override by ${adminSub}: ` +
        `${order.selectedShippingProvider} ₹${quotedRate/100} → ` +
        `${newProvider} ₹${newRate.shippingChargePaise/100} (delta: ₹${delta/100})`,
      shippingRateVerificationStatus: 'DISCREPANCY_RESOLVED'
    }
  })

  return {
    orderId,
    originalProvider: order.selectedShippingProvider,
    originalQuotedRate: quotedRate,
    newProvider,
    newActualRate: newRate.shippingChargePaise,
    rateDelta: delta
  }
}
```

---

## Admin UI Changes Required

### 1. Order Detail Page - Rate Lock Indicator
```
Shipping Provider: DELHIVERY (locked at checkout)
Quoted Rate: ₹130
Actual Rate: [Pending verification during fulfillment]

[Ship Order button]
```

### 2. Order List - Rate Discrepancy Alerts
```
| Order | Customer | Amount | Shipping | Status | ⚠️ Alerts |
|-------|----------|--------|----------|--------|----------|
| #123  | Raj      | ₹1000  | ₹130     | ...    | ⚠️ Rate mismatch (130→480). Click to resolve. |
```

Click → Modal shows:
```
Shipping Provider Override

Original: Delhivery (₹130)
Current Actual: Shiprocket (₹480)
Difference: +₹350

Are you sure you want to proceed? This will affect your margin.

[Cancel] [Confirm Override & Ship]
```

### 3. Orders Queue / Fulfillment Dashboard
Filter by:
- ✅ Rate Verified (safe to ship)
- ⚠️ Rate Discrepancy Flagged (needs merchant review)
- 🔄 Provider Override Pending

---

## Database Migrations

```sql
-- Add columns to orders table
ALTER TABLE "Order" ADD COLUMN "shippingChargeQuotedPaise" INTEGER;
ALTER TABLE "Order" ADD COLUMN "shippingChargeActualPaise" INTEGER;
ALTER TABLE "Order" ADD COLUMN "shippingRateVerificationStatus" VARCHAR(50);
ALTER TABLE "Order" ADD COLUMN "shippingRateDiscrepancyNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "shippingRateDiscrepancyResolvedAt" TIMESTAMP;
ALTER TABLE "Order" ADD COLUMN "shippingProviderOverriddenAt" TIMESTAMP;
ALTER TABLE "Order" ADD COLUMN "shippingProviderOverriddenBy" VARCHAR(100);

-- Backfill existing orders
UPDATE "Order" 
SET "shippingChargeQuotedPaise" = "shippingChargePaise",
    "shippingRateVerificationStatus" = 'LOCKED'
WHERE "shippingChargeQuotedPaise" IS NULL;

-- Index for query performance
CREATE INDEX "idx_order_shipping_verification_status" 
ON "Order"("shippingRateVerificationStatus");
```

---

## Implementation Rollout (Phased)

### Phase 1: Data Integrity (Week 1)
- Add schema columns and migrate existing orders
- Deploy code that reads/writes new fields (but doesn't enforce yet)
- Audit existing orders: identify any with provider mismatches

### Phase 2: Soft Enforcement (Week 2)
- Enable rate verification during fulfillment (logs discrepancies, doesn't block)
- Admin sees warning UI for flagged orders
- Collect metrics on how often rates diverge

### Phase 3: Hard Enforcement (Week 3)
- Block fulfillment if rates diverge > 5 rupees without override
- Admin must explicitly acknowledge before override
- All overrides audited in `shippingProviderOverriddenBy`

### Phase 4: Merchant Dashboard Reporting (Week 4)
- Add analytics report: "Shipping Cost Variance by Provider"
- Show trends: which provider pairs have largest deltas
- Helps merchant renegotiate contracts or adjust pricing strategy

---

## Testing Checklist

- [ ] Rate locks correctly during checkout (quoted price stored)
- [ ] Fulfillment uses locked provider if available
- [ ] Rate discrepancy detection works (verify against actual quote)
- [ ] Admin override requires explicit acknowledgment
- [ ] Override creates audit trail (`shippingProviderOverriddenBy`)
- [ ] Discrepancy flagged orders appear in dashboard
- [ ] Rate delta metrics are accurate
- [ ] Existing orders backfilled correctly
- [ ] No blocking bugs in shipping worker

---

## Success Metrics

**Before Fix:**
- Unknown: How many orders have rate mismatches?
- Merchant loss: Every mismatched order leaks margin silently

**After Fix:**
- Mismatch rate: < 1% of orders (expected variation in pricing)
- Merchant awareness: 100% visibility into all rate deltas
- Override audit trail: Zero "ghost" provider changes
- Fulfillment reliability: All orders ship with expected margin

---

## References

- **Flipkart Seller Docs:** Single provider per order, no switches mid-fulfillment
- **Amazon Logistics:** Multi-option checkout with rate locking
- **Shipway/Easyship Reports:** Rate reconciliation prevents "surprise invoices" from couriers
- **WooCommerce Plugins:** Rate verification threshold (default 10% variance trigger)
