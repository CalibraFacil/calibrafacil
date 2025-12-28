ALTER TABLE "calibration_method" DROP CONSTRAINT "calibration_method_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "calibration_method" DROP CONSTRAINT "calibration_method_published_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;