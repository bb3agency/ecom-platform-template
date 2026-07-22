-- Product-level local delivery + split orders.
--
-- A product flagged isLocalDeliveryOnly is never handed to a courier: it ships exclusively
-- through the merchant-fulfilled local-delivery flow, so it can only reach pincodes on the
-- local-delivery whitelist. A cart mixing flagged and unflagged products splits at checkout
-- into two sibling orders linked by Order.orderGroupId, sharing a single Razorpay payment
-- (each sibling holds its own Payment row with its apportioned share and the same
-- providerOrderId).

-- AlterTable: product-level local-delivery-only flag. Defaults false so every existing
-- product keeps its current courier behaviour.
ALTER TABLE "Product" ADD COLUMN "isLocalDeliveryOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: links sibling orders produced by a split cart. Null for ordinary orders.
ALTER TABLE "Order" ADD COLUMN "orderGroupId" TEXT;

-- Sibling lookup ("show me the other order from this split") runs on every order detail
-- read for split orders, so it needs an index.
CREATE INDEX "Order_orderGroupId_idx" ON "Order"("orderGroupId");
