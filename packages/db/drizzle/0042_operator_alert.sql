-- Operator-addressed alerts (operations-console gap #5). The `operator-alerts`
-- cron recomputes proactive risk signals and upserts them here so the team is
-- notified (until now only labs were). `dedupe_key` makes recompute idempotent;
-- alerts whose condition clears are swept; acknowledgement persists. New table —
-- no impact on existing queries.

CREATE TABLE "operator_alert" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text,
  "dedupe_key" text NOT NULL,
  "kind" text NOT NULL,
  "severity" text DEFAULT 'warning' NOT NULL,
  "title" text NOT NULL,
  "detail" text,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "acknowledged_by_user_id" text,
  "acknowledged_at" timestamp,
  "first_seen_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "operator_alert_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "operator_alert" ADD CONSTRAINT "operator_alert_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "operator_alert" ADD CONSTRAINT "operator_alert_acknowledged_by_user_id_user_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "operator_alert_status_idx" ON "operator_alert" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "operator_alert_org_idx" ON "operator_alert" USING btree ("organization_id");
