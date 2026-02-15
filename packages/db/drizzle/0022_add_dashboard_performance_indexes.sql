CREATE INDEX IF NOT EXISTS "job_org_status_due_idx"
  ON "calibration_job" ("organization_id", "status", "due_date");

CREATE INDEX IF NOT EXISTS "job_org_status_approved_at_idx"
  ON "calibration_job" ("organization_id", "status", "approved_at");

CREATE INDEX IF NOT EXISTS "job_org_status_rejected_at_idx"
  ON "calibration_job" ("organization_id", "status", "rejected_at");

CREATE INDEX IF NOT EXISTS "job_org_created_at_idx"
  ON "calibration_job" ("organization_id", "created_at");
