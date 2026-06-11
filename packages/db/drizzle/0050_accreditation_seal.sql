ALTER TABLE "organization" ADD COLUMN "accreditation_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "accredited_scope" boolean DEFAULT false NOT NULL;
