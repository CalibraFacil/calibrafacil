CREATE TABLE "organization_unit" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_by" text,
  "archived_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "organization_unit_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "organization_unit_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "organization_unit_org_id_idx" ON "organization_unit" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "organization_unit_status_idx" ON "organization_unit" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_unit_org_slug_uidx" ON "organization_unit" USING btree ("organization_id","slug");
--> statement-breakpoint

CREATE TABLE "member_unit_assignment" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "member_id" text NOT NULL,
  "unit_id" integer NOT NULL,
  "role" text DEFAULT 'member' NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "member_unit_assignment_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "member_unit_assignment_member_id_member_id_fk"
    FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "member_unit_assignment_unit_id_organization_unit_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "member_unit_assignment_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "member_unit_assignment_member_unit_unique" UNIQUE("member_id","unit_id")
);
--> statement-breakpoint
CREATE INDEX "member_unit_assignment_org_id_idx" ON "member_unit_assignment" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "member_unit_assignment_member_id_idx" ON "member_unit_assignment" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX "member_unit_assignment_unit_id_idx" ON "member_unit_assignment" USING btree ("unit_id");
--> statement-breakpoint

CREATE TABLE "organization_event_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "unit_id" integer,
  "actor_user_id" text,
  "actor_member_id" text,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "organization_event_log_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "organization_event_log_unit_id_organization_unit_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "organization_event_log_actor_user_id_user_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "organization_event_log_actor_member_id_member_id_fk"
    FOREIGN KEY ("actor_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "organization_event_log_org_id_idx" ON "organization_event_log" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "organization_event_log_unit_id_idx" ON "organization_event_log" USING btree ("unit_id");
--> statement-breakpoint
CREATE INDEX "organization_event_log_action_idx" ON "organization_event_log" USING btree ("action");
--> statement-breakpoint
CREATE INDEX "organization_event_log_created_at_idx" ON "organization_event_log" USING btree ("created_at");
--> statement-breakpoint

INSERT INTO "organization_unit" ("organization_id", "name", "slug", "status", "is_default")
SELECT "id", 'Matriz', 'matriz', 'ACTIVE', true
FROM "organization"
WHERE COALESCE("type", 'LAB') = 'LAB';
--> statement-breakpoint

ALTER TABLE "asset" ADD COLUMN "unit_id" integer;
--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "unit_id" integer;
--> statement-breakpoint
ALTER TABLE "reference_standard" ADD COLUMN "unit_id" integer;
--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "unit_id" integer;
--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN "unit_id" integer;
--> statement-breakpoint

UPDATE "asset" AS a
SET "unit_id" = ou."id"
FROM "customer" AS c
INNER JOIN "organization_unit" AS ou
  ON ou."organization_id" = c."lab_organization_id"
  AND ou."is_default" = true
WHERE a."customer_id" = c."id";
--> statement-breakpoint
UPDATE "service" AS s
SET "unit_id" = ou."id"
FROM "organization_unit" AS ou
WHERE s."organization_id" = ou."organization_id"
  AND ou."is_default" = true;
--> statement-breakpoint
UPDATE "reference_standard" AS rs
SET "unit_id" = ou."id"
FROM "organization_unit" AS ou
WHERE rs."organization_id" = ou."organization_id"
  AND ou."is_default" = true;
--> statement-breakpoint
UPDATE "calibration_job" AS j
SET "unit_id" = ou."id"
FROM "organization_unit" AS ou
WHERE j."organization_id" = ou."organization_id"
  AND ou."is_default" = true;
--> statement-breakpoint
UPDATE "calibration_request" AS r
SET "unit_id" = ou."id"
FROM "organization_unit" AS ou
WHERE r."organization_id" = ou."organization_id"
  AND ou."is_default" = true;
--> statement-breakpoint

ALTER TABLE "asset"
  ALTER COLUMN "unit_id" SET NOT NULL,
  ADD CONSTRAINT "asset_unit_id_organization_unit_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service"
  ALTER COLUMN "unit_id" SET NOT NULL,
  ADD CONSTRAINT "service_unit_id_organization_unit_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reference_standard"
  ALTER COLUMN "unit_id" SET NOT NULL,
  ADD CONSTRAINT "reference_standard_unit_id_organization_unit_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_job"
  ALTER COLUMN "unit_id" SET NOT NULL,
  ADD CONSTRAINT "calibration_job_unit_id_organization_unit_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request"
  ALTER COLUMN "unit_id" SET NOT NULL,
  ADD CONSTRAINT "calibration_request_unit_id_organization_unit_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "asset_unit_id_idx" ON "asset" USING btree ("unit_id");
--> statement-breakpoint
CREATE INDEX "service_unit_id_idx" ON "service" USING btree ("unit_id");
--> statement-breakpoint
CREATE INDEX "standard_unit_id_idx" ON "reference_standard" USING btree ("unit_id");
--> statement-breakpoint
CREATE INDEX "job_unit_id_idx" ON "calibration_job" USING btree ("unit_id");
--> statement-breakpoint
CREATE INDEX "calibration_request_unit_id_idx" ON "calibration_request" USING btree ("unit_id");
--> statement-breakpoint

INSERT INTO "member_unit_assignment" ("organization_id", "member_id", "unit_id", "role")
SELECT
  m."organization_id",
  m."id",
  ou."id",
  CASE
    WHEN m."role" IN ('owner', 'admin') THEN 'unit_admin'
    WHEN m."role" = 'technician' THEN 'technician'
    ELSE 'member'
  END
FROM "member" AS m
INNER JOIN "organization" AS o
  ON o."id" = m."organization_id"
INNER JOIN "organization_unit" AS ou
  ON ou."organization_id" = m."organization_id"
  AND ou."is_default" = true
WHERE COALESCE(o."type", 'LAB') = 'LAB';
