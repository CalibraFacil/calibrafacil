ALTER TABLE "calibration_job" ADD COLUMN "supersedes_id" integer;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "superseded_by_id" integer;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "amendment_number" integer;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "amendment_reason" text;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "superseded_at" timestamp;--> statement-breakpoint
CREATE INDEX "job_supersedes_id_idx" ON "calibration_job" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "job_superseded_by_id_idx" ON "calibration_job" USING btree ("superseded_by_id");