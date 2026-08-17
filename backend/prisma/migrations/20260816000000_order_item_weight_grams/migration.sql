-- Snapshot per-unit net weight on the order line so invoices never re-read a
-- variant weight that may have changed since the sale.
ALTER TABLE "OrderItem" ADD COLUMN "weightGrams" INTEGER;
