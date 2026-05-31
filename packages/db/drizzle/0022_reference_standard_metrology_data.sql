ALTER TABLE "reference_standard"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'generic_scalar',
  ADD COLUMN IF NOT EXISTS "metrology_data" jsonb;
