ALTER TABLE "calibration_method" ADD COLUMN "technical_reviewed_by" text;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_technical_reviewed_by_user_id_fk" FOREIGN KEY ("technical_reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
