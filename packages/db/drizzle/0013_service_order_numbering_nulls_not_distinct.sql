DROP INDEX IF EXISTS "service_order_numbering_sequence_uidx";

CREATE UNIQUE INDEX IF NOT EXISTS "service_order_numbering_sequence_uidx"
  ON "service_order_numbering_sequence" ("organization_id", "unit_id", "sequence_key")
  NULLS NOT DISTINCT;
