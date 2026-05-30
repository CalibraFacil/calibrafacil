-- Account interaction log (operations-console gap #14, omnichannel core). A
-- unified, manually-recorded timeline of operator↔tenant touchpoints (WhatsApp,
-- email, call, meeting, internal note) so context lives in one place. New table —
-- no impact on existing queries. Auto-capture from the channels is the follow-up.

CREATE TABLE "account_interaction" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "channel" text DEFAULT 'note' NOT NULL,
  "direction" text DEFAULT 'outbound' NOT NULL,
  "summary" text NOT NULL,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_interaction" ADD CONSTRAINT "account_interaction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_interaction" ADD CONSTRAINT "account_interaction_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "account_interaction_org_idx" ON "account_interaction" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "account_interaction_occurred_idx" ON "account_interaction" USING btree ("occurred_at");
