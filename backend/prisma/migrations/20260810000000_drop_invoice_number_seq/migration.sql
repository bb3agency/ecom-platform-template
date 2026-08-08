-- Invoice numbers are now DERIVED from the order number (`INV-<order-ref>`), not drawn
-- from a global counter (backend-core 0.1.86 / BR-GST-05 as amended 2026-08-09).
-- Derived numbering is idempotent (regeneration reissues the same number), globally
-- unique via the order-number unique constraint, and leaks no business volume.
-- The sequence is no longer read anywhere; drop it so it cannot drift back into use.
DROP SEQUENCE IF EXISTS invoice_number_seq;
