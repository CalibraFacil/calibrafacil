-- DOM-02 (#655): link a repair service order to the calibration job opened as
-- its follow-up. The technician flags a repair OS with
-- `service_order_execution.calibration_required_after_repair`; opening the new
-- calibration from that OS now records the back-link on the calibration job so
-- the "calibração pendente após reparo" queue can tell which OSs still need a
-- calibration opened (leftJoin on this column, IS NULL = still pending).
--
-- Additive and nullable: existing calibration jobs keep source_service_order_id
-- null. ON DELETE SET NULL so removing an OS never cascades into an issued
-- certificate. Forward-only and idempotent.
ALTER TABLE "calibration_job" ADD COLUMN IF NOT EXISTS "source_service_order_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_source_service_order_id_service_order_id_fk" FOREIGN KEY ("source_service_order_id") REFERENCES "public"."service_order"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_source_service_order_id_idx" ON "calibration_job" ("source_service_order_id");
