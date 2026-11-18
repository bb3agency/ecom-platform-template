-- Couriers key an order by the client reference we send and refuse to reuse one that has
-- been cancelled (Shiprocket answers a re-book on a cancelled reference with
-- "order is in cancelled state"), which left such orders permanently unbookable from
-- admin. Each abandoned attempt bumps this counter and the next booking goes out under
-- "<orderNumber>-R<n>", a fresh courier order.
ALTER TABLE "Order" ADD COLUMN "shipmentBookingAttempt" INTEGER NOT NULL DEFAULT 0;
