ALTER TABLE "calibration_method"
ADD COLUMN "variable_bindings" jsonb DEFAULT '[]'::jsonb NOT NULL;
