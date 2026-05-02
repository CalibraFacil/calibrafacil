CREATE TABLE "app_queue_job" (
  "id" serial PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "available_at" timestamp DEFAULT now() NOT NULL,
  "locked_by" text,
  "locked_at" timestamp,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "app_queue_job_status_available_idx"
  ON "app_queue_job" USING btree ("status", "available_at");

CREATE INDEX "app_queue_job_locked_at_idx"
  ON "app_queue_job" USING btree ("locked_at");

CREATE INDEX "app_queue_job_type_idx"
  ON "app_queue_job" USING btree ("type");
