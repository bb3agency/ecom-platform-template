-- AddColumn: shippingChargeQuotedPaise on Order
-- Stores the shipping rate quoted to the customer at checkout time (immutable after creation).
-- This is always equal to shippingCharge at order creation; kept separate so any future
-- admin adjustment to shippingCharge does not erase the original checkout quote.

ALTER TABLE "Order" ADD COLUMN "shippingChargeQuotedPaise" INTEGER;

-- Backfill existing orders: their quoted rate equals the shipping charge already recorded.
UPDATE "Order" SET "shippingChargeQuotedPaise" = "shippingCharge";
