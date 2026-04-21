ALTER TABLE "asset"
ADD COLUMN "base_measurement_unit" text;
--> statement-breakpoint
UPDATE "asset"
SET "base_measurement_unit" =
  CASE
    WHEN jsonb_typeof("specifications"->'weighingRanges') = 'array'
      AND jsonb_array_length("specifications"->'weighingRanges') > 0
      AND lower(coalesce("specifications"->'weighingRanges'->0->>'rangeUnit', '')) IN ('mg', 'g', 'kg')
    THEN lower("specifications"->'weighingRanges'->0->>'rangeUnit')
    WHEN jsonb_typeof("specifications"->'weighingRanges') = 'array'
      AND jsonb_array_length("specifications"->'weighingRanges') > 0
      AND lower(coalesce("specifications"->'weighingRanges'->0->>'resolutionUnit', '')) IN ('mg', 'g', 'kg')
    THEN lower("specifications"->'weighingRanges'->0->>'resolutionUnit')
    WHEN "specifications" ? 'capacity'
      OR "specifications" ? 'resolution'
      OR "specifications" ? 'linearity'
      OR "specifications" ? 'repeatability'
    THEN 'g'
    ELSE NULL
  END
WHERE "base_measurement_unit" IS NULL;
