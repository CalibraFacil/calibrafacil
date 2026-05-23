CREATE TABLE IF NOT EXISTS "passkey" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "public_key" text NOT NULL,
  "user_id" text NOT NULL,
  "credential_id" text NOT NULL,
  "counter" integer NOT NULL,
  "device_type" text NOT NULL,
  "backed_up" boolean NOT NULL,
  "transports" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "aaguid" text,
  CONSTRAINT "passkey_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "passkey_user_id_idx"
  ON "passkey" USING btree ("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "passkey_credential_id_uidx"
  ON "passkey" USING btree ("credential_id");

CREATE TABLE IF NOT EXISTS "lab_account_setup_token" (
  "id" text PRIMARY KEY NOT NULL,
  "secret_hash" text NOT NULL,
  "user_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "invitation_id" text,
  "email" text NOT NULL,
  "purpose" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "created_by_user_id" text,
  "source" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "lab_account_setup_token_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "lab_account_setup_token_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "lab_account_setup_token_invitation_id_invitation_id_fk"
    FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "lab_account_setup_token_created_by_user_id_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "lab_account_setup_token_user_idx"
  ON "lab_account_setup_token" USING btree ("user_id");

CREATE INDEX IF NOT EXISTS "lab_account_setup_token_org_idx"
  ON "lab_account_setup_token" USING btree ("organization_id");

CREATE INDEX IF NOT EXISTS "lab_account_setup_token_invitation_idx"
  ON "lab_account_setup_token" USING btree ("invitation_id");

CREATE INDEX IF NOT EXISTS "lab_account_setup_token_expires_idx"
  ON "lab_account_setup_token" USING btree ("expires_at");

CREATE INDEX IF NOT EXISTS "lab_account_setup_token_consumed_idx"
  ON "lab_account_setup_token" USING btree ("consumed_at");
