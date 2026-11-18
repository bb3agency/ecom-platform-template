-- Shipment booking runs asynchronously in the shipping worker. When it fails terminally
-- (Shiprocket wallet empty, pickup address not activated, destination unserviceable,
-- Delhivery rejection) the reason previously existed only in worker logs and an ops
-- email, so the merchant clicked "Ship order", no AWB ever arrived, and the admin UI
-- could not explain why. Persist the last terminal failure against the order.
ALTER TABLE "Order" ADD COLUMN "shipmentBookingError" TEXT;
ALTER TABLE "Order" ADD COLUMN "shipmentBookingFailedAt" TIMESTAMP(3);
