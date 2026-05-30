-- Backoffice account tasks: first-class, assignable, due-dated operator tasks
-- per account, superseding the single free-text customer-success `nextAction`.
-- The substrate for onboarding / migration / dunning / go-live playbook motions
-- and the operator "my day" worklist. Additive only.

CREATE TABLE "account_task" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "title" text NOT NULL,
  "type" text DEFAULT 'GENERAL' NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "owner_user_id" text,
  "due_at" timestamp,
  "notes" text,
  "created_by_user_id" text,
  "completed_at" timestamp,
  "completed_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_task" ADD CONSTRAINT "account_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_task" ADD CONSTRAINT "account_task_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_task" ADD CONSTRAINT "account_task_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_task" ADD CONSTRAINT "account_task_completed_by_user_id_user_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "account_task_org_id_idx" ON "account_task" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "account_task_status_idx" ON "account_task" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "account_task_owner_idx" ON "account_task" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "account_task_due_idx" ON "account_task" USING btree ("due_at");
