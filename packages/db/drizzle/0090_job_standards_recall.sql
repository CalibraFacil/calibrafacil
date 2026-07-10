CREATE TABLE "job_standard" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"standard_id" integer NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "job_standard_job_standard_uidx" UNIQUE("job_id","standard_id")
);
--> statement-breakpoint
CREATE TABLE "standard_recall" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"standard_id" integer NOT NULL,
	"nc_id" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"from_date" timestamp,
	"to_date" timestamp,
	"approved_by" text,
	"approved_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oot_notification" ADD COLUMN "recall_id" integer;--> statement-breakpoint
ALTER TABLE "oot_notification" ADD CONSTRAINT "oot_notification_recall_job_uidx" UNIQUE("recall_id","job_id");--> statement-breakpoint
ALTER TABLE "job_standard" ADD CONSTRAINT "job_standard_job_id_calibration_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_standard" ADD CONSTRAINT "job_standard_standard_id_reference_standard_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."reference_standard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_recall" ADD CONSTRAINT "standard_recall_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_recall" ADD CONSTRAINT "standard_recall_standard_id_reference_standard_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."reference_standard"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_recall" ADD CONSTRAINT "standard_recall_nc_id_non_conformance_id_fk" FOREIGN KEY ("nc_id") REFERENCES "public"."non_conformance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_recall" ADD CONSTRAINT "standard_recall_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_recall" ADD CONSTRAINT "standard_recall_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oot_notification" ADD CONSTRAINT "oot_notification_recall_id_standard_recall_id_fk" FOREIGN KEY ("recall_id") REFERENCES "public"."standard_recall"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_standard_job_id_idx" ON "job_standard" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_standard_standard_id_idx" ON "job_standard" USING btree ("standard_id");--> statement-breakpoint
CREATE INDEX "standard_recall_organization_id_idx" ON "standard_recall" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "standard_recall_standard_id_idx" ON "standard_recall" USING btree ("standard_id");--> statement-breakpoint
CREATE UNIQUE INDEX "standard_recall_nc_uidx" ON "standard_recall" USING btree ("nc_id");--> statement-breakpoint
CREATE INDEX "oot_notification_recall_id_idx" ON "oot_notification" USING btree ("recall_id");--> statement-breakpoint
-- Backfill job_standard from the frozen standards_snapshot JSONB (#426 Phase 1).
-- The snapshot stays the source of truth; entries without a numeric id or
-- pointing at a since-deleted standard are counted and reported via NOTICE so
-- the "backfill if needed" mitigation from the issue has an audit trail.
DO $$
DECLARE
  inserted_count bigint;
  unmatched_entries bigint;
  jobs_without_snapshot bigint;
BEGIN
  INSERT INTO job_standard (job_id, standard_id, used_at)
  SELECT DISTINCT
    j.id,
    (entry->>'id')::int,
    COALESCE(j.performed_at, j.created_at)
  FROM calibration_job j
  CROSS JOIN LATERAL jsonb_array_elements(j.standards_snapshot) AS entry
  WHERE j.standards_snapshot IS NOT NULL
    AND jsonb_typeof(j.standards_snapshot) = 'array'
    AND (entry->>'id') ~ '^[0-9]+$'
    AND EXISTS (
      SELECT 1 FROM reference_standard rs WHERE rs.id = (entry->>'id')::int
    )
  ON CONFLICT ON CONSTRAINT job_standard_job_standard_uidx DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT count(*) INTO unmatched_entries
  FROM calibration_job j
  CROSS JOIN LATERAL jsonb_array_elements(j.standards_snapshot) AS entry
  WHERE j.standards_snapshot IS NOT NULL
    AND jsonb_typeof(j.standards_snapshot) = 'array'
    AND (
      (entry->>'id') IS NULL
      OR (entry->>'id') !~ '^[0-9]+$'
      OR NOT EXISTS (
        SELECT 1 FROM reference_standard rs WHERE rs.id = (entry->>'id')::int
      )
    );

  SELECT count(*) INTO jobs_without_snapshot
  FROM calibration_job j
  WHERE j.standards_snapshot IS NULL
    OR jsonb_typeof(j.standards_snapshot) <> 'array';

  RAISE NOTICE 'job_standard backfill: % links inserted, % snapshot entries unmatched (no/invalid id or missing standard), % jobs without a standards snapshot',
    inserted_count, unmatched_entries, jobs_without_snapshot;
END $$;
