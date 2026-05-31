-- Backoffice approval requests: maker-checker / dual-control over sensitive,
-- money-touching actions (refunds, credits, adjustments). One operator opens a
-- request; a *different* platform admin approves or rejects it. The decision
-- record is the governance artifact; downstream execution happens separately.
-- Additive only.

CREATE TABLE "approval_request" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "kind" text DEFAULT 'other' NOT NULL,
  "summary" text NOT NULL,
  "amount_cents" integer,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "requested_by_user_id" text,
  "decided_by_user_id" text,
  "decision_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "decided_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "approval_request_org_idx" ON "approval_request" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "approval_request_status_idx" ON "approval_request" USING btree ("status");
