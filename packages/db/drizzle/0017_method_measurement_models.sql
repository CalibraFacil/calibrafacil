ALTER TABLE "calibration_method"
ADD COLUMN "measurement_models" jsonb DEFAULT '[]'::jsonb NOT NULL;
