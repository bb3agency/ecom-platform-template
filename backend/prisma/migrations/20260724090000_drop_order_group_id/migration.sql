-- Local delivery no longer splits a cart across fulfilment channels: a whitelisted pincode
-- delivers the whole cart locally, otherwise it is a single courier order (or checkout is
-- blocked when a local-delivery-only product cannot reach the pincode). With no split there
-- are no sibling orders, so Order.orderGroupId and its index are removed.
--
-- Safe to drop: no split order was ever created in production (no product was flagged during
-- the brief window the split existed), so every existing row has orderGroupId = NULL.
DROP INDEX IF EXISTS "Order_orderGroupId_idx";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "orderGroupId";
