CREATE TABLE "member_visual_signature" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_signing_certificate" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"serial_number" text NOT NULL,
	"issuer_cn" text NOT NULL,
	"subject_cn" text NOT NULL,
	"subject_cpf_cnpj" text,
	"valid_from" timestamp NOT NULL,
	"valid_until" timestamp NOT NULL,
	"encrypted_p12" text NOT NULL,
	"encrypted_password" text NOT NULL,
	"password_iv" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" text,
	"revoked_reason" text
);
--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "signature_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "member_visual_signature" ADD CONSTRAINT "member_visual_signature_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_visual_signature" ADD CONSTRAINT "member_visual_signature_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signing_certificate" ADD CONSTRAINT "organization_signing_certificate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signing_certificate" ADD CONSTRAINT "organization_signing_certificate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signing_certificate" ADD CONSTRAINT "organization_signing_certificate_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_visual_sig_org_id_idx" ON "member_visual_signature" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_visual_sig_unique_idx" ON "member_visual_signature" USING btree ("member_id","organization_id");--> statement-breakpoint
CREATE INDEX "org_signing_cert_org_id_idx" ON "organization_signing_certificate" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_signing_cert_valid_until_idx" ON "organization_signing_certificate" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "org_signing_cert_is_default_idx" ON "organization_signing_certificate" USING btree ("organization_id","is_default");