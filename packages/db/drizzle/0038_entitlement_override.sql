-- Backoffice entitlement overrides: per-org feature GRANTS layered on top of the
-- plan (comps, upsell trials, one-off access), optionally time-boxed. Merged into
-- getOrganizationPlanAccess as grant-only — an override never removes a plan
-- entitlement. Additive only.

CREATE TABLE "entitlement_override" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "feature" text NOT NULL,
  "reason" text,
  "expires_at" timestamp,
  "created_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlement_override" ADD CONSTRAINT "entitlement_override_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "entitlement_override" ADD CONSTRAINT "entitlement_override_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "entitlement_override_org_idx" ON "entitlement_override" USING btree ("organization_id");
