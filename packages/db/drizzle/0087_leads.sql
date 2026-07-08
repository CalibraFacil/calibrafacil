-- SEO / lead-gen track B — on-site marketing lead capture.
-- A public, unauthenticated inbound form writes here; NOT org-scoped.
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company" text,
	"segment" text DEFAULT 'outro' NOT NULL,
	"message" text,
	"status" text DEFAULT 'new' NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"referrer" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" ("created_at");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" ("status");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" ("email");
