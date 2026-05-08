ALTER TABLE "calibration_method"
ADD COLUMN "compiled_method" jsonb,
ADD COLUMN "method_fingerprint" text,
ADD COLUMN "method_engine" jsonb,
ADD COLUMN "method_compiled_at" timestamp,
ADD COLUMN "publication_evidence" jsonb;
