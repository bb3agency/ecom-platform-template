-- GST invoice sequential numbering (BR-GST-05). Previously created lazily at runtime
-- by the first invoice generation via CREATE SEQUENCE IF NOT EXISTS — which fails when
-- the runtime database role lacks CREATE on the schema (PostgreSQL 15+ default).
-- Creating it here means migrations (which already create every table) own the DDL and
-- generation never needs schema privileges. Idempotent: safe on databases where the
-- runtime fallback already created it.
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;
